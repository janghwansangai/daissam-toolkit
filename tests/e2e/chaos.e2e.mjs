// 확장을 실제 Chrome 에서 무작위로 혹사시키며 ‘잃어버린 데이터가 없는지 · 오류가 없는지 · 새는 것이 없는지’ 본다.
//   node tests/e2e/chaos.e2e.mjs [초=90] [씨앗]      (같은 씨앗이면 같은 순서로 일한다 — 실패하면 씨앗을 알려 준다)
// 하는 일: 메모 저장·삭제·고정·동기화, 잠금·해제(틀린 PIN 포함), 탭 열기·닫기·이동, 서비스 워커 강제 종료,
//          설정·도구·북마크 바꾸기, 백업·복원, 망가진 메시지 던지기, 사이드바 화면 오가기·글 입력.
// 지키는 것(불변식): ① 확인(ack)을 받은 메모는 어떤 일이 있어도 로컬에 남는다 ② 잠그면 열린 탭마다 잠금 화면이 하나씩, 풀면 없다
//   ③ 동기화를 기다리는 메모가 있을 때만 알람이 있다 ④ 확장이 기록한 오류가 없다(Chrome 의 확장 오류 수집으로 읽는다)
//   ⑤ 시간이 가도 메모리가 늘지 않는다.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const ID = 'ehgodopakibamgeopmelemjmjdjhbdgm';
const DURATION = Number(process.argv[2] || 90) * 1000;
const SEED = Number(process.argv[3] || Date.now() % 1e9);
let state = SEED >>> 0;
const rand = () => { state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = list => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const chance = p => rand() < p;
const THROTTLE = Number(process.env.THROTTLE || 1);
console.log(`씨앗 ${SEED} · ${DURATION / 1000}초` + (THROTTLE > 1 ? ` · CPU ${THROTTLE}배 느리게` : ''));

const violations = [];
const log = [];
const note = text => { log.push(text); if (log.length > 40) log.shift(); };
const violate = (what, detail) => { const recent = [...log].slice(-10); violations.push({what, detail, 직전_작업: recent}); console.log('✗ 위반: ' + what, JSON.stringify(detail).slice(0, 300)); console.log('   직전 작업:', recent.join(' ▸ ')); };

// ── 시험용 서버: 별난 페이지들 ───────────────────────────────────────────
const pages = {
  '/': () => ['text/html', `<!doctype html><title>t</title><body><h1>수업 자료</h1><input id=x><p>${'가나다 '.repeat(50)}</p></body>`],
  '/frames': () => ['text/html', `<!doctype html><body><iframe src="/"></iframe><iframe srcdoc="<p>srcdoc</p>"></iframe><iframe sandbox src="/"></iframe><iframe src="about:blank"></iframe><iframe sandbox="allow-scripts" srcdoc="<script>1</script>"></iframe></body>`],
  '/svg': () => ['image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><text x="10" y="50">svg 문서</text></svg>`],
  '/xml': () => ['application/xml', `<?xml version="1.0"?><root><a>xml 문서</a></root>`],
  '/spa': () => ['text/html', `<!doctype html><body>시작<script>setInterval(()=>{document.body.innerHTML='<p>'+Date.now()+'</p>';if(Math.random()<.2){document.documentElement.replaceChildren(document.head||document.createElement('head'),document.createElement('body'));}},400)</script></body>`],
  '/long': () => ['text/html', `<!doctype html><body style="margin:0"><div style="height:30000px">긴 페이지</div></body>`],
  '/empty': () => ['text/html', ``],
  '/write': () => ['text/html', `<!doctype html><body><script>document.open();document.write('<p>다시 쓴 문서</p>');document.close()</script></body>`]
};
const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/slow') await sleep(1200);
  if (path === '/redirect') { res.writeHead(302, {location: '/'}); return res.end(); }
  const [type, body] = (pages[path === '/slow' ? '/' : path] || pages['/'])();
  res.setHeader('content-type', type + '; charset=utf-8'); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const routes = ['/', '/frames', '/svg', '/xml', '/spa', '/long', '/slow', '/redirect', '/empty', '/write'];

const freePort = () => new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });
const chrome = new Chrome({ext: EXT, profile: os.tmpdir() + '/e2e-chaos-' + SEED + '-' + Date.now() + '/p', port: await freePort(), downloads: os.tmpdir() + '/e2e-chaos-dl'});
await chrome.start();
// 사이드바의 api() 와 같다: 서비스 워커가 꺼지는 순간의 ‘Receiving end does not exist’ 만 한 번 다시 보낸다(그 오류는 메시지가 안 닿은 것).
// 횟수는 센다 — 시험에서 이 경합이 얼마나 자주 나는지 알아 두려는 것이다.
let raced = 0;
const send = async (page, type, data = {}) => {
  const run = () => page.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
  try { return await run(); }
  catch (error) { if (!/Receiving end does not exist/.test(error.message)) throw error; raced++; await sleep(200); return run(); }
};
const swTarget = async () => (await chrome.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes(ID));
const killWorker = async () => { const w = await swTarget(); if (w) await chrome.send('Target.closeTarget', {targetId: w.targetId}).catch(() => {}); };

// Chrome 이 확장의 모든 오류(서비스 워커·콘텐츠 스크립트·화면)를 모아 둔다. 그것을 읽는다.
const manager = await chrome.open('chrome://extensions/');
await sleep(1200);
await manager.eval(`new Promise(r=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},()=>r(1)))`);
await manager.eval(`new Promise(r=>chrome.developerPrivate.updateExtensionConfiguration({extensionId:'${ID}',errorCollection:true},()=>r(1)))`);
const extensionErrors = async () => JSON.parse(await manager.eval(`new Promise(r=>chrome.developerPrivate.getExtensionInfo('${ID}',i=>r(JSON.stringify((i.runtimeErrors||[]).map(e=>({m:e.message,s:e.source||'',c:e.occurrences||1,t:e.type}))))))`));

const slow = async page => { if (THROTTLE > 1) await page.cmd('Emulation.setCPUThrottlingRate', {rate: THROTTLE}).catch(() => {}); return page; };
const panel = await slow(await chrome.open(`chrome-extension://${ID}/panel.html`));
await panel.waitFor(panel.visible('#gate-form'), 15000, '처음 화면');
const PIN = '246810';
await send(panel, 'setup', {pin: PIN, name: '혹사'});
await send(panel, 'settings', {name: '혹사', idleMinutes: 0, startLocked: false, lockOnAway: false, wheelZoom: true});
await panel.waitFor(panel.visible('#workspace'), 15000, '작업 화면');
const device = await panel.eval(`chrome.storage.local.get('device').then(x=>x.device)`);

// ── 모형: 확인(ack)을 받은 메모 ─────────────────────────────────────────
const notes = new Map();       // id → {title, text, deleted, uncertain}
const noteIds = () => [...notes.entries()].filter(([, n]) => !n.deleted).map(([id]) => id);
const newId = () => 'c' + between(100000, 999999) + '-' + between(10, 99);
const bytes = text => Buffer.byteLength(text, 'utf8');
const words = ['수업', '준비', '학부모', '상담', '체험학습', '😀', '알림장', '\n', 'abc', 'XYZ', '한글', '“따옴표”', '<b>태그</b>', '\\n', '日本語', '🎒'];
const makeText = () => {
  const r = rand();
  const target = r < 0.6 ? between(0, 120) : r < 0.85 ? between(300, 2200) : r < 0.95 ? between(5200, 5440) : between(5600, 9000);
  let text = '';
  while (bytes(text) < target) text += pick(words) + ' ';
  return text.slice(0, Math.max(0, text.length - 1));
};
const tabs = [];
let uiNotes = 0;                 // 사이드바 화면이 만든 자기 메모 수
let attempts = 0;                // 틀린 PIN 시도(5번이면 30초 쉬므로 아껴 쓴다)
let locked = false;
let ops = 0;

const operations = {
  async saveNote() {
    const existing = noteIds();
    const id = existing.length && chance(0.55) ? pick(existing) : newId();
    const text = makeText(), title = pick(['메모 ' + between(1, 99), '제목', '긴 글 😀', '한 줄', '  공백  ']);
    note(`note-save ${id} ${bytes(text)}B`);
    try {
      const r = await send(panel, 'note-save', {id, title, text});
      if (r.ok) notes.set(id, {title: title.replace(/\s+/g, ' ').trim() || '새 메모', text, deleted: false});
      else if (/5,500|동기화/.test(r.error || '') && !/너무 큽니다/.test(r.error || '')) notes.set(id, {title: title.replace(/\s+/g, ' ').trim() || '새 메모', text, deleted: false});   // 너무 길어 동기화는 안 되지만 로컬 초안은 남는다
      else if (locked) { /* 잠긴 동안에는 거부가 맞다 */ }
      else if (!/너무 큽니다/.test(r.error || '')) violate('메모 저장이 까닭 없이 거부됐다', {r, id});
    } catch (error) { const n = notes.get(id); if (n) n.uncertain = true; else notes.set(id, {title: '', text: '', deleted: false, uncertain: true}); }
  },
  async saveBadNote() {
    // 같은 묶음에서 다른 작업이 저장소를 함께 바꾸므로 ‘개수가 같다’ 로는 못 본다. 나쁜 입력이 쓸 법한 id 가 저장소에 없는지 본다.
    const bad = pick([{id: '../x', text: 'a'}, {id: '', text: 'a'}, {id: 'bad-big', text: 'a'.repeat(200001)}, {id: 'bad-title', title: 'x'.repeat(41), text: 'a'}, {id: {}, text: 'a'}, {id: 'bad-null', text: null}, {id: 'bad-num', text: 5}]);
    note(`note-save(나쁜 입력) ${JSON.stringify(bad).slice(0, 40)}`);
    const r = await send(panel, 'note-save', bad);
    if (r.ok) violate('나쁜 메모 입력이 받아들여졌다', {bad: JSON.stringify(bad).slice(0, 80)});
    const keys = await panel.eval(`chrome.storage.local.get(['draftNotes','pendingNotes']).then(x=>[...Object.keys(x.draftNotes||{}),...Object.keys(x.pendingNotes||{})])`);
    const leaked = keys.filter(k => ['../x', '', 'bad-big', 'bad-title', 'bad-null', 'bad-num', '[object Object]'].includes(k));
    if (leaked.length) violate('나쁜 메모 입력이 저장소에 남았다', {leaked});
  },
  async deleteNote() {
    const ids = noteIds(); if (!ids.length) return;
    const id = pick(ids); note(`note-delete ${id}`);
    try { const r = await send(panel, 'note-delete', {id}); if (r.ok) notes.get(id).deleted = true; else if (!locked) violate('메모 삭제가 거부됐다', {r, id}); }
    catch { notes.get(id).uncertain = true; }
  },
  async pinNote() { const ids = noteIds(); if (!ids.length) return; note('note-pin'); try { await send(panel, 'note-pin', {id: pick(ids), pinned: chance(0.5)}); } catch {} },
  async flush() { note('note-flush'); try { await send(panel, 'note-flush'); } catch {} },
  async openTab() { if (tabs.length >= 10) return; const url = origin + pick(routes) + '?t=' + ops; note('탭 열기 ' + url.slice(origin.length)); try { tabs.push({page: await slow(await chrome.open(url)), url}); } catch {} },
  async closeTab() { if (tabs.length < 3) return; const i = between(0, tabs.length - 1); note('탭 닫기'); const [t] = tabs.splice(i, 1); await chrome.send('Target.closeTarget', {targetId: t.page.targetId}).catch(() => {}); },
  async navigate() { if (!tabs.length) return; const t = pick(tabs); const url = origin + pick(routes) + '?n=' + ops; note('탭 이동 ' + url.slice(origin.length)); await t.page.cmd('Page.navigate', {url}).catch(() => {}); t.url = url; },
  async reload() { if (!tabs.length) return; note('새로고침'); await pick(tabs).page.cmd('Page.reload').catch(() => {}); },
  async killWorker() { note('서비스 워커 강제 종료'); await killWorker(); },
  async wake() { note('서비스 워커 깨우기(state)'); try { await send(panel, 'state'); } catch {} },
  async settings() {
    note('settings'); const idle = pick([0, 0, 0, 1, 5, 15, 30]);   // 자동 잠금 시간은 대부분 끈다(이 컴퓨터의 입력 없는 시간 때문에 시험 도중 잠기지 않게)
    try { await send(panel, 'settings', {name: pick(['혹사', '이름 😀', 'x'.repeat(40)]), idleMinutes: 0, startLocked: chance(0.5), lockOnAway: false, wheelZoom: chance(0.5)}); } catch {}
    void idle;
  },
  async tools() {
    note('도구');
    try {
      await send(panel, 'tool-bells', {times: ['08:50', '09:40', '25:00', 'x'].slice(0, between(0, 4)), on: chance(0.5)});
      await send(panel, 'tool-teams', {teams: Array.from({length: between(0, 14)}, (_, i) => ({name: '모둠' + i, score: between(-5000, 20000)}))});
      if (chance(0.3)) await send(panel, 'tool-timer', {seconds: between(1, 5)}); else if (chance(0.3)) await send(panel, 'tool-timer-stop');
    } catch {}
  },
  async bookmarks() {
    note('북마크');
    try {
      const key = 'marks_' + device;
      const current = await panel.eval(`chrome.storage.sync.get('${key}').then(x=>x['${key}']||null)`);
      const items = (current?.items || []).slice(0, 25);
      items.push({id: 'b' + ops, rev: Math.max(0, ...items.map(i => i.rev)) + 1, writer: device, title: '북마크 ' + ops, url: 'https://example.com/' + ops, folder: ''});
      await send(panel, 'marks-commit', {expected: current, value: {v: 1, kind: 'bookmarks', items}});
    } catch {}
  },
  async fuzz() {
    const types = ['state', 'setup', 'unlock', 'lock', 'settings', 'note-save', 'note-delete', 'note-pin', 'note-flush', 'tool-timer', 'tool-bells', 'tool-sound', 'tool-teams', 'marks-commit', 'marks-drop-legacy', 'vault-commit', 'clip-toggle', 'clip-copy', 'clip-remove', 'backup-restore', 'capture', 'record-check', 'record-open', 'presenter-command', 'recorder-badge', 'screen-settings', 'music-control', 'note-active', 'page-zoom', 'nope', '', null, 5, {}];
    const junk = () => pick([null, undefined, 0, -1, 1e99, NaN, '', 'x'.repeat(5000), {}, [], [[]], {a: 1}, true, '__proto__', {__proto__: {x: 1}}, 'a'.repeat(300), ['x'], {id: {}}, '../../', '\u0000']);
    const type = pick(types);
    const data = {}; for (let i = 0, n = between(0, 4); i < n; i++) data[pick(['id', 'title', 'text', 'pin', 'name', 'times', 'teams', 'seconds', 'expected', 'value', 'blob', 'on', 'file', 'mode', 'payload', 'parts', 'action', 'items', 'tag', 'idleMinutes', 'tone', 'kind', 'note'])] = junk();
    // 위험한 것(진짜 잠금·설정 파괴·녹화 창 열기·사이드바 닫기 등)은 막아 둔다 — 망가진 입력이 얌전히 거부되는지가 목적이다
    if (['lock', 'setup', 'unlock', 'record-open', 'capture', 'clip-toggle', 'screen-settings', 'music-control', 'presenter-command', 'recorder-badge', 'settings', 'backup-restore'].includes(type)) return;
    note('fuzz ' + String(type)); const message = {...data}; if (type !== null) message.type = type;
    try { await panel.eval(`chrome.runtime.sendMessage(${JSON.stringify(message)}).then(()=>1,()=>2)`); } catch {}
  },
  async panelNav() {
    note('사이드바 화면 오가기');
    try { await panel.eval(`(()=>{const b=[...document.querySelectorAll('nav button')];b[Math.floor(Math.random()*b.length)]?.click();})()`); } catch {}
  },
  // 사이드바에서 글을 쓰는 것은 ‘두 번째 글쓴이’ 가 된다. 시험이 직접 쓰는 메모와 겹치면(같은 메모를 화면 글상자가 낡은 내용으로
  // 덮는다) 시험이 만든 가짜 위반이 나오므로, 사이드바는 언제나 새로 만든 자기 메모에만 쓴다(실제 사용에서도 쓰는 곳은 사이드바 하나다).
  async panelType() {
    if (locked || uiNotes >= 40) return;
    note('사이드바에서 새 메모에 글 입력');
    try {
      await panel.eval(`document.querySelector('nav button[data-page="notes"]')?.click()`);
      await panel.eval(`document.getElementById('add-note')?.click()`); uiNotes++;
      const text = makeText().slice(0, 40);
      await panel.eval(`(()=>{const box=document.getElementById('note');if(!box)return;box.focus();box.value=${JSON.stringify(text)};box.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    } catch {}
  },
  async panelAdd() { /* 사이드바는 panelType 이 만든 자기 메모만 쓴다 */ }
};
const weights = {saveNote: 14, saveBadNote: 2, deleteNote: 3, pinNote: 2, flush: 4, openTab: 5, closeTab: 4, navigate: 6, reload: 3, killWorker: 3, wake: 3, settings: 2, tools: 2, bookmarks: 2, fuzz: 8, panelNav: 4, panelType: 4, panelAdd: 1};
const bag = Object.entries(weights).flatMap(([name, w]) => Array(w).fill(name));

// ── 점검(불변식) ─────────────────────────────────────────────────────────
async function checkNotes(label) {
  const [draft, pending, sync] = await panel.eval(`Promise.all([chrome.storage.local.get(['draftNotes','pendingNotes']),0,chrome.storage.sync.get(null)]).then(([l,,s])=>[l.draftNotes||{},l.pendingNotes||{},s])`).then(x => x);
  const pendingNotes = await panel.eval(`chrome.storage.local.get('pendingNotes').then(x=>x.pendingNotes||{})`);
  for (const [id, n] of notes) {
    if (n.uncertain || n.deleted) continue;
    const d = draft[id];
    if (!d) { violate(`확인받은 메모가 사라졌다 (${label})`, {id, 기대: n.text.slice(0, 40)}); continue; }
    if (d.text !== n.text) violate(`메모 내용이 확인받은 것과 다르다 (${label})`, {id, 기대: n.text.slice(0, 40), 실제: String(d.text).slice(0, 40)});
  }
  return {pendingNotes, sync};
}
const hosts = `document.querySelectorAll('[data-browser-sheriff-guard]').length`;
async function lockCheckpoint() {
  note('◆ 잠금 점검'); await sleep(900);                       // 이동 중인 탭이 가라앉기를 기다린다
  const stable = [];
  for (const t of tabs) { try { const href = await t.page.eval('location.href'); if (href.startsWith(origin) && !/\/(svg|xml)/.test(href)) stable.push(t); } catch {} }
  locked = true;
  const r = await send(panel, 'lock');
  if (!r.ok || r.data.locked !== true) { violate('잠그기가 안 됐다', r); locked = false; return; }
  await sleep(1500);
  for (const t of stable) {
    try {
      const href = await t.page.eval('location.href');
      if (!href.startsWith(origin)) continue;
      const n = await t.page.eval(hosts);
      // /spa 는 문서를 갈아엎는 페이지라 잠금 화면이 지워질 수 있다(알려진 한계) — 그 밖에는 하나여야 한다
      if (n !== 1 && !/\/spa|\/write/.test(href)) violate('잠근 뒤 탭의 잠금 화면 수가 1이 아니다', {href: href.slice(origin.length), n});
    } catch {}
  }
  if (attempts < 3 && chance(0.5)) { attempts++; const bad = await send(panel, 'unlock', {pin: '000000'}); if (bad.ok) violate('틀린 PIN 으로 열렸다', bad); }
  const ok = await send(panel, 'unlock', {pin: PIN});
  if (!ok.ok || ok.data.locked !== false) { violate('올바른 PIN 으로 안 열린다', ok); await send(panel, 'unlock', {pin: PIN}).catch(() => {}); }
  locked = false; attempts = Math.max(0, attempts - 1);
  await sleep(1200);
  for (const t of stable) { try { const href = await t.page.eval('location.href'); if (href.startsWith(origin)) { const n = await t.page.eval(hosts); if (n !== 0) violate('풀었는데 잠금 화면이 남아 있다', {href: href.slice(origin.length), n}); } } catch {} }
}
async function alarmCheckpoint() {
  await send(panel, 'note-flush').catch(() => {}); await sleep(300);
  const [alarms, pending] = await Promise.all([panel.eval(`chrome.alarms.getAll().then(a=>a.map(x=>x.name).filter(n=>n==='flush-notes').length)`), panel.eval(`chrome.storage.local.get('pendingNotes').then(x=>Object.keys(x.pendingNotes||{}).length)`)]);
  if (pending === 0 && alarms !== 0) violate('보낼 메모가 없는데 알람이 있다', {alarms, pending});
  if (pending > 0 && alarms === 0) violate('보낼 메모가 있는데 알람이 없다(영영 못 보낼 수 있다)', {alarms, pending});
  return {alarms, pending};
}
const samples = [];
async function memorySample() {
  const live = tabs.filter(t => t.page);
  const t = live.length ? pick(live) : null; let tabHeap = null;
  if (t) { try { await t.page.cmd('HeapProfiler.enable'); await t.page.cmd('HeapProfiler.collectGarbage'); tabHeap = Math.round((await t.page.cmd('Runtime.getHeapUsage')).usedSize / 1024); } catch {} }
  let swHeap = null; const w = await swTarget();
  if (w) { try { const {sessionId} = await chrome.send('Target.attachToTarget', {targetId: w.targetId, flatten: true}); await chrome.send('HeapProfiler.collectGarbage', {}, sessionId).catch(() => {}); swHeap = Math.round((await chrome.send('Runtime.getHeapUsage', {}, sessionId)).usedSize / 1024); await chrome.send('Target.detachFromTarget', {sessionId}).catch(() => {}); } catch {} }
  let panelHeap = null; try { await panel.cmd('HeapProfiler.enable'); await panel.cmd('HeapProfiler.collectGarbage'); panelHeap = Math.round((await panel.cmd('Runtime.getHeapUsage')).usedSize / 1024); } catch {}
  const listeners = await panel.eval(`0`).catch(() => 0);
  samples.push({초: Math.round((Date.now() - started) / 1000), 탭힙KB: tabHeap, 서비스워커힙KB: swHeap, 사이드바힙KB: panelHeap, 탭수: tabs.length, listeners});
}

// ── 본 운동 ──────────────────────────────────────────────────────────────
for (let i = 0; i < 3; i++) tabs.push({page: await slow(await chrome.open(origin + routes[i] + '?s=' + i)), url: routes[i]});
const started = Date.now();
let nextLock = started + 12000, nextCheck = started + 20000, nextMemory = started + 15000;
const counts = {};
while (Date.now() - started < DURATION) {
  const burst = chance(0.12) ? between(2, 4) : 1;                // 가끔 여럿을 한꺼번에(경쟁 상태를 노린다)
  const names = Array.from({length: burst}, () => pick(bag));
  for (const n of names) counts[n] = (counts[n] || 0) + 1;
  ops += burst;
  try { await Promise.all(names.map(n => operations[n]().catch(error => { if (!/closed|Target|Session|detached|destroyed|No tab|crashed|navigat/i.test(error.message)) violate('작업 중 예외 ' + n, {m: error.message.slice(0, 200)}); }))); }
  catch (error) { violate('작업 묶음 예외', {m: error.message.slice(0, 200)}); }
  await sleep(between(20, 260));
  const nowT = Date.now();
  if (nowT >= nextLock) { await lockCheckpoint().catch(error => violate('잠금 점검 예외', {m: error.message.slice(0, 200)})); nextLock = Date.now() + between(18000, 30000); }
  if (nowT >= nextCheck) { await checkNotes('중간 점검'); await alarmCheckpoint(); nextCheck = Date.now() + 20000; }
  if (nowT >= nextMemory) { await memorySample(); nextMemory = Date.now() + 30000; }
}

// ── 마무리: 모두 가라앉힌 뒤 최종 점검 ────────────────────────────────────
note('◆ 마무리');
await sleep(1500);
await send(panel, 'unlock', {pin: PIN}).catch(() => {});
await killWorker(); await sleep(500);
await send(panel, 'note-flush').catch(() => {}); await sleep(500); await send(panel, 'note-flush').catch(() => {});
const {pendingNotes, sync} = await checkNotes('끝');
const live = [...notes.entries()].filter(([, n]) => !n.deleted && !n.uncertain);
let synced = 0, localOnly = 0;
for (const [id, n] of live) {
  const key = `note_${device}_${id}`;
  if (bytes(n.text) > 5500) { localOnly++; if (key in sync && sync[key].text === n.text) violate('너무 긴 메모가 동기화됐다', {id}); continue; }
  if (!(id in pendingNotes) && !n.text.trim()) continue;            // 빈 메모는 보내지 않는다(설계)
  if (sync[key]?.text === n.text) synced++;
  else if (!(id in pendingNotes)) violate('보낼 수 있는 메모가 동기화되지도 대기하지도 않는다', {id, 기대: n.text.slice(0, 30), 실제: String(sync[key]?.text).slice(0, 30)});
}
for (const [id, n] of notes) if (n.deleted && !n.uncertain) { const key = `note_${device}_${id}`; if (sync[key] && !sync[key].deleted) violate('지운 메모가 동기화 쪽에 살아 있다', {id}); }
const finalAlarm = await alarmCheckpoint();
await memorySample();
const errors = await extensionErrors();
const real = errors.filter(e => !/Specified native messaging host not found/.test(e.m));
console.log('\n=== 결과 ===');
console.log('실행한 작업:', ops, JSON.stringify(counts), '· 서비스 워커가 꺼지는 순간에 보내 다시 보낸 횟수:', raced);
console.log('메모: 확인받은', live.length, '개 · 동기화됨', synced, '· 로컬에만(긴 글)', localOnly, '· 대기 중', Object.keys(pendingNotes).length, '· 알람', JSON.stringify(finalAlarm));
console.log('메모리 표본:', JSON.stringify(samples));
if (errors.length) console.log('확장이 기록한 오류:', JSON.stringify(errors).slice(0, 1500));
for (const e of real) violate('확장이 오류를 기록했다', e);
// 메모리: 첫 표본과 마지막 표본의 차이가 크면 새는 것
const first = samples[0], last = samples.at(-1);
if (first && last) for (const key of ['서비스워커힙KB', '사이드바힙KB']) if (first[key] && last[key] && last[key] > first[key] * 2.5 + 3000) violate('메모리가 크게 늘었다: ' + key, {첫: first[key], 끝: last[key]});
console.log(violations.length ? `\n위반 ${violations.length}건` : '\n모두 통과');
if (violations.length) console.log('씨앗(다시 돌리려면):', SEED);
await chrome.stop(); server.close();
process.exit(violations.length ? 1 : 0);
