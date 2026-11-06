#!/usr/bin/env node
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { projectRoot } from '../src/paths.js';
import { errorMessage } from '../src/errors.js';
import { exists, sha256, downloadVerified, installDirectory, recoverReplacement, runInstaller } from '../src/install.js';
import { acquireRuntimeLock, createShutdownController, ShutdownError } from '../src/lifecycle.js';
import { CHROMIUM_ARCHIVES, CHROMIUM_REVISION, WINE_SHA256, WINE_VERSION, ZIG_SHA256, ZIG_VERSION, inspectComponent, inspectRuntime } from '../src/runtime.js';

const { values } = parseArgs({ options: { runtime: { type: 'string', default: join(projectRoot, '.runtime') }, repair: { type: 'boolean' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('Usage: node dist/bin/setup-wine.js [--runtime <directory>] [--repair]\nInstall missing pinned components. --repair also replaces damaged components. Healthy components and the Wine prefix are preserved.');
  process.exit(0);
}
const runtime = resolve(values.runtime);
const shutdown = createShutdownController();
const { signal } = shutdown;
let lock: Awaited<ReturnType<typeof acquireRuntimeLock>> | undefined;
const run = (file: string, args: string[], extra: { env?: NodeJS.ProcessEnv } = {}) => runInstaller(file, args, { signal, ...extra });

async function prepareToolchain(): Promise<{ zig: string; pythonPackages: string }> {
  const zigDirectory = join(runtime, `zig-aarch64-macos-${ZIG_VERSION}`);
  const zig = join(zigDirectory, 'zig');
  let zigReady = false;
  if (await exists(zig)) {
    try { zigReady = (await run(zig, ['version'])).stdout.trim() === ZIG_VERSION; }
    catch { signal.throwIfAborted(); }
  }
  if (!zigReady) {
    if (await exists(zigDirectory) && !values.repair) throw new Error('The compatibility compiler is incomplete or changed. Run setup with --repair.');
    const archive = join(runtime, 'zig.tar.xz');
    console.log('Preparing the pinned compatibility toolchain…');
    await downloadVerified(`https://ziglang.org/download/${ZIG_VERSION}/zig-aarch64-macos-${ZIG_VERSION}.tar.xz`, archive, ZIG_SHA256, { signal });
    await installDirectory(zigDirectory, async staging => {
      await run('/usr/bin/tar', ['-xf', archive, '-C', staging]);
      return join(staging, `zig-aarch64-macos-${ZIG_VERSION}`);
    }, async candidate => { if ((await run(join(candidate, 'zig'), ['version'])).stdout.trim() !== ZIG_VERSION) throw new Error('Zig extraction has an unexpected version.'); }, signal);
  }
  const pythonPackages = join(runtime, 'python');
  const checkPython = async (directory: string) => run('python3', ['-c', 'import pefile; assert pefile.__version__ == "2024.8.26"'], { env: { ...process.env, PYTHONPATH: directory } });
  let pythonReady = false;
  if (await exists(join(pythonPackages, 'pefile.py'))) {
    try { await checkPython(pythonPackages); pythonReady = true; }
    catch { signal.throwIfAborted(); }
  }
  if (!pythonReady) {
    if (await exists(pythonPackages) && !values.repair) throw new Error('The compatibility Python package is incomplete or changed. Run setup with --repair.');
    await installDirectory(pythonPackages, async staging => {
      await run('python3', ['-m', 'pip', 'install', '--target', staging, 'pefile==2024.8.26', '--disable-pip-version-check', '--quiet']);
      return staging;
    }, async candidate => { await checkPython(candidate); }, signal);
  }
  return { zig, pythonPackages };
}

async function buildShim(browserDirectory: string): Promise<void> {
  const { zig, pythonPackages } = await prepareToolchain();
  const result = await run('python3', [join(projectRoot, 'bin/pointer-compat.py'), browserDirectory, '--zig', zig], {
    env: { ...process.env, PYTHONPATH: pythonPackages, ZIG_GLOBAL_CACHE_DIR: join(runtime, 'zig-cache'), ZIG_LOCAL_CACHE_DIR: join(runtime, 'zig-local-cache') }
  });
  console.log(result.stdout.trim());
  await recordShimHash(browserDirectory);
}

async function recordShimHash(browserDirectory: string): Promise<void> {
  const path = join(browserDirectory, 'wineglass-compat.json');
  const manifest: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof manifest !== 'object' || manifest === null) throw new Error('Invalid compatibility manifest.');
  const value = { ...manifest, shimSHA256: await sha256(join(browserDirectory, 'WGUI32.dll'), signal) };
  await writeFile(`${path}.partial`, `${JSON.stringify(value, null, 2)}\n`);
  signal.throwIfAborted();
  await rename(`${path}.partial`, path);
}

try {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Automatic setup supports Apple Silicon macOS only.');
  try { await run('/usr/bin/arch', ['-x86_64', '/usr/bin/true']); }
  catch { signal.throwIfAborted(); throw new Error('Rosetta is not installed. Install Apple Rosetta, then rerun setup.'); }
  lock = await acquireRuntimeLock(runtime, { signal });
  for (const name of ['Wine Devel.app', 'chromium-win', 'chromium-mac', `zig-aarch64-macos-${ZIG_VERSION}`, 'python']) await recoverReplacement(join(runtime, name));
  await mkdir(runtime, { recursive: true });
  const wineDirectory = join(runtime, 'Wine Devel.app');
  const wineCheck = await inspectComponent('wine', wineDirectory, { signal });
  if (!wineCheck.ok) {
    if (await exists(wineDirectory) && !values.repair) throw new Error('Existing Wine files are incomplete or changed. Run setup with --repair to replace only damaged components.');
    console.log('Installing the pinned Wine runtime…');
    const archive = join(runtime, 'wine.tar.xz');
    await downloadVerified(`https://github.com/Gcenx/macOS_Wine_builds/releases/download/${WINE_VERSION}/wine-devel-${WINE_VERSION}-osx64.tar.xz`, archive, WINE_SHA256, { signal });
    await installDirectory(wineDirectory, async staging => {
      await run('/usr/bin/tar', ['-xf', archive, '-C', staging]);
      return join(staging, 'Wine Devel.app');
    }, async candidate => { const result = await inspectComponent('wine', candidate, { signal }); if (!result.ok) throw new Error(result.issues.map(issue => issue.message).join('\n')); }, signal);
  }
  for (const item of CHROMIUM_ARCHIVES) {
    const directory = join(runtime, item.directory);
    const component = item.platform === 'Win_x64' ? 'windows' : 'mac';
    const inspection = await inspectComponent(component, directory, { signal });
    if (inspection.ok) {
      if (component === 'windows' && inspection.issues.some(issue => issue.code === 'legacy_shim_receipt')) await recordShimHash(join(directory, 'chrome-win'));
      continue;
    }
    if (await exists(directory) && !values.repair) throw new Error(`Existing ${component} Chromium files are incomplete or changed. Run setup with --repair.\n${inspection.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('\n')}`);
    console.log(`Installing matching ${component} Chromium…`);
    const archive = join(runtime, `${item.platform}-${CHROMIUM_REVISION}.zip`);
    await downloadVerified(`https://commondatastorage.googleapis.com/chromium-browser-snapshots/${item.platform}/${CHROMIUM_REVISION}/${item.archive}`, archive, item.sha256, { signal });
    await installDirectory(directory, async staging => {
      await run('/usr/bin/ditto', ['-x', '-k', archive, staging]);
      if (component === 'windows') await buildShim(join(staging, 'chrome-win'));
      return staging;
    }, async candidate => { const result = await inspectComponent(component, candidate, { signal }); if (!result.ok) throw new Error(result.issues.map(issue => issue.message).join('\n')); }, signal);
  }
  await writeFile(join(runtime, 'chromium-revision.txt.partial'), `${CHROMIUM_REVISION}\n`);
  signal.throwIfAborted();
  await rename(join(runtime, 'chromium-revision.txt.partial'), join(runtime, 'chromium-revision.txt'));
  const final = await inspectRuntime(runtime, { signal });
  if (!final.ok) throw new Error(final.issues.map(issue => issue.message).join('\n'));
  console.log(`Runtime verified in ${runtime}\nNo virtual machine or Windows installation is used.\nNext: node dist/bin/wineglass.js --demo --runtime "${runtime}"`);
} catch (error) {
  console.error(`WineGlass setup: ${errorMessage(error)}`);
  process.exitCode = error instanceof ShutdownError ? error.exitCode : signal.aborted && signal.reason instanceof ShutdownError ? signal.reason.exitCode : 1;
} finally {
  try { await lock?.release(); } finally { shutdown.dispose(); }
}
