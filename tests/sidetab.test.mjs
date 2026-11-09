// v0.45.0 자동 숨김: 책갈피가 보일지(창마다) · 사이드바가 알린 열림/닫힘 · 닫힘 알림이 빠졌을 때 바로잡기 · 누른 순간에 열기 ·
// 잠기면 숨기 · 책갈피 스크립트는 꺼져 있으면 서비스 워커를 깨우지 않고 스크롤을 막는 듣는 쪽도 없다.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {createChrome} from './chrome-mock.mjs';
const mock=createChrome();globalThis.chrome=mock.chrome;
const opened=[];let contexts=[{contextType:'SIDE_PANEL',windowId:-1,tabId:-1}];
mock.chrome.sidePanel.open=async info=>{opened.push(info);};
mock.chrome.runtime.getContexts=async()=>contexts;
const baseQuery=mock.chrome.tabs.query;
mock.chrome.tabs.query=async q=>q?.windowId!==undefined||q?.url?[{id:40+(q.windowId??7),windowId:q.windowId??7,url:'https://example.test/'}]:baseQuery(q);
await import('../extension/background.js');
const send=(type,data={},sender)=>mock.send({type,...data},sender);
const page=windowId=>({tab:{id:40+windowId,windowId},url:'https://example.test/'});
const view=windowId=>send('side-tab',{},page(windowId)).then(r=>r.data);

test('자동 숨김이 꺼져 있으면 책갈피는 없다',async()=>{
  assert.equal((await send('setup',{guest:true,name:'게스트'})).ok,true);
  assert.deepEqual(await view(7),{on:false,show:false,spot:.5});
});
test('켜면 사이드바가 닫힌 창에만 책갈피가 보인다 — 사이드바가 열림 · 닫힘을 알린다',async()=>{
  mock.tabMessages.length=0;
  assert.equal((await send('side-auto',{on:true})).ok,true);
  assert.equal(mock.data.local.sideAutoHide,true);
  assert.ok(mock.tabMessages.some(m=>m.type==='side-tab'&&m.on===true),'켜면 모든 탭의 책갈피에 알린다');
  assert.equal((await send('side-auto',{on:true},page(7))).ok,false,'페이지는 켜고 끄지 못한다');
  assert.equal((await send('side-spot',{spot:.2},page(7))).ok,true,'책갈피가 옮긴 자리');
  assert.equal((await send('side-spot',{spot:3},page(7))).ok,false,'자리는 0~1');
  assert.equal((await send('side-spot',{spot:.4})).ok,false,'탭이 아닌 곳은 자리를 보내지 않는다');
  assert.deepEqual(await view(7),{on:true,show:true,spot:.2,guest:true});
  assert.equal((await send('side-panel',{open:true,windowId:7})).ok,true);
  assert.equal((await view(7)).show,false,'사이드바가 열린 창');
  assert.equal((await view(8)).show,true,'다른 창에는 보인다');
  assert.ok(mock.tabMessages.some(m=>m.type==='side-tab'&&m.show===false),'열린 창의 책갈피에게 숨으라고 알린다');
  assert.equal((await send('side-panel',{open:false,windowId:7})).ok,true);
  assert.equal((await view(7)).show,true);
});
test('사이드바가 아닌 곳(페이지)은 열림 · 닫힘을 알리지 못한다',async()=>{
  const refused=await send('side-panel',{open:true,windowId:7},page(7));
  assert.equal(refused.ok,false);
  assert.equal((await view(7)).show,true);
  assert.equal((await send('side-panel',{open:true,windowId:-1})).ok,false,'이상한 창 번호는 거절');
});
test('닫힘 알림이 빠졌어도, 연 지 3초가 지나 사이드바가 하나도 없으면 책갈피를 다시 보인다',async()=>{
  await send('side-panel',{open:true,windowId:7});
  contexts=[];
  assert.equal((await view(7)).show,false,'갓 연 사이드바는 아직 뜨는 중일 수 있다');
  await mock.chrome.storage.session.set({sidePanels:{7:Date.now()-5000}});
  assert.equal((await view(7)).show,true);
  contexts=[{contextType:'SIDE_PANEL',windowId:-1,tabId:-1}];
  await mock.chrome.storage.session.set({sidePanels:{7:Date.now()-5000}});
  assert.equal((await view(7)).show,false,'사이드바가 하나라도 있으면 알린 대로 둔다');
  await send('side-panel',{open:false,windowId:7});
});
test('책갈피를 누르면 기다리지 않고 바로 그 창에서 연다(Chrome 은 누른 순간에만 허락한다)',async()=>{
  opened.length=0;
  const pending=send('side-open',{},page(9));
  assert.deepEqual(opened,[{windowId:9}],'메시지를 받은 그 자리에서 sidePanel.open 을 부른다');
  assert.equal((await pending).ok,true);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal((await view(9)).show,false,'연 창의 책갈피는 숨는다');
  assert.equal((await send('side-open',{},{url:'https://example.test/'})).ok,false,'탭이 없으면 거절');
});
test('책갈피의 세로 도크: 맨 위 틀의 탭에서, 정해진 단추만 받는다',async()=>{
  const top={...page(8),frameId:0};
  assert.equal((await send('side-dock',{action:'evil'},top)).ok,false,'모르는 단추는 거절');
  assert.equal((await send('side-dock',{action:'constructor'},top)).ok,false,'이름으로 속일 수 없다');
  assert.equal((await send('side-dock',{action:'stop'},{...page(8),frameId:3})).ok,false,'페이지 안 틀은 거절');
  assert.equal((await send('side-dock',{action:'stop'},{url:'https://example.test/'})).ok,false,'탭이 아닌 곳은 거절');
  assert.equal((await send('side-pick',{action:'snip'},top)).ok,false,'고르기 시작은 사이드바만');
});
test('책갈피의 세로 도크: 사이드바 도크와 같은 명령을 앱에 보낸다 · 앱이 없으면 까닭을 돌려준다',async()=>{
  const top={...page(8),frameId:0},connect=mock.chrome.runtime.connectNative;
  mock.chrome.runtime.connectNative=()=>{throw new Error('no port');};
  const said=()=>mock.nativeMessages.map(one=>one.message.action);
  try{
    mock.nativeMessages.length=0;
    for(const action of ['stop','through','pins'])assert.equal((await send('side-dock',{action},top)).ok,true,action);
    assert.deepEqual(said(),['stop','pins-through','pins-clear']);
    mock.nativeMessages.length=0;mock.native.presenter.focus=false;
    await send('side-dock',{action:'focus'},top);
    assert.deepEqual(said(),['state','focus-on'],'꺼져 있으면 켠다');
    mock.nativeMessages.length=0;mock.native.presenter.focus=true;
    await send('side-dock',{action:'focus'},top);
    assert.deepEqual(said(),['state','focus-off'],'켜져 있으면 끈다');
    mock.native.presenter.focus=false;mock.nativeMessages.length=0;
    await mock.chrome.storage.local.set({presentKnobs:{dim:30,blur:4,ringSize:60,ring:'#ff0000'}});
    await send('side-dock',{action:'start'},top);
    assert.deepEqual(mock.nativeMessages[0].message,{type:'presenter',action:'start',dim:'0.3',blur:'4',ringSize:'60',ring:'#ff0000'},'사이드바에서 정한 값을 함께 보낸다');
    await mock.chrome.storage.local.remove('presentKnobs');
    mock.native.available=false;
    const missing=await send('side-dock',{action:'stop'},top);
    assert.equal(missing.ok,false);assert.match(missing.error,/발표 도우미/);
  }finally{mock.native.available=true;mock.chrome.runtime.connectNative=connect;}
});
test('책갈피 설정 단추는 누른 순간에 열고, 열린 사이드바가 설정으로 가도록 표시를 남긴다',async()=>{
  opened.length=0;
  const pending=send('side-open',{page:'settings'},page(11));
  assert.deepEqual(opened,[{windowId:11}]);
  assert.equal((await pending).ok,true);
  assert.equal(mock.data.session.sideOpenPage,'settings');
  delete mock.data.session.sideOpenPage;
  await send('side-open',{},page(11));
  assert.equal(mock.data.session.sideOpenPage,undefined,'그냥 열 때는 표시가 없다');
  await send('side-panel',{open:false,windowId:11});
});
test('잠기면 책갈피를 숨긴다',async()=>{
  assert.equal((await send('pin-make',{pin:'246810'})).ok,true);
  assert.equal((await view(8)).show,true);
  await send('lock');
  assert.deepEqual(await view(8),{on:true,show:false,spot:.2});
  assert.equal((await send('side-dock',{action:'full'},{...page(8),frameId:0})).ok,false,'잠겨 있으면 도크도 거절');
  assert.equal((await send('side-pick',{action:'snip'})).ok,false,'잠겨 있으면 고르기도 거절');
});

function sideTabEnv({top=true,on=false}={}){
  const listeners=[],sent=[],built=[];let push;
  const element=()=>({style:{setProperty(){},cssText:''},setAttribute(){},append(){},addEventListener(){},attachShadow:()=>({append(){}}),classList:{add(){},remove(){},toggle(){}},isConnected:false});
  const doc={querySelectorAll:()=>[],documentElement:{append(){}},addEventListener:(type,fn,o={})=>listeners.push({type,fn,passive:o.passive===true}),removeEventListener(){},hidden:false,
    createElement:tag=>{built.push(tag);return element();},createElementNS:()=>element()};
  const win={addEventListener:(type,fn,o={})=>listeners.push({type,fn,passive:o.passive===true}),removeEventListener(){}};
  win.top=top?win:{};
  const chrome={runtime:{id:'x',sendMessage:async m=>{sent.push(m);return {ok:true,data:{on,show:on,spot:.5}};},onMessage:{addListener:f=>{push=f;},removeListener(){}}}};
  const context=vm.createContext({window:win,document:doc,chrome,innerHeight:800,requestAnimationFrame:f=>setTimeout(f,0),setTimeout,clearTimeout});
  context.globalThis=context;
  vm.runInContext(readFileSync('extension/sidetab.js','utf8'),context);
  return {listeners,sent,built,push:(m,reply=()=>{})=>push(m,{},reply),fire:type=>listeners.filter(l=>l.type===type).forEach(l=>l.fn({}))};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
test('책갈피 스크립트: 열 때 한 번만 묻고, 꺼져 있으면 크기가 바뀌어도 다시 묻지 않는다 · 켜졌다는 알림을 받으면 그린다',async()=>{
  const env=sideTabEnv();
  await tick();
  assert.deepEqual(env.sent.map(m=>m.type),['side-tab']);
  env.fire('resize');env.fire('visibilitychange');await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(env.sent.length,1,'꺼져 있으면 서비스 워커를 다시 깨우지 않는다');
  assert.equal(env.built.length,0,'꺼져 있으면 아무것도 그리지 않는다');
  assert.equal(env.listeners.filter(l=>['wheel','touchstart','touchmove','scroll'].includes(l.type)).length,0,'스크롤을 막거나 느리게 하는 듣는 쪽이 없다');
  let answer;env.push({type:'side-tab-ping'},value=>{answer=value;});
  assert.equal(answer,false,'꺼져 있으면 ‘책갈피가 뜰 수 없다’ 고 답한다');
  env.push({type:'side-tab',on:true,show:true,spot:.3});
  assert.ok(env.built.includes('button'),'켜졌다는 알림을 받으면 책갈피를 그린다');
  env.push({type:'side-tab-ping'},value=>{answer=value;});
  assert.equal(answer,true);
});
test('책갈피 스크립트: 숨으라는 알림에는 화면에서 사라진 뒤에 답한다 · 페이지 안 틀(iframe)에서는 아무것도 하지 않는다',async()=>{
  const env=sideTabEnv({on:true});await tick();
  let replied=false;
  const keep=env.push({type:'side-tab',on:true,show:false,spot:.5},()=>{replied=true;});
  assert.equal(keep,true,'답을 미룬다');
  assert.equal(replied,false);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(replied,true);
  const framed=sideTabEnv({top:false,on:true});await tick();
  assert.equal(framed.sent.length,0);assert.equal(framed.listeners.length,0);
});
