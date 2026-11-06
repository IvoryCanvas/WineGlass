import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { CHROMIUM_VERSION, inspectRuntime, WINE_VERSION } from './runtime.js';
import type { RuntimeInspection } from './runtime.js';

const exec = promisify(execFile);
export interface DoctorReport extends RuntimeInspection { versions: { node: string; wine?: string; macChromium?: string } }

export async function diagnoseRuntime(runtime: string, options: { signal?: AbortSignal } = {}): Promise<DoctorReport> {
  runtime = resolve(runtime);
  const inspection = await inspectRuntime(runtime, options);
  const { issues } = inspection;
  const versions: DoctorReport['versions'] = { node: process.version };
  if (Number(process.versions.node.split('.')[0]) < 22) issues.push({ code: 'node_version', component: 'install', severity: 'error', message: 'Node.js 22 or newer is required.' });
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    issues.push({ code: 'unsupported_platform', component: 'install', severity: 'error', message: 'Automatic setup is supported on Apple Silicon macOS only.' });
  } else {
    const runOptions = { timeout: 10000, ...(options.signal ? { signal: options.signal } : {}) };
    try { await exec('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], runOptions); }
    catch { options.signal?.throwIfAborted(); issues.push({ code: 'rosetta_missing', component: 'install', severity: 'error', message: 'Rosetta is unavailable. Install Apple Rosetta before running WineGlass.' }); }
    if (!issues.some(issue => issue.component === 'wine' && issue.severity === 'error')) {
      try {
        const result = await exec(join(runtime, 'Wine Devel.app/Contents/Resources/wine/bin/wine'), ['--version'], { ...runOptions, env: { ...process.env, WINEPREFIX: join(runtime, 'prefix') } });
        versions.wine = result.stdout.trim();
        if (!versions.wine.includes(`wine-${WINE_VERSION}`)) throw new Error('Unexpected Wine version');
      } catch { options.signal?.throwIfAborted(); issues.push({ code: 'wine_version', component: 'wine', severity: 'error', message: `Wine did not report the pinned version ${WINE_VERSION}.` }); }
    }
    if (!issues.some(issue => issue.component === 'mac' && issue.severity === 'error')) {
      try {
        const result = await exec(join(runtime, 'chromium-mac/chrome-mac/Chromium.app/Contents/MacOS/Chromium'), ['--version'], runOptions);
        versions.macChromium = result.stdout.trim();
        if (!versions.macChromium.includes(CHROMIUM_VERSION)) throw new Error('Unexpected Chromium version');
      } catch { options.signal?.throwIfAborted(); issues.push({ code: 'mac_version', component: 'mac', severity: 'error', message: `macOS Chromium did not report the pinned version ${CHROMIUM_VERSION}.` }); }
    }
  }
  return { ...inspection, ok: !issues.some(issue => issue.severity === 'error'), versions };
}
