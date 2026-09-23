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
