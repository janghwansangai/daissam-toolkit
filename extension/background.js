import {seal,unseal,assertPin} from './lib/crypto.js';
import {validateNote,checkQuota,noteKey,noteGroups,validateNoteId,validateTitle,autoTitle,LEGACY_NOTE,NOTE_BYTES} from './lib/data.js';
import {cleanBackup,mergedNotes,planNotes,planMarks,mergeImages,IMAGES_PER_NOTE,IMAGES_TOTAL} from './lib/backup.js';
import {captureAndDeliver,targetTab,pickTabArea} from './capture-core.js';
const RULE=701;
const HOST='app.browsersheriff.presenter';
// 사용자가 연 유튜브 뮤직 탭에서 실행된다. 페이지가 이미 보여 주는 버튼을 누르고 곡 제목을 읽는다.
function controlMusic(action,text){
  const click=selector=>{const button=document.querySelector(selector);if(button){button.click();return true;}return false;};
  if(action==='toggle')click('#play-pause-button');
  if(action==='next')click('.next-button');
  if(action==='prev')click('.previous-button');
  if(action==='search'&&text){
    const box=document.querySelector('ytmusic-search-box input, input#input');
    if(box){
      box.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(box,text);
      box.dispatchEvent(new Event('input',{bubbles:true}));
      box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
    }
  }
  const title=document.querySelector('.ytmusic-player-bar .title')?.textContent?.trim();
  const artist=document.querySelector('.ytmusic-player-bar .byline')?.textContent?.trim();
  return {now:title?(artist?title+' — '+artist.split('•')[0].trim():title):'재생 중인 곡 없음'};
}
let clipPort=null;
let serial=Promise.resolve();
function exclusive(fn) { const p=serial.then(fn); serial=p.catch(()=>{}); return p; }
async function profile() { return (await chrome.storage.local.get('profile')).profile; }
async function startLocked() {
  const {startLocked=true}=await chrome.storage.local.get('startLocked');
  return startLocked!==false;
}
// 자리를 비웠을 때 잠그는 것과 브라우저를 다시 켰을 때 잠그는 것은 뜻이 다르다.
// 부팅 잠금은 남기고 자동 잠금만 끄고 싶다는 요구가 있어 따로 뒀다. 기본은 켜짐.
async function lockOnAway() {
  const {lockOnAway=true}=await chrome.storage.local.get('lockOnAway');
  return lockOnAway!==false;
}
async function wheelZoom() {
  const {wheelZoom=true}=await chrome.storage.local.get('wheelZoom');
  return wheelZoom!==false;
}
// Chrome 이 Command +/− 로 밟는 배율 그대로. 휠로도 같은 자리에 서야 한다.
const ZOOM_STEPS=[0.25,0.33,0.5,0.67,0.75,0.8,0.9,1,1.1,1.25,1.5,1.75,2,2.5,3,4,5];
async function authorizedNow() {
  const {authorized}=await chrome.storage.session.get('authorized');
  if(authorized!==undefined)return !!authorized;
  if(await startLocked())return false;
  const {keptAuthorized=false}=await chrome.storage.local.get('keptAuthorized');
  return !!keptAuthorized;
}
async function allow(value) {
  await chrome.storage.session.set({authorized:value});
  await chrome.storage.local.set({keptAuthorized:value});
}
async function state() {
  const p=await profile();
  const authorized=await authorizedNow();
  const {stateRevision=0}=await chrome.storage.local.get('stateRevision');
  return {revision:stateRevision,configured:!!p,locked:!!p&&!authorized,name:p?.name||'내 프로필',idleMinutes:p?.idleMinutes||0,startLocked:await startLocked(),lockOnAway:await lockOnAway(),wheelZoom:await wheelZoom()};
}
async function enforce() {
  const {stateRevision=0}=await chrome.storage.local.get('stateRevision');
  await chrome.storage.local.set({stateRevision:stateRevision+1});
  const s=await state();
  // Chrome's own block screen cannot carry our wording, so send the navigation to the extension page.
  await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[RULE],addRules:s.locked?[{
    id:RULE,priority:1,
    action:{type:'redirect',redirect:{regexSubstitution:chrome.runtime.getURL('locked.html')+'#\\0'}},
    condition:{regexFilter:'^https?://.*',resourceTypes:['main_frame']}
  }]:[]});
  if(s.locked)await clipDisconnect(); else await clipConnect();
  await chrome.action.setBadgeText({text:s.locked?'잠금':''});
  await chrome.action.setBadgeBackgroundColor({color:'#dc6453'});
  const tabs=await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(t=>chrome.tabs.sendMessage(t.id,{type:'lock-state',state:s})));
  chrome.runtime.sendMessage({type:'state-changed',state:s}).catch(()=>{});
  return s;
}
async function lock() { await allow(false); return enforce(); }
// 지금 프로필의 PIN 이 맞는지 본다. 틀리면 횟수를 세고, 다섯 번 틀리면 30초 쉬게 한다.
// 잠금 해제와 ‘백업으로 잠금 PIN 바꾸기’가 같은 횟수를 나눠 쓴다 — 어느 쪽으로든 PIN 을 알아내려는 시도를 막는다.
async function checkPin(pin) {
  const {attempts={count:0,until:0}}=await chrome.storage.local.get('attempts');
  if(Date.now()<attempts.until)throw new Error('잠시 후 다시 시도하세요.');
  try {if((await unseal(pin,(await profile()).proof)).kind!=='profile')throw Error();}
  catch {const count=attempts.count+1;await chrome.storage.local.set({attempts:{count,until:count>=5?Date.now()+30000:0}});throw new Error('PIN이 맞지 않습니다.');}
  await chrome.storage.local.remove('attempts');
}
// 확장을 지울 때 Google 로그아웃 페이지를 여는 기능은 뺐다. setUninstallURL 이 여는 주소로는
// Google 계정이 실제로 로그아웃되지 않는다(로그아웃은 단순 GET 으로 되지 않는다). 되지도 않는
// 기능을 켜 두면 지켜 주는 줄 알고 믿게 되므로, 남겨 두는 편이 더 나쁘다. 이전에 켜 두었던
// 주소는 아래에서 한 번 비운다.
async function initialize() {
  // 모든 명령이 ready(= 이 함수) 를 기다린다. 여기서 한 번이라도 예외가 나면 확장이 통째로 멈춘다 — 실제로 Chrome 127 에서
  // setAccessLevel 이 없어 사이드바가 오류 글만 보이고 아무것도 못 했다(최소 지원이 120 인데 130 이상이 필요했다).
  // 그래서 없어도 되는 단계는 실패해도 건너뛰고(경고만 남긴다), 꼭 필요한 것(기기 번호)만 엄격하게 한다.
  const optional=async job=>{ try{ await job(); }catch(error){ console.warn('시작 단계를 건너뜁니다:',error?.message||error); } };
  // Chrome decides which side the panel sits on; the extension cannot force the right edge.
  await optional(()=>chrome.sidePanel?.setPanelBehavior?.({openPanelOnActionClick:true}));
  // 예전 버전이 등록해 둔 제거 주소를 지운다.
  await optional(()=>chrome.runtime.setUninstallURL(''));
  await optional(()=>chrome.storage.local.remove(['logoutOnRemove','safeUntil']));
  await optional(scheduleBells);
  // 저장소를 확장 자신(신뢰된 곳)만 읽게 좁힌다. local·sync 에 이 함수가 생긴 것은 비교적 최근 Chrome 부터라, 없으면 건너뛴다.
  for(const area of [chrome.storage.local,chrome.storage.sync])await optional(()=>area.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'}));
  if (!(await chrome.storage.local.get('device')).device) await chrome.storage.local.set({device:crypto.randomUUID()});
  await optional(migrateNotes);
  const p=await profile();
  if(p?.idleMinutes) chrome.idle.setDetectionInterval(p.idleMinutes*60);
  await optional(settleFlushAlarm);
  // 이미 열려 있던 탭에 잠금 화면(guard.js)을 넣는 일은 확장이 켜진 뒤 한 번이면 된다. 새로 여는 페이지에는
  // manifest 의 content_scripts 가 알아서 넣는다. 서비스 워커는 30초 놀면 꺼졌다가 알람(1분)마다 다시 켜지는데,
  // 그때마다 모든 탭에 다시 넣었더니 잠겨 있는 동안 1분 안팎마다 잠금 화면이 지워졌다 다시 그려져 깜박였다(사용자 보고).
  // storage.session 은 확장을 다시 불러오거나 업데이트·끔→켬 할 때, 그리고 브라우저를 다시 켤 때 비워진다 —
  // 곧 ‘다시 넣어야 하는 때’와 같다. 그때의 교체도 guard.js 가 끊김 없이 한다.
  await optional(async()=>{
    const {guardsInjected}=await chrome.storage.session.get('guardsInjected');
    if(guardsInjected)return;
    const existing=await chrome.tabs.query({url:['http://*/*','https://*/*']});
    await Promise.allSettled(existing.map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['guard.js']})));
    await chrome.storage.session.set({guardsInjected:true});
  });
  await enforce();
}
const ready=initialize();
// v0.1 kept one note per device under note_<device>; move this device's copy into the multi note layout.
async function migrateNotes() {
  const {device,draftNote,pendingNote,draftNotes={},pendingNotes={}}=await chrome.storage.local.get(['device','draftNote','pendingNote','draftNotes','pendingNotes']);
  const upgrade=value=>({v:2,id:LEGACY_NOTE,title:'빠른 메모',text:value.text,time:value.time||Date.now(),revision:value.revision||crypto.randomUUID(),device:value.device||device});
  if(draftNote?.text!==undefined||pendingNote?.text!==undefined){
    const next={draftNotes:{...draftNotes},pendingNotes:{...pendingNotes}};
    if(draftNote?.text!==undefined&&!next.draftNotes[LEGACY_NOTE])next.draftNotes[LEGACY_NOTE]=upgrade(draftNote);
    if(pendingNote?.text!==undefined&&!next.pendingNotes[LEGACY_NOTE])next.pendingNotes[LEGACY_NOTE]=upgrade(pendingNote);
    await chrome.storage.local.set(next);
    await chrome.storage.local.remove(['draftNote','pendingNote']);
  }
  const legacyKey='note_'+device;
  const stored=(await chrome.storage.sync.get(legacyKey))[legacyKey];
  if(stored?.v!==1||typeof stored.text!=='string')return;
  const value=upgrade(stored);
  try {
    const all=await chrome.storage.sync.get(null);
    checkQuota(all,noteKey(device,LEGACY_NOTE),value);
    await chrome.storage.sync.set({[noteKey(device,LEGACY_NOTE)]:value});
    await chrome.storage.sync.remove(legacyKey);
  } catch(error) { await chrome.storage.local.set({noteSyncError:error.message}); }
}
async function storeNote(rawId,rawTitle,text,pinned,tag) {
  if(typeof text!=='string' || text.length>200000)throw Error('메모가 너무 큽니다. 텍스트 파일로 내보내세요.');
  const id=validateNoteId(rawId);const title=validateTitle(rawTitle);
  const {device,draftNotes={},pendingNotes={}}=await chrome.storage.local.get(['device','draftNotes','pendingNotes']);
  const known=pendingNotes[id]||draftNotes[id];
  const created=Number(known?.created)||Date.now();
  const keep=pinned===undefined?known?.pinned===true:!!pinned;
  const value={v:2,id,title,text,time:Date.now(),created,pinned:keep,revision:crypto.randomUUID(),device};
  await chrome.storage.local.set({draftNotes:{...draftNotes,[id]:value}});
  try {validateNote(text);}
  catch(error){const next={...pendingNotes};delete next[id];await chrome.storage.local.set({pendingNotes:next,noteSyncError:error.message});throw error;}
  // 쓴 창을 함께 남긴다. 사이드바가 제 글을 남의 글로 착각해 덮어쓰지 않게 하는 표다.
  const writer=typeof tag==='string'?tag.slice(0,32):'';
  await chrome.storage.local.set({pendingNotes:{...pendingNotes,[id]:value},lastNoteWriter:writer,noteSyncError:null});
  await chrome.alarms.create('flush-notes',{delayInMinutes:0.5,periodInMinutes:1});
  return {id,revision:value.revision};
}

// 백업 파일의 내용을 이 컴퓨터에 합쳐 넣는다. 더하기만 하고 지우지 않는다(규칙은 lib/backup.js 에 있다).
// 파일은 남이 만든 것일 수 있으므로 화면이 이미 걸렀어도 여기서 다시 검사한다. 잠금 PIN 을 바꾸는 일은 가장
// 먼저 현재 PIN 을 확인하고, 틀리면 아무것도 바꾸지 않는다. 부분마다 따로 해서 한 부분이 실패해도 나머지는 넣는다.
async function restoreBackup(m) {
  const before=await state();
  if(before.locked)throw Error('먼저 프로필 잠금을 해제하세요.');
  const data=cleanBackup(m.payload);
  const want={};for(const name of ['notes','bookmarks','settings','tools','lock'])want[name]=!!m.parts?.[name];
  const withLock=want.lock&&!!data.lock;
  if(!before.configured&&!withLock)throw Error('이 컴퓨터에는 아직 프로필이 없습니다. 잠금 PIN 이 든 백업을 고르거나, 먼저 PIN 을 만들어 주세요.');
  if(withLock&&before.configured)await checkPin(m.pin);
  const done={},problems=[];
  const part=async(name,job)=>{try{done[name]=await job();}catch(error){problems.push(name+': '+error.message);}};
  const settings=want.settings?data.settings:null;
  if(withLock)await part('lock',async()=>{
    const p=await profile();
    await chrome.storage.local.set({profile:{name:String(settings?.name||p?.name||'내 프로필').slice(0,40),proof:data.lock.proof,idleMinutes:settings?.idleMinutes??p?.idleMinutes??0}});
    if(!before.configured)await allow(true);
    return true;
  });
  if(settings)await part('settings',async()=>{
    const current=await chrome.storage.local.get(['captureOptions','recordOptions','profile']);
    const next={};
    for(const key of ['startLocked','lockOnAway','wheelZoom','uiFont','uiSize','uiTrack','presentKnobs'])if(settings[key]!==undefined)next[key]=settings[key];
    // 캡처·녹화 옵션은 덮어쓰지 않고 합친다. 이 컴퓨터의 카메라·마이크 번호가 그대로 남는다.
    if(settings.captureOptions)next.captureOptions={...(current.captureOptions||{}),...settings.captureOptions};
    if(settings.recordOptions)next.recordOptions={...(current.recordOptions||{}),...settings.recordOptions};
    if(current.profile&&!withLock)next.profile={...current.profile,name:settings.name||current.profile.name,idleMinutes:settings.idleMinutes??current.profile.idleMinutes};
    await chrome.storage.local.set(next);
    const minutes=(next.profile||current.profile)?.idleMinutes;
    if(minutes)chrome.idle.setDetectionInterval(minutes*60);
    if(data.hotkeys)await chrome.storage.sync.set({hotkeys:data.hotkeys});
    return true;
  });
  if(want.tools&&data.tools)await part('tools',async()=>{
    await chrome.storage.local.set(data.tools);
    await scheduleBells();
    return true;
  });
  if(want.notes&&data.notes.length)await part('notes',async()=>{
    const [all,local]=await Promise.all([chrome.storage.sync.get(null),chrome.storage.local.get(['device','draftNotes','pendingNotes','noteImages'])]);
    const plan=planNotes(noteGroups(mergedNotes(all,local)),data.notes);
    const now=Date.now(),drafts={...(local.draftNotes||{})},pending={...(local.pendingNotes||{})};
    let localOnly=0;
    for(const note of plan.add){
      const value={v:2,id:note.id,title:note.title,text:note.text,time:note.time||now,created:note.created||note.time||now,pinned:note.pinned,revision:crypto.randomUUID(),device:local.device};
      drafts[note.id]=value;
      // 5,500바이트를 넘는 글은 동기화되지 않고 이 컴퓨터에만 남는다(사이드바에서 쓸 때와 같다).
      if(new TextEncoder().encode(note.text).length<=NOTE_BYTES)pending[note.id]=value; else localOnly++;
    }
    await chrome.storage.local.set({draftNotes:drafts,pendingNotes:pending,noteImages:mergeImages(local.noteImages||{},data.images,plan.target)});
    await chrome.alarms.create('flush-notes',{delayInMinutes:0.5,periodInMinutes:1});
    await flushNotes();
    // Chrome 동기화는 분당 쓰기 횟수가 정해져 있어 많이 넣으면 일부가 기다린다. 1분마다 다시 올리므로 곧 올라간다.
    const waiting=Object.keys((await chrome.storage.local.get('pendingNotes')).pendingNotes||{}).length;
    return {added:plan.add.length,same:plan.same,copies:plan.copies,revived:plan.revived,localOnly,waiting};
  });
  if(want.bookmarks&&(data.bookmarks.length||Object.keys(data.vault).length))await part('bookmarks',async()=>{
    const {device}=await chrome.storage.local.get('device');
    const all=await chrome.storage.sync.get(null);
    const plan=planMarks(all,device,data.bookmarks);
    if(plan.value)await chrome.storage.sync.set({[plan.key]:plan.value});
    // 예전 방식(PIN 으로 잠근) 보관함이 남아 있었다면 그대로 옮긴다. 사이드바가 PIN 을 물어 북마크로 바꿔 준다.
    let vault=0;
    for(const [key,blob] of Object.entries(data.vault)){
      if(key in all)continue;
      try{checkQuota(all,key,blob);await chrome.storage.sync.set({[key]:blob});all[key]=blob;vault++;}catch{}
    }
    return {added:plan.added,links:plan.links,folders:plan.folders,same:plan.same,left:plan.left,vault};
  });
  // 이름·잠금 옵션이 바뀌었을 수 있다. 상태를 한 번 올려 열려 있는 모든 창이 새 값을 읽게 한다.
  const next=(withLock||settings)?await enforce():await state();
  return {done,problems,skipped:data.skipped,state:next};
}
// The helper app watches the clipboard only while this port is open, so the toggle is the whole switch.
async function clipStatus() {
  const {clipboardImport=false,clipError=''}=await chrome.storage.local.get(['clipboardImport','clipError']);
  return {on:!!clipboardImport,connected:!!clipPort,error:clipError};
}
async function clipDisconnect() {
  if(!clipPort)return;
  const port=clipPort;clipPort=null;
  try{port.postMessage({type:'stop'});port.disconnect();}catch{}
}
async function clipConnect() {
  if(clipPort)return;
  const s=await state();
  const {clipboardImport}=await chrome.storage.local.get('clipboardImport');
  if(!clipboardImport||s.locked||!s.configured)return;
  let port;
  try { port=chrome.runtime.connectNative(HOST); }
  catch { await chrome.storage.local.set({clipboardImport:false,clipError:'발표 도우미 앱에서 클립보드 도우미를 등록한 뒤 다시 켜 주세요.'}); return; }
  clipPort=port;
  port.onDisconnect.addListener(()=>{
    const reason=chrome.runtime.lastError?.message||'';
    if(clipPort===port)clipPort=null;
    chrome.storage.local.set({clipboardImport:false,clipError:'도우미 연결이 끊어졌습니다. '+reason});
  });
  port.onMessage.addListener(message=>exclusive(()=>clipReceive(message)));
  port.postMessage({type:'start'});
}
async function clipReceive(message) {
  if(!message||typeof message!=='object')return;
  if(message.kind==='error'){await chrome.storage.local.set({clipError:String(message.message||'')});return;}
  if(['ready','state','copied'].includes(message.kind)){await chrome.storage.local.set({clipError:''});return;}
  if((await state()).locked){await clipDisconnect();return;}
  const {noteImages={}}=await chrome.storage.local.get('noteImages');
  if(message.kind==='text'){
    const text=String(message.text||'');
    if(!text)return;
    try { validateNote(text); }
    catch { await chrome.storage.local.set({clipError:'복사한 내용이 한 메모에 담기에 너무 깁니다.'}); return; }
    const fresh=crypto.randomUUID();
    await storeNote(fresh,autoTitle(),text);
    await chrome.storage.local.set({lastImportId:fresh});
    return;
  }
  if(message.kind==='image'){
    if(typeof message.file!=='string'||typeof message.thumb!=='string')return;
    const id=crypto.randomUUID();
    await storeNote(id,autoTitle(),'');
    const shot={id:crypto.randomUUID(),file:message.file,name:String(message.name||'캡처.png'),
      thumb:message.thumb,width:Number(message.width)||0,height:Number(message.height)||0,time:Date.now()};
    const next={...noteImages,[id]:[shot,...(noteImages[id]||[])].slice(0,IMAGES_PER_NOTE)};
    // Thumbnails live in local storage, so keep a hard ceiling across every note.
    let total=Object.values(next).reduce((sum,list)=>sum+list.length,0);
    while(total>IMAGES_TOTAL){
      let oldestNote=null,oldestTime=Infinity;
      for(const [note,list] of Object.entries(next)){const last=list[list.length-1];if(last&&last.time<oldestTime){oldestTime=last.time;oldestNote=note;}}
      if(!oldestNote)break;
      next[oldestNote]=next[oldestNote].slice(0,-1);total--;
    }
    await chrome.storage.local.set({noteImages:next,clipError:'',lastImportId:id});
  }
}
// 서비스 워커에는 오디오가 없다. 숨은 문서를 잠깐 띄워 소리를 낸다.
async function playTone(kind) {
  const saved=await chrome.storage.local.get(['toneAlarm','volumeAlarm','toneBell','volumeBell']);
  const bell=kind==='bell';
  const tone=bell?(saved.toneBell||'school'):(saved.toneAlarm||'chime');
  const volume=bell?(saved.volumeBell??70):(saved.volumeAlarm??60);
  const url=`offscreen.html?tone=${encodeURIComponent(tone)}&volume=${volume}&repeat=${bell?2:1}&n=${Date.now()}`;
  // 값을 주소에 실어 새로 띄운다. 문서가 준비되기 전에 메시지를 보내면 소리가 나지 않는다.
  try { await chrome.offscreen.closeDocument(); } catch {}
  try { await chrome.offscreen.createDocument({url,reasons:['AUDIO_PLAYBACK'],justification:'타이머와 수업 시보 알림음'}); }
  catch(error) { await chrome.storage.local.set({soundError:String(error?.message||error)}); return false; }
  await chrome.storage.local.set({soundError:''});
  return true;
}
async function announce(title,body,kind) {
  try { await chrome.notifications.create({type:'basic',iconUrl:'icons/128.png',title,message:body,priority:2}); } catch {}
  await playTone(kind);
}
async function scheduleBells() {
  const alarms=await chrome.alarms.getAll();
  for(const alarm of alarms)if(alarm.name.startsWith('bell-'))await chrome.alarms.clear(alarm.name);
  const {bellTimes=[],bellOn=false}=await chrome.storage.local.get(['bellTimes','bellOn']);
  if(!bellOn)return;
  bellTimes.forEach((time,index)=>{
    const [hour,minute]=time.split(':').map(Number);
    const when=new Date();
    when.setHours(hour,minute,0,0);
    if(when.getTime()<=Date.now())when.setDate(when.getDate()+1);
    chrome.alarms.create('bell-'+index,{when:when.getTime(),periodInMinutes:1440});
  });
}
// 동기화를 기다리는 메모가 있을 때만 1분 알람을 둔다. 늘 켜 두었더니 보낼 것이 없어도 확장이 1분마다 깨어났다
// (서비스 워커 시작 + 모든 탭에 상태 전달). 실측: 서비스 워커가 절반 넘게 켜져 있었다.
// 알람이 있어야 하는데 없으면 만들고, 없어도 되는데 있으면(예전 버전이 만든 것 포함) 지운다.
async function settleFlushAlarm() {
  const waiting=async()=>Object.keys((await chrome.storage.local.get('pendingNotes')).pendingNotes||{}).length>0;
  const alarm=await chrome.alarms.get('flush-notes');
  if(await waiting()){
    if(!alarm)await chrome.alarms.create('flush-notes',{delayInMinutes:0.5,periodInMinutes:1});
    return;
  }
  if(!alarm)return;
  await chrome.alarms.clear('flush-notes');
  // 지우는 사이에 메모가 새로 쌓였을 수 있다. 한 번 더 보고, 쌓였으면 다시 만든다.
  if(await waiting())await chrome.alarms.create('flush-notes',{delayInMinutes:0.5,periodInMinutes:1});
}
async function flushNotes() {
  const {pendingNotes={},device}=await chrome.storage.local.get(['pendingNotes','device']);
  const ids=Object.keys(pendingNotes);
  if(!ids.length){await settleFlushAlarm();return;}
  let failure=null;
  for(const id of ids){
    const value=pendingNotes[id];
    const key=noteKey(value.device||device,id);
    try {
      const all=await chrome.storage.sync.get(null);
      // 캡처는 그림만 있고 글은 비어 있는 메모를 만든다. 그림은 이 기기에만 두므로 다른
      // 기기에는 빈 메모만 건너갔다. 한 번도 보낸 적 없는 빈 메모는 보내지 않고 이 기기에만
      // 둔다. 이미 보낸 메모를 비운 것과 지움 표시는 그대로 보낸다.
      if(!value.deleted&&!String(value.text||'').trim()&&!(key in all)){
        const latest=(await chrome.storage.local.get('pendingNotes')).pendingNotes||{};
        if(latest[id]?.revision===value.revision){const next={...latest};delete next[id];await chrome.storage.local.set({pendingNotes:next});}
        continue;
      }
      checkQuota(all,key,value);
      await chrome.storage.sync.set({[key]:value});
      const latest=(await chrome.storage.local.get('pendingNotes')).pendingNotes||{};
      if(latest[id]?.revision===value.revision){const next={...latest};delete next[id];await chrome.storage.local.set({pendingNotes:next});}
    } catch(error) { failure=error.message; }
  }
  await chrome.storage.local.set({noteSyncError:failure});
  // 다 보냈으면 알람을 끄고, 못 보낸 것이 남았으면 그대로 두어 1분마다 다시 시도한다.
  await settleFlushAlarm();
}
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='flush-notes') exclusive(async()=>{await ready;await flushNotes();});});
chrome.alarms.onAlarm.addListener(a=>{
  if(a.name==='utility-timer')exclusive(async()=>{await ready;await chrome.storage.local.set({timerEndsAt:0});await announce('타이머','설정한 시간이 끝났습니다.','alarm');});
  if(a.name.startsWith('bell-'))exclusive(async()=>{
    await ready;
    await announce('수업 시보',new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' 입니다.','bell');
    // 시보는 24시간 간격으로 예약되어 있어, 서머타임이 있는 곳이나 컴퓨터를 며칠씩 켜 둘 때 시각에서 조금씩 밀린다.
    // 울릴 때마다 ‘다음 시각’ 을 벽시계 기준으로 다시 맞춘다(예전에는 서비스 워커가 1분마다 깨며 저절로 맞췄다).
    try{ await scheduleBells(); }catch{}
  });
});
chrome.runtime.onStartup.addListener(()=>exclusive(async()=>{await ready;if(await startLocked())await lock();}));
chrome.commands.onCommand.addListener(c=>{
  if(c==='lock-profile'){exclusive(async()=>{await ready;await lock();});return;}
  // 캡처 단축키. 사이드바를 열지 않아도 된다. 결과는 알림으로 알린다.
  const mode={'capture-visible':'visible','capture-area':'area','capture-full':'full'}[c];
  if(mode)quickCapture(mode).catch(()=>{});
});
// 잠긴 프로필에서는 캡처하지 않는다(잠금 화면만 찍히고, 남의 화면을 가져가는 길이 된다).
async function capturable(){ await ready; const s=await state(); if(s.locked||!s.configured)throw new Error('먼저 프로필 잠금을 해제하세요.'); }
function captureNotice(result){
  if(result.cancelled)return '';
  const parts=[];
  if(result.after==='editor'||result.after==='ocr')parts.push(result.fallback?('편집기로 열었습니다 — '+result.fallback):'편집기로 열었습니다.');
  else{
    if(result.path)parts.push('바탕화면 ‘캡처이미지’ 폴더에 저장했습니다.');
    if(result.copied)parts.push('클립보드에 복사했습니다 — 붙여넣을 곳에서 ⌘V / Ctrl+V.');
  }
  if(result.truncated)parts.push('페이지가 너무 길어 32,000px 까지만 담았습니다.');
  return parts.join(' ');
}
// 녹화를 못 하는 까닭을 사람 말로 바꾼다. Chrome 이 보호하는 페이지가 가장 흔하다.
function recordWhy(error){
  if(String(error?.message)!=='CHROME_PAGE')return String(error?.message||error);
  return '이 페이지는 Chrome 이 보호해서 ‘이 탭’ 이나 ‘선택 영역’ 으로 녹화할 수 없습니다'
        +'(새 탭·chrome:// 설정·확장 프로그램·웹 스토어). ‘전체 화면’ 으로 녹화하거나 일반 웹페이지로 옮겨 주세요.';
}
function tell(title,message){try{chrome.notifications.create('dais-capture-'+Date.now(),{type:'basic',iconUrl:'icons/128.png',title,message:String(message).slice(0,240)})?.catch?.(()=>{});}catch{}}
// 캡처 한 번. notify 면 결과를 알림으로 알린다(사이드바를 닫고 찍는 경우 알려 줄 곳이 없다).
// widen 이면 사이드바가 닫혀 페이지가 넓어질 때까지 기다렸다 찍는다.
// 사이드바를 닫는 두 가지 길을 다 쓴다. 사이드바 쪽은 스스로 window.close() 를 부르고,
// 여기서는 그 탭에서 사이드바를 잠깐 꺼 둔다. 둘 중 하나만 들어도 페이지가 제 너비로 돌아온다.
async function sidePanelAway(){
  const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true,windowType:'normal'});
  if(!tab)return {tab:null,back:async()=>false};
  try{ await chrome.sidePanel.setOptions({tabId:tab.id,enabled:false}); }
  catch{ return {tab,back:async()=>false}; }
  // 다시 켜 두지 않으면 그 탭에서 사이드바가 열리지 않는다. reopen 이면 열어 보기까지 한다.
  // sidePanel.open() 은 Chrome 이 '사용자가 누른 직후' 에만 허락해서 여기서는 막힐 수 있다.
  // 그래서 결과 안내는 페이지 위 알림과 알림창으로도 함께 알린다.
  return {tab, back:async reopen=>{
    try{ await chrome.sidePanel.setOptions({tabId:tab.id,enabled:true,path:'panel.html'}); }catch{ return false; }
    if(!reopen)return false;
    try{ await chrome.sidePanel.open({windowId:tab.windowId}); return true; }catch{ return false; }
  }};
}
// 페이지 위에 잠깐 떴다 사라지는 알림. 사이드바가 닫힌 채로 끝났을 때 결과를 알리는 길이다
// (맥·윈도우에서 Chrome 알림을 꺼 둔 사람도 볼 수 있어야 한다). 캡처가 끝난 뒤에만 띄운다.
async function toast(tabId,text){
  if(!tabId||!text)return;
  await chrome.scripting.executeScript({target:{tabId},func:words=>{
    document.getElementById('dais-toast')?.remove();
    const box=document.createElement('div');
    box.id='dais-toast';box.textContent=words;
    Object.assign(box.style,{position:'fixed',left:'50%',bottom:'26px',transform:'translateX(-50%)',zIndex:'2147483647',
      maxWidth:'min(560px,86vw)',padding:'11px 16px',borderRadius:'12px',background:'#173b36',color:'#f6f9e9',
      font:'500 13px/1.5 -apple-system,BlinkMacSystemFont,\'Apple SD Gothic Neo\',\'Segoe UI\',sans-serif',
      boxShadow:'0 10px 24px rgba(0,0,0,.28)',pointerEvents:'none',transition:'opacity .2s'});
    // 보이지 않는 탭에서는 requestAnimationFrame 이 돌지 않는다. 그걸로 나타나게 하면
    // 탭을 다시 열었을 때 투명한 채로 남아 아무것도 안 보인다. 처음부터 보이게 둔다.
    document.documentElement.append(box);
    setTimeout(()=>{box.style.opacity='0';setTimeout(()=>box.remove(),400);},3400);
  },args:[String(text).slice(0,240)]});
}
// 캡처가 끝난 뒤: 닫아 둔 사이드바를 되돌리고(열 수 있으면 열고) 결과를 알린다.
// Chrome 은 sidePanel.open() 을 '사용자가 누른 직후' 에만 허락한다. 캡처가 끝나는 순간은
// 그 직후가 아니라서 대개 막힌다 — 그래서 결과와 '다시 여는 법' 을 페이지 위에 띄워 준다.
async function captureDone(away,text,title,tabId){
  const opened=away?await away.back(true):false;
  if(text)await chrome.storage.local.set({lastCapture:{text,at:Date.now()}}).catch(()=>{});
  // 알림은 **찍은 그 탭** 위에 띄운다. 사이드바를 닫은 탭과 다를 수 있다.
  if(away&&!opened)await toast(tabId||away.tab?.id,text+' · 사이드바는 확장 아이콘을 눌러 다시 엽니다.').catch(()=>{});
  if(title&&text)tell(title,text);
  chrome.runtime.sendMessage({type:'capture-done',text}).catch(()=>{});
}
// 알림을 누르면 사이드바를 열어 본다. 알림 클릭을 '누름' 으로 쳐 주는 Chrome 에서는 이때 열린다.
chrome.notifications.onClicked.addListener(id=>{
  if(!String(id).startsWith('dais-capture-'))return;
  exclusive(async()=>{
    const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true,windowType:'normal'});
    if(tab)await chrome.sidePanel.open({windowId:tab.windowId}).catch(()=>{});
    chrome.notifications.clear(id);
  });
});
async function runCapture(mode,{after,notify,widen}={}){
  let away=null;
  try{
    await capturable();
    if(widen)away=await sidePanelAway();
    const result=await captureAndDeliver(mode,{...(after?{after}:{}),...(widen?{widen:true}:{})});
    const text=captureNotice(result);
    const done=away;away=null;
    await captureDone(done,text||'캡처를 그만두었습니다.',notify&&text?'다있쌤 캡처':'',result.tabId);
    return {...result,message:text};
  }catch(error){
    const done=away;away=null;
    await captureDone(done,String(error?.message||error),notify?'캡처하지 못했습니다':'');
    throw error;
  }finally{ if(away)await away.back(true); }
}
async function quickCapture(mode){ return runCapture(mode,{notify:true,widen:true}); }
// 발표 명령을 보내는 '오래 여는 통로'. sendNativeMessage 는 부를 때마다 도우미 프로세스를
// 새로 띄운다 — 윈도우에서는 한 번에 0.8초가 걸리고, 슬라이더를 끄는 0.7초 동안 프로세스가
// 13개까지 쌓여 합쳐 465MB 를 썼다(윈도우 세션 실측). 통로를 하나 열어 두면 프로세스도
// 하나다. 도우미는 받은 순서대로 한 건에 한 번 답하므로 순서대로 짝을 맞춘다.
let cmdPort=null,cmdWaiting=[],cmdIdle=0;
function cmdConnect(){
  if(cmdPort)return cmdPort;
  let port;
  try{ port=chrome.runtime.connectNative(HOST); }catch{ return null; }
  port.onMessage.addListener(message=>{ const waiter=cmdWaiting.shift(); if(waiter)waiter.ok(message); });
  port.onDisconnect.addListener(()=>{
    void chrome.runtime.lastError;   // 읽지 않으면 도우미가 없을 때마다 ‘Unchecked runtime.lastError’ 가 확장 오류 목록에 쌓인다
    if(cmdPort===port)cmdPort=null;
    const waiting=cmdWaiting; cmdWaiting=[];
    for(const one of waiting)one.no(new Error('발표 도우미와의 연결이 끊어졌습니다.'));
  });
  cmdPort=port;
  return port;
}
// 한동안 쓰지 않으면 통로를 닫는다(도우미 프로세스를 붙잡아 두지 않는다).
function cmdRest(){
  clearTimeout(cmdIdle);
  cmdIdle=setTimeout(()=>{ try{cmdPort?.disconnect();}catch{} cmdPort=null; },20000);
}
async function presenterSay(payload){
  const port=cmdConnect();
  if(!port)return chrome.runtime.sendNativeMessage(HOST,payload);
  return new Promise((ok,no)=>{
    const waiter={ok,no};
    cmdWaiting.push(waiter);
    // 답이 늦으면 통로를 접고 한 번짜리로 다시 해 본다(멈춰 있지 않게).
    const guard=setTimeout(()=>{
      const at=cmdWaiting.indexOf(waiter); if(at>=0)cmdWaiting.splice(at,1);
      try{cmdPort?.disconnect();}catch{} cmdPort=null;
      chrome.runtime.sendNativeMessage(HOST,payload).then(ok,no);
    },4000);
    waiter.ok=value=>{clearTimeout(guard);ok(value);};
    waiter.no=error=>{clearTimeout(guard);no(error);};
    try{ port.postMessage(payload); cmdRest(); }
    catch{ clearTimeout(guard); const at=cmdWaiting.indexOf(waiter); if(at>=0)cmdWaiting.splice(at,1);
           chrome.runtime.sendNativeMessage(HOST,payload).then(ok,no); }
  });
}

// 녹화 중 화면에 뜨는 ‘녹화 표시기’ 는 발표 도우미 앱이 그린다. 그 창은 화면 녹화에 담기지
// 않는다(맥 sharingType=none · 윈도우 WDA_EXCLUDEFROMCAPTURE). 표시기의 단추를 누르면
// 앱이 알려 주므로, 녹화가 도는 동안에만 오래 열어 두는 통로를 하나 잡는다.
// 녹화 창의 창 번호. 이 창이 닫히면(사용자가 ✕ 를 눌렀거나 크롬이 닫았거나) 표시기와
// 카메라 창을 반드시 내린다 — 예전에는 그대로 화면에 남았다(사용자 보고).
let recordWindow=0;
let badgePort=null;
function badgeConnect(){
  if(badgePort)return badgePort;
  let port;
  try{ port=chrome.runtime.connectNative(HOST); }catch{ return null; }
  port.onMessage.addListener(message=>{
    if(message?.kind==='recorder'&&message.button)chrome.runtime.sendMessage({type:'recorder-button',button:String(message.button)}).catch(()=>{});
  });
  port.onDisconnect.addListener(()=>{ void chrome.runtime.lastError; if(badgePort===port)badgePort=null; });
  badgePort=port;
  port.postMessage({type:'recorder-watch'});
  return port;
}
// 마지막으로 쓰던 '보통' 창을 기억한다. 도크 창(팝업)에서 캡처를 부르면 어느 탭을 찍을지
// 알 길이 없어 쓰는 값이다(예전에는 그 자리에서 '탭을 찾지 못했습니다' 로 끝났다).
chrome.windows.onFocusChanged.addListener(id=>{
  if(id===chrome.windows.WINDOW_ID_NONE)return;
  chrome.windows.get(id).then(one=>{
    if(one?.type==='normal')chrome.storage.session.set({lastNormalWindow:id}).catch(()=>{});
  }).catch(()=>{});
});
// 녹화 창이 사라지면 앱의 표시기·카메라 창도 함께 내린다.
chrome.windows.onRemoved.addListener(id=>{
  if(!recordWindow||id!==recordWindow)return;
  recordWindow=0;
  const port=badgeConnect();
  if(!port)return;
  try{ port.postMessage({type:'recorder',action:'hide'}); port.disconnect(); }catch{}
  badgePort=null;
});
chrome.idle.onStateChanged.addListener(s=>exclusive(async()=>{
  await ready;
  if(s==='active')return;
  // 화면 잠금·절전은 '자리를 비움' 설정과 따로 논다. 둘 다 끌 수 있어야 한다.
  if(s==='locked'){ if(await lockOnAway())await lock(); return; }
  if((await profile())?.idleMinutes)await lock();
}));
function trusted(sender) { return sender.url?.startsWith(chrome.runtime.getURL('')); }
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(!m?.type || ['state-changed','lock-state','play-tone'].includes(m.type))return;
  exclusive(async()=>{
    await ready;
    if(m.type==='state')return state();
    // 보낸 탭의 배율만 바꾼다. 다른 탭이나 다른 데이터는 건드리지 않는다.
    if(m.type==='page-zoom'){
      const tab=sender.tab?.id;
      if(tab===undefined || !(await wheelZoom()))return false;
      const now=await chrome.tabs.getZoom(tab);
      let at=ZOOM_STEPS.findIndex(step=>step>=now-0.001);
      if(at<0)at=ZOOM_STEPS.indexOf(1);
      at=Math.max(0,Math.min(ZOOM_STEPS.length-1,at+(m.step>0?1:-1)));
      await chrome.tabs.setZoom(tab,ZOOM_STEPS[at]);
      return ZOOM_STEPS[at];
    }
    if(m.type==='open-unlock') { if((await state()).locked)await chrome.windows.create({url:chrome.runtime.getURL('panel.html?unlock=1'),type:'popup',width:440,height:660});return true; }
    if(m.type==='close-guard-window' && sender.tab?.windowId!==undefined && (await state()).locked){await chrome.windows.remove(sender.tab.windowId);return true;}
    if(m.type==='guest-window'){
      if(!trusted(sender) && !(await state()).locked)throw new Error('잠금 상태에서만 사용할 수 있습니다.');
      try {
        const reply=await chrome.runtime.sendNativeMessage(HOST,{type:'guest'});
        if(reply?.ok)return {mode:'guest'};
        throw new Error(reply?.message||'게스트 창을 열지 못했습니다.');
      } catch {
        // 도우미가 없으면 확장만으로 가능한 시크릿 창으로 대신한다.
        await chrome.windows.create({incognito:true,url:'about:blank'});
        return {mode:'incognito'};
      }
    }
    if(!trusted(sender))throw new Error('확장 패널에서만 사용할 수 있습니다.');
    if(m.type==='setup'){
      if(await profile())throw new Error('이미 설정된 프로필입니다.');
      assertPin(m.pin);
      await chrome.storage.local.set({profile:{name:String(m.name||'내 프로필').slice(0,40),proof:await seal(m.pin,{kind:'profile'}),idleMinutes:0}});
      await allow(true);return enforce();
    }
    if(m.type==='unlock') { await checkPin(m.pin);await allow(true);return enforce(); }
    if(m.type==='clip-state')return clipStatus();
    if(m.type==='presenter-command'){
      // 한 번짜리 호출이라 도우미가 뜨고 명령을 넘긴 뒤 바로 끝난다.
      const payload={type:'presenter'};
      // 여기 적힌 이름만 앱까지 간다. 'keys'(사용자가 바꾼 단축키)를 빠뜨려서, 사이드바는
      // 제대로 보냈는데 앱은 늘 기본 조합만 듣고 있었다(v0.29.0). 새 값을 넣을 때 여기도 볼 것.
      for(const key of ['action','dim','blur','ring','ringSize','keys'])if(m[key]!==undefined)payload[key]=String(m[key]);
      let reply;
      try { reply=await presenterSay(payload); }
      catch { throw Error('발표 도우미에 연결하지 못했습니다. 앱을 설치하고 클립보드 도우미를 등록해 주세요.'); }
      // 도우미가 앱에 명령을 넘기지 못한 경우. 예전에는 이 답을 그냥 흘려보내 사이드바가
      // 아무 말도 하지 않았고, 사용자는 버튼이 죽은 것으로만 보였다.
      if(reply&&reply.ok===false)throw Error(String(reply.message||'발표 도우미 앱에 명령을 전달하지 못했습니다.'));
      return reply;
    }
    // 아래 둘은 잠금과 상관없이 받는다. 이미 돌고 있는 녹화의 표시기가 잠금 때문에
    // 사라지거나, 권한 안내 단추가 죽으면 안 된다. 확장 페이지에서만 부를 수 있는 것은 그대로다.
    // 맥에서 Chrome 에 화면 기록 권한을 주는 자리를 연다(도우미 앱이 연다).
    if(m.type==='screen-settings'){
      try{ await chrome.runtime.sendNativeMessage(HOST,{type:'screen-settings'}); return {opened:true}; }
      catch{ throw Error('발표 도우미 앱이 없어 열지 못했습니다. 시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 녹음에서 Google Chrome 을 켜 주세요.'); }
    }
    // 녹화 표시기(발표 도우미 앱이 그리는 작은 창)에 지금 상태를 보낸다.
    if(m.type==='recorder-badge'){
      const port=badgeConnect();
      if(!port)return {sent:false};
      // cameraName: 전체 화면 녹화에서 앱이 같은 카메라로 동그란 창을 띄우게 한다.
      try{ port.postMessage({type:'recorder',action:String(m.action||'update'),time:String(m.time||''),paused:m.paused?'1':'0',camera:m.camera?'1':'0',cameraView:m.cameraView?'1':'0',cameraName:String(m.cameraName||''),display:String(m.display||'')}); }
      catch{ badgePort=null; return {sent:false}; }
      if(m.action==='hide'){ try{port.disconnect();}catch{} badgePort=null; }
      return {sent:true};
    }
    if(m.type==='lock')return lock();
    // 잠금 상태 확인은 함수 안에서 한다. 처음 쓰는 컴퓨터(아직 프로필이 없음)에서도 백업으로 시작할 수 있어야 한다.
    if(m.type==='backup-restore')return restoreBackup(m);
    if(m.type==='close-window'){const w=await chrome.windows.getCurrent();await chrome.windows.remove(w.id);return true;}
    if((await state()).locked || !(await state()).configured)throw new Error('먼저 프로필 잠금을 해제하세요.');
    // 캡처: mode 는 visible·area·full·delay·ocr. after 를 주면 설정 대신 그것을 쓴다(도크는 'both').
    if(m.type==='capture')return runCapture(String(m.mode||'visible'),{after:m.after&&String(m.after),notify:!!m.notify,widen:!!m.widen});
    // 영상 녹화 창. 작은 창 하나가 곧 컨트롤 바다. 선택 영역은 먼저 페이지에서 고른다.
    // 녹화 전에 '이 탭' 을 찍을 수 있는지만 본다. 사이드바가 닫히기 전에 알려 줘야
    // 까닭을 보여 줄 수 있다(예전에는 조용히 닫히고 아무 일도 안 일어났다 — 사용자 보고).
    if(m.type==='record-check'){
      if(m.mode!=='tab'&&m.mode!=='area')return {ok:true};
      try{ await targetTab({strict:true}); return {ok:true}; }
      catch(error){ throw Error(recordWhy(error)); }
    }
    if(m.type==='record-open'){
      const query=new URLSearchParams();
      for(const [key,value] of Object.entries(m.options||{}))query.set(key,String(value));
      query.set('mode',String(m.mode||'desktop'));
      if(m.mode==='tab'||m.mode==='area'){
        let tab;
        try{ tab=await targetTab({strict:true}); }
        catch(error){
          // 사이드바가 이미 닫혔을 수 있다. 알림으로라도 반드시 알린다.
          const why=recordWhy(error);
          tell('녹화하지 못했습니다',why);
          await chrome.storage.local.set({lastCapture:{text:why,at:Date.now()}}).catch(()=>{});
          throw Error(why);
        }
        query.set('tab',String(tab.id));
        if(m.mode==='area'){
          const rect=await pickTabArea(tab);
          if(!rect)return {cancelled:true};
          query.set('rect',JSON.stringify(rect));
        }
      }
      // 녹화도 사이드바를 닫아 둔다(페이지가 좁아진 채로 담기지 않게).
      // 사이드바가 닫히며 초점이 움직이면 Chrome 의 '화면 고르기' 창이 그대로 취소된다
      // (사용자에게는 '한 번 실패하고 다시 해 보기를 눌러야 되는' 것으로 보였다).
      // 그래서 사이드바가 다 닫히기를 기다린 뒤에 녹화 창을 연다.
      let away=null;
      if(m.options?.hideSide!==false){ away=await sidePanelAway(); await new Promise(r=>setTimeout(r,450)); }
      const control=m.options?.controlBar!==false;
      // 전체 화면 녹화는 Chrome 고르기 창이 이 창 안쪽에 그려진다. 작게 열면 고를 것이
      // 하나도 안 보인다(사용자 보고). 크게 열고, 화면을 고른 뒤 녹화 창이 스스로 줄인다.
      const big=String(m.mode||'desktop')==='desktop';
      const made=await chrome.windows.create({url:chrome.runtime.getURL('record.html?'+query),type:'popup',
        width:big?860:400,height:big?660:(control?214:190),focused:true});
      recordWindow=made.id||0;
      // 그 탭에서 사이드바를 다시 켜 둔다(열지는 않는다 — 열면 녹화 화면에 다시 끼어든다).
      if(away)setTimeout(()=>{away.back(false).catch(()=>{});},1500);
      return {opened:true};
    }
    if(m.type==='settings'){
      const p=await profile();const minutes=Number(m.idleMinutes);
      if(![0,1,5,15,30].includes(minutes))throw Error('올바르지 않은 시간입니다.');
      await chrome.storage.local.set({profile:{...p,name:String(m.name||p.name).slice(0,40),idleMinutes:minutes},startLocked:m.startLocked!==false,lockOnAway:m.lockOnAway!==false,wheelZoom:m.wheelZoom!==false});
      if(minutes)chrome.idle.setDetectionInterval(minutes*60);return enforce();
    }
    if(m.type==='note-save')return storeNote(m.id,m.title,m.text,undefined,m.tag);
    if(m.type==='note-pin'){
      const id=validateNoteId(m.id);
      const {device,pendingNotes={},draftNotes={}}=await chrome.storage.local.get(['device','pendingNotes','draftNotes']);
      const key=noteKey(device,id);
      const known=pendingNotes[id]||draftNotes[id]||(await chrome.storage.sync.get(key))[key];
      if(!known)throw Error('먼저 메모에 내용을 적어 주세요.');
      return storeNote(id,known.title,known.text,!!m.pinned);
    }
    if(m.type==='tool-timer'){
      const seconds=Math.max(1,Math.min(10800,Number(m.seconds)||0));
      const endsAt=Date.now()+seconds*1000;
      await chrome.storage.local.set({timerEndsAt:endsAt});
      await chrome.alarms.create('utility-timer',{when:endsAt});
      return {endsAt};
    }
    if(m.type==='tool-timer-stop'){
      await chrome.alarms.clear('utility-timer');
      await chrome.storage.local.set({timerEndsAt:0});
      return true;
    }
    if(m.type==='tool-bells'){
      const times=(Array.isArray(m.times)?m.times:[]).filter(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0,16);
      await chrome.storage.local.set({bellTimes:times,bellOn:!!m.on});
      await scheduleBells();
      return {times,on:!!m.on};
    }
    if(m.type==='tool-sound'){
      const bell=m.kind==='bell';
      await chrome.storage.local.set(bell
        ?{toneBell:String(m.tone||'school'),volumeBell:Number(m.volume)||70}
        :{toneAlarm:String(m.tone||'chime'),volumeAlarm:Number(m.volume)||60});
      if(m.preview){
        const ok=await playTone(m.kind);
        const {soundError=''}=await chrome.storage.local.get('soundError');
        if(!ok)throw Error('소리를 낼 수 없습니다. '+soundError);
      }
      return true;
    }
    if(m.type==='tool-teams'){
      const teams=(Array.isArray(m.teams)?m.teams:[]).slice(0,12).map(team=>({
        name:String(team?.name||'').slice(0,20),
        score:Math.max(-999,Math.min(9999,Math.round(Number(team?.score)||0)))
      }));
      await chrome.storage.local.set({teams});
      return {teams};
    }
    if(m.type==='note-new-title')return {title:autoTitle()};
    if(m.type==='clip-toggle'){
      await chrome.storage.local.set({clipboardImport:!!m.on,clipError:''});
      if(m.on)await clipConnect(); else await clipDisconnect();
      return clipStatus();
    }
    if(m.type==='clip-copy'){
      if(!clipPort)throw Error('도우미가 연결되어 있지 않습니다. 자동 가져오기를 켜 주세요.');
      clipPort.postMessage({type:'copy-file',file:String(m.file||'')});
      return true;
    }
    if(m.type==='clip-remove'){
      const note=validateNoteId(m.note);
      const {noteImages={}}=await chrome.storage.local.get('noteImages');
      const next={...noteImages,[note]:(noteImages[note]||[]).filter(item=>item.id!==m.id)};
      await chrome.storage.local.set({noteImages:next});
      return true;
    }
    if(m.type==='music-control'){
      const [tab]=await chrome.tabs.query({url:'https://music.youtube.com/*'});
      if(!tab){await chrome.tabs.create({url:'https://music.youtube.com/'});return {opened:true,now:'탭을 여는 중'};}
      const [run]=await chrome.scripting.executeScript({target:{tabId:tab.id},args:[String(m.action||''),String(m.text||'')],func:controlMusic});
      if(m.action==='search')await chrome.tabs.update(tab.id,{active:true});
      return run?.result||{now:'곡 정보를 읽지 못했습니다.'};
    }
    if(m.type==='note-active'){await chrome.storage.local.set({activeNoteId:validateNoteId(m.id)});return true;}
    if(m.type==='note-delete'){
      const id=validateNoteId(m.id);
      const {device,draftNotes={},pendingNotes={}}=await chrome.storage.local.get(['device','draftNotes','pendingNotes']);
      const drafts={...draftNotes};delete drafts[id];
      // Keep a tombstone so the other devices drop the note instead of syncing it back.
      const value={v:2,id,title:'',text:'',time:Date.now(),revision:crypto.randomUUID(),device,deleted:true};
      await chrome.storage.local.set({draftNotes:drafts,pendingNotes:{...pendingNotes,[id]:value}});
      await flushNotes();
      return true;
    }
    if(m.type==='marks-commit'){
      const {device}=await chrome.storage.local.get('device');const key='marks_'+device;
      const all=await chrome.storage.sync.get(null);
      if(JSON.stringify(all[key]||null)!==JSON.stringify(m.expected||null))throw Error('다른 창에서 북마크를 바꿨습니다. 다시 열고 저장하세요.');
      if(m.value?.kind!=='bookmarks'||!Array.isArray(m.value.items))throw Error('북마크 형식이 올바르지 않습니다.');
      checkQuota(all,key,m.value);await chrome.storage.sync.set({[key]:m.value});return true;
    }
    if(m.type==='marks-drop-legacy'){
      const all=await chrome.storage.sync.get(null);
      const stale=Object.keys(all).filter(key=>key.startsWith('vault_'));
      if(stale.length)await chrome.storage.sync.remove(stale);
      return stale.length;
    }
    if(m.type==='vault-commit'){
      const {device}=await chrome.storage.local.get('device');const key='vault_'+device;
      const all=await chrome.storage.sync.get(null);
      if(JSON.stringify(all[key]||null)!==JSON.stringify(m.expected||null))throw Error('다른 창에서 보관함을 수정했습니다. 다시 열고 저장하세요.');
      if(m.blob?.v!==1 || typeof m.blob.c!=='string')throw Error('암호화 데이터가 필요합니다.');
      checkQuota(all,key,m.blob);await chrome.storage.sync.set({[key]:m.blob});return true;
    }
    if(m.type==='note-flush'){await flushNotes();return true;}
    throw new Error('알 수 없는 요청입니다.');
  }).then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message}));return true;
});
