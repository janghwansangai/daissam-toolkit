// v0.42.0 기능을 실제 Chrome 에서 본다: 탭 휠 · 끌어서 순서 · 보안 북마크 · 가려졌다 보여도 북마크 유지 ·
// 빠른 동기화 · 동기화 확인 · 사이드바 페이지 맞추기. 사용: node tests/e2e/features042.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-042-'));
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail).slice(0, 300))); if (!cond) failed++; };
const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  r.end(q.url.startsWith('/wide') ? '<body style="margin:0"><div style="width:1600px;height:300px;background:#cde">넓은 페이지</div></body>' : '<h1>수업 자료</h1>'); }).listen(8797);
const C = new Chrome({ext: EXT, profile: path.join(root, 'p'), port: 9621, downloads: path.join(root, 'dl')});
await C.start();
const p = await C.open(PANEL, {width: 400, height: 900});
await p.waitFor(p.visible('#gate-guest'), 15000, '처음 화면');
await p.eval(`document.getElementById('gate-guest').click()`);
await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
const send = (type, data = {}) => p.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
const device = await p.eval(`chrome.storage.local.get('device').then(r=>r.device)`);

// 빠른 동기화: 저장하고 몇 초 안에 Chrome 동기화로 올라간다(예전 30초)
const t0 = Date.now();
await send('note-save', {id: 'q1', title: '빠른 동기화', text: '노트북을 곧바로 덮어도'});
let synced = false;
for (let i = 0; i < 20 && !synced; i++) { await sleep(500); synced = await p.eval(`chrome.storage.sync.get(null).then(a=>Object.keys(a).some(k=>k.endsWith('_q1')))`); }
ok('메모가 몇 초 안에 Chrome 동기화로 올라간다(30초 기다리지 않음)', synced && Date.now() - t0 < 9000, Date.now() - t0);
ok('이 기기의 동기화 소식(dev_)이 남는다', await p.eval(`chrome.storage.sync.get('dev_'+${JSON.stringify(device)}).then(r=>!!r['dev_'+${JSON.stringify(device)}])`));
for (let i = 1; i <= 8; i++) await send('note-save', {id: 'n' + i, title: '긴 제목의 메모 ' + i + ' 번째', text: '내용 ' + i});
await sleep(5000);
let rev = 1; const item = f => ({rev: rev++, writer: device, ...f});
const folderIds = Array.from({length: 8}, (_, i) => 'f' + i);
await p.eval(`chrome.storage.sync.set({['marks_'+${JSON.stringify(device)}]:${JSON.stringify({v: 1, kind: 'bookmarks', items: [
  ...folderIds.map((id, i) => item({id, type: 'folder', title: '폴더 이름 ' + i})), item({id: 'b1', title: '수업 자료', url: 'http://127.0.0.1:8797/class'})]})}})`);
await p.eval(`location.reload()`); await p.waitFor(p.visible('#workspace'), 15000, '다시 연 작업 화면'); await sleep(1500);

// 휠: Shift 없이 탭 줄이 좌우로
const wheel = id => p.eval(`(()=>{const s=document.getElementById('${id}');s.scrollLeft=0;s.dispatchEvent(new WheelEvent('wheel',{deltaY:240,bubbles:true,cancelable:true}));return {left:s.scrollLeft,over:s.scrollWidth>s.clientWidth};})()`);
let w = await wheel('note-tabs');
ok('메모 탭 줄 위에서 휠을 굴리면(Shift 없이) 옆으로 넘어간다', w.over && w.left > 0, w);
await p.eval(`document.querySelector('[data-page="vault"]').click()`); await sleep(800);
w = await wheel('folder-tabs');
ok('북마크 폴더 탭 줄도 휠로 넘어간다', w.over && w.left > 0, w);

// 끌어서 순서: 세 번째 탭을 첫 번째 자리로
const drag = (id, from, to) => p.eval(`(()=>{const s=document.getElementById('${id}');const tabs=[...s.querySelectorAll('[data-id]')];const a=tabs[${from}],b=tabs[${to}];
  const dt=new DataTransfer();a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
  b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));a.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));return a.dataset.id;})()`);
const order = id => p.eval(`[...document.getElementById('${id}').querySelectorAll('[data-id]')].map(n=>n.dataset.id)`);
const movedFolder = await drag('folder-tabs', 2, 0); await sleep(1200);
ok('폴더 탭을 끌어 놓으면 그 자리로 옮겨진다', (await order('folder-tabs'))[0] === movedFolder, await order('folder-tabs'));
await p.eval(`document.querySelector('[data-page="notes"]').click()`); await sleep(600);
const before = await order('note-tabs');
const movedNote = await drag('note-tabs', 3, 0); await sleep(1500);
ok('메모 탭을 끌어 놓으면 그 자리로 옮겨진다', (await order('note-tabs'))[0] === movedNote && before[0] !== movedNote, {before, after: await order('note-tabs')});
const saved = await p.eval(`chrome.storage.sync.get(['noteOrder','folderOrder'])`);
ok('정한 순서는 동기화 저장소에 남는다(다른 컴퓨터도 같은 순서)', saved.noteOrder?.ids?.[0] === movedNote && saved.folderOrder?.ids?.[0] === movedFolder, saved);
await p.eval(`location.reload()`); await p.waitFor(p.visible('#workspace'), 15000, '다시 연 화면'); await sleep(1500);
ok('사이드바를 다시 열어도 순서가 그대로다', (await order('note-tabs'))[0] === movedNote);

// 가려졌다 다시 보여도 북마크가 남아 있다
await p.eval(`document.querySelector('[data-page="vault"]').click()`); await sleep(800);
const count = () => p.eval(`document.querySelectorAll('#bookmarks .bookmark').length`);
const n0 = await count();
await p.eval(`(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));})()`); await sleep(1200);
ok('사이드바가 가려졌다 다시 보여도 북마크가 보인다', n0 >= 1 && (await count()) === n0, {n0, now: await count()});

// 보안 북마크: 게스트가 켜면 PIN 을 만든다
await p.eval(`document.getElementById('dock-settings').click()`); await sleep(800);
await p.eval(`(()=>{const c=document.getElementById('secure-marks');c.checked=true;c.dispatchEvent(new Event('change'));})()`); await sleep(500);
ok('게스트가 보안 북마크를 켜면 PIN 만들기 칸이 뜬다(PIN 한 번 더 포함)', await p.eval(`!document.getElementById('secure-box').hidden&&!document.getElementById('secure-pin2-label').hidden`));
await p.type('#secure-pin', '246810'); await p.type('#secure-pin2', '135790');
await p.eval(`document.getElementById('secure-go').click()`); await sleep(600);
ok('두 PIN 이 다르면 켜지지 않는다', !(await send('state')).data.secureMarks);
await p.eval(`document.getElementById('secure-pin2').value=''`); await p.type('#secure-pin2', '246810');
await p.eval(`document.getElementById('secure-go').click()`); await sleep(1200);
let st = (await send('state')).data;
ok('PIN 을 만들고 보안 북마크가 켜진다 — 게스트가 아니게 되고 잠금은 꺼진 채', st.secureMarks && !st.guest && !st.locked && st.startLocked === false && st.lockOnAway === false, st);
await p.eval(`document.querySelector('[data-page="vault"]').click()`); await sleep(800);
const link = await p.eval(`(()=>{const a=document.querySelector('#bookmarks .bookmark a');return {href:a.getAttribute('href'),secure:a.classList.contains('secure')};})()`);
ok('보안 북마크는 주소를 걸어 두지 않는다(가운데 클릭 · 끌어 놓기로 건너뛰지 못하게)', link.href === null && link.secure, link);
const tabsOpen = () => p.eval(`chrome.tabs.query({url:'http://127.0.0.1:8797/class'}).then(t=>t.length)`);
await p.eval(`document.querySelector('#bookmarks .bookmark a').click()`); await sleep(500);
ok('보안 북마크를 누르면 PIN 을 묻는다', await p.eval(`document.getElementById('mark-pin').open`));
await p.type('#mark-pin-input', '000000'); await p.eval(`document.getElementById('mark-pin-form').requestSubmit()`); await sleep(700);
ok('틀린 PIN 이면 열지 않고 알려 준다', (await tabsOpen()) === 0 && /PIN/.test(await p.eval(`document.getElementById('mark-pin-error').textContent`)) && await p.eval(`document.getElementById('mark-pin').open`));
await p.type('#mark-pin-input', '246810'); await p.eval(`document.getElementById('mark-pin-form').requestSubmit()`); await sleep(1200);
ok('맞는 PIN 이면 연다', (await tabsOpen()) === 1 && !(await p.eval(`document.getElementById('mark-pin').open`)));
await p.eval(`document.querySelector('#bookmarks .bookmark a').click()`); await sleep(1000);
ok('5분 안에는 다시 묻지 않는다', (await tabsOpen()) === 2 && !(await p.eval(`document.getElementById('mark-pin').open`)));
// 끄려면 PIN
await p.eval(`document.getElementById('dock-settings').click()`); await sleep(600);
await p.eval(`(()=>{const c=document.getElementById('secure-marks');c.checked=false;c.dispatchEvent(new Event('change'));})()`); await sleep(400);
await p.type('#secure-pin', '111111'); await p.eval(`document.getElementById('secure-go').click()`); await sleep(700);
ok('틀린 PIN 으로는 보안 북마크를 끌 수 없다', (await send('state')).data.secureMarks === true);
await p.eval(`document.getElementById('secure-pin').value=''`); await p.type('#secure-pin', '246810'); await p.eval(`document.getElementById('secure-go').click()`); await sleep(900);
ok('맞는 PIN 으로 끈다 — 북마크에 주소가 다시 걸린다', (await send('state')).data.secureMarks === false
  && await p.eval(`(document.querySelector('[data-page="vault"]').click(),new Promise(r=>setTimeout(()=>r(!!document.querySelector('#bookmarks .bookmark a').getAttribute('href')),700)))`));

// 동기화 확인
await p.eval(`document.querySelector('[data-page="notes"]').click()`); await sleep(400);
await p.eval(`document.getElementById('sync-check').click()`); await sleep(3500);
ok('‘동기화 확인’ 이 이 컴퓨터의 상태를 알려 준다', /이 컴퓨터: 모든 메모를/.test(await p.eval(`document.getElementById('sync-box').textContent`)), await p.eval(`document.getElementById('sync-box').textContent`));
await p.eval(`chrome.storage.sync.set({dev_ffeedd11:{v:1,os:'win',at:Date.now()-3600000,pending:1,error:''}})`);
await p.eval(`document.getElementById('sync-check').click()`); await sleep(3500);
ok('다른 컴퓨터가 못 올린 메모가 있으면 알려 준다', /윈도우 컴퓨터\(ffeedd\).*못 올린 메모 1개/.test(await p.eval(`document.getElementById('sync-box').textContent`)));

// 사이드바 페이지 맞추기(배경의 fit-page · fit-release 를 직접 부른다 — 시험 Chrome 에서는 사이드바를 열 수 없다)
const wide = await C.open('http://127.0.0.1:8797/wide', {width: 1000, height: 700}); await sleep(800);
const other = await C.open('http://127.0.0.1:8797/other', {width: 1000, height: 700}); await sleep(500);
const tabs = await p.eval(`chrome.tabs.query({url:'http://127.0.0.1:8797/*'}).then(t=>t.map(x=>({id:x.id,w:x.windowId,url:x.url})))`);
const wideTab = tabs.find(t => t.url.endsWith('/wide')), otherTab = tabs.find(t => t.url.endsWith('/other'));
let r = await send('fit-page', {tabId: wideTab.id});
const zoom = id => p.eval(`chrome.tabs.getZoom(${id})`);
ok('넘치는 페이지는 그 탭만 배율을 줄인다', r.ok && r.data.changed && (await zoom(wideTab.id)) < 0.7 && (await zoom(otherTab.id)) === 1, {r, other: await zoom(otherTab.id)});
ok('줄인 뒤에는 옆으로 넘치지 않는다', await wide.eval(`document.documentElement.scrollWidth<=document.documentElement.clientWidth+24`));
r = await send('fit-page', {tabId: otherTab.id});
ok('넘치지 않는 페이지는 그대로 둔다', r.ok && !r.data.changed && (await zoom(otherTab.id)) === 1);
r = await send('fit-release', {windowId: wideTab.w});
ok('사이드바를 닫으면 원래 배율로 돌아온다', r.ok && r.data.restored === 1 && (await zoom(wideTab.id)) === 1, {r, z: await zoom(wideTab.id)});
await send('fit-page', {tabId: wideTab.id});
await p.eval(`chrome.tabs.setZoom(${wideTab.id},0.8)`);
await send('fit-release', {windowId: wideTab.w});
ok('그 사이 사용자가 배율을 바꿨으면 손대지 않는다', (await zoom(wideTab.id)) === 0.8);
await p.eval(`chrome.tabs.setZoom(${wideTab.id},1)`);
r = await send('fit-set', {on: false});
r = await send('fit-page', {tabId: wideTab.id});
ok('설정에서 끄면 줄이지 않는다', r.ok && !r.data.changed && (await zoom(wideTab.id)) === 1);
await send('fit-set', {on: true});

await C.stop(); server.close();
try { fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 300}); } catch {}
console.log(failed ? `실패 ${failed}건` : '모두 통과');
process.exit(failed ? 1 : 0);
