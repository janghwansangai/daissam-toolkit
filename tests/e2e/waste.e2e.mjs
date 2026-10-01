// v0.39.2 — 측정으로 찾은 낭비 세 가지를 고친 뒤 실제 Chrome 에서 눌러 본다. 사용법은 cdp.mjs 맨 위를 보세요.
//  ① 보낼 메모가 없으면 1분 알람이 없다(서비스 워커를 1분마다 깨우지 않는다)
//  ② 사이드바를 열기만 해서는 카메라·오디오 보조 프로세스(약 48MB)가 뜨지 않고, 그 화면을 열면 목록이 채워진다
//  ③ 풀려 있는 동안 휠·터치를 막지 않는다. 그래도 잠금·Command+휠 확대는 그대로 동작한다.
// ※ Command+휠 확대(맥)는 맥에서만 확인한다.
import http from 'node:http';
import os from 'node:os';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
const MAC = process.platform === 'darwin';
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail))); if (!cond) failed++; };
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>t</title><body style="margin:0"><div style="height:60000px;background:linear-gradient(#fff,#bbb)">긴 페이지 ${req.url}</div></body>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
// 가짜 카메라·마이크를 달아 목록이 채워지는지 본다
const chrome = new Chrome({ext: EXT, profile: os.tmpdir() + '/e2e-waste-' + Date.now() + '/p', port: 9531, downloads: os.tmpdir() + '/e2e-waste-dl',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});
await chrome.start();
const send = (page, type, data = {}) => page.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
const utilities = () => {
  const rows = execSync('ps -axo pid=,ppid=,command=', {encoding: 'utf8'}).trim().split('\n').map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m && {pid: +m[1], ppid: +m[2], cmd: m[3]}; }).filter(Boolean);
  const kids = new Map(); for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  const out = []; const walk = p => { for (const k of kids.get(p) || []) { out.push(k); walk(k.pid); } }; walk(chrome.proc.pid);
  return out.map(r => (r.cmd.match(/--utility-sub-type=([\w.]+)/) || [])[1]).filter(Boolean);
};
const media = () => utilities().filter(name => /VideoCaptureService|AudioService/.test(name));

// ── ② 사이드바와 보조 프로세스 ──────────────────────────────────────────
let panel = await chrome.open(PANEL);
await panel.waitFor(panel.visible('#gate-form'), 15000, '처음 화면');
await send(panel, 'setup', {pin: '246810', name: '시험'});
await send(panel, 'settings', {name: '시험', idleMinutes: 0, startLocked: false, lockOnAway: false, wheelZoom: true});
await panel.waitFor(panel.visible('#workspace'), 15000, '작업 화면');
await panel.eval(`chrome.storage.local.set({recordOptions:{mode:'desktop',camera:true,cameraId:'saved-camera-id',cameraName:'내 카메라',mic:true,micId:'saved-mic-id',res:'1080',format:'mp4',countdown:3,limit:0,sound:true,controlBar:true}})`);
await panel.eval('location.reload()'); await sleep(1500);
await panel.waitFor(panel.visible('#workspace'), 15000, '다시 연 작업 화면'); await sleep(3500);
ok('사이드바를 열기만 해서는 카메라·오디오 보조 프로세스가 뜨지 않는다', media().length === 0, utilities());
// 캡처 화면을 열기 전에 녹화 옵션이 저장돼도 골라 둔 카메라·마이크가 지워지지 않는다
await panel.eval(`(()=>{const e=document.getElementById('rec-res');e.value='720';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await sleep(500);
const kept = await panel.eval(`chrome.storage.local.get('recordOptions').then(x=>x.recordOptions)`);
ok('목록을 채우기 전에 저장해도 골라 둔 카메라·마이크가 그대로다', kept.res === '720' && kept.cameraId === 'saved-camera-id' && kept.micId === 'saved-mic-id' && kept.cameraName === '내 카메라', kept);
ok('캡처 화면을 열기 전에도 여전히 보조 프로세스가 없다', media().length === 0, utilities());
// 캡처 화면을 연다 → 목록이 채워진다
await panel.click('nav button[data-page="capture"]');
await panel.waitFor(`document.getElementById('rec-cam-dev').options.length>1`, 8000, '카메라 목록');
ok('캡처 화면을 열면 카메라·마이크 목록이 채워진다', (await panel.eval(`document.getElementById('rec-cam-dev').options.length`)) > 1 && (await panel.eval(`document.getElementById('rec-mic-dev').options.length`)) > 1);
await sleep(1500);
ok('그때서야 보조 프로세스가 뜬다(녹화를 하는 사람에게는 필요하다)', media().length >= 1, utilities());
// 유틸리티 → 녹음기: 칸을 펼칠 때 마이크 목록을 읽는다
await panel.click('nav button[data-page="tools"]');
await panel.eval(`document.getElementById('tool-rec').open=true`);
await panel.waitFor(`document.querySelectorAll('#rec-mic-pick option[data-device]').length>0`, 8000, '녹음기 마이크 목록');
ok('녹음기 칸을 펼치면 마이크 목록이 채워진다', true);

// ── ① 알람 ──────────────────────────────────────────────────────────────
const alarms = () => panel.eval(`chrome.alarms.getAll().then(a=>a.map(x=>x.name).filter(n=>n==='flush-notes'))`);
ok('보낼 메모가 없으면 1분 알람이 없다', (await alarms()).length === 0, await alarms());
await send(panel, 'note-save', {id: 'n-0001', title: '한 줄', text: '안녕'});
ok('메모를 쓰면 알람이 생긴다', (await alarms()).length === 1);
await send(panel, 'note-flush'); await sleep(300);
ok('다 보내면 알람이 사라진다', (await alarms()).length === 0, await alarms());


// 콘텐츠 스크립트는 페이지와 분리된 ‘격리된 세계’에서 돈다. 그 세계의 window 에 걸린 듣는 쪽을 Chrome 이 직접 알려 준다.
const isolatedContext = page => chrome.events.filter(e => e.method === 'Runtime.executionContextCreated' && e.sessionId === page.sessionId
  && e.params.context.auxData?.type === 'isolated' && String(e.params.context.origin).includes('ehgodopakibamgeopmelemjmjdjhbdgm')).at(-1)?.params.context.id;
const windowListeners = async page => {
  const contextId = isolatedContext(page);
  if (!contextId) throw new Error('격리된 세계를 찾지 못했다');
  const {result} = await page.cmd('Runtime.evaluate', {expression: 'window', contextId});
  const {listeners} = await page.cmd('DOMDebugger.getEventListeners', {objectId: result.objectId});
  return listeners.map(l => ({type: l.type, passive: l.passive, capture: l.useCapture}));
};
const blockingScroll = async page => (await windowListeners(page)).filter(l => (l.type === 'wheel' || l.type === 'touchstart') && !l.passive).map(l => l.type).sort();
// ── ③ 휠·터치 ───────────────────────────────────────────────────────────
const tab = await chrome.open(`${origin}/?a`);
await tab.waitFor(`document.readyState==='complete'`, 10000);
await chrome.send('Page.bringToFront', {}, tab.sessionId).catch(() => {});
await tab.cmd('Emulation.setFocusEmulationEnabled', {enabled: true}).catch(() => {});
const wheel = (page, deltaY, modifiers = 0) => page.cmd('Input.dispatchMouseEvent', {type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY, modifiers});
const scrollY = () => tab.eval('window.scrollY');
const key = (page, type) => page.cmd('Input.dispatchKeyEvent', {type, key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91, modifiers: type === 'keyUp' ? 0 : 4});
const tabZoom = () => panel.eval(`chrome.tabs.query({url:'${origin}/*'}).then(t=>chrome.tabs.getZoom(t[0].id))`);
await sleep(600);
let y = await scrollY();
for (let i = 0; i < 5; i++) { await wheel(tab, 200); await sleep(40); }
await sleep(400);
ok('풀려 있으면 휠로 스크롤된다', (await scrollY()) > y + 500, {before: y, after: await scrollY()});
ok('풀려 있으면 스크롤을 막을 수 있다고 듣는 휠·터치 듣는 쪽이 하나도 없다', (await blockingScroll(tab)).length === 0, await windowListeners(tab));
// 잠금: 막는 쪽이 다시 켜진다. (잠금 화면이 화면 전체를 덮고 있어 휠의 목적지가 잠금 화면 자신이다 —
// 잠금 화면 안의 입력은 원래부터 통과시킨다. 뒤의 페이지가 스크롤되지 않는다는 보장은 처음부터 없었다.)
await send(panel, 'lock');
await tab.waitFor(`document.querySelectorAll('[data-browser-sheriff-guard]').length===1`, 8000, '잠금 화면');
await sleep(300);
ok('잠그면 휠·터치를 막는 듣는 쪽이 켜진다', JSON.stringify(await blockingScroll(tab)) === JSON.stringify(['touchstart', 'wheel']), await windowListeners(tab));
const outside = `document.body.dispatchEvent(new WheelEvent('wheel',{deltaY:100,cancelable:true,bubbles:true}))`;
ok('잠겨 있는 동안 잠금 화면 밖으로 가는 휠은 막힌다', (await tab.eval(outside)) === false);
await send(panel, 'unlock', {pin: '246810'});
await tab.waitFor(`document.querySelectorAll('[data-browser-sheriff-guard]').length===0`, 8000, '해제');
await sleep(300);
ok('해제하면 막는 듣는 쪽이 다시 모두 걷힌다', (await blockingScroll(tab)).length === 0, await windowListeners(tab));
ok('해제된 동안 휠은 막히지 않는다', (await tab.eval(outside)) === true);
y = await scrollY();
for (let i = 0; i < 5; i++) { await wheel(tab, 200); await sleep(40); }
await sleep(400);
ok('해제하면 다시 스크롤된다', (await scrollY()) > y + 500, {before: y, after: await scrollY()});
if (MAC) {
  // Command+휠 확대: Command 를 누르면 가로채고, 떼면 평소 스크롤
  const zoom0 = await tabZoom();
  ok('맥: Command 를 안 눌렀으면 막는 휠 듣는 쪽이 없다', (await blockingScroll(tab)).length === 0, await windowListeners(tab));
  await key(tab, 'rawKeyDown'); await sleep(200);
  ok('맥: Command 를 누르는 동안에만 휠을 막는 듣는 쪽이 하나 생긴다', JSON.stringify(await blockingScroll(tab)) === JSON.stringify(['wheel']), await windowListeners(tab));
  y = await scrollY();
  await wheel(tab, -100, 4); await sleep(500);
  const zoom1 = await tabZoom();
  ok('Command+휠이 화면 배율을 바꾼다(맥)', zoom1 > zoom0, {zoom0, zoom1});
  await wheel(tab, -100, 4); await sleep(150); await wheel(tab, -100, 4); await sleep(500);
  ok('Command+휠 동안 페이지가 스크롤되지 않는다', (await scrollY()) === y, {before: y, after: await scrollY()});
  await key(tab, 'keyUp'); await sleep(200);
  ok('맥: Command 를 떼면 다시 없다', (await blockingScroll(tab)).length === 0, await windowListeners(tab));
  y = await scrollY(); const zoom2 = await tabZoom();
  for (let i = 0; i < 4; i++) { await wheel(tab, 200); await sleep(40); }
  await sleep(400);
  ok('Command 를 떼면 평소처럼 스크롤되고 배율은 그대로다', (await scrollY()) > y + 300 && (await tabZoom()) === zoom2, {y, after: await scrollY(), zoom2});
  // Command 키 입력 없이 휠에만 Command 가 실려 온 경우(포커스가 다른 프레임일 때): 첫 눈금에서 알아채 배율을 바꾼다
  await panel.eval(`chrome.tabs.query({url:'${origin}/*'}).then(t=>chrome.tabs.setZoom(t[0].id,1))`);
  const tab2 = await chrome.open(`${origin}/?b`);
  await tab2.waitFor(`document.readyState==='complete'`, 10000); await sleep(500);
  const before = await panel.eval(`chrome.tabs.query({url:'${origin}/?b'}).then(t=>chrome.tabs.getZoom(t[0].id))`);
  await wheel(tab2, -100, 4); await sleep(600);
  const after = await panel.eval(`chrome.tabs.query({url:'${origin}/?b'}).then(t=>chrome.tabs.getZoom(t[0].id))`);
  ok('Command 키 입력을 못 받아도 Command+휠 첫 눈금에서 배율이 바뀐다', after > before, {before, after});
}
const exceptions = chrome.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
ok('처리되지 않은 예외가 없다', exceptions.length === 0, exceptions);
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
await chrome.stop(); server.close();
process.exit(failed ? 1 : 0);
