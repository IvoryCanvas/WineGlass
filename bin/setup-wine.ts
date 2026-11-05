#!/usr/bin/env node
import { mkdir, writeFile, access, rename } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { projectRoot } from '../src/paths.js';
import { errorMessage } from '../src/errors.js';

const exec = promisify(execFile);
const root = projectRoot;
const runtime = join(root, '.runtime');
const WINE_URL = 'https://github.com/Gcenx/macOS_Wine_builds/releases/download/11.21/wine-devel-11.21-osx64.tar.xz';
const WINE_SHA256 = '9909b486657e10ab66c7279371ae1f990345b596b3b1b3a0cf21f28af24fa0ce';
const CHROMIUM_REVISION = '1735907';
const ZIG_VERSION = '0.17.1';
const ZIG_SHA256 = '75f1bc7a1e9852f17ec9a0c1895f767c4ec56d46bc8a834920eece1d0359dd8d';

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function download(url: string, path: string, expectedHash?: string): Promise<void> {
  if (await exists(path) && (!expectedHash || await sha256(path) === expectedHash)) return;
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const temp = `${path}.partial`;
  await pipeline(Readable.from(response.body, { objectMode: false }), createWriteStream(temp));
  if (expectedHash && await sha256(temp) !== expectedHash) throw new Error('Wine archive SHA-256 does not match its published release digest.');
  await rename(temp, path);
}

try {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This setup script is currently tested on Apple Silicon macOS only.');
  if (process.arch === 'arm64') {
    try { await exec('/usr/bin/arch', ['-x86_64', '/usr/bin/true']); }
    catch { throw new Error('Rosetta is not installed. Install it with softwareupdate --install-rosetta, then rerun. This script does not install system components.'); }
  }
  await mkdir(runtime, { recursive: true });
  const wine = join(runtime, 'Wine Devel.app/Contents/Resources/wine/bin/wine');
  if (!await exists(wine)) {
    const archive = join(runtime, 'wine.tar.xz');
    await download(WINE_URL, archive, WINE_SHA256);
    await exec('/usr/bin/tar', ['-xf', archive, '-C', runtime], { timeout: 180000 });
  }
  // A shared Chromium snapshot revision keeps the browser engine the same.
  for (const item of [
    { platform: 'Win_x64', archive: 'chrome-win.zip', directory: 'chromium-win', binary: 'chrome-win/chrome.exe' },
    { platform: 'Mac_Arm', archive: 'chrome-mac.zip', directory: 'chromium-mac', binary: 'chrome-mac/Chromium.app/Contents/MacOS/Chromium' }
  ]) {
    const directory = join(runtime, item.directory);
    if (!await exists(join(directory, item.binary))) {
      await mkdir(directory, { recursive: true });
      const archive = join(runtime, `${item.platform}-${CHROMIUM_REVISION}.zip`);
      const url = `https://commondatastorage.googleapis.com/chromium-browser-snapshots/${item.platform}/${CHROMIUM_REVISION}/${item.archive}`;
      await download(url, archive);
      await exec('/usr/bin/ditto', ['-x', '-k', archive, directory], { timeout: 180000 });
    }
  }
  await writeFile(join(runtime, 'chromium-revision.txt'), `${CHROMIUM_REVISION}\n`);
  const browserDirectory = join(runtime, 'chromium-win/chrome-win');
  if (!await exists(join(browserDirectory, 'wineglass-compat.json'))) {
    console.log('Building the documented GetPointerDevice compatibility shim for Wine.');
    const zig = join(runtime, `zig-aarch64-macos-${ZIG_VERSION}/zig`);
    if (!await exists(zig)) {
      const archive = join(runtime, 'zig.tar.xz');
      await download(`https://ziglang.org/download/${ZIG_VERSION}/zig-aarch64-macos-${ZIG_VERSION}.tar.xz`, archive, ZIG_SHA256);
      await exec('/usr/bin/tar', ['-xf', archive, '-C', runtime], { timeout: 180000 });
    }
    const pythonPackages = join(runtime, 'python');
    if (!await exists(join(pythonPackages, 'pefile.py'))) {
      await exec('python3', ['-m', 'pip', 'install', '--target', pythonPackages, 'pefile==2024.8.26', '--disable-pip-version-check', '--quiet'], { timeout: 180000 });
    }
    const result = await exec('python3', [join(root, 'bin/pointer-compat.py'), browserDirectory, '--zig', zig], {
      env: { ...process.env, PYTHONPATH: pythonPackages, ZIG_GLOBAL_CACHE_DIR: join(runtime, 'zig-cache'), ZIG_LOCAL_CACHE_DIR: join(runtime, 'zig-local-cache') },
      timeout: 180000
    });
    console.log(result.stdout);
  }
  console.log(`Runtime ready in ${runtime}\nNo virtual machine or Windows installation is used.\nNext: node dist/bin/wineglass.js --demo`);
} catch (error) { console.error(errorMessage(error)); process.exitCode = 1; }
