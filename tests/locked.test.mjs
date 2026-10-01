// 잠긴 동안 새 주소로 가면 뜨는 안내 화면(locked.js). 두 가지를 지킨다.
//  ① 잠금이 풀리면 ‘원래 주소 그대로’ 돌아간다 — 예전에는 주소를 한 번 더 디코딩해 ?x=a%26b 가 ?x=a&b 로 바뀌었다.
//  ② 홀로 있는 ‘%’(…/50%)가 있어도 스크립트가 멈추지 않고 단추가 걸린다 — 예전에는 URIError 로 첫 줄에서 죽었다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function run(hash, {locked = false} = {}) {
  const elements = {}, handlers = [], replaced = [];
  const element = id => elements[id] ||= {id, textContent: '', disabled: false, addEventListener: (type, fn) => handlers.push({id, type, fn})};
  const messages = [];
  const context = {
    location: {hash, replace: url => replaced.push(url)},
    document: {getElementById: element, addEventListener: () => {}, hidden: false},
    chrome: {runtime: {sendMessage: async message => { messages.push(message.type); return {ok: true, data: {configured: true, locked, name: '다있쌤'}}; },
      onMessage: {addListener: fn => handlers.push({id: 'runtime', type: 'message', fn})}}, tabs: {getCurrent: async () => null, remove: async () => {}}},
    decodeURIComponent, setTimeout, Promise
  };
  vm.runInNewContext(readFileSync('extension/locked.js', 'utf8'), context);
  return {elements, handlers, replaced, messages, element};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('잠금이 풀리면 원래 주소를 한 글자도 바꾸지 않고 돌아간다(%26·%3A%2F 포함)', async () => {
  for (const url of ['http://a.test/q?x=a%26b&y=%E2%9C%93', 'http://a.test/x?next=https%3A%2F%2Fexample.com%2F', 'http://a.test/p#frag%20x', 'http://a.test/%ED%95%9C%EA%B8%80?%EC%9D%B4=%EA%B0%92', 'https://a.test/path with%20mix']) {
    const page = run('#' + url, {locked: false}); await tick();
    assert.deepEqual(page.replaced, [url], '디코딩 때문에 다른 주소로 갔다: ' + url);
  }
});
test('잠겨 있는 동안에는 이동하지 않고, 풀렸다는 소식이 오면 그때 이동한다', async () => {
  const url = 'http://a.test/q?x=a%26b';
  const page = run('#' + url, {locked: true}); await tick();
  assert.deepEqual(page.replaced, []);
  page.handlers.find(h => h.id === 'runtime').fn({type: 'state-changed', state: {locked: false}});
  assert.deepEqual(page.replaced, [url]);
});
test('안내 글에는 풀어서 읽기 쉽게 보여 준다', async () => {
  const page = run('#http://a.test/%ED%95%9C%EA%B8%80', {locked: true}); await tick();
  assert.equal(page.elements.target.textContent, '잠금이 풀리면 http://a.test/한글 으로 돌아갑니다.');
});
test('홀로 있는 %(…/50%)가 있어도 스크립트가 멈추지 않고 단추가 모두 걸린다', async () => {
  for (const url of ['http://a.test/50%', 'http://a.test/a%E0%A4%A', 'http://a.test/%zz', 'http://a.test/%']) {
    let page;
    assert.doesNotThrow(() => { page = run('#' + url, {locked: true}); }, 'URIError 로 죽었다: ' + url);
    await tick();
    for (const id of ['unlock', 'guest', 'close']) assert.ok(page.handlers.some(h => h.id === id && h.type === 'click'), `${url}: ${id} 단추가 안 걸렸다`);
    assert.ok(page.handlers.some(h => h.id === 'runtime'), `${url}: 상태 소식을 못 듣는다(풀려도 이 화면에 머문다)`);
    assert.equal(page.elements.target.textContent, `잠금이 풀리면 ${url} 으로 돌아갑니다.`, '풀지 못하면 그대로 보여 준다');
    page.handlers.find(h => h.id === 'runtime').fn({type: 'state-changed', state: {locked: false}});
    assert.deepEqual(page.replaced, [url], '풀리면 그 주소로 돌아간다');
  }
});
test('http(s) 가 아닌 주소는 따라가지 않는다', async () => {
  for (const hash of ['#javascript:alert(1)', '#data:text/html,x', '#chrome://settings', '#file:///etc/passwd', '']) {
    const page = run(hash, {locked: false}); await tick();
    assert.deepEqual(page.replaced, ['about:blank'], hash);
  }
});
