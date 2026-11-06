import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { CapturePair, ComparisonMetadata } from './types.js';

const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, char => escapes[char] ?? char);

function initializeOverlay(): void {
  const control = document.getElementById('alpha');
  const overlay = document.getElementById('overlay');
  if (!(control instanceof HTMLInputElement) || !(overlay instanceof HTMLImageElement)) return;
  control.addEventListener('input', () => { overlay.style.opacity = String(Number(control.value) / 100); });
}

export async function writeReport(directory: string, captures: CapturePair): Promise<ComparisonMetadata> {
  const a = PNG.sync.read(await readFile(join(directory, 'macos.png')));
  const b = PNG.sync.read(await readFile(join(directory, 'wine-windows.png')));
  if (a.width !== b.width || a.height !== b.height) throw new Error('Screenshot dimensions differ. Use a shared viewport and scale.');
  const diff = new PNG({ width: a.width, height: a.height });
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  await writeFile(join(directory, 'difference.png'), PNG.sync.write(diff));
  const manifest: ComparisonMetadata = {
    capturedAt: new Date().toISOString(),
    target: captures[0].url,
    renderer: 'macOS native Chromium vs Windows Chromium on Wine',
    fidelity: 'Wine compatibility rendering; not a real Windows capture or pass/fail test',
    changedPixels: changed,
    changedPercent: Number((100 * changed / (a.width * a.height)).toFixed(2)),
    captures
  };
  await writeFile(join(directory, 'metadata.json'), JSON.stringify(manifest, null, 2) + '\n');
  const details = captures.map(c => `<tr><td>${esc(c.label)}<br>${esc(c.url)}</td><td>${esc(c.version)}</td><td>${esc(c.platform)}</td><td>${c.scrollbarWidth}px</td><td>${esc([...new Set(c.platformFonts.map(f => f.familyName))].join(', '))}</td></tr>`).join('');
  const fontFamilies = [...new Set(captures[1].platformFonts.map(f => f.familyName))];
  const fontNames = fontFamilies.join(', ') || '표본 없음';
  const observations: string[] = [];
  if (captures[0].url !== captures[1].url) observations.push('두 탭의 URL이 다릅니다. 같은 화면 상태인지 확인해 주세요.');
  if (captures[0].version !== captures[1].version) observations.push('브라우저 버전이 다릅니다. 엔진 버전 차이도 결과에 포함됩니다.');
  if (!fontFamilies.some(name => /segoe ui/i.test(name))) observations.push('Windows 글꼴 표본에서 Segoe UI가 관찰되지 않았습니다. 설치 여부를 판정하는 검사는 아닙니다.');
  if (!fontFamilies.some(name => /malgun|맑은 고딕/i.test(name))) observations.push('Windows 글꼴 표본에서 Malgun Gothic(맑은 고딕)이 관찰되지 않았습니다. 한국어 글꼴 차이를 확인해 주세요.');
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WineGlass — Local comparison</title>
  <style>
  :root { color-scheme: light; font-family: system-ui,sans-serif; background: #f5f6fa; color: #223047; }
  body { margin: 0; padding: 32px; } main { max-width: 1600px; margin: auto; }
  h1 { font-size: 30px; letter-spacing: -.035em; } p { line-height: 1.6; }
  .note { background: #fff6df; border: 1px solid #ead8a5; border-radius: 10px; padding: 14px 18px; }
  .muted { color: #627086; overflow-wrap: anywhere; } .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  figure { margin: 0; background: white; border: 1px solid #dce1eb; border-radius: 12px; overflow: hidden; }
  figcaption { padding: 14px; font-weight: 650; border-bottom: 1px solid #e6eaf0; }
  img { width: 100%; display: block; } .overlay { position: relative; max-width: 1000px; background: white; }
  .overlay img:last-child { position: absolute; top: 0; left: 0; opacity: .5; }
  input { width: 260px; } table { border-collapse: collapse; width: 100%; background: white; font-size: 13px; }
  td,th { text-align: left; padding: 12px; border-bottom: 1px solid #dce1eb; overflow-wrap: anywhere; }
  .table { overflow: auto; } h2 { font-size: 20px; margin-top: 32px; } a { color: #4558be; }
  @media(max-width:800px) { body { padding: 16px; } .grid { grid-template-columns: 1fr; } }
  </style><main><h1>Mac ↔ Windows Chromium · Wine</h1>
  <p class="note"><strong>Windows 근사 실행 결과입니다.</strong> Windows용 브라우저 바이너리를 Wine으로 실행했습니다. 실제 Windows의 DirectWrite, 기본 폰트, 네이티브 대화상자, DPI 동작과 동일하다고 보장하지 않습니다. Wine에서 사용된 폰트: ${esc(fontNames)}. Segoe UI·맑은 고딕이 없으면 Windows 기본 글꼴을 검증할 수 없습니다. 펜 입력 조회는 미지원 응답을 반환하는 호환 코드를 사용합니다.</p>
  <p class="muted">${esc(manifest.target)} · ${esc(manifest.capturedAt)}<br>차이가 표시된 픽셀: ${manifest.changedPercent}% — 버그 점수나 Windows 호환성 판정이 아닙니다.</p>
  ${observations.length ? `<div class="note"><strong>비교 시 확인할 사항</strong><ul>${observations.map(note => `<li>${esc(note)}</li>`).join('')}</ul></div>` : ''}
  <div class="grid"><figure><figcaption>macOS · native Chromium</figcaption><a href="macos.png"><img src="macos.png" alt="Mac screenshot"></a></figure>
  <figure><figcaption>Windows Chromium · Wine approximation</figcaption><a href="wine-windows.png"><img src="wine-windows.png" alt="Windows Chromium running under Wine"></a></figure></div>
  <h2>겹쳐 보기</h2><label>Windows 이미지 투명도 <input type="range" min="0" max="100" value="50" id="alpha"></label>
  <div class="overlay"><img src="macos.png" alt="Mac base"><img src="wine-windows.png" alt="Wine overlay" id="overlay"></div>
  <h2>차이 표시</h2><figure><a href="difference.png"><img src="difference.png" alt="Pixel differences"></a></figure>
  <h2>실행 환경</h2><div class="table"><table><thead><tr><th>환경</th><th>브라우저 버전</th><th>navigator.platform</th><th>페이지 스크롤바</th><th>표본에서 실제 사용된 폰트</th></tr></thead><tbody>${details}</tbody></table></div>
  <p class="muted">폰트는 앞쪽 DOM 노드 최대 200개에서 수집한 표본입니다. 전체 글리프 집계가 아닙니다. CSS 글꼴 선언과 자세한 환경은 metadata.json에 기록됩니다. 브라우저 버전이 다르거나 Wine에서 Windows 기본 폰트가 대체되면 해당 차이도 이미지에 포함됩니다. 로그인 상태는 새 프로필로 시작합니다. 캡처는 페이지 영역만 포함합니다.</p>
  <p><a href="metadata.json">메타데이터 JSON</a></p></main><script>(${initializeOverlay.toString()})();</script></html>`;
  await writeFile(join(directory, 'index.html'), html);
  return manifest;
}
