// 크롬 웹 스토어 등록정보용 스크린샷(1280x800)과 작은 홍보 타일(440x280)을 실제 확장 화면으로 만든다.
// 사용: node scripts/store-shots.mjs   → store/ 폴더. Chrome for Testing 필요(tests/e2e/cdp.mjs 참고).
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Chrome, sleep} from '../tests/e2e/cdp.mjs';

const EXT = fileURLToPath(new URL('../extension', import.meta.url));
const OUT = fileURLToPath(new URL('../store', import.meta.url));
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
const root = os.tmpdir() + '/store-shots-' + Date.now();
const C = new Chrome({ext: EXT, profile: root + '/p', port: 9461, downloads: root + '/dl'});
await C.start();
const p = await C.open(PANEL, {width: 400, height: 760});
await p.cmd('Emulation.setDeviceMetricsOverride', {width: 400, height: 760, deviceScaleFactor: 2, mobile: false});
await p.waitFor(p.visible('#gate-form'), 15000, '처음 화면');
await p.type('#profile-name', '김선생'); await p.type('#profile-pin', '246810'); await p.type('#profile-confirm', '246810');
await p.eval(`document.getElementById('gate-form').requestSubmit()`);
await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
await p.eval(`chrome.storage.local.set({lockOnAway:false})`);
const notes = [
  ['3월 학급 운영', '· 1인 1역 정하기\n· 모둠 자리 바꾸기(금)\n· 학부모 상담 주간 안내장'],
  ['과학 4단원 준비물', '자석, 클립, 나침반 6모둠분\n실험 영상 링크 북마크에 저장'],
  ['오늘 할 일', '출석부 마감 · 급식 지도 · 방과후 명단 제출'],
];
for (const [title, text] of notes) await p.eval(`chrome.runtime.sendMessage({type:'note-save',id:'shot-'+Math.random().toString(36).slice(2),title:${JSON.stringify(title)},text:${JSON.stringify(text)}})`);
await p.eval(`location.reload()`); await sleep(2500);
const raw = {};
for (const page of ['notes', 'capture', 'presenter', 'tools']) {
  await p.eval(`document.querySelector('[data-page="${page}"]').click()`); await sleep(900);
  await p.eval(`document.querySelectorAll('.notice,#notice').forEach(n=>n.hidden=true)`);
  const file = `${root}/${page}.png`; await p.shot(file); raw[page] = file;
}
// 1280x800 장면: 왼쪽 글, 오른쪽 실제 사이드바 화면
const scenes = [
  ['1-memo', 'notes', '수업 중 떠오른 것을<br>바로 적어 두세요', '빠른 메모 · 북마크 · 자동 동기화<br>같은 Google 계정의 다른 컴퓨터에서도 이어서'],
  ['2-capture', 'capture', '보이는 그대로,<br>한 번에 캡처', '선택 영역 · 스크롤 전체 페이지 · 화면 녹화<br>‘캡처이미지’ 폴더 저장과 클립보드 복사를 동시에'],
  ['3-present', 'presenter', '수업 발표를<br>더 또렷하게', '화면 확대 · 큰 포인터 · 집중 모드 · 화면 핀<br>(발표 도우미 앱과 함께)'],
  ['4-tools', 'tools', '교실 도구를<br>사이드바 하나에', '타이머 · 수업 시보 · 뽑기 · 녹음기<br>PIN 잠금과 전체 백업 · 복원'],
];
const css = `*{margin:0;box-sizing:border-box}body{width:1280px;height:800px;overflow:hidden;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:linear-gradient(135deg,#0f2921 0%,#1d4a3a 100%);color:#fff;display:flex;align-items:center;gap:70px;padding:0 90px}
@font-face{font-family:Pretendard;src:url('${pathToFileURL(EXT + '/fonts/PretendardVariable.woff2')}')}
.t{flex:1}.b{font-size:22px;color:#9fd8b8;font-weight:700;letter-spacing:.04em;margin-bottom:22px}h1{font-size:58px;line-height:1.22;font-weight:800;margin-bottom:28px}p{font-size:23px;line-height:1.6;color:#d6e6dc}
.s{width:400px;height:760px;border-radius:22px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.45);background:#fff;flex:none}.s img{width:400px;height:760px;display:block}`;
for (const [name, page, title, sub] of scenes) {
  const html = `${root}/${name}.html`;
  fs.writeFileSync(html, `<!doctype html><meta charset=utf-8><style>${css}</style><div class=t><div class=b>다있쌤</div><h1>${title}</h1><p>${sub}</p></div><div class=s><img src="${pathToFileURL(raw[page])}"></div>`);
  const s = await C.open(pathToFileURL(html).href, {width: 1280, height: 800}); await sleep(900);
  await s.shot(`${OUT}/screenshot-${name}.png`);
}
// 작은 홍보 타일 440x280
const tile = `${root}/tile.html`;
fs.writeFileSync(tile, `<!doctype html><meta charset=utf-8><style>@font-face{font-family:Pretendard;src:url('${pathToFileURL(EXT + '/fonts/PretendardVariable.woff2')}')}*{margin:0}body{width:440px;height:280px;overflow:hidden;font-family:Pretendard,sans-serif;background:linear-gradient(135deg,#0f2921,#1d4a3a);color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 40px}img{width:56px;height:56px;margin-bottom:16px;image-rendering:auto}h1{font-size:44px;font-weight:800}p{font-size:18px;color:#cfe3d6;margin-top:8px}</style><img src="${pathToFileURL(EXT + '/icons/128.png')}"><h1>다있쌤</h1><p>선생님을 위한 수업 도우미</p>`);
const t = await C.open(pathToFileURL(tile).href, {width: 440, height: 280}); await sleep(700);
await t.shot(`${OUT}/promo-small-440x280.png`);
fs.copyFileSync(EXT + '/icons/128.png', `${OUT}/icon-128.png`);
await C.stop();
console.log('만든 파일:', fs.readdirSync(OUT).join(', '));
