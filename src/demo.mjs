import { createServer } from 'node:http';

export async function startDemo() {
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>WineGlass demo</title>
  <style>
  :root { color-scheme: light; font-family: system-ui, sans-serif; color: #243044; background: #f3f5f9; }
  body { margin: 0; padding: 48px; } main { max-width: 900px; margin: auto; }
  h1 { letter-spacing: -.035em; font-size: 38px; margin: 0 0 10px; }
  p { line-height: 1.65; } .eyebrow { color: #5968c7; font: 600 12px monospace; letter-spacing: .14em; }
  .card { background: white; border: 1px solid #dce2ed; border-radius: 16px; padding: 26px; margin: 24px 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  label { display: block; margin-bottom: 8px; font-size: 14px; }
  input[type=text],select { width: 100%; box-sizing: border-box; min-height: 34px; }
  button { margin: 16px 8px 0 0; } .custom { appearance: none; background: #4757ca; color: white; padding: 10px 18px; border: 0; border-radius: 8px; font: inherit; }
  .sample { font-size: 22px; } .narrow { width: 340px; border-left: 3px solid #aab2eb; padding-left: 16px; }
  .scroll { height: 115px; overflow-y: scroll; border: 1px solid #dce2ed; padding: 12px; }
  small { color: #67758b; } .platform { font: 12px monospace; }
  </style><main><p class="eyebrow">WINEGLASS / LOCAL COMPARISON</p>
  <h1>같은 웹, 다른 플랫폼</h1><p>Windows용 Chromium을 Wine으로 실행한 결과와 Mac 브라우저를 비교합니다.</p>
  <div class="card"><div class="grid"><div><label for="name">브라우저 기본 입력창</label><input id="name" type="text" value="Hello, Windows & macOS"></div>
  <div><label for="region">브라우저 기본 선택창</label><select id="region"><option>서울 / Seoul</option><option>London</option></select></div></div>
  <p><label><input type="checkbox" checked> 기본 체크박스</label><label><input type="radio" checked> 기본 라디오 버튼</label></p>
  <button>브라우저 기본 버튼</button><button class="custom">앱에서 디자인한 버튼</button></div>
  <div class="card"><small>SYSTEM FONT / WRAPPING</small><p class="sample">Typography — Aa Bb 0123456789</p>
  <p class="narrow">System fonts affect the width of a sentence and may change where text wraps onto the next line. 한글 글꼴의 차이도 확인합니다.</p>
  <div class="scroll">스크롤바와 기본 글꼴을 확인합니다.<br><br>First row<br><br>Second row<br><br>Third row<br><br>Last row</div></div>
  <p class="platform" id="platform"></p><script>document.getElementById('platform').textContent=navigator.platform+' | '+navigator.userAgent;</script></main></html>`;
  const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
