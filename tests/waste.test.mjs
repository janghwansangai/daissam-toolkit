// 측정으로 찾은 낭비 세 가지를 고친 뒤, 되돌아가지 않도록 지킨다(v0.39.2).
//  ① 동기화를 기다리는 메모가 없는데도 1분마다 확장을 깨우던 알람
//  ② 사이드바를 열 때마다 카메라·마이크를 읽고 지켜봐 Chrome 보조 프로세스 두 개(약 48MB)를 띄우던 것
//  ③ 풀려 있는 동안에도 모든 페이지의 휠·터치를 ‘막을 수 있다’고 듣고 있어 스크롤이 느려지던 것
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createChrome} from './chrome-mock.mjs';

// ── ① 알람 ──────────────────────────────────────────────────────────────
const mock = createChrome();
mock.alarmNames.set('flush-notes', {periodInMinutes: 1});      // 예전 버전이 남겨 둔 알람
globalThis.chrome = mock.chrome;
await import('../extension/background.js');
const send = (type, data = {}) => mock.send({type, ...data});
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const has = () => mock.alarmNames.has('flush-notes');

test('보낼 메모가 없으면 알람이 없다 — 예전 버전이 남긴 알람도 시작할 때 지운다', async () => {
  assert.equal((await send('state')).ok, true);          // 초기화가 끝나기를 기다린다
  assert.equal(has(), false, '서비스 워커를 1분마다 깨우는 알람이 남아 있다');
});
test('메모를 쓰면 알람이 생기고, 다 보내면 사라진다', async () => {
  await send('setup', {pin: '123456', name: 'T'});
  assert.equal((await send('note-save', {id: 'n1', title: '한 줄', text: '안녕'})).ok, true);
  assert.equal(has(), true, '보낼 메모가 있는 동안에는 알람이 있어야 한다');
  assert.deepEqual(mock.alarmNames.get('flush-notes'), {delayInMinutes: 0.5, periodInMinutes: 1});
  await send('note-flush');
  assert.equal(mock.data.local.pendingNotes.n1, undefined);
  assert.equal(has(), false, '다 보냈으면 알람을 끈다');
});
test('보내지 못한 메모가 남으면 알람도 남아 1분마다 다시 시도한다', async () => {
  mock.data.sync.filler = 'x'.repeat(96000);
  try {
    await send('note-save', {id: 'n2', title: '둘째', text: '용량이 모자란다'});
    await send('note-flush');
    assert.ok(mock.data.local.pendingNotes.n2, '못 보냈다');
    assert.equal(has(), true, '못 보낸 것이 있으면 알람이 남아야 한다');
  } finally { delete mock.data.sync.filler; }
  await send('note-flush');
  assert.equal(mock.data.local.pendingNotes.n2, undefined);
  assert.equal(has(), false, '결국 보내졌으면 알람이 없다');
});
test('지움 표시도 보낼 때까지 알람을 둔다', async () => {
  await send('note-save', {id: 'n3', title: '지울 글', text: '곧 지움'}); await send('note-flush');
  mock.data.sync.filler = 'x'.repeat(96000);
  try {
    assert.equal((await send('note-delete', {id: 'n3'})).ok, true);
    assert.ok(mock.data.local.pendingNotes.n3?.deleted);
    assert.equal(has(), true);
  } finally { delete mock.data.sync.filler; }
  await send('note-flush');
  assert.equal(has(), false);
});
test('알람이 울렸는데 보낼 것이 없으면 알람을 끈다', async () => {
  mock.alarmNames.set('flush-notes', {periodInMinutes: 1});
  mock.events.alarmsEvent.emit({name: 'flush-notes'}); await settle();
  assert.equal(has(), false);
});
test('시작할 때 보내지 못한 메모가 있으면 알람을 만든다(브라우저를 다시 켜면 알람이 사라질 수 있다)', async () => {
  const other = createChrome({local: {device: 'dev', pendingNotes: {w: {v: 2, id: 'w', title: 't', text: 'x', time: 1, created: 1, revision: 'r', device: 'dev'}}}});
  globalThis.chrome = other.chrome;
  await import('../extension/background.js?restart=1');
  await settle();
  assert.equal(other.alarmNames.has('flush-notes'), true);
  globalThis.chrome = mock.chrome;
});

// ── ② 사이드바의 카메라·마이크 ──────────────────────────────────────────
// 화면을 열기만 해도 Chrome 이 ‘카메라’·‘오디오’ 보조 프로세스를 띄우므로, 읽기와 듣기 모두 그 화면이 열린 동안에만 한다.
test('사이드바는 시작할 때 카메라·마이크를 읽지도 지켜보지도 않는다', () => {
  const js = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8').split('\n');
  const code = js.filter(line => !line.trim().startsWith('//'));
  // devicechange 를 듣는 자리는 한 곳(watchDevices)뿐이고, 그것은 화면이 열릴 때만 불린다
  const listens = code.filter(line => line.includes("addEventListener('devicechange'"));
  assert.equal(listens.length, 1, 'devicechange 를 듣는 곳이 watchDevices 하나여야 한다');
  assert.ok(code.some(line => line.includes('function watchDevices')));
  // 시작할 때 곧바로 부르는 enumerate 호출이 없다(예전: loadCapture().then(listRecDevices), recListMics() 최상위 호출)
  assert.ok(!code.some(line => /^\s*loadCapture\(\)\.then\(listRecDevices\)/.test(line)), '시작할 때 listRecDevices 를 부르면 안 된다');
  assert.ok(!code.some(line => /^recListMics\(\)/.test(line)), '시작할 때 recListMics 를 부르면 안 된다');
  assert.ok(code.some(line => line.includes("watchDevices(name==='capture'")), '캡처 화면이 열릴 때 읽는다');
  assert.ok(code.some(line => line.includes("$('tool-rec').addEventListener('toggle'")), '녹음기 칸을 펼칠 때 읽는다');
  assert.equal(code.filter(line => line.includes('pageShown(')).length >= 3, true, '화면이 바뀌는 두 길과 정의');
});
test('목록을 채우기 전에는 저장해도 골라 둔 카메라·마이크가 지워지지 않는다', () => {
  const source = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');
  assert.match(source, /const devices=recDevicesListed\?\{cameraId:/, '채우기 전에는 칸의 값을 믿지 않는다');
  assert.match(source, /recDevicesListed=true;\n\}/, '목록을 채운 뒤에 믿는다');
});

// ── ③ 잠금 화면의 휠·터치 ───────────────────────────────────────────────
function guardEnv({mac = false} = {}) {
  const listeners = [];   // {type, fn, passive, capture}
  const doc = {body: null, documentElement: null, activeElement: {blur() {}}, hidden: false, fullscreenElement: null,
    querySelectorAll: () => [], createElement: () => ({style: {}, children: [], append() {}, setAttribute() {}, attachShadow() { return {append() {}}; }, addEventListener() {}, focus() {}, remove() {}, isConnected: true}),
    addEventListener() {}, removeEventListener() {}};
  doc.body = doc.documentElement = {append() {}};
  const win = {
    addEventListener: (type, fn, options = {}) => listeners.push({type, fn, passive: options.passive === true, capture: options.capture === true}),
    removeEventListener: (type, fn) => { const i = listeners.findIndex(l => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); }
  };
  win.top = win;
  const sent = [];
  let push;
  const runtime = {id: 'x', sendMessage: async message => { sent.push(message); return {ok: true, data: state}; }, onMessage: {addListener: f => { push = f; }, removeListener() {}}};
  let state = {locked: true, name: 'T', revision: 1, wheelZoom: true};
  const context = vm.createContext({window: win, document: doc, chrome: {runtime}, navigator: mac ? {platform: 'MacIntel'} : {platform: 'Win32'}});
  vm.runInContext(readFileSync('extension/guard.js', 'utf8'), context);
  const blockingScroll = () => listeners.filter(l => (l.type === 'wheel' || l.type === 'touchstart') && !l.passive);
  const zooms = () => JSON.stringify(sent.filter(m => m.type === 'page-zoom'));
  return {listeners, sent, zooms, blockingScroll, lockState: s => push({type: 'lock-state', state: s}),
    fire: (type, event) => { for (const l of [...listeners.filter(x => x.type === type)]) l.fn(event); }};
}
const tick = () => new Promise(setImmediate);
const wheelEvent = (extra = {}) => ({deltaY: 100, metaKey: false, composedPath: () => [], preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra});

test('잠겨 있는 동안에만 휠·터치를 막는다 — 풀리면 막을 수 있다고 듣는 쪽이 하나도 없다', async () => {
  const env = guardEnv();
  assert.deepEqual(env.blockingScroll().map(l => l.type).sort(), ['touchstart', 'wheel'], '상태를 알기 전에는 막는 쪽이 안전하다');
  await tick();                                                   // 서비스 워커의 답: 잠김
  assert.equal(env.blockingScroll().length, 2);
  const locked = wheelEvent(); env.fire('wheel', locked);
  assert.equal(locked.prevented, true, '잠긴 동안 휠은 막힌다(뒤의 페이지가 스크롤되지 않는다)');
  env.lockState({locked: false, name: 'T', revision: 2, wheelZoom: true});
  assert.equal(env.blockingScroll().length, 0, '풀리면 스크롤을 막을 수 있는 듣는 쪽이 없어야 한다');
  env.lockState({locked: true, name: 'T', revision: 3, wheelZoom: true});
  assert.equal(env.blockingScroll().length, 2, '다시 잠그면 다시 막는다');
  const again = wheelEvent(); env.fire('wheel', again);
  assert.equal(again.prevented, true);
  env.lockState({locked: false, name: 'T', revision: 4, wheelZoom: true});
  assert.equal(env.blockingScroll().length, 0);
});
test('막는 일이 필요 없는 입력(클릭·키 등)은 그대로 듣는다 — 스크롤과 상관없다', async () => {
  const env = guardEnv(); await tick();
  env.lockState({locked: false, name: 'T', revision: 2, wheelZoom: true});
  for (const type of ['click', 'keydown', 'mousedown', 'paste', 'submit']) assert.ok(env.listeners.some(l => l.type === type), type + ' 는 늘 듣는다');
  const click = wheelEvent(); env.fire('click', click);
  assert.equal(click.prevented, undefined, '풀려 있으면 아무것도 막지 않는다');
});
test('맥: Command 를 누르는 동안에만 휠을 가로챈다', async () => {
  const env = guardEnv({mac: true}); await tick();
  env.lockState({locked: false, name: 'T', revision: 2, wheelZoom: true});
  assert.equal(env.blockingScroll().length, 0, '풀려 있고 Command 를 안 눌렀으면 막을 수 있는 휠 듣는 쪽이 없다');
  assert.ok(env.listeners.some(l => l.type === 'wheel' && l.passive), '못 받은 프레임을 위한 것은 막지 않는(passive) 듣는 쪽이다');
  env.fire('keydown', {key: 'Meta', metaKey: true});
  assert.equal(env.blockingScroll().filter(l => l.type === 'wheel').length, 1, 'Command 를 누르면 휠을 막을 준비를 한다');
  const zoom = wheelEvent({metaKey: true, deltaY: -100}); env.fire('wheel', zoom);
  assert.equal(zoom.prevented, true, 'Command+휠은 페이지를 움직이지 않고');
  assert.equal(env.zooms(), JSON.stringify([{type: 'page-zoom', step: 1}]), '배율을 바꾼다');
  env.fire('keyup', {key: 'Meta', metaKey: false});
  assert.equal(env.blockingScroll().length, 0, 'Command 를 떼면 다시 막지 않는다');
  const plain = wheelEvent(); env.fire('wheel', plain);
  assert.equal(plain.prevented, undefined, '평소 스크롤은 건드리지 않는다');
});
test('맥: Command 키 입력을 못 받은 프레임도 첫 눈금에서 알아채 배율을 바꾸고 다음부터 막는다', async () => {
  const env = guardEnv({mac: true}); await tick();
  env.lockState({locked: false, name: 'T', revision: 2, wheelZoom: true});
  const first = wheelEvent({metaKey: true, deltaY: 100}); env.fire('wheel', first);
  assert.equal(first.prevented, undefined, '첫 눈금은 막지 못한다(passive)');
  assert.equal(env.zooms(), JSON.stringify([{type: 'page-zoom', step: -1}]), '그래도 배율은 바뀐다');
  assert.equal(env.blockingScroll().filter(l => l.type === 'wheel').length, 1, '다음 눈금부터 막는다');
});
test('맥: Command 를 뗀 것을 놓쳐도 다음 휠에서 스스로 물러난다 · 창을 떠나면 물러난다 · 설정을 끄면 안 한다', async () => {
  const env = guardEnv({mac: true}); await tick();
  env.lockState({locked: false, name: 'T', revision: 2, wheelZoom: true});
  env.fire('keydown', {key: 'Meta', metaKey: true});
  const stale = wheelEvent({metaKey: false}); env.fire('wheel', stale);
  assert.equal(stale.prevented, undefined);
  assert.equal(env.blockingScroll().length, 0, '키를 뗐는데 눌려 있는 줄 알면 안 된다');
  env.fire('keydown', {key: 'Meta', metaKey: true}); assert.equal(env.blockingScroll().length, 1);
  env.fire('blur', {}); assert.equal(env.blockingScroll().length, 0, '창을 떠나면 키를 뗐는지 알 수 없으니 물러난다');
  env.lockState({locked: false, name: 'T', revision: 3, wheelZoom: false});
  env.fire('keydown', {key: 'Meta', metaKey: true});
  assert.equal(env.blockingScroll().length, 0, '설정에서 껐으면 가로채지 않는다');
  env.lockState({locked: false, name: 'T', revision: 4, wheelZoom: true});
  env.fire('keydown', {key: 'Meta', metaKey: true}); assert.equal(env.blockingScroll().length, 1);
  env.lockState({locked: true, name: 'T', revision: 5, wheelZoom: true});
  assert.equal(env.blockingScroll().filter(l => l.type === 'wheel').length, 1, '잠기면 Command 와 상관없이 휠 하나만(잠금용) 막는다');
});
test('윈도우: 휠 확대 듣는 쪽이 아예 없다(Ctrl+휠은 Chrome 이 한다)', async () => {
  const env = guardEnv({mac: false}); await tick();
  env.lockState({locked: false, name: 'T', revision: 2, wheelZoom: true});
  assert.equal(env.listeners.filter(l => l.type === 'wheel').length, 0, '풀리면 휠 듣는 쪽이 하나도 없다');
});
