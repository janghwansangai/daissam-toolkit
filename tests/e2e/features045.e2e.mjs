// v0.45.0 자동 숨김을 실제 Chrome 의 진짜 사이드바로 본다: 머리줄 토글 · 마우스가 나가면 숨음 · 책갈피(오른쪽 끝) ·
// 올리면 또렷해지기만 하고 열리지 않음(Chrome 규칙) · 누르면 열림 · 끌어 옮기기(다른 탭도 같은 자리) · 숨지 않는 때(작은 창 ·
// 글 치는 중 · 책갈피가 뜰 수 없는 탭) · ✕ 로 닫아도 책갈피가 돌아옴 · 캡처에 책갈피가 찍히지 않음 · 끄면 사라짐.
// 사용: node tests/e2e/features045.e2e.mjs   (CHROME_BIN 으로 다른 Chrome 판)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {Chrome, Page, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const ORIGIN = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm';
const PANEL = ORIGIN + '/panel.html';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-045-'));
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail).slice(0, 300))); if (!cond) failed++; };
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<!doctype html><title>시험 페이지</title><body style="margin:0;background:#fff;height:3000px"><p>시험 페이지</p></body>'); }).listen(0);
const WEB = `http://127.0.0.1:${server.address().port}/`;
const C = new Chrome({ext: EXT, profile: path.join(root, 'p'), port: 9645, downloads: path.join(root, 'dl'), args: ['--window-size=1280,900']});
await C.start();
const p = await C.open(PANEL, {width: 400, height: 900});
await p.waitFor(p.visible('#gate-guest'), 15000, '처음 화면');
await p.eval(`document.getElementById('gate-guest').click()`);
await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
const send = (type, data = {}) => p.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
const local = key => p.eval(`chrome.storage.local.get(${JSON.stringify(key)}).then(r=>r[${JSON.stringify(key)}])`);

// ── 머리줄 토글 ──
const header = width => p.cmd('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: false}).then(() => sleep(250)).then(() => p.eval(`(()=>{
  const h=document.querySelector('header'),t=h.querySelector('.auto-hide'),name=h.querySelector('strong'),b=e=>e.getBoundingClientRect();
  return {inHeader:!!t&&t.contains(document.getElementById('auto-hide')),text:t?.innerText.trim(),sameRow:Math.abs((b(t).top+b(t).bottom)/2-(b(name).top+b(name).bottom)/2)<4,
    fits:h.scrollWidth<=h.clientWidth+1&&b(t).right<=innerWidth,checked:document.getElementById('auto-hide').checked};})()`));
for (const width of [400, 320]) {
  const h = await header(width);
  ok(`머리줄(다있쌤 옆)에 ‘자동 숨김’ 토글이 한 줄로 들어간다 — 너비 ${width}`, h.inHeader && h.text === '자동 숨김' && h.sameRow && h.fits && h.checked === false, h);
}
await p.cmd('Emulation.setDeviceMetricsOverride', {width: 400, height: 900, deviceScaleFactor: 1, mobile: false});

// ── 웹 페이지 · 서비스 워커 ──
async function webTab(url = WEB) {
  const {targetId} = await C.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await C.send('Target.attachToTarget', {targetId, flatten: true});
  const page = new Page(C, sessionId, targetId); await page.cmd('Runtime.enable'); await page.cmd('Page.enable');
  // Chrome 156 은 만들 때 준 주소로 넘어가는 동안 붙은 연결이 빈 페이지에 남는다 — 빈 탭에 붙은 뒤 직접 옮긴다.
  await page.cmd('Page.navigate', {url});
  await page.waitFor(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'`, 10000); await sleep(400);
  return page;
}
async function sw(expression) {
  const {targetInfos} = await C.send('Target.getTargets');
  const t = targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith(ORIGIN));
  const {sessionId} = await C.send('Target.attachToTarget', {targetId: t.targetId, flatten: true});
  const r = await C.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId);
  return r.result.value;
}
const panels = () => sw(`chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}).then(c=>c.length)`);
async function waitPanels(n, timeout = 5000) { const end = Date.now() + timeout; let now; while (Date.now() < end) { now = await panels(); if (now === n) return true; await sleep(150); } return false; }
async function side() {
  const {targetInfos} = await C.send('Target.getTargets');
  const t = targetInfos.find(t => t.url.startsWith(PANEL) && t.targetId !== p.targetId);
  if (!t) return null;
  const {sessionId} = await C.send('Target.attachToTarget', {targetId: t.targetId, flatten: true});
  const page = new Page(C, sessionId, t.targetId); await page.cmd('Runtime.enable');
  return page;
}
const mouse = (page, type, x, y) => C.send('Input.dispatchMouseEvent', {type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1, clickCount: 1}, page.sessionId);
const tabBox = page => page.eval(`(()=>{const h=document.querySelector('[data-dais-sidetab]');if(!h)return {shown:false};const r=h.getBoundingClientRect();
  return {shown:getComputedStyle(h).display!=='none'&&r.width>0,right:r.right,width:r.width,top:r.top,mid:r.top+r.height/2,vw:document.documentElement.clientWidth,iw:innerWidth,vh:innerHeight,count:document.querySelectorAll('[data-dais-sidetab]').length};})()`);
async function waitTab(page, shown, timeout = 5000) { const end = Date.now() + timeout; let box; while (Date.now() < end) { box = await tabBox(page); if (box.shown === shown) return box; await sleep(120); } return box; }
async function clickTab(page) { const b = await tabBox(page); await mouse(page, 'mouseMoved', b.vw - 6, b.mid); await sleep(250); await mouse(page, 'mousePressed', b.vw - 6, b.mid); await mouse(page, 'mouseReleased', b.vw - 6, b.mid); }
async function leave(panel) { await mouse(panel, 'mouseMoved', 120, 300); await sleep(150); await mouse(panel, 'mouseMoved', -30, 300); }

const web = await webTab();
await C.send('Target.activateTarget', {targetId: web.targetId}); await sleep(300);
ok('꺼져 있으면 페이지에 책갈피가 없다', (await tabBox(web)).shown === false, await tabBox(web));

await p.eval(`document.querySelector('header .auto-hide').click()`); await sleep(700);
ok('토글을 켜면 이 컴퓨터에 저장된다', await local('sideAutoHide') === true);
let box = await waitTab(web, true);
ok('켜면 사이드바가 닫힌 창의 페이지 오른쪽 끝에 책갈피가 뜬다(가운데 높이)', box.shown && Math.abs(box.right - box.vw) < 1 && box.width <= 16 && Math.abs(box.top - Math.round(8 + (box.vh - 100) * .5)) <= 1 && box.count === 1, box);

// 올리기만: 또렷해지지만 열리지 않는다
await mouse(web, 'mouseMoved', box.vw - 6, box.mid); await sleep(500);
const hovered = await tabBox(web);
ok('마우스를 올리면 책갈피가 넓어진다(또렷해짐)', hovered.width >= 28, hovered);
await sleep(600);
ok('올리기만 해서는 사이드바가 열리지 않는다(Chrome 은 누른 순간에만 허락)', await panels() === 0);

// 누르면 열림
await clickTab(web);
ok('책갈피를 누르면 진짜 사이드바가 열린다', await waitPanels(1), await panels());
for (let i = 0; i < 30; i++) { box = await tabBox(web); if (!box.shown && box.iw < 1200) break; await sleep(150); }
ok('사이드바가 열리면 그 창의 책갈피는 숨는다', box.shown === false && box.iw < 1200, box);
let sp = await side();
await sp.waitFor(sp.visible('#workspace'), 15000, '사이드바 작업 화면');
ok('사이드바 쪽 토글도 켜져 있다', await sp.eval(`document.getElementById('auto-hide').checked`) === true);
const notice = await sp.eval(`document.getElementById('notice').hidden?'':document.getElementById('notice').textContent`);
ok('사이드바를 열 때 오류 글이 뜨지 않는다', !/initialization|is not defined|Cannot access/.test(notice), notice);

// 마우스가 나가면 숨음
await leave(sp);
await sleep(300);
ok('마우스가 나가자마자(0.7초 전)는 아직 닫지 않는다', await panels() === 1);
ok('마우스가 사이드바 밖으로 나가면 잠시 뒤 사이드바가 닫힌다', await waitPanels(0, 4000), await panels());
for (let i = 0; i < 30; i++) { box = await tabBox(web); if (box.shown && box.iw > 1200) break; await sleep(150); }
ok('닫히면 페이지가 넓어지고 책갈피가 다시 뜬다', box.shown && box.iw > 1200, box);

// 숨지 않는 때 ① 작은 창(PIN 등)이 떠 있으면
await clickTab(web); await waitPanels(1); sp = await side(); await sp.waitFor(sp.visible('#workspace'), 15000);
await sp.eval(`document.getElementById('mark-pin').showModal()`);
await leave(sp); await sleep(2000);
ok('작은 창이 떠 있으면 마우스가 나가도 닫지 않는다', await panels() === 1);
await sp.eval(`document.getElementById('mark-pin').close()`);
ok('작은 창을 닫았는데 마우스가 여전히 밖이면 그때 닫는다', await waitPanels(0, 4000));
await waitTab(web, true);

// ② 방금 글을 치는 중이면
await clickTab(web); await waitPanels(1); sp = await side(); await sp.waitFor(sp.visible('#workspace'), 15000);
await mouse(sp, 'mouseMoved', 120, 300);
for (let i = 0; i < 4; i++) { await sp.cmd('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16}); await sp.cmd('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16}); await sleep(100); }
await mouse(sp, 'mouseMoved', -30, 300); await sleep(1000);
ok('글을 치다가 마우스가 나가면 바로 닫지 않는다', await panels() === 1);
ok('치기를 멈추면 닫는다', await waitPanels(0, 4000));
await waitTab(web, true);

// ②-2 한글을 치다 멈춘 채(마지막 글자가 조합 중) 마우스가 나가면 — 맥 한글 입력은 다음 글자를 칠 때까지 조합이 끝나지 않는다
await clickTab(web); await waitPanels(1); sp = await side(); await sp.waitFor(sp.visible('#workspace'), 15000);
await mouse(sp, 'mouseMoved', 120, 300);
await sp.eval(`document.getElementById('note').focus()`);
await sp.cmd('Input.imeSetComposition', {text: '안', selectionStart: 1, selectionEnd: 1});
await sleep(200);
const composing = await sp.eval(`document.getElementById('note').value`);
await mouse(sp, 'mouseMoved', -30, 300); await sleep(800);
ok('한글 조합 중에 마우스가 나가도 곧바로 닫지 않는다', await panels() === 1, composing);
ok('조합 중인 글자가 남아 있어도 치기를 멈추면 닫는다(조합이 끝나기를 기다리지 않는다)', await waitPanels(0, 4000), await panels());
await waitTab(web, true);
const kept = await p.eval(`chrome.storage.local.get(['pendingNotes','draftNotes']).then(r=>JSON.stringify([...Object.values(r.pendingNotes||{}),...Object.values(r.draftNotes||{})].map(n=>n.text)))`);
ok('숨으면서 조합 중이던 글자도 메모에 남는다', kept.includes('안'), kept);

// ②-3 확장 내부 연결이 끊겨 저장이 끝내 실패하면 글을 잃지 않게 숨지 않는다(메모 유실 보고)
await clickTab(web); await waitPanels(1); sp = await side(); await sp.waitFor(sp.visible('#workspace'), 15000);
await mouse(sp, 'mouseMoved', 120, 300);
const typeNote = text => `(()=>{const b=document.getElementById('note');b.focus();b.value=${JSON.stringify(text)};b.dispatchEvent(new Event('input',{bubbles:true}));})()`;
await sp.eval(`window.__send=chrome.runtime.sendMessage;chrome.runtime.sendMessage=()=>Promise.reject(new Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'));`);
await sp.eval(typeNote('연결이 끊긴 동안 쓴 글'));
await mouse(sp, 'mouseMoved', -30, 300); await sleep(4500);
ok('저장이 끝내 실패하면 마우스가 나가도 닫지 않는다(글이 화면에만 있다)', await panels() === 1);
const broken = await sp.eval(`document.getElementById('notice').hidden?'':document.getElementById('notice').textContent`);
ok('저장하지 못했다고 알린다', /저장하지 못했습니다/.test(broken), broken);
await sp.eval(`chrome.runtime.sendMessage=window.__send;`);
await sp.eval(typeNote('연결이 돌아온 뒤의 글')); await sleep(700);
await leave(sp);
ok('연결이 돌아와 저장되면 다시 숨는다', await waitPanels(0, 4000));
await waitTab(web, true);
const back = await p.eval(`chrome.storage.local.get(['pendingNotes','draftNotes']).then(r=>JSON.stringify([...Object.values(r.pendingNotes||{}),...Object.values(r.draftNotes||{})].map(n=>n.text)))`);
ok('그 글이 메모에 남아 있다', back.includes('연결이 돌아온 뒤의 글'), back);

// ③ 지금 탭에 책갈피가 뜰 수 없으면(새 탭 · Chrome 화면 등)
await clickTab(web); await waitPanels(1); sp = await side(); await sp.waitFor(sp.visible('#workspace'), 15000);
const blank = await C.send('Target.createTarget', {url: 'about:blank'}); await sleep(700);
await leave(sp); await sleep(2200);
ok('책갈피가 뜰 수 없는 탭에서는 마우스가 나가도 닫지 않는다(돌아올 길이 아이콘뿐이라)', await panels() === 1);
const why = await sp.eval(`document.getElementById('notice').hidden?'':document.getElementById('notice').textContent`);
ok('그때는 숨지 않는 까닭을 사이드바에 알린다(고장처럼 보이지 않게)', /책갈피를 띄울 수 없어/.test(why), why);
await C.send('Target.closeTarget', {targetId: blank.targetId}); await C.send('Target.activateTarget', {targetId: web.targetId});
ok('마우스가 밖에 있는 채로 웹 페이지 탭으로 돌아오면 그때 닫는다', await waitPanels(0, 4000));
await waitTab(web, true);

// ✕ 로 닫아도(자동 숨김이 아닌 닫기) 책갈피가 돌아온다
await clickTab(web); await waitPanels(1); sp = await side(); await sp.waitFor(sp.visible('#workspace'), 15000);
await waitTab(web, false);
await sp.eval(`window.close()`).catch(() => {});
ok('사이드바를 다른 길로 닫아도 사이드바가 사라진다', await waitPanels(0, 4000));
ok('그때도 책갈피가 다시 뜬다', (await waitTab(web, true)).shown === true);

// 끌어 옮기기
box = await tabBox(web);
await mouse(web, 'mouseMoved', box.vw - 6, box.mid); await sleep(250);
await mouse(web, 'mousePressed', box.vw - 6, box.mid);
for (let step = 1; step <= 10; step++) { await C.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: box.vw - 6, y: box.mid - step * 25, button: 'left', buttons: 1}, web.sessionId); await sleep(30); }
await mouse(web, 'mouseReleased', box.vw - 6, box.mid - 250); await sleep(600);
const moved = await tabBox(web);
ok('위아래로 끌면 책갈피가 그만큼 옮겨진다', Math.abs(moved.top - (box.top - 250)) <= 2, {before: box.top, after: moved.top});
ok('끈 것은 누른 것이 아니다 — 사이드바가 열리지 않는다', await panels() === 0);
const spot = await local('sideTabSpot');
ok('옮긴 자리를 이 컴퓨터에 남긴다', Math.abs(spot - (moved.top - 8) / (moved.vh - 100)) < 0.01, spot);
const web2 = await webTab();
const other = await waitTab(web2, true);
ok('다른 탭의 책갈피도 같은 자리에 뜬다', Math.abs(other.top - moved.top) <= 1, {other: other.top, moved: moved.top});
await C.send('Target.closeTarget', {targetId: web2.targetId}); await C.send('Target.activateTarget', {targetId: web.targetId}); await sleep(500);

// 캡처에 책갈피가 찍히지 않는다
box = await waitTab(web, true);
// 화면 그림 · 캡처 그림의 한 점 색. 그림 너비 / 창 너비(스크롤바 포함)로 배율을 맞춘다.
const readPixel = (source, x, y) => `(async()=>{const bm=await createImageBitmap(${source});
  const c=new OffscreenCanvas(bm.width,bm.height),g=c.getContext('2d');g.drawImage(bm,0,0);const s=bm.width/${box.iw};return [...g.getImageData(Math.round(${x}*s),Math.round(${y}*s),1,1).data].slice(0,3);})()`;
const {data: seen} = await web.cmd('Page.captureScreenshot', {format: 'png'});
const control = await p.eval(readPixel(`await (await fetch('data:image/png;base64,${seen}')).blob()`, box.vw - 6, box.mid));
ok('(대조) 화면에는 그 자리에 책갈피가 보인다', control.some(v => v < 200), control);
// ‘저장’ 은 발표 도우미 앱을 거쳐 실제 바탕화면 폴더로 간다 — 시험은 편집기로 보내 그 그림을 읽는다.
const shot = await send('capture', {mode: 'visible', after: 'editor'});
ok('보이는 부분 캡처가 된다', shot.ok === true, shot);
let editor; for (let i = 0; i < 40 && !editor; i++) { editor = (await C.send('Target.getTargets')).targetInfos.find(t => t.url.startsWith(ORIGIN + '/capture.html#')); if (!editor) await sleep(150); }
const shotId = editor?.url.split('#')[1]?.split('&')[0];
const taken = await p.eval(readPixel(`(await (await import('./lib/shots.js')).getShot(${JSON.stringify(shotId)})).blob`, box.vw - 6, box.mid));
ok('확장의 캡처에는 책갈피가 찍히지 않는다(그 자리가 페이지 바탕색)', taken.every(v => v > 245), taken);
if (editor) await C.send('Target.closeTarget', {targetId: editor.targetId});
await C.send('Target.activateTarget', {targetId: web.targetId}); await sleep(400);
ok('캡처가 끝나면 책갈피가 돌아온다', (await waitTab(web, true)).shown === true);

// ── v0.46.0 세로 도크 ──
const setSpot = async spot => { await p.eval(`chrome.storage.local.set({sideTabSpot:${spot}})`); await web.cmd('Page.reload', {}); await web.waitFor(`document.readyState==='complete'`, 10000); await sleep(600); return waitTab(web, true); };
const hostAt = (x, y) => web.eval(`document.elementFromPoint(${x},${y})?.hasAttribute?.('data-dais-sidetab')===true`);
const dockInfo = () => web.eval(`(()=>{const h=document.querySelector('[data-dais-sidetab]');return {side:h.getAttribute('data-side'),btn:Number(h.getAttribute('data-btn'))};})()`);
const hoverHead = async b => { await mouse(web, 'mouseMoved', 200, 300); await sleep(450); await mouse(web, 'mouseMoved', b.vw - 6, b.mid); await sleep(350); return dockInfo(); };
// 단추 차례(게스트라 잠금 없음): 시작 정지 집중 조각 통과 핀 | 영역 전체 | 띄우기 설정
const dockY = (b, size, at, seps) => b.top + 84 + 4 + size * at + 9 * seps + size / 2;
const pressDock = async (b, size, at, seps) => { const y = dockY(b, size, at, seps), x = b.vw - 22; await mouse(web, 'mouseMoved', x, y); await sleep(200); await mouse(web, 'mousePressed', x, y); await mouse(web, 'mouseReleased', x, y); };
await mouse(web, 'mouseMoved', 200, 300); await sleep(300);
let low = await setSpot(.08);
ok('(세로 도크) 올리기 전에는 아래쪽에 단추가 없다', await hostAt(low.vw - 22, low.top + 84 + 30) === false);
let dock = await hoverHead(low);
ok('(세로 도크) 올리면 책갈피 아래로 펼쳐진다', dock.side === 'below' && dock.btn >= 24 && dock.btn <= 38, dock);
ok('(세로 도크) 펼쳐도 마우스가 있던 자리는 책갈피 머리다', (await tabBox(web)).top === low.top && await hostAt(low.vw - 6, low.mid), await tabBox(web));
ok('(세로 도크) 단추 줄이 화면 안에 다 들어온다', dockY(low, dock.btn, 9, 2) + dock.btn / 2 <= low.vh, {low, dock});
ok('(세로 도크) 단추 자리를 마우스가 받는다', await hostAt(low.vw - 22, dockY(low, dock.btn, 0, 0)) && await hostAt(low.vw - 22, dockY(low, dock.btn, 9, 2)));
await sleep(500);
ok('(세로 도크) 펼치기만 해서는 사이드바가 열리지 않는다', await panels() === 0);
const beforeLeave = await hostAt(low.vw - 22, dockY(low, dock.btn, 2, 0));
await mouse(web, 'mouseMoved', 200, 300); await sleep(600);
ok('(세로 도크) 마우스가 나가면 접힌다', beforeLeave && await hostAt(low.vw - 22, dockY(low, dock.btn, 2, 0)) === false);
// 앱이 없어도 멈추거나 사이드바가 열리지 않는다
await hoverHead(low); await pressDock(low, dock.btn, 0, 0); await sleep(900);
ok('(세로 도크) 앱 없이 발표 시작을 눌러도 책갈피가 그대로다', (await tabBox(web)).shown === true && await panels() === 0);
// 도크만 띄우기
await hoverHead(low); await pressDock(low, dock.btn, 8, 2);
let popup; for (let i = 0; i < 30 && !popup; i++) { popup = (await C.send('Target.getTargets')).targetInfos.find(t => t.url === ORIGIN + '/dock.html'); if (!popup) await sleep(150); }
ok('(세로 도크) 도크만 띄우기가 작은 창을 연다', !!popup);
if (popup) await C.send('Target.closeTarget', {targetId: popup.targetId});
await C.send('Target.activateTarget', {targetId: web.targetId}); await sleep(400);
// 설정
await hoverHead(low); await pressDock(low, dock.btn, 9, 2);
ok('(세로 도크) 설정을 누르면 사이드바가 열린다', await waitPanels(1), await panels());
sp = await side(); await sp.waitFor(sp.visible('#workspace'), 15000);
const SETTINGS_SHOWN = `document.getElementById('settings').hidden===false`;
await sp.waitFor(SETTINGS_SHOWN, 3000).catch(() => {});
ok('(세로 도크) 열린 사이드바가 프로필 설정으로 간다', await sp.eval(`chrome.storage.session.get('sideOpenPage').then(r=>r.sideOpenPage===undefined)`) && await sp.eval(SETTINGS_SHOWN), await sp.eval(SETTINGS_SHOWN));
// 선택 영역: 사이드바가 다 닫힌 뒤에 고른다
const pickSeen = async () => { const from = Date.now(); for (let i = 0; i < 200; i++) { if (await web.eval(`!!document.getElementById('__dais_pick')`)) { console.log('     고르기까지', Date.now() - from, 'ms'); return true; } await sleep(50); } return false; };
const pickState = async () => ({panels: await panels(), iw: await web.eval('innerWidth'), tab: (await tabBox(web)).shown});
const escape = async () => { await web.cmd('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27}); await web.cmd('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27}); await sleep(500); };
const wideBefore = box.iw;
await sp.eval(`document.getElementById('cap-area').click()`);
let seenPick = await pickSeen(), at = await pickState();
ok('(자동 숨김 캡처) 선택 영역을 누르면 고르는 화면이 뜬다', seenPick, at);
ok('(자동 숨김 캡처) 고르기가 시작될 때 사이드바는 이미 사라지고 화면이 넓어져 있다', at.panels === 0 && at.iw >= wideBefore - 1, {at, wideBefore});
ok('(자동 숨김 캡처) 고르는 동안 책갈피는 보이지 않는다', at.tab === false, at);
await escape();
ok('(자동 숨김 캡처) Esc 로 그만두면 책갈피가 돌아오고 사이드바는 닫힌 채다', (await waitTab(web, true, 6000)).shown === true && await panels() === 0, await pickState());
// 세로 도크의 선택 영역
await hoverHead(low); await pressDock(low, dock.btn, 6, 1);
seenPick = await pickSeen(); at = await pickState();
ok('(세로 도크) 선택 영역 단추로 고르기가 시작되고 책갈피는 숨는다', seenPick && at.tab === false && at.panels === 0, at);
await escape();
ok('(세로 도크) 그만두면 책갈피가 돌아온다', (await waitTab(web, true, 6000)).shown === true);
// 아래쪽 자리에서는 위로 펼친다
let high = await setSpot(.97);
dock = await hoverHead(high);
ok('(세로 도크) 아래 공간이 없으면 위로 펼친다', dock.side === 'above' && await hostAt(high.vw - 22, high.top - 30) && (await tabBox(web)).top === high.top, dock);
await mouse(web, 'mouseMoved', 200, 300); await sleep(500);
// 작은 창: 단추가 줄어 다 들어오거나 스크롤로 닿는다
await setSpot(.5); box = await waitTab(web, true);

// 사이드바에서 끄면: 책갈피가 사라지고, 마우스가 나가도 닫지 않는다
await clickTab(web); await waitPanels(1); sp = await side(); await sp.waitFor(sp.visible('#workspace'), 15000);
await sp.eval(`document.querySelector('header .auto-hide').click()`); await sleep(500);
ok('사이드바에서 끄면 저장된다', await local('sideAutoHide') === false);
await leave(sp); await sleep(2000);
ok('끄면 마우스가 나가도 닫지 않는다', await panels() === 1);
await sp.eval(`window.close()`).catch(() => {}); await waitPanels(0, 4000); await sleep(1500);
ok('끄면 사이드바가 닫혀 있어도 책갈피가 없다', (await tabBox(web)).shown === false, await tabBox(web));

console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
await C.stop(); server.close();
process.exit(failed ? 1 : 0);
