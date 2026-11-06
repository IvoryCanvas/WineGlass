import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { exists, sha256 } from './install.js';

export const WINE_VERSION = '11.21';
export const CHROMIUM_REVISION = '1735907';
export const CHROMIUM_VERSION = '159.0.8144.0';
export const ZIG_VERSION = '0.17.1';
export const WINE_SHA256 = '9909b486657e10ab66c7279371ae1f990345b596b3b1b3a0cf21f28af24fa0ce';
export const ZIG_SHA256 = '75f1bc7a1e9852f17ec9a0c1895f767c4ec56d46bc8a834920eece1d0359dd8d';
// Digests pinned from the official snapshot downloads used by this project.
export const CHROMIUM_ARCHIVES = [
  { platform: 'Win_x64', archive: 'chrome-win.zip', directory: 'chromium-win', sha256: '003981f356ab6f987e7e81708460175a0691f5c919e8e20e076eec92cfb10849' },
  { platform: 'Mac_Arm', archive: 'chrome-mac.zip', directory: 'chromium-mac', sha256: '335c4c01f00079e6353c3f1fe6288417810f6ef05092ad1dbee89748ae3a7357' }
] as const;

export type RuntimeComponent = 'wine' | 'mac' | 'windows' | 'shim' | 'revision' | 'install';
export interface RuntimeIssue { code: string; message: string; component: RuntimeComponent; severity: 'error' | 'warning' }
export interface RuntimeInspection { ok: boolean; issues: RuntimeIssue[]; checkedFiles: number }

interface Fingerprint { path: string; hash: string; executable?: boolean }
const WINE_FILES: readonly Fingerprint[] = [
  { path: 'Contents/Resources/wine/bin/wine', hash: '0a6318981ece3921e2161bc4b4e060001380bb11e22847d99e3faa1cacd31037', executable: true },
  { path: 'Contents/Resources/wine/bin/wineserver', hash: 'fd24f27d77c34e0dec9515d4d1f6763bd555eb93bb812367a4ec606da62fdbab', executable: true }
];
const MAC_FILES: readonly Fingerprint[] = [
  { path: 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', hash: '0056a20d4e427f808474c894c2c60fa262f64d24cefc4f1c58aa0f25c31c3cfa', executable: true },
  { path: `chrome-mac/Chromium.app/Contents/Frameworks/Chromium Framework.framework/Versions/${CHROMIUM_VERSION}/Chromium Framework`, hash: 'a07872a9012abf09d87465bfae2177470a6b6f5b60e36d1d347bb594747e692e' }
];
export const ORIGINAL_CHROME_SHA256 = 'f07101db796d881cbad33703592a98c88bd9437eddb0e7c76da6f385142d9212';
export const PATCHED_CHROME_SHA256 = '3ca0bb96de7bc2dfedcd682b4cfe9783e343f3752bc803b090d2492621dea16f';
export const LEGACY_SHIM_SHA256 = '8570c0cbe27df4551e46a8b73bc24478107c28e4ee2e44121776c6aa8b8f5ea8';
const WINDOWS_FILES: readonly Fingerprint[] = [
  { path: 'chrome-win/chrome.exe', hash: 'eb9db7d8c325d2259c7f43e32476ee657c8964cc2fb964d3e222ac3b870089ca' },
  { path: 'chrome-win/chrome.dll', hash: PATCHED_CHROME_SHA256 },
  { path: 'chrome-win/chrome.dll.wineglass-original', hash: ORIGINAL_CHROME_SHA256 }
];

async function checkFile(path: string, hash: string | undefined, component: RuntimeComponent, issues: RuntimeIssue[], signal?: AbortSignal, executable = false): Promise<void> {
  signal?.throwIfAborted();
  try {
    if (!(await stat(path)).isFile()) throw new Error('Not a regular file');
    if (executable) {
      try { await access(path, constants.X_OK); }
      catch { issues.push({ code: 'not_executable', component, severity: 'error', message: `File is not executable: ${path}` }); }
    }
    if (hash && await sha256(path, signal) !== hash) issues.push({ code: 'hash_mismatch', component, severity: 'error', message: `Unexpected file contents: ${path}` });
  } catch (error) {
    signal?.throwIfAborted();
    issues.push({ code: 'missing_file', component, severity: 'error', message: `Missing or unreadable file: ${path}` });
  }
}

export async function inspectComponent(component: 'wine' | 'mac' | 'windows', directory: string, options: { signal?: AbortSignal } = {}): Promise<RuntimeInspection> {
  const issues: RuntimeIssue[] = [];
  const fingerprints = component === 'wine' ? WINE_FILES : component === 'mac' ? MAC_FILES : WINDOWS_FILES;
  for (const file of fingerprints) await checkFile(join(directory, file.path), file.hash, component, issues, options.signal, file.executable);
  // Essential resources are presence-checked, not an exhaustive runtime audit.
  const resources = component === 'windows' ? ['chrome-win/icudtl.dat', 'chrome-win/resources.pak', 'chrome-win/chrome_100_percent.pak'] : [];
  for (const path of resources) await checkFile(join(directory, path), undefined, component, issues, options.signal);
  if (component === 'windows') issues.push(...await inspectShim(join(directory, 'chrome-win'), options.signal));
  return { ok: !issues.some(issue => issue.severity === 'error'), issues, checkedFiles: fingerprints.length + resources.length + (component === 'windows' ? 1 : 0) };
}

async function inspectShim(directory: string, signal?: AbortSignal): Promise<RuntimeIssue[]> {
  const issues: RuntimeIssue[] = [];
  let shimHash: string | undefined;
  try {
    const manifest: unknown = JSON.parse(await readFile(join(directory, 'wineglass-compat.json'), 'utf8'));
    if (typeof manifest !== 'object' || manifest === null || !('patchedSHA256' in manifest) || manifest.patchedSHA256 !== PATCHED_CHROME_SHA256 || !('originalSHA256' in manifest) || manifest.originalSHA256 !== ORIGINAL_CHROME_SHA256) throw new Error('Unexpected compatibility manifest');
    if ('shimSHA256' in manifest && typeof manifest.shimSHA256 === 'string' && /^[a-f0-9]{64}$/.test(manifest.shimSHA256)) shimHash = manifest.shimSHA256;
    else {
      shimHash = LEGACY_SHIM_SHA256;
      issues.push({ code: 'legacy_shim_receipt', component: 'shim', severity: 'warning', message: 'Legacy compatibility manifest has no shim digest. Setup can record the verified legacy shim.' });
    }
  } catch {
    issues.push({ code: 'invalid_shim_manifest', component: 'shim', severity: 'error', message: `Missing or invalid compatibility manifest: ${join(directory, 'wineglass-compat.json')}` });
  }
  await checkFile(join(directory, 'WGUI32.dll'), shimHash, 'shim', issues, signal);
  return issues;
}

export async function inspectRuntime(runtime: string, options: { signal?: AbortSignal } = {}): Promise<RuntimeInspection> {
  const issues: RuntimeIssue[] = [];
  let checkedFiles = 0;
  for (const [component, directory] of [['wine', 'Wine Devel.app'], ['mac', 'chromium-mac'], ['windows', 'chromium-win']] as const) {
    const result = await inspectComponent(component, join(runtime, directory), options);
    issues.push(...result.issues); checkedFiles += result.checkedFiles;
    for (const suffix of ['.wineglass-staging', '.wineglass-backup']) if (await exists(join(runtime, `${directory}${suffix}`))) issues.push({ code: 'interrupted_install', component: 'install', severity: 'error', message: `Interrupted installation found: ${directory}${suffix}. Rerun setup to recover it.` });
  }
  try {
    if ((await readFile(join(runtime, 'chromium-revision.txt'), 'utf8')).trim() !== CHROMIUM_REVISION) throw new Error('Unexpected revision');
  } catch { issues.push({ code: 'revision_mismatch', component: 'revision', severity: 'error', message: `Missing or unexpected Chromium revision; expected ${CHROMIUM_REVISION}. Rerun setup.` }); }
  return { ok: !issues.some(issue => issue.severity === 'error'), issues, checkedFiles };
}
