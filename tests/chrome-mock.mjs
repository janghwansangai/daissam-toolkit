export function createChrome(seed={}) {
  const event=()=>{const listeners=[];return {listeners,addListener:f=>listeners.push(f),removeListener:f=>{const i=listeners.indexOf(f);if(i>=0)listeners.splice(i,1);},emit:(...a)=>listeners.forEach(f=>f(...a))};};
  const changed=event(),messages=event(),start=event(),alarmsEvent=event(),idleEvent=event(),commands=event();
  const data={local:structuredClone(seed.local||{}),sync:structuredClone(seed.sync||{}),session:structuredClone(seed.session||{})};
  const area=name=>({
    get:async keys=>structuredClone(keys==null?data[name]:Object.fromEntries((Array.isArray(keys)?keys:typeof keys==='string'?[keys]:Object.keys(keys)).filter(k=>k in data[name]).map(k=>[k,data[name][k]]))),
    set:async values=>{const changes={};for(const [k,v] of Object.entries(values)){changes[k]={oldValue:structuredClone(data[name][k]),newValue:structuredClone(v)};data[name][k]=structuredClone(v);}changed.emit(changes,name);},
    remove:async keys=>{const changes={};for(const k of Array.isArray(keys)?keys:[keys]){changes[k]={oldValue:data[name][k]};delete data[name][k];}changed.emit(changes,name);},
    setAccessLevel:async()=>{}
  });
  const rules=new Map();const tabMessages=[];const alarmNames=new Map();const nativePorts=[];const native={available:true,presenter:{presenting:false,focus:false}};const opened=[];const uninstallURL={value:null};const nativeMessages=[];const notified=[];const offscreen={open:false};
  const sender={url:'chrome-extension://test/panel.html'};
  const send=(message,source=sender)=>new Promise((resolve,reject)=>{
    let handled=false;
    for(const listener of messages.listeners){try{if(listener(message,source,resolve)===true)handled=true;}catch(e){reject(e);}}
    if(!handled)resolve(undefined);
  });
  const chrome={storage:{local:area('local'),sync:area('sync'),session:area('session'),onChanged:changed},
    scripting:{executeScript:async({func,args=[]})=>[{result:func?{now:"곡 제목 — 가수",asked:args}:undefined}]},
    runtime:{id:'test',onMessage:messages,onStartup:start,getURL:p=>'chrome-extension://test/'+p,sendMessage:send,
      getManifest:()=>({version:'0.36.0'}),setUninstallURL:async url=>{uninstallURL.value=url;},
      sendNativeMessage:async(name,message)=>{
        if(!native.available)throw new Error('Specified native messaging host not found.');
        nativeMessages.push({name,message});return {kind:'presenter',ok:true,launched:false,...native.presenter};
      },
      connectNative:name=>{
        if(!native.available)throw new Error('Specified native messaging host not found.');
        const incoming=event(),closed=event();
        const port={name,sent:[],onMessage:incoming,onDisconnect:closed,
          postMessage:message=>port.sent.push(message),disconnect:()=>closed.emit()};
        nativePorts.push(port);return port;
      }},
    alarms:{create:async(n,a)=>alarmNames.set(n,a),clear:async n=>alarmNames.delete(n),
      getAll:async()=>[...alarmNames.entries()].map(([name,info])=>({name,...(info||{})})),onAlarm:alarmsEvent},
    offscreen:{createDocument:async({url})=>{offscreen.open=true;offscreen.url=url;},closeDocument:async()=>{offscreen.open=false;}},
    notifications:{create:async info=>{notified.push(info);return 'n'+notified.length;},clear:async()=>true,onClicked:{addListener(){}}},
    idle:{setDetectionInterval:()=>{},onStateChanged:idleEvent},commands:{onCommand:commands,getAll:async()=>[{name:'lock-profile',shortcut:'Ctrl+Shift+L',description:'프로필 잠금'}]},
    declarativeNetRequest:{updateDynamicRules:async({removeRuleIds=[],addRules=[]})=>{removeRuleIds.forEach(id=>rules.delete(id));addRules.forEach(r=>rules.set(r.id,r));}},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    sidePanel:{setPanelBehavior:async()=>{}},
    tabs:{zoom:new Map(),getZoom:async id=>chrome.tabs.zoom.get(id)??1,setZoom:async(id,value)=>{chrome.tabs.zoom.set(id,value);},query:async()=>[{id:1,url:'https://example.test/article?id=7',title:'테스트 문서'}],sendMessage:async(id,m)=>tabMessages.push(m),create:async info=>{opened.push(info);return {id:opened.length+1};},getCurrent:async()=>({id:1}),remove:async()=>{}},
    windows:{create:async()=>{},getCurrent:async()=>({id:1}),remove:async()=>{},get:async id=>({id,type:'normal'}),update:async()=>{},WINDOW_ID_NONE:-1,onFocusChanged:{addListener(){}}}
  };
  return {chrome,data,rules,tabMessages,send,events:{start,alarmsEvent,idleEvent},alarmNames,nativePorts,native,opened,uninstallURL,nativeMessages,notified,offscreen,alarmNames2:alarmNames};
}
