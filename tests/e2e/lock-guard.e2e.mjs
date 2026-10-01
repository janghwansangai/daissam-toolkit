// 잠금 화면(guard.js)을 실제 Chrome 에서 눌러 본다. 사용법은 cdp.mjs 맨 위를 보세요.
//   ① 잠겨 있는 동안 서비스 워커가 깨어나도, 열린 탭에 guard.js 가 다시 들어가도 잠금 화면이 한 순간도 사라지지 않는다
//      (사용자 보고: 잠금 중에 1분 안팎마다 화면이 깜박이며 원래 화면이 잠깐 보였다. 서비스 워커가 깰 때마다 모든 탭에
//       guard.js 를 다시 넣었고, 새 주입은 옛 잠금 화면을 먼저 지운 뒤 서비스 워커의 답을 기다려 새로 그렸다.)
//   ② 갈아 낀 뒤에도 해제·재잠금·단추·입력 차단이 제대로 동작한다.
// 탭이 많을수록 틈이 길어진다(탭 6개 8ms · 30개 17ms, 고치기 전). 기본 12개로 돌린다: node tests/e2e/lock-guard.e2e.mjs [탭 수]
import http from 'node:http';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

// EXT_DIR 로 다른 확장 폴더(예: 고치기 전 코드)를 바꿔 끼워 비교할 수 있다.
const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const TABS = Number(process.argv[2] || 12);
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail))); if (!cond) failed++; };
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>t</title><body><h1>수업 자료 ${req.url}</h1><input id=x></body>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = new Chrome({ext: EXT, profile: os.tmpdir() + '/e2e-lock-' + Date.now() + '/p', port: 9521, downloads: os.tmpdir() + '/e2e-lock-dl'});
await chrome.start();
const send = (page, type, data = {}) => page.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
const hosts = `document.querySelectorAll('[data-browser-sheriff-guard]').length`;
const workerLive = async () => (await chrome.send('Target.getTargets')).targetInfos.some(t => t.type === 'service_worker' && t.url.includes('ehgodopakibamgeopmelemjmjdjhbdgm'));
const stopWorker = async () => {
  const worker = (await chrome.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes('ehgodopakibamgeopmelemjmjdjhbdgm'));
  if (worker) await chrome.send('Target.closeTarget', {targetId: worker.targetId}).catch(() => {});
  await sleep(600);
};
const wakeByAlarm = async panel => { await panel.eval(`chrome.alarms.create('flush-notes',{when:Date.now()+200,periodInMinutes:1})`); await sleep(2200); };
const reinject = panel => panel.eval(`(async()=>{const tabs=await chrome.tabs.query({url:'${origin}/*'});await Promise.allSettled(tabs.map(t=>chrome.scripting.executeScript({target:{tabId:t.id,allFrames:true},files:['guard.js']})));})()`);

const panel = await chrome.open(PANEL);
await panel.waitFor(panel.visible('#gate-form'), 15000, '처음 화면');
await send(panel, 'setup', {pin: '246810', name: '시험'});
// 이 컴퓨터의 ‘입력 없는 시간’ 때문에 시험 도중 잠기지 않게 자동 잠금은 끈다(cdp.mjs 맨 위 설명)
await send(panel, 'settings', {name: '시험', idleMinutes: 0, startLocked: false, lockOnAway: false, wheelZoom: true});
const tabs = [];
for (let i = 0; i < TABS; i++) tabs.push(await chrome.open(`${origin}/?tab=${i}`));
await sleep(600);
ok('풀린 탭에는 잠금 화면이 없다', (await tabs[0].eval(hosts)) === 0);
await send(panel, 'lock');
for (const tab of tabs) await tab.waitFor(`${hosts}===1`, 10000, '잠금 화면');
ok(`잠그면 탭 ${TABS}개 모두 잠금 화면이 정확히 하나`, true);

// 맨 앞 탭에 관찰자를 심는다: 잠금 화면이 사라진/생긴 순간과, 잠금 화면 없이 그려진 프레임 수
const front = tabs.at(-1);
await chrome.send('Target.activateTarget', {targetId: front.targetId});
await front.eval(`(()=>{
  const q=()=>!!document.querySelector('[data-browser-sheriff-guard]');
  const p=window.__p={events:[],frames:0,exposed:0,t0:performance.now()};
  let had=q();
  new MutationObserver(()=>{const now=q();if(now!==had){p.events.push({t:Math.round(performance.now()-p.t0),overlay:now});had=now;}}).observe(document.documentElement,{childList:true,subtree:true});
  (function loop(){p.frames++;if(!q())p.exposed++;requestAnimationFrame(loop);})();
})()`);
const reset = () => front.eval(`window.__p.events.length=0;window.__p.exposed=0;window.__p.frames=0;window.__p.t0=performance.now()`);
const read = async () => JSON.parse(await front.eval(`JSON.stringify(window.__p)`));
const removals = r => r.events.filter(e => !e.overlay).length;

// 0) 관찰자가 정말 깜박임을 잡아내는지: 일부러 지웠다 50ms 뒤에 다시 붙여 본다
await reset();
await front.eval(`(()=>{const h=document.querySelector('[data-browser-sheriff-guard]');h.remove();setTimeout(()=>document.body.append(h),50);})()`);
await sleep(400);
{ const r = await read(); ok('관찰자 자체 점검: 일부러 만든 50ms 깜박임을 잡아낸다', removals(r) === 1 && r.exposed >= 1, r); }

// ① 서비스 워커가 깨어날 때
for (let round = 1; round <= 3; round++) {
  await reset(); await stopWorker();
  const stopped = !(await workerLive());
  await wakeByAlarm(panel);
  const r = await read();
  ok(`서비스 워커를 껐다 깨워도(${round}/3) 잠금 화면이 사라지지 않는다`, stopped && removals(r) === 0 && r.exposed === 0, {stopped, removals: removals(r), exposed: r.exposed, events: r.events});
}
// ② 열린 탭에 guard.js 를 직접 다시 넣을 때(확장 업데이트·끔→켬 때 일어나는 일)
for (let round = 1; round <= 3; round++) {
  await reset(); await reinject(panel); await sleep(1800);
  const r = await read();
  ok(`다시 주입해도(${round}/3) 잠금 화면이 사라지지 않는다`, removals(r) === 0 && r.exposed === 0 && (await front.eval(hosts)) === 1, {removals: removals(r), exposed: r.exposed, hosts: await front.eval(hosts)});
}
ok('그 뒤에도 탭마다 잠금 화면이 하나', (await Promise.all(tabs.map(t => t.eval(hosts)))).every(n => n === 1));

// ③ 갈아 낀 잠금 화면이 살아 있다
const popups = async () => (await chrome.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page' && t.url.includes('panel.html?unlock=1')).length;
const before = await popups();
await front.eval(`document.querySelector('[data-browser-sheriff-guard]').shadowRoot.querySelector('button').click()`);
await sleep(1500);
ok('‘PIN 확인하기’ 단추가 동작한다(해제 창이 열린다)', (await popups()) > before);
const keyBlocked = `(()=>{const x=document.getElementById('x');let seen=false;x.addEventListener('keydown',()=>seen=true,{once:true});x.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true,cancelable:true}));return !seen;})()`;
ok('잠긴 동안 페이지의 키 입력은 막힌다', (await front.eval(keyBlocked)) === true);
const r = await send(panel, 'unlock', {pin: '246810'});
ok('올바른 PIN 으로 해제된다', r.ok === true && r.data.locked === false);
for (const tab of tabs) await tab.waitFor(`${hosts}===0`, 10000, '해제');
ok('해제하면 모든 탭의 잠금 화면이 사라진다', true);
ok('해제된 탭에서 키 입력이 막히지 않는다', (await front.eval(keyBlocked)) === false);
ok('해제된 탭에서 클릭이 막히지 않는다', (await front.eval(`(()=>{let n=0;document.body.addEventListener('click',()=>n++,{once:true});document.body.click();return n;})()`)) === 1);
await send(panel, 'lock');
for (const tab of tabs) await tab.waitFor(`${hosts}===1`, 10000, '재잠금');
ok('다시 잠그면 잠금 화면이 다시 생긴다', true);

// ④ 잠긴 동안 새 주소로 이동하면 잠금 안내가 뜨고, 풀면 ‘그 주소 그대로’ 돌아간다.
//    (예전에는 안내 화면이 주소를 한 번 더 디코딩해 ?x=a%26b 가 ?x=a&b 로 바뀌었고, 홀로 있는 % 에서는 스크립트가 죽어 단추가 하나도 안 걸렸다.)
{
  const paths = ['/q?x=a%26b&y=%E2%9C%93', '/x?next=https%3A%2F%2Fexample.com%2F', '/p#frag%20x', '/한글/경로?이름=값', '/50%', '/a%E0%A4%A', '/%zz'];
  const guarded = [];
  for (const path of paths) guarded.push({path, page: await chrome.open(origin + path)});
  await sleep(1500);
  for (const {path, page} of guarded) {
    const href = await page.eval('location.href').catch(() => '');
    ok(`잠긴 동안 ${path} 로 가면 잠금 안내가 뜬다`, href.includes('locked.html'), href.slice(0, 80));
    if (!/%(?![0-9A-Fa-f]{2})/.test(path)) continue;
    const popupsBefore = await popups();
    await page.eval(`document.getElementById('unlock').click()`); await sleep(1000);
    ok(`홀로 있는 % 가 든 주소(${path})의 잠금 안내에서도 ‘PIN 확인하기’ 단추가 동작한다`, (await popups()) > popupsBefore);
    ok(`홀로 있는 % 가 든 주소(${path})의 잠금 안내가 오류 없이 그려진다`, !chrome.events.some(e => e.method === 'Runtime.exceptionThrown' && e.sessionId === page.sessionId));
  }
  const unlocked = await send(panel, 'unlock', {pin: '246810'});
  ok('안내 화면이 여럿 떠 있어도 해제된다', unlocked.ok === true && unlocked.data.locked === false);
  for (const {path, page} of guarded) {
    const want = new URL(origin + path).href;
    let got = '';
    for (let i = 0; i < 30 && got !== want; i++) { got = await page.eval('location.href').catch(() => ''); if (got !== want) await sleep(200); }
    ok(`풀리면 ${path} 로 한 글자도 바뀌지 않고 돌아간다`, got === want, {want, got});
  }
  await send(panel, 'lock');
  for (const tab of tabs) await tab.waitFor(`${hosts}===1`, 10000, '다시 잠금');
}
const exceptions = chrome.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
ok('처리되지 않은 예외가 없다', exceptions.length === 0, exceptions);
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
await chrome.stop(); server.close();
process.exit(failed ? 1 : 0);
