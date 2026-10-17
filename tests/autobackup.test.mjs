// 자동 백업 규칙(lib/autobackup.js)과 망가진 북마크를 건너뛰는 읽기(readBookmarks).
import test from 'node:test';
import assert from 'node:assert/strict';
import {backupName, parseName, sortBackups, pruneList, fingerprint, worthKeeping, deviceTag, KEEP_NEWEST} from '../extension/lib/autobackup.js';
import {readBookmarks} from '../extension/lib/data.js';

const DEV = 'ab12cd34-0000-4000-8000-000000000000';
test('이름: 날짜 · 시각 · 종류 · 기기로 짓고 다시 풀린다', () => {
  const name = backupName(new Date(2026, 9, 17, 14, 30, 5), 'change', DEV);
  assert.equal(name, 'daissam-backup_2026-10-17_14-30-05_change_ab12cd.json');
  const p = parseName(name);
  assert.equal(p.kind, 'change'); assert.equal(p.device, 'ab12cd'); assert.equal(p.day, '2026-10-17');
  assert.equal(p.at, new Date(2026, 9, 17, 14, 30, 5).getTime());
  assert.throws(() => backupName(new Date(), 'weird', DEV));
  for (const bad of ['../x.json', 'daissam-backup_2026-13-01_00-00-00_daily_ab12cd.json', 'daissam-backup_2026-10-17_14-30-05_daily_AB12CD.json', 'notes.json', ''])
    assert.equal(parseName(bad), null, bad);
  assert.equal(deviceTag(''), '000000');
});
test('목록: 여러 컴퓨터 것이 섞여도 최신이 먼저', () => {
  const files = [backupName(new Date(2026, 9, 1), 'daily', 'aaaaaa'), backupName(new Date(2026, 9, 3), 'daily', 'bbbbbb'), 'other.txt', backupName(new Date(2026, 9, 2), 'manual', 'aaaaaa')].map(name => ({name}));
  assert.deepEqual(sortBackups(files).map(f => f.day), ['2026-10-03', '2026-10-02', '2026-10-01']);
});
const at = (d, h = 9, kind = 'change', dev = DEV) => ({name: backupName(new Date(2026, 9, d, h, 0, 0), kind, dev)});
test('보관: 한 달 지난 것은 지우되 가장 최근 3개는 남긴다', () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  // 한 달 넘게 안 쓴 컴퓨터: 전부 오래됐어도 최근 3개는 남는다
  const old = [at(1, 9), at(2, 9), at(3, 9), at(4, 9)].map(f => ({name: f.name.replace('2026-10', '2026-08')}));
  const gone = pruneList(old, DEV, now);
  assert.equal(gone.length, old.length - KEEP_NEWEST);
  assert.ok(gone.includes(old[0].name), '가장 오래된 것은 지운다');
});
test('보관: 오늘 · 어제는 모두, 그 전 날은 하루에 마지막 하나, 직접 · 복구 직전은 한 달 동안 모두', () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  const files = [at(17, 8), at(17, 9), at(17, 10), at(16, 8), at(16, 20),       // 오늘 · 어제: 모두
    at(14, 8), at(14, 12), at(14, 18),                                              // 그저께 전: 18시 것만
    at(10, 9, 'manual'), at(10, 10, 'manual'), at(10, 11, 'before-restore'),       // 직접 · 복구 직전: 모두
    at(14, 9, 'change', 'ffffff')];                                                  // 다른 컴퓨터 것: 손대지 않음
  const gone = pruneList(files, DEV, now);
  assert.deepEqual(gone.sort(), [at(14, 8).name, at(14, 12).name].sort());
});
test('보관: 31일 넘은 직접 백업도 지운다(최근 3개가 아니면)', () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  const files = [at(17, 8), at(17, 9), at(17, 10), {name: backupName(new Date(2026, 8, 10, 9), 'manual', DEV)}];
  assert.deepEqual(pruneList(files, DEV, now), [files[3].name]);
});
test('지문: 만든 시각은 빼고 내용으로만 비교한다 · 빈 백업은 만들지 않는다', async () => {
  const a = await fingerprint({made: {at: '1'}, notes: [{id: 'x'}], bookmarks: []});
  const b = await fingerprint({made: {at: '2'}, notes: [{id: 'x'}], bookmarks: []});
  const c = await fingerprint({made: {at: '2'}, notes: [{id: 'y'}], bookmarks: []});
  assert.equal(a, b); assert.notEqual(a, c);
  assert.equal(worthKeeping({notes: [], bookmarks: []}), false);
  assert.equal(worthKeeping({notes: [], bookmarks: [{id: 'f', type: 'folder'}]}), true);
});
test('북마크 읽기: 망가진 항목 하나 때문에 목록 전체를 버리지 않는다(사용자 보고)', () => {
  const good = {id: 'a', rev: 1, writer: 'd1', title: '수업 자료', url: 'https://example.com/'};
  const snapshots = [
    {kind: 'bookmarks', items: [good, {id: 'b', rev: 1, writer: 'd1', title: 'x'.repeat(500), url: 'https://e.com/'}]},
    {kind: 'bookmarks', items: [{id: 'c', rev: 'x', writer: 'd2'}, {id: 'd', rev: 2, writer: 'd2', title: '나쁜 주소', url: 'javascript:alert(1)'}]},
    {kind: 'nope'}];
  const read = readBookmarks(snapshots);
  assert.deepEqual(read.items.map(i => i.id), ['a']);
  assert.equal(read.skipped, 4);
});
