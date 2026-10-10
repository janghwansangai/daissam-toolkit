// 확장이 바로 찍지 못하는 화면(about:blank 에 그린 페이지 · data:)에서 캡처를 눌렀을 때를 실제 Chrome 에서 본다.
// 사용자 보고: about:blank 에 그린 '풍등 색칠 도안' 에서 선택 영역 캡처 → '이 탭은 캡처할 수 없습니다', 그리고
// 한 번씩 다른 창이 앞으로 나와 그 창에서 찍으려 했다.  사용: node tests/e2e/capture-blocked.e2e.mjs
import os from 'node:os';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail))); if (!cond) failed++; };
const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  r.end(`<title>원래 페이지</title><h1 style="font-size:60px">웹 페이지</h1><button id=b>도안 열기</button>
<script>b.onclick=()=>{const w=window.open('about:blank');w.document.write('<title>풍등 색칠 도안</title><h1 style="font-size:90px">풍등 색칠 도안</h1>');w.document.close();}</script>`); }).listen(8798);
const C = new Chrome({ext: EXT, profile: os.tmpdir() + '/e2e-capblock-' + Date.now(), port: 9551, downloads: os.tmpdir() + '/e2e-capblock-dl'});
await C.start();
const panel = await C.open(PANEL);
await panel.waitFor(panel.visible('#gate-guest'), 15000, '처음 화면');
await panel.eval(`document.getElementById('gate-guest').click()`);
await panel.waitFor(panel.visible('#workspace'), 15000, '작업 화면');
// 다른 창 하나: 여기에 '원래 웹페이지' 가 있다 — 예전 코드는 이 창으로 건너뛰었다.
const other = await panel.eval(`chrome.windows.create({url:'http://127.0.0.1:8798/?other',focused:false}).then(w=>w.id)`);
const web = await C.open('http://127.0.0.1:8798/'); await sleep(900);
const tabs = () => panel.eval(`chrome.tabs.query({}).then(t=>t.map(x=>({id:x.id,w:x.windowId,title:x.title,url:x.url||'',active:x.active})))`);
const seen = new Set((await tabs()).map(t => t.id));
await web.eval(`document.getElementById('b').click()`); await sleep(1500);
// 확장은 tabs 권한이 없어 about:blank 탭의 주소 · 제목을 볼 수 없다(사용자 환경과 같다) — 새로 생긴 탭으로 찾는다.
const blank = (await tabs()).find(t => !seen.has(t.id));
ok('about:blank 에 그린 도안 탭이 열렸다', !!blank, await tabs());
await panel.eval(`chrome.tabs.update(${blank.id},{active:true}).then(()=>chrome.windows.update(${blank.w},{focused:true}))`); await sleep(700);
const send = (m) => panel.eval(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);
for (const mode of ['area', 'visible']) {
  const before = await panel.eval(`chrome.windows.getAll({populate:true}).then(ws=>ws.length)`);
  const r = await send({type: 'capture', mode});
  await sleep(1200);
  const wins = await panel.eval(`chrome.windows.getAll({populate:true}).then(ws=>ws.map(w=>({id:w.id,type:w.type,focused:w.focused,urls:w.tabs.map(t=>t.url||t.pendingUrl||'')})))`);
  // 확장은 tabs 권한이 없어 자기 창의 주소도 못 본다 — 새로 뜬 팝업 창으로 찾는다(이 시험에서 팝업은 이것뿐이다).
  const grabWin = wins.find(w => w.type === 'popup');
  ok(`[${mode}] 오류로 끝나지 않고 다른 길로 안내한다`, r.ok && r.data?.redirected && /화면 고르기|발표 도우미/.test(r.data.message), r);
  ok(`[${mode}] ‘화면 고르기’ 작은 창이 뜬다`, !!grabWin && (await panel.eval(`chrome.tabs.query({windowId:${grabWin?.id||0}}).then(t=>t.length)`)) === 1, wins);
  ok(`[${mode}] 다른 창(원래 웹페이지)으로 건너뛰지 않는다`, !wins.find(w => w.id === other)?.focused && (await tabs()).find(t => t.id === blank.id).active, wins);
  if (grabWin) await panel.eval(`chrome.windows.remove(${grabWin.id})`);
  await panel.eval(`chrome.windows.update(${blank.w},{focused:true})`); await sleep(500);
}
// data: 는 찍기는 되지만 페이지 안에 들어갈 수 없다 → 보이는 부분을 찍어 편집기를 자르기로 연다
const data = await panel.eval(`chrome.tabs.create({url:'data:text/html,<h1 style=font-size:80px>data page</h1>'}).then(t=>({id:t.id,w:t.windowId}))`);
await sleep(1200);
await panel.eval(`chrome.windows.update(${data.w},{focused:true})`); await sleep(500);
let r = await send({type: 'capture', mode: 'area'}); await sleep(1500);
let all = await tabs();
// data: 는 Chrome 판에 따라 찍기까지 막히거나(→ 화면 고르기) 찍기만 된다(→ 편집기 자르기). 어느 쪽이든 오류로 끝나지 않아야 한다.
ok('[data:] 선택 영역이 오류 없이 다른 길로 간다', r.ok && (r.data?.redirected || /편집기/.test(r.data?.message || '')), r);
for (const w of await panel.eval(`chrome.windows.getAll().then(ws=>ws.filter(w=>w.type==='popup').map(w=>w.id))`)) await panel.eval(`chrome.windows.remove(${w})`);
// 보통 웹페이지는 예전처럼 바로 찍는다(회귀)
await panel.eval(`chrome.tabs.update(${all.find(t => t.url === 'http://127.0.0.1:8798/').id},{active:true})`); await sleep(600);
r = await send({type: 'capture', mode: 'visible'}); await sleep(1200);
all = await tabs();
ok('[웹페이지] 보이는 부분은 예전처럼 바로 편집기로 연다', r.ok && !r.data?.redirected && /편집기/.test(r.data?.message || ''), r);
// 정리안: 끌어서 고르기는 ‘선택 영역’ 하나. 앱이 없으면 단추 아래에 ‘이 탭 안’ 이라고 적는다.
await panel.eval(`document.querySelector('[data-page="capture"]').click()`); await sleep(1500);
const ui = await panel.eval(`({area:!!document.getElementById('cap-area'),merged:!document.getElementById('cap-screen-area'),mode:document.getElementById('cap-area-mode').textContent,whole:document.getElementById('cap-screen').textContent})`);
ok('캡처 탭: ‘화면 영역’ 단추가 선택 영역에 합쳐졌다', ui.area && ui.merged, ui);
ok('캡처 탭: 선택 영역이 지금 어느 방식인지 적혀 있다(앱 없음 → 이 탭 안)', /이 탭 안/.test(ui.mode) && /발표 도우미 앱을 설치/.test(ui.mode), ui.mode);
ok('캡처 탭: 통째로 찍는 단추 이름이 바뀌었다', /화면 · 창 통째로/.test(ui.whole), ui.whole);
await C.stop();
// ‘화면 고르기’ 창이 고른 화면을 찍어 편집기(자르기)로 여는지. 헤드리스 Chrome 은 실제 화면 공유를 못 하므로
// Chrome 의 고르기 대신 가짜 화면(캔버스 스트림)을 넣고, 그 뒤의 우리 코드(한 장 찍기 → 보내기)를 본다.
const D = new Chrome({ext: EXT, profile: os.tmpdir() + '/e2e-capblock2-' + Date.now(), port: 9552, downloads: os.tmpdir() + '/e2e-capblock2-dl'});
await D.start();
const p2 = await D.open(PANEL);
await p2.waitFor(p2.visible('#gate-guest'), 15000, '처음 화면 2');
await p2.eval(`document.getElementById('gate-guest').click()`); await sleep(800);
const w2 = await D.open('http://127.0.0.1:8798/'); await sleep(800);
await w2.eval(`document.getElementById('b').click()`); await sleep(1500);
const g = await D.open(PANEL.replace('panel.html', 'grab.html') + '#mode=area&after=', {width: 440, height: 360});
await sleep(600);
await g.eval(`navigator.mediaDevices.getDisplayMedia=async()=>{const c=document.createElement('canvas');c.width=800;c.height=500;const x=c.getContext('2d');
  x.fillStyle='#c33';x.fillRect(0,0,800,500);setInterval(()=>{x.fillStyle='#c33';x.fillRect(0,0,800,500);},40);window.__picked=true;return c.captureStream(15);};0`);
await g.eval(`document.getElementById('go').click()`);
// 편집기 탭을 CDP 로 찾는다(확장 API 로는 자기 탭 주소도 안 보인다).
let crop = null, say = '';
for (let i = 0; i < 30 && !crop; i++) {
  await sleep(500);
  const {targetInfos} = await D.send('Target.getTargets');
  crop = targetInfos.find(t => /capture\.html#.+&crop=1/.test(t.url)) || null;
  say = await g.eval(`document.getElementById('say')?.textContent||''`).catch(() => '(창이 닫힘)');
}
ok('‘화면 고르기’ 로 고른 화면이 편집기(자르기)로 열린다', !!crop, say);
if (crop) {
  const {sessionId} = await D.send('Target.attachToTarget', {targetId: crop.targetId, flatten: true}); await sleep(1500);
  const r2 = await D.send('Runtime.evaluate', {expression: `({w:document.querySelector('canvas')?.width||0, banner:document.getElementById('banner').textContent})`, returnByValue: true}, sessionId);
  ok('편집기에 찍힌 그림이 있고 자르기 안내가 보인다', r2.result.value.w > 100 && /자르기/.test(r2.result.value.banner), r2.result.value);
}
await D.stop(); server.close();
console.log(failed ? `실패 ${failed}건` : '모두 통과');
process.exit(failed ? 1 : 0);
