import test from 'node:test';
import assert from 'node:assert/strict';
import {sealBackup, plainBackup, openBackup, cleanBackup, collectBackup, collectNotes, describeBackup, planNotes, planMarks, mergeImages, mergedNotes,
  copyId, copyTitle, BACKUP_FORMAT, IMAGES_PER_NOTE, IMAGES_TOTAL} from '../extension/lib/backup.js';
import {noteGroups, noteKey, mergeBookmarks, editBookmarks} from '../extension/lib/data.js';
import {seal, unseal} from '../extension/lib/crypto.js';

const FAST = 1000;   // 시험에서는 PBKDF2 반복을 줄인다. 기본값(60만 회)은 한 번만 따로 시험한다.
const note = (device, id, extra = {}) => ({[noteKey(device, id)]: {v: 2, id, title: '제목 ' + id, text: '본문 ' + id, time: 2000, created: 1000, pinned: false, revision: 'r', device, ...extra}});
const link = (id, title, url = 'https://example.com/' + id, folder = '') => ({id, title, url, folder});
const folder = (id, title) => ({id, type: 'folder', title});
const snapshot = (device, items) => ({['marks_' + device]: {v: 1, kind: 'bookmarks', items}});

async function sampleStorage() {
  const proof = await seal('123456', {kind: 'profile'});
  const sync = {
    ...note('devA', 'n1'), ...note('devB', 'n1', {text: '다른 기기에서 고친 본문', time: 3000}),
    ...note('devA', 'n2', {created: 1500}), ...note('devA', 'gone', {deleted: true, text: '', title: '', time: 9000}),
    ...snapshot('devA', [
      {id: 'f1', rev: 1, writer: 'devA', type: 'folder', title: '수업'},
      {id: 'l1', rev: 2, writer: 'devA', title: '위키', url: 'https://ko.wikipedia.org/', folder: 'f1'},
      {id: 'l2', rev: 3, writer: 'devA', title: '지운 링크', url: 'https://example.com/x', folder: '', deleted: true}]),
    hotkeys: {mac: {present: 'ctrl+alt+P', focus: 'ctrl+shift+F'}, win: {}},
    vault_old: {v: 1, s: 'c2FsdA==', i: 'aXY=', c: 'Y2lwaGVy'}
  };
  const local = {
    device: 'devA', profile: {name: '로디 쌤', idleMinutes: 5, proof}, startLocked: true, lockOnAway: false, wheelZoom: true,
    uiFont: 'malgun', uiSize: 15, uiTrack: 2, presentKnobs: {dim: 50, blur: 12, ringSize: 40, ring: '#aabbcc'},
    captureOptions: {after: 'both', format: 'jpg', quality: 80, delay: 5, hideFixed: false, hideScrollbar: true, hideSide: true},
    recordOptions: {mode: 'tab', camera: true, cameraId: 'CAM-ABC', cameraName: '내 카메라', mic: true, micId: 'MIC-XYZ', controlBar: true, res: '720', format: 'webm', countdown: 5, limit: 10, sound: true},
    bellTimes: ['08:50', '09:40'], bellOn: true, toneBell: 'school', volumeBell: 70, toneAlarm: 'chime', volumeAlarm: 60,
    teams: [{name: '1모둠', score: 3}, {name: '2모둠', score: -1}],
    // 동기화를 기다리는 더 새로운 글, 동기화되지 못한 긴 초안
    pendingNotes: {n2: {v: 2, id: 'n2', title: '제목 n2', text: '쓰는 중인 최신 본문', time: 5000, created: 1500, pinned: true, revision: 'r2', device: 'devA'}},
    draftNotes: {long: {v: 2, id: 'long', title: '긴 글', text: '한'.repeat(3000), time: 4000, created: 1200, pinned: false, revision: 'r3', device: 'devA'}},
    noteImages: {n1: [{id: 's1', file: '/바탕화면/캡처.png', name: '캡처.png', thumb: 'iVBORw0KGgo=', width: 800, height: 600, time: 100}], gone: [{id: 'x', file: 'f', name: 'n', thumb: 'AAAA', width: 1, height: 1, time: 1}]},
    // 담으면 안 되는 것들
    dockSpot: {left: 7351, top: 40}, attempts: {count: 3, until: 1}, keptAuthorized: true, clipboardImport: true, clipError: 'x', watch: {from: 1}, timerEndsAt: 9, lastCapture: {text: 't'}
  };
  return {sync, local, proof};
}

test('암호를 건 백업은 풀었을 때 그대로 돌아온다', async () => {
  const {sync, local} = await sampleStorage();
  const payload = collectBackup({sync, local, version: '0.39.0', os: 'mac', includeLock: true, now: Date.UTC(2026, 9, 1)});
  const file = await sealBackup(payload, '우리반 비밀 2026');            // 기본 반복 횟수(60만 회) 한 번
  const opened = await openBackup(file, '우리반 비밀 2026');
  assert.equal(opened.encrypted, true);
  assert.deepEqual(opened.payload, payload);
  assert.equal(JSON.parse(file).iterations, 600000);
  assert.ok(!file.includes('로디'), '암호 파일에 평문 이름이 보이면 안 된다');
  assert.ok(!file.includes('본문'));
});
test('암호가 없거나 틀리거나 파일이 바뀌면 열리지 않는다', async () => {
  const {sync, local} = await sampleStorage();
  const file = await sealBackup(collectBackup({sync, local, includeLock: true}), '맞는암호12345', FAST);
  await assert.rejects(openBackup(file), error => error.code === 'NEEDS_PASSPHRASE');
  await assert.rejects(openBackup(file, '틀린암호12345'), /암호가 맞지 않거나/);
  const parts = JSON.parse(file);
  // 암호문 한 글자만 바꿔도 거부(GCM 인증)
  const flipped = {...parts, data: parts.data.slice(0, 10) + (parts.data[10] === 'A' ? 'B' : 'A') + parts.data.slice(11)};
  await assert.rejects(openBackup(JSON.stringify(flipped), '맞는암호12345'), /암호가 맞지 않거나/);
  // 반복 횟수를 바꾸면 다른 열쇠가 나와 열리지 않는다
  await assert.rejects(openBackup(JSON.stringify({...parts, iterations: 2000}), '맞는암호12345'), /암호가 맞지 않거나/);
});
test('반복 횟수를 터무니없이 키운 파일로 컴퓨터를 붙들 수 없다', async () => {
  const {sync, local} = await sampleStorage();
  const parts = JSON.parse(await sealBackup(collectBackup({sync, local}), '맞는암호12345', FAST));
  for (const iterations of [1e9, 999, -5, 1.5, '600000', null])
    await assert.rejects(openBackup(JSON.stringify({...parts, iterations}), '맞는암호12345'), /손상/);
});
test('암호는 8자 이상이고, 맥과 윈도우의 한글 조합 방식 차이로 달라지지 않는다', async () => {
  const {sync, local} = await sampleStorage();
  const payload = collectBackup({sync, local});
  await assert.rejects(sealBackup(payload, '짧은암호', FAST), /8자 이상/);
  const composed = '가나다라마바사아'.normalize('NFC'), decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);
  const file = await sealBackup(payload, composed, FAST);
  assert.equal((await openBackup(file, decomposed)).payload.notes.length, payload.notes.length);
});
test('암호 없는 백업에는 잠금 PIN 이 절대 들어가지 않는다', async () => {
  const {sync, local, proof} = await sampleStorage();
  const without = collectBackup({sync, local, includeLock: false});
  assert.equal(without.lock, null);
  const text = plainBackup(without);
  assert.ok(!text.includes(proof.c), 'PIN 검증값이 파일에 새어 나갔다');
  assert.equal((await openBackup(text)).encrypted, false);
  // 담은 채 암호 없이 저장하려는 실수도 막는다
  assert.throws(() => plainBackup(collectBackup({sync, local, includeLock: true})), /암호를 걸어야/);
  // 암호 파일에는 담긴다
  const locked = collectBackup({sync, local, includeLock: true});
  assert.deepEqual(locked.lock.proof, proof);
  // 담긴 검증값은 옮긴 곳에서도 원래 PIN 으로 열린다
  const opened = await openBackup(await sealBackup(locked, '백업암호1234', FAST), '백업암호1234');
  assert.equal((await unseal('123456', opened.payload.lock.proof)).kind, 'profile');
});
test('아주 큰 백업도 조각내어 안전하게 암호화한다', async () => {
  const payload = {...cleanBackup({kind: BACKUP_FORMAT}), notes: Array.from({length: 40}, (_, i) => ({id: 'big' + i, title: 't', text: '가'.repeat(100000), time: 1, created: 1, pinned: false}))};
  const file = await sealBackup(payload, '아주큰백업1234', FAST);
  assert.ok(file.length > 5_000_000);
  assert.equal((await openBackup(file, '아주큰백업1234')).payload.notes.length, 40);
});

test('담을 것과 담지 않을 것', async () => {
  const {sync, local} = await sampleStorage();
  const payload = collectBackup({sync, local, version: '0.39.0', os: 'win', includeLock: false});
  assert.deepEqual(payload.notes.map(n => n.id), ['n1', 'long', 'n2']);               // 지운 메모는 빠지고 만든 순서(created)대로
  const n1 = payload.notes.find(n => n.id === 'n1'), n2 = payload.notes.find(n => n.id === 'n2');
  assert.equal(n1.text, '다른 기기에서 고친 본문', '여러 기기 사본 중 가장 새 것');
  assert.equal(n2.text, '쓰는 중인 최신 본문', '동기화 대기 중인 글이 이 기기의 최신본');
  assert.equal(n2.pinned, true);
  assert.ok(payload.notes.some(n => n.id === 'long' && n.text.length === 3000), '동기화되지 못한 긴 초안도 담는다');
  assert.deepEqual(Object.keys(payload.images), ['n1'], '지운 메모의 그림은 담지 않는다');
  assert.deepEqual(payload.bookmarks.map(b => b.id), ['f1', 'l1']);                     // 지운 링크는 빠짐
  assert.equal(payload.bookmarks[1].folder, 'f1');
  assert.deepEqual(Object.keys(payload.vault), ['vault_old']);
  assert.equal(payload.hotkeys.mac.focus, 'ctrl+shift+F');
  assert.equal(payload.hotkeys.win.present, 'ctrl+alt+P', '빈 칸은 기본 조합으로 채운다');
  assert.equal(payload.settings.name, '로디 쌤');
  assert.equal(payload.settings.uiFont, 'malgun');
  assert.deepEqual(payload.settings.recordOptions, {mode: 'tab', camera: true, mic: true, controlBar: true, res: '720', format: 'webm', countdown: 5, limit: 10, sound: true});
  assert.deepEqual(payload.tools.bellTimes, ['08:50', '09:40']);
  assert.deepEqual(payload.tools.teams, [{name: '1모둠', score: 3}, {name: '2모둠', score: -1}]);
  assert.equal(payload.made.os, 'win');
  const json = JSON.stringify(payload);
  for (const secret of ['CAM-ABC', 'MIC-XYZ', '내 카메라', 'dockSpot', '7351', 'keptAuthorized', 'attempts', 'clipboardImport', 'timerEndsAt', 'lastCapture', 'devA', 'devB'])
    assert.ok(!json.includes(secret), `백업에 들어가면 안 되는 값: ${secret}`);
  const summary = describeBackup(payload);
  assert.deepEqual([summary.notes, summary.images, summary.links, summary.folders, summary.vault, summary.lock], [3, 1, 1, 1, 1, false]);
});
test('빈 저장소도 백업할 수 있다', () => {
  const payload = collectBackup({sync: {}, local: {}});
  assert.deepEqual([payload.notes, payload.bookmarks, payload.settings, payload.tools, payload.lock, payload.hotkeys], [[], [], null, null, null, null]);
  assert.equal(cleanBackup(payload).kind, BACKUP_FORMAT);
});

test('남이 만든 파일을 믿지 않는다 — 모양이 틀린 값은 걸러 낸다', () => {
  const hostile = {
    kind: BACKUP_FORMAT, v: 1,
    made: {at: '아무말', version: 'x'.repeat(100), os: '<script>', profile: 'p'.repeat(100)},
    notes: [{id: '../evil', title: 't', text: 'x'}, {id: 'ok1', title: '  공백   많은   제목  ', text: '본문', time: '1', created: 1e20}, {id: 'ok1', title: 'dup', text: 'x'},
      {id: 'big', title: 't', text: 'x'.repeat(200001)}, {id: 'num', title: 't', text: 5}, 'string', null, {id: 'proto', title: 't', text: 'ok'}],
    images: {__proto__: [{id: 'a', thumb: 'AAAA'}], ok1: [{id: 'i1', thumb: 'AAAA', name: 'n', file: 'f', width: 99999999, height: -4, time: 1}, {id: 'i2', thumb: '<img onerror=x>'}, {thumb: 'x'.repeat(250001)}], ghost: [{id: 'z', thumb: 'AAAA'}], '../x': []},
    bookmarks: [folder('fo', ''), link('a', '정상'), link('b', 'js', 'javascript:alert(1)'), link('c', '비번', 'https://user:pw@example.com/'), link('d', '없는폴더', 'https://example.com/d', 'nofolder'),
      link('e', '폴더 안', 'https://example.com/e', 'fo'), {id: 'a', title: '중복', url: 'https://example.com/'}, {id: 'bad id!', title: 't', url: 'https://example.com/'}, 7],
    vault: {vault_ok: {v: 1, s: 'AA==', i: 'AA==', c: 'AAAA'}, vault_bad: {v: 1, s: 'AA==', i: 'AA==', c: '!!!'}, evil: {v: 1, s: 'AA==', i: 'AA==', c: 'AAAA'}, '__proto__': {v: 1, s: 'AA', i: 'AA', c: 'AAAA'}},
    hotkeys: {mac: {present: 'rm -rf', focus: 'ctrl+alt+J', evil: 'x'}, win: 5},
    settings: {name: '  이름  ', idleMinutes: 7, startLocked: 'yes', lockOnAway: false, uiFont: 'Evil<Font>', uiSize: 99, uiTrack: -50, deviceX: 'z',
      presentKnobs: {dim: 500, blur: 'a', ring: 'red', ringSize: 40.4, extra: 1},
      captureOptions: {after: 'rm', format: 'jpg', quality: 1, delay: 1000},
      recordOptions: {mode: 'camera', cameraId: 'NOPE', micId: 'NOPE', res: 1080, format: 'webm', countdown: 3}},
    tools: {bellTimes: ['09:00', '25:00', 'x', '10:5'], bellOn: 1, toneBell: 'rock', toneAlarm: 'soft', volumeBell: 500, teams: Array.from({length: 30}, (_, i) => ({name: 'n'.repeat(50), score: 1e9 * (i % 2 ? 1 : -1)}))},
    lock: {proof: {v: 1, s: 'AA==', i: 'AA==', c: 'x'.repeat(14001)}}
  };
  const clean = cleanBackup(hostile);
  assert.equal(Object.getPrototypeOf(clean.images), Object.prototype, '__proto__ 키가 바탕 객체를 바꾸면 안 된다');
  assert.equal(clean.made.at, ''); assert.equal(clean.made.version.length, 20); assert.equal(clean.made.os, 'other');
  assert.deepEqual(clean.notes.map(n => n.id), ['ok1', 'proto']);
  assert.equal(clean.notes[0].title, '공백 많은 제목');
  assert.equal(clean.notes[0].time, 0); assert.equal(clean.notes[0].created, 0);
  assert.deepEqual(Object.keys(clean.images), ['ok1']);
  assert.deepEqual(clean.images.ok1.map(i => i.id), ['i1']);
  assert.equal(clean.images.ok1[0].width, 20000); assert.equal(clean.images.ok1[0].height, 0);
  assert.deepEqual(clean.bookmarks.map(b => b.id), ['fo', 'a', 'd', 'e']);
  assert.equal(clean.bookmarks[0].title, '폴더');
  assert.equal(clean.bookmarks.find(b => b.id === 'd').folder, '', '없는 폴더를 가리키던 북마크는 맨 위로');
  assert.equal(clean.bookmarks.find(b => b.id === 'e').folder, 'fo');
  assert.deepEqual(Object.keys(clean.vault), ['vault_ok']);
  assert.equal(clean.hotkeys.mac.present, 'ctrl+alt+P'); assert.equal(clean.hotkeys.mac.focus, 'ctrl+alt+J');
  assert.equal(clean.hotkeys.mac.evil, undefined); assert.equal(clean.hotkeys.win.present, 'ctrl+alt+P');
  assert.deepEqual(clean.settings, {name: '이름', lockOnAway: false, uiSize: 19, uiTrack: -4,
    presentKnobs: {dim: 90, ringSize: 40}, captureOptions: {format: 'jpg', quality: 50, delay: 60}, recordOptions: {mode: 'camera', format: 'webm', countdown: 3}});
  assert.deepEqual(clean.tools.bellTimes, ['09:00']); assert.equal(clean.tools.bellOn, undefined);
  assert.equal(clean.tools.toneBell, undefined); assert.equal(clean.tools.toneAlarm, 'soft'); assert.equal(clean.tools.volumeBell, 100);
  assert.equal(clean.tools.teams.length, 12); assert.equal(clean.tools.teams[0].name.length, 20);
  assert.deepEqual(clean.tools.teams.map(t => t.score).slice(0, 2), [-999, 9999]);
  assert.equal(clean.lock, null, '너무 큰 검증값은 버린다');
  assert.ok(clean.skipped >= 8);
});
test('백업이 아닌 파일은 이유를 알려 주며 거부한다', async () => {
  for (const text of ['', 'not json', '[]', '{}', '{"format":"other"}', JSON.stringify({format: BACKUP_FORMAT, v: 1, encrypted: false, payload: {kind: 'x'}})])
    await assert.rejects(openBackup(text), /백업 파일/);
  await assert.rejects(openBackup(JSON.stringify({format: BACKUP_FORMAT, v: 2, encrypted: false})), /더 새로운/);
  await assert.rejects(openBackup(JSON.stringify({format: BACKUP_FORMAT, v: 0})), /지원하지 않는/);
  await assert.rejects(openBackup('x'.repeat(41 * 1024 * 1024)), /너무 큽니다/);
  assert.throws(() => cleanBackup({kind: BACKUP_FORMAT, notes: 'nope'}), /백업 파일/);
  assert.throws(() => cleanBackup({kind: BACKUP_FORMAT, notes: Array.from({length: 1001}, (_, i) => ({id: 'n' + i, text: ''}))}), /백업 파일/);
});

const groupsOf = (sync, local = {device: 'me'}) => noteGroups(mergedNotes(sync, local));
const incoming = (id, extra = {}) => ({id, title: '제목 ' + id, text: '본문 ' + id, time: 2000, created: 1000, pinned: false, ...extra});
test('메모 합치기: 없는 것만 더하고, 같은 것은 건너뛰고, 다른 것은 사본으로 남긴다', () => {
  const groups = groupsOf({...note('me', 'same'), ...note('me', 'edited', {text: '지금 내용'}), ...note('me', 'dead', {deleted: true, title: '', text: '', time: 9000})});
  const plan = planNotes(groups, [incoming('fresh'), incoming('same'), incoming('edited'), incoming('dead')]);
  assert.deepEqual(plan.add.map(n => n.id), ['fresh', copyId('edited'), copyId('dead')]);
  assert.equal(plan.add[1].title, '제목 edited (백업)', '고친 글은 제목에 (백업)을 붙인 사본');
  assert.equal(plan.add[1].text, '본문 edited');
  assert.equal(plan.add[2].title, '제목 dead', '지웠던 글은 이름 그대로 되살린다');
  assert.deepEqual([plan.same, plan.copies, plan.revived], [1, 1, 1]);
  assert.equal(plan.target.get('edited'), copyId('edited'));
});
test('같은 백업을 두 번 풀어도 두 번째에는 아무것도 늘지 않는다', () => {
  const sync = {...note('me', 'edited', {text: '지금 내용'}), ...note('me', 'dead', {deleted: true, title: '', text: '', time: 9000})};
  const list = [incoming('fresh'), incoming('edited'), incoming('dead')];
  const first = planNotes(groupsOf(sync), list);
  assert.equal(first.add.length, 3);
  const after = {...sync};
  for (const n of first.add) after[noteKey('me', n.id)] = {v: 2, ...n, revision: 'x', device: 'me'};
  const second = planNotes(groupsOf(after), list);
  assert.deepEqual(second.add, []);
  assert.equal(second.same, 3);
  // 가져온 사본을 사용자가 지웠다면, 다시 풀어도 되살리지 않는다
  after[noteKey('me', copyId('edited'))] = {v: 2, id: copyId('edited'), title: '', text: '', time: 99999, deleted: true, revision: 'y', device: 'me'};
  const third = planNotes(groupsOf(after), list);
  assert.deepEqual(third.add, []);
  assert.equal(third.target.get('edited'), undefined, '지운 사본에는 그림도 붙이지 않는다');
});
test('다른 기기에 같은 내용이 있어도 지운 글은 되살린다, 지금 보이는 글이면 건너뛴다', () => {
  // 한 기기에서 지웠고(가장 새 사본이 지움 표시), 다른 기기의 옛 사본이 백업과 같은 내용
  const sync = {...note('devB', 'x'), ...note('devA', 'x', {deleted: true, title: '', text: '', time: 9000})};
  const plan = planNotes(groupsOf(sync), [incoming('x')]);
  assert.deepEqual(plan.add.map(n => n.id), [copyId('x')]);
  assert.equal(plan.revived, 1);
  // 옛 사본이 같은 내용이고 지금도 살아 있다
  assert.equal(planNotes(groupsOf({...note('devB', 'y'), ...note('devA', 'y', {text: '더 새로운 내용', time: 5000})}), [incoming('y')]).same, 1);
});
test('사본 이름은 제목 길이 한도 안에 든다', () => {
  assert.equal(copyTitle('가'.repeat(40)).length, 40);
  assert.ok(copyTitle('짧게').endsWith(' (백업)'));
  assert.ok(copyId('x'.repeat(40)).length <= 40);
  assert.match(copyId('abc'), /^[A-Za-z0-9-]{1,40}$/);
});

test('그림 썸네일 합치기: 같은 그림은 한 번만, 상한은 지킨다', () => {
  const shot = (id, time) => ({id, file: 'f', name: 'n', thumb: 'AAAA', width: 1, height: 1, time});
  const target = new Map([['a', 'a'], ['b', 'b2']]);
  const merged = mergeImages({a: [shot('s1', 10)]}, {a: [shot('s1', 10), shot('s2', 20)], b: [shot('t1', 5)], zzz: [shot('q', 1)]}, target);
  assert.deepEqual(merged.a.map(s => s.id), ['s2', 's1']);
  assert.deepEqual(Object.keys(merged).sort(), ['a', 'b2'], '대상이 아닌 메모의 그림은 들이지 않는다');
  const many = Object.fromEntries(Array.from({length: 6}, (_, n) => ['m' + n, Array.from({length: 10}, (_, i) => shot(`m${n}-${i}`, n * 100 + i))]));
  const capped = mergeImages({}, many, new Map(Object.keys(many).map(id => [id, id])));
  assert.equal(Object.values(capped).reduce((sum, list) => sum + list.length, 0), IMAGES_TOTAL);
  assert.ok(Object.values(capped).every(list => list.length <= IMAGES_PER_NOTE));
  assert.ok(!capped.m0 || capped.m0.every(s => s.time >= 0));
});

test('북마크 합치기: 없는 것만 더하고, 지운 것은 되살리고, 있는 것은 그대로 둔다', () => {
  const all = snapshot('me', [{id: 'f1', rev: 1, writer: 'me', type: 'folder', title: '이미 있음'}, {id: 'l1', rev: 2, writer: 'me', title: '이미 있음', url: 'https://a.example/', folder: 'f1'},
    {id: 'l2', rev: 3, writer: 'me', title: '지움', url: 'https://b.example/', folder: '', deleted: true}]);
  const plan = planMarks(all, 'me', [folder('f1', '백업의 이름'), link('l1', '백업의 이름', 'https://zzz.example/', 'f1'), link('l2', '되살릴 링크', 'https://b.example/'),
    folder('f9', '새 폴더'), link('l9', '새 링크', 'https://c.example/', 'f9')]);
  assert.deepEqual([plan.added, plan.same, plan.left], [3, 2, 0]);
  assert.deepEqual([plan.links, plan.folders], [2, 1], '더한 것을 링크와 폴더로 나눠 센다');
  const merged = mergeBookmarks([plan.value]);
  const live = merged.filter(i => !i.deleted);
  assert.deepEqual(live.map(i => i.id).sort(), ['f1', 'f9', 'l1', 'l2', 'l9']);
  assert.equal(live.find(i => i.id === 'l1').title, '이미 있음', '있는 북마크는 백업 내용으로 덮지 않는다');
  assert.equal(live.find(i => i.id === 'l1').url, 'https://a.example/');
  assert.equal(live.find(i => i.id === 'l2').title, '되살릴 링크');
  assert.equal(live.find(i => i.id === 'l9').folder, 'f9');
  // 같은 것을 다시 풀면 더할 것이 없다
  const again = planMarks({'marks_me': plan.value}, 'me', [folder('f9', '새 폴더'), link('l9', '새 링크', 'https://c.example/', 'f9'), link('l2', '되살릴 링크', 'https://b.example/')]);
  assert.deepEqual([again.added, again.same, again.value], [0, 3, null]);
});
test('북마크가 한 칸(약 8KB)에 다 안 들어가면 들어가는 데까지만 넣고 폴더를 먼저 둔다', () => {
  const items = [folder('fa', '폴더 A'), ...Array.from({length: 150}, (_, i) => link('k' + i, '북마크 번호 ' + i, 'https://example.com/page/' + i + '?q=' + 'x'.repeat(30), i < 100 ? 'fa' : ''))];
  const plan = planMarks({}, 'me', items);
  assert.ok(plan.added > 20 && plan.added < 150, `들어간 수 ${plan.added}`);
  assert.equal(plan.left, 151 - plan.added);
  assert.equal(plan.wanted, 151);
  const live = mergeBookmarks([plan.value]).filter(i => !i.deleted);
  assert.equal(live.length, plan.added);
  assert.ok(live.some(i => i.id === 'fa'), '폴더가 먼저 들어간다');
  assert.ok(JSON.stringify(plan.value).length < 7900);
  // 한 개 더 넣으면 넘친다는 것(상한에 맞춰 최대한 채웠다)
  assert.ok(planMarks({}, 'me', items.slice(0, plan.added + 2)).left >= 1);
});
test('합치기 계획은 새로 만든 저장소와 이어 붙는다 — 메모 → 백업 → 새 컴퓨터 전체 순환', async () => {
  const {sync, local} = await sampleStorage();
  const payload = collectBackup({sync, local, includeLock: true});
  const file = await sealBackup(payload, '순환시험1234', FAST);
  const {payload: restored} = await openBackup(file, '순환시험1234');
  // 빈 새 컴퓨터
  const fresh = planNotes(groupsOf({}, {device: 'new'}), restored.notes);
  assert.equal(fresh.add.length, restored.notes.length);
  assert.deepEqual(fresh.add.map(n => n.text), restored.notes.map(n => n.text));
  const marks = planMarks({}, 'new', restored.bookmarks);
  assert.equal(marks.added, restored.bookmarks.length);
  // 새 컴퓨터에서 다시 백업하면 같은 내용이 나온다
  const newSync = {};
  for (const n of fresh.add) newSync[noteKey('new', n.id)] = {v: 2, ...n, revision: 'x', device: 'new'};
  newSync['marks_new'] = marks.value;
  const again = collectBackup({sync: newSync, local: {device: 'new'}});
  assert.deepEqual(again.notes, restored.notes);
  assert.deepEqual(again.bookmarks.map(b => b.id).sort(), restored.bookmarks.map(b => b.id).sort());
});

// ── 화면과 코드가 같은 이름을 쓰는가 ────────────────────────────────────
// 화면(panel.html)에서 id 를 바꾸거나 지우면 panel.js 의 $('…') 가 null 을 만나 단추가 조용히 죽는다.
// 브라우저 없이도 잡을 수 있게, 백업 화면이 쓰는 id 가 모두 있는지 본다.
import {readFileSync} from 'node:fs';
test('백업 화면이 쓰는 모든 id 가 panel.html 에 있다', () => {
  const html = readFileSync(new URL('../extension/panel.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');
  const used = new Set([...js.matchAll(/\$\('((?:bk|gate)-[a-z-]+)'\)|event\('((?:bk|gate)-[a-z-]+)'/g)].map(m => m[1] || m[2]));
  assert.ok(used.size >= 20, `백업·처음 화면 id 를 ${used.size}개만 찾았다`);
  for (const id of used) assert.ok(html.includes(`id="${id}"`), `panel.html 에 id="${id}" 가 없다`);
  // 암호 입력칸은 브라우저가 저장·자동완성하지 않게 한다(새 암호는 new-password, 여는 암호는 off)
  for (const id of ['bk-pass', 'bk-pass2']) assert.match(html, new RegExp(`id="${id}" type="password" autocomplete="new-password"`));
  for (const id of ['bk-open-pass', 'gate-restore-pass']) assert.match(html, new RegExp(`id="${id}" type="password" autocomplete="off"`));
});
test('백업은 서버나 네트워크로 아무것도 보내지 않는다', () => {
  for (const file of ['../extension/lib/backup.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|chrome\.(storage|runtime|tabs)/.test(source), file + ' 는 저장소·네트워크를 직접 만지지 않는다');
  }
  const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const restore = bg.slice(bg.indexOf('async function restoreBackup'), bg.indexOf('// The helper app watches'));
  assert.ok(!/fetch\(|XMLHttpRequest/.test(restore), '복원은 네트워크를 쓰지 않는다');
});
