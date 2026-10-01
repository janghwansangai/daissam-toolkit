import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('existing page inputs are blocked, overlay controls work, stale unlock ignored, contents preserved',async()=>{
  let pushed,blurred=false,host;const handlers={};
  class Element {
    constructor(){this.style={};this.children=[];this.isConnected=false;this.textContent='';}
    append(...items){for(const item of items){item.isConnected=true;this.children.push(item);}if(this===root)host=items[0];}
    attachShadow(){this.shadowRoot=new Element();return this.shadowRoot;}setAttribute(){}focus(){}addEventListener(){}remove(){this.isConnected=false;}
  }
  const root=new Element();const doc={querySelectorAll:()=>[],documentElement:root,activeElement:{blur:()=>blurred=true},createElement:()=>new Element(),addEventListener:()=>{},hidden:false,fullscreenElement:null};
  const win={removeEventListener:()=>{},addEventListener:(type,handler)=>{handlers[type]=handler;}};win.top=win;
  const context={window:win,document:doc,chrome:{runtime:{id:'test',sendMessage:async()=>({ok:true,data:{locked:true,name:'Test',revision:10}}),onMessage:{addListener:f=>pushed=f,removeListener:()=>{}}}}};
  vm.runInNewContext(readFileSync('extension/guard.js','utf8'),context);await new Promise(setImmediate);
  assert.ok(host.isConnected);assert.equal(blurred,true);
  let prevented=false;handlers.keydown({composedPath:()=>[],preventDefault:()=>prevented=true,stopImmediatePropagation:()=>{}});assert.equal(prevented,true);
  prevented=false;handlers.click({composedPath:()=>[host],preventDefault:()=>prevented=true,stopImmediatePropagation:()=>{}});assert.equal(prevented,false);
  pushed({type:'lock-state',state:{locked:false,revision:9}});assert.equal(host.isConnected,true);
  pushed({type:'lock-state',state:{locked:false,revision:11}});assert.equal(host.isConnected,false);
  prevented=false;handlers.keydown({composedPath:()=>[],preventDefault:()=>prevented=true,stopImmediatePropagation:()=>{}});assert.equal(prevented,false);
  assert.equal(root.children.length,1,'guard never replaces or removes page content');
});
test('extension update removes stale DOM even when old Chrome APIs throw',async()=>{
  const nodes=[],events=new Map();let invalid=false;
  class El{
    constructor(){this.style={};this.children=[];this.isConnected=false;this.attrs={};}
    setAttribute(k,v){this.attrs[k]=v;}append(...items){items.forEach(i=>{i.isConnected=true;this.children.push(i);});}
    attachShadow(){this.shadowRoot=new El();return this.shadowRoot;}
    addEventListener(){}focus(){}remove(){this.isConnected=false;}
  }
  const body=new El();body.append=(n)=>{nodes.push(n);n.isConnected=true;};
  const doc={body,documentElement:body,createElement:()=>new El(),activeElement:{blur(){}},querySelectorAll:()=>nodes.filter(n=>n.isConnected&&'data-browser-sheriff-guard' in n.attrs),addEventListener(){},removeEventListener(){}};
  const win={addEventListener:(type,f)=>{if(!events.has(type))events.set(type,[]);events.get(type).push(f);},removeEventListener:(type,f)=>{events.set(type,events.get(type)?.filter(x=>x!==f)||[]);}};win.top=win;
  const runtime={get id(){if(invalid)throw Error('Extension context invalidated');return 'test';},sendMessage:async()=>({ok:true,data:{locked:true,name:'Test',revision:1}}),onMessage:{addListener(){},removeListener(){if(invalid)throw Error('Extension context invalidated');}}};
  const source=readFileSync('extension/guard.js','utf8');
  vm.runInNewContext(source,{window:win,document:doc,chrome:{runtime}});await new Promise(setImmediate);
  const old=nodes[0];assert.equal(old.isConnected,true);invalid=true;
  const nextRuntime={id:'test',sendMessage:async()=>({ok:true,data:{locked:false,name:'Test',revision:2}}),onMessage:{addListener(){},removeListener(){}}};
  vm.runInNewContext(source,{window:win,document:doc,chrome:{runtime:nextRuntime}});await new Promise(setImmediate);
  assert.equal(old.isConnected,false);
  const event={composedPath:()=>[],preventDefault(){throw Error('stale guard must not block');},stopImmediatePropagation(){}};
  for(const f of [...events.get('click')])assert.doesNotThrow(()=>f(event));
  assert.equal(doc.querySelectorAll().length,0);
});

// ── 다시 주입돼도 깜박이지 않는다 ───────────────────────────────────────
// 서비스 워커가 깰 때마다 guard.js 가 다시 들어오던 시절에는, 새 주입이 시작하자마자 옛 잠금 화면을 지우고 서비스
// 워커의 답을 받은 뒤에야 새로 그렸다. 그 사이에 원래 화면이 드러나 잠금 중에 1분 안팎마다 깜박였다(사용자 보고).
function guardEnv() {
  const log = [], nodes = [], events = new Map();
  let serial = 0;
  class El {
    constructor() { this.id = 'el' + (++serial); this.style = {}; this.children = []; this.isConnected = false; this.attrs = {}; }
    setAttribute(k, v) { this.attrs[k] = v; }
    append(...items) { items.forEach(i => { i.isConnected = true; this.children.push(i); }); }
    attachShadow() { this.shadowRoot = new El(); return this.shadowRoot; }
    addEventListener() {} focus() {}
    remove() { if (this.isConnected) { this.isConnected = false; if ('data-browser-sheriff-guard' in this.attrs) log.push('remove:' + this.id); } }
  }
  const body = new El();
  body.append = node => { nodes.push(node); node.isConnected = true; if ('data-browser-sheriff-guard' in node.attrs) log.push('add:' + node.id); };
  const doc = {body, documentElement: body, createElement: () => new El(), activeElement: {blur() {}}, hidden: false, fullscreenElement: null,
    querySelectorAll: () => nodes.filter(n => n.isConnected && 'data-browser-sheriff-guard' in n.attrs), addEventListener() {}, removeEventListener() {}};
  const win = {addEventListener: (type, f) => { if (!events.has(type)) events.set(type, []); events.get(type).push(f); },
    removeEventListener: (type, f) => events.set(type, (events.get(type) || []).filter(x => x !== f))};
  win.top = win;
  const context = vm.createContext({window: win, document: doc, chrome: {}});
  const source = readFileSync('extension/guard.js', 'utf8');
  const runtimeFor = reply => ({id: 'test', sendMessage: reply, onMessage: {addListener() {}, removeListener() {}}});
  return {log, nodes, events, doc, run(reply) { context.chrome = {runtime: runtimeFor(reply)}; vm.runInContext(source, context); },
    shown: () => nodes.filter(n => n.isConnected && 'data-browser-sheriff-guard' in n.attrs)};
}
const tick = () => new Promise(setImmediate);
const locked = revision => async () => ({ok: true, data: {locked: true, name: 'Test', revision}});

test('잠금 중 다시 주입돼도 새 화면이 올라간 뒤에야 옛 화면을 걷는다', async () => {
  const env = guardEnv();
  env.run(locked(1)); await tick();
  const first = env.shown()[0];
  assert.ok(first, '처음 주입으로 잠금 화면이 뜬다');
  // 두 번째 주입: 서비스 워커의 답이 아직 오지 않았다
  let answer;
  env.run(() => new Promise(resolve => { answer = resolve; })); await tick();
  assert.equal(first.isConnected, true, '답을 기다리는 동안에도 옛 잠금 화면은 그대로다(원래 화면이 드러나면 안 된다)');
  assert.equal(env.shown().length, 1);
  answer({ok: true, data: {locked: true, name: 'Test', revision: 2}}); await tick();
  const [second] = env.shown();
  assert.equal(env.shown().length, 1, '교체가 끝나면 잠금 화면은 하나');
  assert.notEqual(second, first);
  assert.equal(first.isConnected, false);
  assert.ok(env.log.indexOf('add:' + second.id) < env.log.indexOf('remove:' + first.id), '새 화면을 올린 다음에 옛 화면을 걷는다');
  // 옛 가드의 입력 차단은 거둬졌다 — 새 가드 하나만 듣는다
  for (const type of ['click', 'keydown', 'wheel']) assert.equal(env.events.get(type).length, 1, type + ' 듣는 쪽이 하나');
});
test('다시 주입했는데 풀려 있으면 답이 온 뒤에 옛 화면을 걷는다', async () => {
  const env = guardEnv();
  env.run(locked(1)); await tick();
  const first = env.shown()[0];
  let answer;
  env.run(() => new Promise(resolve => { answer = resolve; })); await tick();
  assert.equal(first.isConnected, true);
  answer({ok: true, data: {locked: false, name: 'Test', revision: 2}}); await tick();
  assert.equal(first.isConnected, false);
  assert.equal(env.shown().length, 0);
});
test('서비스 워커가 답하지 못하면 옛 잠금 화면을 그대로 둔다(안전한 쪽)', async () => {
  const env = guardEnv();
  env.run(locked(1)); await tick();
  const first = env.shown()[0];
  env.run(async () => { throw new Error('서비스 워커가 아직 없다'); }); await tick(); await tick();
  assert.equal(first.isConnected, true);
  assert.equal(env.shown().length, 1);
});
test('여러 번 겹쳐 주입돼도 잠금 화면은 하나이고 입력 차단이 쌓이지 않는다', async () => {
  const env = guardEnv();
  env.run(locked(1)); await tick();
  const pending = [];
  for (let i = 0; i < 3; i++) env.run(() => new Promise(resolve => pending.push(resolve)));
  await tick();
  assert.equal(env.shown().length, 1, '답을 기다리는 동안 옛것 하나');
  pending.forEach((resolve, i) => resolve({ok: true, data: {locked: true, name: 'Test', revision: 2 + i}})); await tick();
  assert.equal(env.shown().length, 1);
  assert.equal(env.events.get('keydown').length, 1, '옛 가드들의 듣는 쪽이 모두 걷혔다');
});

// 서비스 워커가 깰 때마다 열린 탭에 guard.js 를 다시 넣지 않는다. 새 페이지는 manifest 가 넣어 준다.
import {createChrome} from './chrome-mock.mjs';
test('열린 탭에 잠금 화면을 넣는 일은 확장이 켜진 뒤 한 번만 한다', async () => {
  const mock = createChrome();
  globalThis.chrome = mock.chrome;
  const injected = [];
  const execute = mock.chrome.scripting.executeScript;
  mock.chrome.scripting.executeScript = async spec => { if (spec.files?.includes('guard.js')) injected.push(spec.target.tabId); return execute(spec); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));
  await import('../extension/background.js?boot=1'); await settle();
  assert.deepEqual(injected, [1], '처음 켜질 때 열려 있던 탭에 한 번');
  assert.equal(mock.data.session.guardsInjected, true);
  // 서비스 워커가 꺼졌다 켜지는 것(알람이 1분마다 깨운다)을 되풀이해도 다시 넣지 않는다
  for (let n = 2; n <= 5; n++) { await import(`../extension/background.js?boot=${n}`); await settle(); }
  assert.deepEqual(injected, [1], '서비스 워커가 다시 켜져도 재주입이 없다 — 있으면 잠금 화면이 1분마다 깜박인다');
  // 확장을 다시 불러오면(업데이트·끔→켬·브라우저 재시작) storage.session 이 비워지고, 그때는 다시 넣는다
  delete mock.data.session.guardsInjected;
  await import('../extension/background.js?boot=6'); await settle();
  assert.deepEqual(injected, [1, 1], '다시 불러온 뒤에는 한 번 더');
  assert.equal(mock.data.session.guardsInjected, true);
});
