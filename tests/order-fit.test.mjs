// v0.42.0 규칙: 끌어서 정한 순서 · 순서표 검사 · 사이드바 페이지 맞추기 배율.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOrder, cleanOrder, moveInOrder, fitZoom, ORDER_MAX} from '../extension/lib/data.js';

const ids = list => list.map(item => item.id);
test('순서: 순서표 차례대로, 새로 생긴 것은 앞에, 없어진 id 는 무시', () => {
  const items = [{id: 'new'}, {id: 'a'}, {id: 'b'}, {id: 'c'}];
  assert.deepEqual(ids(applyOrder(items, ['c', 'gone', 'a', 'b'])), ['new', 'c', 'a', 'b']);
  assert.deepEqual(ids(applyOrder(items, null)), ['new', 'a', 'b', 'c'], '순서표가 없으면 원래 차례');
});
test('끌어 놓기: 오른쪽으로 끌면 그 뒤, 왼쪽으로 끌면 그 앞', () => {
  assert.deepEqual(moveInOrder(['a', 'b', 'c', 'd'], 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveInOrder(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveInOrder(['a', 'b'], 'x', 'a'), ['a', 'b'], '없는 id 는 그대로');
});
test('순서표 검사: 모양 · 겹침 · 개수', () => {
  assert.deepEqual(cleanOrder(['a', 'a', '../x', 42, 'b-1', '']), ['a', 'b-1']);
  assert.equal(cleanOrder(Array.from({length: 500}, (_, i) => 'n' + i)).length, ORDER_MAX);
  assert.throws(() => cleanOrder('a,b'));
});
test('페이지 맞추기: 넘치는 만큼만 줄이고, 조금 넘치거나 맞으면 그대로', () => {
  assert.equal(fitZoom(1, 1600, 1000), 0.62);
  assert.equal(fitZoom(1, 1010, 1000), null, '24px 이하로 넘치면 그대로(반응형 페이지의 1px 넘침)');
  assert.equal(fitZoom(1, 1000, 1000), null);
  assert.equal(fitZoom(1, 5000, 1000), 0.5, '0.5 아래로는 줄이지 않는다');
  assert.equal(fitZoom(0.62, 1000, 1000), null, '이미 맞으면 키우지도 줄이지도 않는다');
  assert.equal(fitZoom(0, 1, 1), null);
});
test('동기화 공간이 가득 차도 지움 표시처럼 줄어드는 쓰기는 통과한다(혹사 시험으로 발견)', async () => {
  const {checkQuota, TOTAL_BYTES} = await import('../extension/lib/data.js');
  const all = {};
  for (let i = 0; i < 15; i++) all['note_d_' + i] = {v: 2, text: 'x'.repeat(7000)};   // 약 105KB — 다른 기기 것까지 합쳐 넘친 상태(하나를 지워도 넘친다)
  const tomb = {v: 2, text: '', deleted: true};
  assert.throws(() => checkQuota(all, 'note_d_new', {v: 2, text: 'y'}), /가득/);
  assert.throws(() => checkQuota(all, 'note_d_0', tomb), /가득/, '예전 동작(allowShrink 없이)');
  assert.doesNotThrow(() => checkQuota(all, 'note_d_0', tomb, {allowShrink: true}));
  assert.throws(() => checkQuota(all, 'note_d_0', {v: 2, text: 'z'.repeat(7500)}, {allowShrink: true}), /가득/, '커지는 쓰기는 여전히 막는다');
  assert.ok(TOTAL_BYTES > 0);
});
