import test from 'node:test';
import assert from 'node:assert/strict';
import {createChrome} from './chrome-mock.mjs';
import {seal, unseal} from '../extension/lib/crypto.js';
import {collectBackup, mergedNotes, BACKUP_FORMAT} from '../extension/lib/backup.js';
import {noteList, noteKey, mergeBookmarks} from '../extension/lib/data.js';

const mock = createChrome();
globalThis.chrome = mock.chrome;
await import('../extension/background.js');
const send = (type, data = {}, sender) => mock.send({type, ...data}, sender);
const ALL = {notes: true, bookmarks: true, settings: true, tools: true, lock: true};
const note = (device, id, extra = {}) => ({[noteKey(device, id)]: {v: 2, id, title: '제목 ' + id, text: '본문 ' + id, time: 2000, created: 1000, pinned: false, revision: 'r', device, ...extra}});
const marks = (device, items) => ({['marks_' + device]: {v: 1, kind: 'bookmarks', items}});
const link = (id, title, url = 'https://example.com/' + id, folder = '') => ({id, title, url, folder});

// 원래 컴퓨터에서 만든 백업(잠금 PIN 123456, 암호 파일에 담는다고 가정)
const sourceProof = await seal('123456', {kind: 'profile'});
const source = {
  sync: {...note('src', 'n1'), ...note('src', 'n2', {created: 1500, text: '둘째 메모'}),
    ...marks('src', [{id: 'f1', rev: 1, writer: 'src', type: 'folder', title: '수업'}, {id: 'l1', rev: 2, writer: 'src', title: '위키', url: 'https://ko.wikipedia.org/', folder: 'f1'}]),
    hotkeys: {mac: {focus: 'ctrl+shift+F'}, win: {}}, vault_old: {v: 1, s: 'c2FsdA==', i: 'aXY=', c: 'Y2lwaGVy'}},
  local: {device: 'src', profile: {name: '로디 쌤', idleMinutes: 15, proof: sourceProof}, startLocked: false, lockOnAway: false, wheelZoom: false,
    uiFont: 'malgun', uiSize: 16, uiTrack: 3, presentKnobs: {dim: 60, blur: 9, ringSize: 50, ring: '#112233'},
    captureOptions: {after: 'save', format: 'jpg', quality: 70, delay: 7},
    recordOptions: {mode: 'tab', camera: true, cameraId: 'SRC-CAM', micId: 'SRC-MIC', res: '720', format: 'webm', countdown: 10, limit: 30},
    bellTimes: ['08:50', '09:40'], bellOn: true, toneBell: 'bell', volumeBell: 40, toneAlarm: 'soft', volumeAlarm: 30, teams: [{name: '1모둠', score: 4}],
    noteImages: {n1: [{id: 's1', file: '/Desktop/캡처.png', name: '캡처.png', thumb: 'iVBORw0KGgo=', width: 800, height: 600, time: 100}]}}
};
const payload = collectBackup({sync: source.sync, local: source.local, version: '0.39.0', os: 'mac', includeLock: true});
const withoutLock = collectBackup({sync: source.sync, local: source.local, includeLock: false});
const store = () => mock.data;
// 사이드바가 목록을 만드는 것과 같은 기준(동기화된 것 + 동기화 대기 + 동기화되지 못한 초안). 목록은 만든 지 가장 새 것이 앞이다.
const liveNotes = () => noteList(mergedNotes(store().sync, store().local));
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

test('아직 프로필이 없는 새 컴퓨터: 잠금 PIN 이 든 백업으로 시작하면 모든 것이 돌아오고 같은 PIN 으로 잠금이 풀린다', async () => {
  assert.equal((await send('state')).data.configured, false);
  const myDevice = store().local.device;
  store().local.dockSpot = {left: 11, top: 22};
  store().local.clipboardImport = false;
  const r = await send('backup-restore', {payload, parts: ALL});
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.data.problems, []);
  assert.equal(r.data.state.configured, true);
  assert.equal(r.data.state.locked, false, '백업으로 시작하면 바로 쓸 수 있다');
  assert.equal(r.data.state.name, '로디 쌤');
  assert.equal(r.data.state.idleMinutes, 15);
  assert.equal(r.data.state.startLocked, false);
  // 메모·그림·북마크
  assert.deepEqual(liveNotes().map(n => n.id).sort(), ['n1', 'n2']);
  assert.equal(store().local.noteImages.n1[0].id, 's1');
  assert.equal(r.data.done.notes.added, 2);
  assert.equal(r.data.done.bookmarks.added, 2);
  const key = 'marks_' + myDevice;
  assert.deepEqual(mergeBookmarks([store().sync[key]]).filter(i => !i.deleted).map(i => i.id).sort(), ['f1', 'l1']);
  assert.ok(store().sync.vault_old, '예전 보관함도 함께 옮긴다');
  // 설정·도구
  assert.equal(store().local.uiFont, 'malgun');
  assert.deepEqual(store().local.presentKnobs, {dim: 60, blur: 9, ringSize: 50, ring: '#112233'});
  assert.equal(store().local.captureOptions.format, 'jpg');
  assert.equal(store().local.recordOptions.res, '720');
  assert.equal(store().local.recordOptions.cameraId, undefined, '다른 컴퓨터의 카메라 번호는 들어오지 않는다');
  assert.equal(store().sync.hotkeys.mac.focus, 'ctrl+shift+F');
  assert.deepEqual(store().local.bellTimes, ['08:50', '09:40']);
  assert.equal(store().local.teams[0].name, '1모둠');
  assert.ok(mock.alarmNames.has('bell-0') && mock.alarmNames.has('bell-1'), '종 알람이 다시 예약된다');
  // 이 컴퓨터에만 뜻이 있는 값은 그대로
  assert.equal(store().local.device, myDevice);
  assert.deepEqual(store().local.dockSpot, {left: 11, top: 22});
  assert.equal(store().local.clipboardImport, false);
  // 원래 PIN 으로 잠금이 풀린다
  await send('lock');
  assert.equal((await send('unlock', {pin: '000000'})).ok, false);
  const open = await send('unlock', {pin: '123456'});
  assert.equal(open.ok, true);
  assert.equal(open.data.locked, false);
});

test('같은 백업을 다시 풀어도 아무것도 늘지 않는다', async () => {
  const before = JSON.stringify([liveNotes().map(n => n.id), store().sync['marks_' + store().local.device], store().local.noteImages]);
  const r = await send('backup-restore', {payload, parts: {notes: true, bookmarks: true}});
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.data.done.notes.added, r.data.done.notes.same, r.data.done.bookmarks.added, r.data.done.bookmarks.same], [0, 2, 0, 2]);
  assert.equal(JSON.stringify([liveNotes().map(n => n.id), store().sync['marks_' + store().local.device], store().local.noteImages]), before);
});

test('이 컴퓨터에서 고친 메모는 덮이지 않고, 백업의 내용은 (백업) 사본으로 남는다', async () => {
  assert.equal((await send('note-save', {id: 'n1', title: '제목 n1', text: '여기서 고친 내용'})).ok, true);
  await send('note-flush');
  const r = await send('backup-restore', {payload, parts: {notes: true}});
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.done.notes.copies, 1);
  const titles = liveNotes().map(n => n.current.title);
  assert.ok(titles.includes('제목 n1 (백업)'));
  assert.equal(liveNotes().find(n => n.id === 'n1').current.text, '여기서 고친 내용', '지금 내용은 그대로');
  assert.equal(liveNotes().find(n => n.id === 'b-n1').current.text, '본문 n1');
  // 또 풀어도 사본이 늘지 않는다
  assert.equal((await send('backup-restore', {payload, parts: {notes: true}})).data.done.notes.copies, 0);
  assert.equal(liveNotes().length, 3);
});

test('이미 PIN 이 있는 컴퓨터에서 잠금 PIN 을 바꾸려면 지금 PIN 이 필요하다 — 틀리면 아무것도 바꾸지 않는다', async () => {
  // 이 컴퓨터의 PIN 을 따로 정해 둔다
  const mine = await seal('777777', {kind: 'profile'});
  const original = store().local.profile.proof;
  store().local.profile = {...store().local.profile, proof: mine, name: '이 컴퓨터'};
  const notesBefore = liveNotes().length;
  const extra = collectBackup({sync: {...source.sync, ...note('src', 'brandnew', {text: '새 메모'})}, local: source.local, includeLock: true});
  let r = await send('backup-restore', {payload: extra, parts: ALL});
  assert.equal(r.ok, false, '지금 PIN 없이 PIN 교체를 시도했다');
  r = await send('backup-restore', {payload: extra, parts: ALL, pin: '123456'});     // 백업의 PIN 이 아니라 '지금' PIN 이 필요
  assert.equal(r.ok, false);
  assert.match(r.error, /PIN이 맞지 않습니다/);
  assert.deepEqual(store().local.profile.proof, mine, 'PIN 이 바뀌지 않았다');
  assert.equal(liveNotes().length, notesBefore, '틀렸을 때는 메모도 들어오지 않았다');
  // 틀린 횟수는 잠금 해제와 함께 센다 — 다섯 번이면 쉬어야 한다
  for (let i = 0; i < 4; i++) await send('backup-restore', {payload: extra, parts: ALL, pin: '000000'});
  r = await send('backup-restore', {payload: extra, parts: ALL, pin: '777777'});
  assert.equal(r.ok, false);
  assert.match(r.error, /잠시 후/);
  store().local.attempts = {count: 0, until: 0};
  // 맞는 PIN 이면 바뀐다
  r = await send('backup-restore', {payload: extra, parts: ALL, pin: '777777'});
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(store().local.profile.proof, original);
  assert.equal(store().local.profile.name, '로디 쌤');
  assert.equal(liveNotes().length, notesBefore + 1);
  assert.equal((await unseal('123456', store().local.profile.proof)).kind, 'profile');
});

test('잠금 PIN 을 고르지 않으면 이 컴퓨터의 PIN 은 그대로이고 지금 PIN 도 묻지 않는다', async () => {
  const proof = store().local.profile.proof;
  const r = await send('backup-restore', {payload, parts: {...ALL, lock: false}});
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(store().local.profile.proof, proof);
  assert.equal(r.data.done.lock, undefined);
});

test('암호 없는 백업(잠금 PIN 없음)은 이미 프로필이 있는 컴퓨터에서만 쓸 수 있다', async () => {
  const r = await send('backup-restore', {payload: withoutLock, parts: ALL});
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.done.lock, undefined);
});

test('잠긴 상태와 웹 페이지에서는 복원할 수 없다', async () => {
  await send('lock');
  let r = await send('backup-restore', {payload, parts: ALL});
  assert.equal(r.ok, false);
  assert.match(r.error, /잠금을 해제/);
  await send('unlock', {pin: '123456'});
  r = await send('backup-restore', {payload, parts: ALL}, {url: 'https://evil.example', tab: {id: 1, windowId: 1}});
  assert.equal(r.ok, false);
  assert.match(r.error, /확장 패널에서만/);
});

test('조작된 파일이 들어와도 저장소에는 검사를 통과한 값만 들어간다', async () => {
  const hostile = {kind: BACKUP_FORMAT, v: 1,
    notes: [{id: '../evil', title: 'x', text: 'x'}, {id: 'okk', title: '<img src=x onerror=alert(1)>', text: '정상 본문'}],
    images: {okk: [{id: 'i', thumb: '<script>', file: 'f'}]},
    bookmarks: [{id: 'js', title: 'js', url: 'javascript:alert(1)'}, {id: 'okm', title: '정상', url: 'https://example.com/ok'}],
    settings: {uiFont: '../../x', uiSize: 9999, __proto__: {polluted: true}, evilKey: 1, recordOptions: {res: '1', format: 'exe'}},
    tools: {bellTimes: ['99:99', '08:00'], toneBell: 'x'},
    lock: {proof: {v: 1, s: 'AA==', i: 'AA==', c: 'x'.repeat(20000)}}};
  const proofBefore = store().local.profile.proof;
  const r = await send('backup-restore', {payload: hostile, parts: ALL, pin: '123456'});
  assert.equal(r.ok, true, r.error);
  assert.ok(liveNotes().some(n => n.id === 'okk'));
  assert.ok(!liveNotes().some(n => n.id === '../evil'));
  assert.ok(!JSON.stringify(store().sync).includes('javascript:'));
  assert.equal(store().local.uiFont, 'malgun', '이상한 글꼴 이름은 버려서 이전 값이 남는다');
  assert.equal(store().local.uiSize, 19);
  assert.equal(store().local.evilKey, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(store().local.recordOptions.format, 'webm');
  assert.deepEqual(store().local.bellTimes, ['08:00']);
  assert.deepEqual(store().local.profile.proof, proofBefore, '쓸 수 없는 검증값으로 PIN 을 바꾸지 않는다');
  assert.equal(r.data.skipped >= 3, true);
  assert.equal((await send('backup-restore', {payload: {kind: 'nope'}, parts: ALL})).ok, false);
  assert.equal((await send('backup-restore', {payload: 'text', parts: ALL})).ok, false);
});

test('긴 메모는 이 컴퓨터에만 남고, 동기화 공간이 모자라면 기다렸다가 올라간다', async () => {
  const big = {kind: BACKUP_FORMAT, v: 1, notes: [{id: 'bigone', title: '긴 글', text: '한'.repeat(3000), created: 1, time: 1}, {id: 'smallone', title: '짧은 글', text: '짧다', created: 2, time: 2}]};
  store().sync.filler = 'x'.repeat(96000);
  try {
    const r = await send('backup-restore', {payload: big, parts: {notes: true}});
    assert.equal(r.ok, true, r.error);
    assert.equal(r.data.done.notes.localOnly, 1, '5,500바이트를 넘는 글');
    assert.ok(r.data.done.notes.waiting >= 1, '공간이 없어 기다리는 글이 있다');
    assert.ok(liveNotes().some(n => n.id === 'bigone') && liveNotes().some(n => n.id === 'smallone'), '그래도 목록에는 모두 보인다');
    assert.ok(store().local.draftNotes.bigone && !store().local.pendingNotes?.bigone);
  } finally { delete store().sync.filler; }
  await send('note-flush');
  assert.equal(store().sync[noteKey(store().local.device, 'smallone')].text, '짧다');
});

test('북마크가 한 칸에 다 안 들어가면 들어가는 만큼만 넣고 얼마나 남았는지 알려 준다', async () => {
  const items = Array.from({length: 200}, (_, i) => ({id: 'bulk' + i, title: '대량 북마크 ' + i, url: 'https://example.com/bulk/' + i + '?q=' + 'x'.repeat(30)}));
  const lots = {kind: BACKUP_FORMAT, v: 1, bookmarks: items};
  const r = await send('backup-restore', {payload: lots, parts: {bookmarks: true}});
  assert.equal(r.ok, true, r.error);
  const info = r.data.done.bookmarks;
  assert.ok(info.added > 10 && info.left > 0 && info.added + info.left === 200, JSON.stringify(info));
  assert.ok(JSON.stringify(store().sync['marks_' + store().local.device]).length < 7900);
});

test('아무것도 고르지 않으면 아무것도 바꾸지 않는다', async () => {
  const snapshot = JSON.stringify(store());
  const r = await send('backup-restore', {payload, parts: {}});
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.data.done, {});
  assert.equal(JSON.stringify(store()), snapshot);
});
