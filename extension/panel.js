import {unseal,assertPin} from './lib/crypto.js';
import {noteList,noteKey,stampTitle,particle,checkQuota,safeURL,mergeBookmarks,editBookmarks} from './lib/data.js';
import {HOT_DEFAULTS,HOT_ORDER,HOT_LABEL,hotShow,hotFromEvent,hotCheck,hotText,hotClean} from './lib/keys.js';
import {deliver} from './lib/shots.js';
const $=id=>document.getElementById(id);
let profileState,device,editingNote=false,currentNoteId=null,unsavedNote=false,myRevision='',markFolder='',vaultItems=[],vaultEpoch=0,vaultBusy=false;
// 이 창이 쓴 글인지 가리는 표. 같은 기기의 다른 창이 쓴 것만 글상자를 갈아끼운다.
const windowTag=crypto.randomUUID().slice(0,8);
// 한글·일본어·중국어는 IME 가 한 글자를 조합하는 동안 계속 입력이 온다. 그 사이에
// value 를 다시 넣으면 Windows IME 는 조합을 끊고 머무른 자모를 한 번 더 뱉는다.
// 그게 ‘학ㄱ교에에서서’ 처럼 글자가 겹쳐 보이던 이유다. 조합 중에는 손대지 않는다.
let composing=false;
function watchIME(id){
  const box=$(id);
  box.addEventListener('compositionstart',()=>{composing=true;});
  box.addEventListener('compositionend',()=>{composing=false;saveSoon();});
}
// 손이 올라가 있거나 조합 중인 글상자는 건드리지 않고, 같은 글이면 다시 쓰지도 않는다.
function setBox(box,text){
  if(composing||document.activeElement===box)return;
  if(box.value!==text)box.value=text;
}
async function api(type,data={}) { const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw new Error(r?.error||'확장에 연결할 수 없습니다.');return r.data; }
function notice(message=''){ $('notice').textContent=message;$('notice').hidden=!message; }
function event(id,type,fn){$(id).addEventListener(type,async e=>{try{notice();await fn(e);}catch(err){notice(err.message);}});}
// 앱 파일은 60MB가 넘는다. Blob 을 또 감싸면 메모리를 두 배로 쓰므로 그대로 쓴다.
function download(name,data,type){const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function renderState(s){
  if(profileState&&s.revision<profileState.revision)return;
  profileState=s;$('workspace').hidden=!s.configured||s.locked;$('gate').hidden=s.configured&&!s.locked;
  $('name-label').hidden=s.configured;$('confirm-label').hidden=s.configured;$('profile-confirm').required=!s.configured;
  $('gate-title').textContent=s.configured?s.name+'입니다':'내 공간의 작은 문지기';
  $('gate-description').textContent=s.configured?'계속 사용하려면 이 기기의 프로필 PIN을 입력하세요.':'프로필 이름과 PIN을 정해 주세요. 다른 사람이 실수로 내 공간을 사용하는 것을 막아 줍니다.';
  $('gate-submit').textContent=s.configured?'내 프로필 사용하기 →':'내 공간 만들기 →';
  $('owner').textContent=s.name;$('settings-name').value=s.name;$('idle').value=String(s.idleMinutes);$('start-locked').checked=s.startLocked!==false;$('lock-away').checked=s.lockOnAway!==false;$('wheel-zoom').checked=s.wheelZoom!==false;
  if(s.locked||!s.configured){closeVault();$('note').value='';$('note-title').value='';$('note-tabs').replaceChildren();$('note-versions').replaceChildren();$('note-images').replaceChildren();editingNote=false;currentNoteId=null;unsavedNote=false;}
  else {await loadNotes();await loadClip();await loadMarks();}
}
// 잠금 해제만 하려고 띄운 창은 할 일이 끝나면 닫는다. 사이드바가 본 화면이다.
const unlockOnly=new URLSearchParams(location.search).get('unlock')==='1';
event('gate-form','submit',async e=>{e.preventDefault();const pin=$('profile-pin').value;assertPin(pin);
  if(!profileState.configured&&pin!==$('profile-confirm').value)throw Error('두 PIN이 일치하지 않습니다.');
  $('gate-submit').disabled=true;
  try{
    const s=await api(profileState.configured?'unlock':'setup',{pin,name:$('profile-name').value});
    $('profile-pin').value='';$('profile-confirm').value='';
    if(unlockOnly&&!s.locked){window.close();return;}
    await renderState(s);
  }finally{$('gate-submit').disabled=false;}});
event('close-window','click',()=>api('close-window'));
event('lock','click',async()=>{await api('lock');});
event('lock-now','click',async()=>{await api('lock');});
// ── 늘 보이는 도크 ──────────────────────────────────────────────────────
// 어느 탭에 있든 스크롤 없이 닿아야 한다. 이름과 단축키는 올렸을 때 아래 줄에 뜬다.
const DOCK_TIP='올려 두면 무엇인지 알려 줍니다';
for(const button of document.querySelectorAll('.dockbtn')){
  const tell=()=>{$('dock-tip').textContent=button.dataset.tip||'';};
  button.addEventListener('mouseenter',tell);
  button.addEventListener('focus',tell);
  button.addEventListener('mouseleave',()=>{$('dock-tip').textContent=DOCK_TIP;});
  button.addEventListener('blur',()=>{$('dock-tip').textContent=DOCK_TIP;});
}
function showPage(name){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('selected',b.dataset.page===name));
  document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==name);
  notice();
}
let pageBefore='notes';
event('dock-settings','click',()=>{
  if($('settings').hidden){pageBefore=document.querySelector('.page:not([hidden])')?.id||'notes';showPage('settings');}
  else showPage(pageBefore);
});
event('settings-close','click',()=>showPage(pageBefore));

// ── 화면 글꼴 ───────────────────────────────────────────────────────────
// 글꼴은 기기마다 다르게 깔려 있다. 윈도우에만 있는 맑은 고딕을 맥까지 따라가면 안 되므로
// 동기화하지 않고 이 기기에만 저장한다.
const UI_FONTS={
  auto:"-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard Variable','Segoe UI',sans-serif",
  malgun:"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif",
  gulim:"'Gulim','굴림','AppleGothic',sans-serif",
  dotum:"'Dotum','돋움','Apple SD Gothic Neo',sans-serif",
  pretendard:"'Pretendard Variable',sans-serif",
  apple:"'Apple SD Gothic Neo','Pretendard Variable',sans-serif"
};
// 굵기가 400·700 둘뿐인 글꼴들. 600 을 흉내 내면 획이 뭉개지므로 700 으로 올린다.
const UI_CRISP=new Set(['malgun','gulim','dotum']);
function trackText(step){return step?((step>0?'+':'')+(step/10).toFixed(1)+'px'):'기본';}
function applyLook(font,size,track){
  const pick=UI_FONTS[font]?font:'auto';
  const root=document.documentElement;
  const step=Math.max(-4,Math.min(12,Math.round(Number(track)||0)));
  root.style.setProperty('--ui-font',UI_FONTS[pick]);
  root.style.setProperty('--ui-size',Math.max(12,Math.min(19,Number(size)||14))+'px');
  root.style.setProperty('--ui-track',(step/10)+'px');
  if(UI_CRISP.has(pick))root.setAttribute('data-crisp','1'); else root.removeAttribute('data-crisp');
  // 또렷한 글꼴은 이미 0 에서 시작하므로 따로 덮어쓸 것이 없다. 그 밖의 글꼴에서 자간을
  // 건드린 때에만, 제목마다 손으로 넣어 둔 음수 자간까지 이 값으로 바꾼다.
  if(step&&!UI_CRISP.has(pick))root.setAttribute('data-track','1'); else root.removeAttribute('data-track');
}
async function loadLook(){
  const saved=await chrome.storage.local.get(['uiFont','uiSize','uiTrack']);
  const font=UI_FONTS[saved.uiFont]?saved.uiFont:'auto';
  const size=Math.max(12,Math.min(19,Number(saved.uiSize)||14));
  const track=Math.max(-4,Math.min(12,Math.round(Number(saved.uiTrack)||0)));
  $('ui-font').value=font;$('ui-size').value=String(size);$('ui-size-out').textContent=size+'px';
  $('ui-track').value=String(track);$('ui-track-out').textContent=trackText(track);
  applyLook(font,size,track);
}
async function saveLook(){
  const font=$('ui-font').value,size=Number($('ui-size').value),track=Number($('ui-track').value);
  $('ui-size-out').textContent=size+'px';$('ui-track-out').textContent=trackText(track);
  applyLook(font,size,track);
  await chrome.storage.local.set({uiFont:font,uiSize:size,uiTrack:track});
}
event('ui-font','change',saveLook);
event('ui-size','input',saveLook);
event('ui-track','input',saveLook);
loadLook().catch(()=>{});
// 도크만 따로 띄운다. 단추 줄 하나짜리 작은 창이고, 자리는 사용자가 끌어 옮긴다.
// 처음에는 화면 위쪽 가운데. 한 번 옮기면 그 자리를 기억해 다음에도 거기서 열린다.
const DOCK_SIZE={width:404,height:76};
event('dock-pop','click',async()=>{
  const saved=(await chrome.storage.local.get('dockSpot')).dockSpot;
  const left=Number.isFinite(saved?.left)?saved.left:Math.round(screen.availLeft+(screen.availWidth-DOCK_SIZE.width)/2);
  const top=Number.isFinite(saved?.top)?saved.top:screen.availTop+12;
  const made=await chrome.windows.create({url:chrome.runtime.getURL('dock.html'),type:'popup',width:DOCK_SIZE.width,height:DOCK_SIZE.height,left,top,focused:true});
  // 만들 때 준 크기를 Chrome 이 흘려보내는 일이 있다(맥에서 확인). 만든 뒤 한 번 더 맞춘다.
  await chrome.windows.update(made.id,{left,top,...DOCK_SIZE}).catch(()=>{});
  notice('도크 창을 띄웠습니다. 제목 표시줄을 끌어 원하는 자리에 두세요.');
});
event('dock-present','click',async()=>{$('present-start').click();});
event('dock-stop','click',async()=>{$('present-stop').click();});
event('dock-focus','click',()=>{$('present-focus').click();});
event('dock-snip','click',()=>{$('pin-snip').click();});
// ‘클립보드를 화면에 붙이기’ 는 도크에서 뺐다(자리가 모자라 단추가 아랫줄로 내려갔다).
// 발표 탭의 같은 단추와 단축키(⌃⌥V · Ctrl+Alt+V)로 그대로 쓸 수 있고, 따로 띄운 도크 창에는 남아 있다.
event('dock-pins','click',()=>{$('pin-clear').click();});
event('dock-through','click',()=>{$('pin-through').click();});
// 설정은 바꾸는 즉시 저장한다. 예전에는 맨 아래 ‘설정 저장’ 을 눌러야만 저장됐는데, 그 사이에
// 상태가 한 번 다시 그려지면(잠금·해제·자리 비움 등) 저장 안 된 체크가 원래대로 돌아갔다.
// ‘잠그기를 껐는데 돌아와 보니 켜져 있다’ 가 이것이다. 이 값들은 chrome.storage.local 이라
// 기기마다 따로이며 다른 컴퓨터와 동기화되지 않는다.
async function saveSettings(){
  const name=$('settings-name').value.trim()||profileState?.name||'내 프로필';
  await renderState(await api('settings',{name,idleMinutes:$('idle').value,startLocked:$('start-locked').checked,lockOnAway:$('lock-away').checked,wheelZoom:$('wheel-zoom').checked}));
}
event('settings-form','submit',async e=>{e.preventDefault();await saveSettings();notice('설정을 저장했습니다.');});
for(const id of ['start-locked','lock-away','wheel-zoom','idle'])event(id,'change',async()=>{await saveSettings();notice('저장했습니다 — 이 컴퓨터에만 적용됩니다.');});
for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>{
  if(button.dataset.page!=='vault')closeVault();
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('selected',b===button));
  // 설정도 page 로 취급한다. 탭을 고르면 같이 닫힌다.
  document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==button.dataset.page);notice();
  if(button.dataset.page==='presenter')refreshPresenter();
});
function updateCount(){const count=new TextEncoder().encode($('note').value).length;$('note-count').textContent=count.toLocaleString()+' / 5,500 B';}
function startNote(){currentNoteId=crypto.randomUUID();unsavedNote=true;editingNote=false;$('note').value='';$('note-title').value=stampTitle();updateCount();}
async function pickNote(id){currentNoteId=id;unsavedNote=false;editingNote=false;await loadNotes();await loadClip();}
// One click per note: the strip scrolls sideways once more notes exist than fit.
let shownTab=null;
function renderTabs(list){
  const strip=$('note-tabs');strip.replaceChildren();
  const entries=[...list.map(note=>({id:note.id,label:note.current.title}))];
  if(unsavedNote&&currentNoteId)entries.unshift({id:currentNoteId,label:$('note-title').value||'새 메모'});
  for(const entry of entries){
    const tab=document.createElement('button');
    tab.type='button';tab.className='note-tab';tab.textContent=entry.label;tab.title=entry.label;
    tab.setAttribute('role','tab');
    const chosen=entry.id===currentNoteId;
    tab.setAttribute('aria-selected',String(chosen));
    tab.classList.toggle('selected',chosen);
    tab.onclick=()=>{if(entry.id!==currentNoteId)pickNote(entry.id).catch(error=>notice(error.message));};
    strip.append(tab);
    // 글자를 칠 때마다 스크롤하면 Windows IME 의 조합이 끊긴다. 고른 메모가 바뀐 때만 옮긴다.
    if(chosen&&shownTab!==entry.id){shownTab=entry.id;requestAnimationFrame(()=>tab.scrollIntoView({block:'nearest',inline:'nearest'}));}
  }
}
async function loadNotes(){
  if(!profileState?.configured||profileState.locked)return;
  const [all,local]=await Promise.all([chrome.storage.sync.get(null),chrome.storage.local.get(['draftNotes','pendingNotes','noteSyncError'])]);
  if(profileState.locked)return;
  const pending=local.pendingNotes||{},drafts=local.draftNotes||{},syncError=local.noteSyncError||'';
  // Writes waiting to sync are this device's newest copy, and a draft too large to sync must stay listed.
  const merged={...all};
  for(const [id,value] of Object.entries(pending))merged[noteKey(value.device||device,id)]=value;
  for(const [id,value] of Object.entries(drafts))if(!merged[noteKey(value.device||device,id)])merged[noteKey(value.device||device,id)]=value;
  const list=noteList(merged);
  if(!unsavedNote&&!list.some(note=>note.id===currentNoteId))currentNoteId=list[0]?.id||null;
  if(!currentNoteId)startNote();
  renderTabs(list);renderPins(list);showPin(list);
  const note=list.find(item=>item.id===currentNoteId);
  const shown=(syncError&&drafts[currentNoteId])||note?.current||null;
  if(!editingNote){setBox($('note'),shown?.text||'');setBox($('note-title'),shown?.title||$('note-title').value||'새 메모');updateCount();}
  $('note-status').textContent=syncError?'로컬 보관 · 동기화 오류':Object.keys(pending).length?'이 기기에 저장 · 동기화 대기':'Chrome 동기화 저장소 사용';
  if(syncError)notice(syncError);
  const others=(note?.versions||[]).filter(v=>!v.deleted&&v.key!==shown?.key);
  $('note-versions').replaceChildren();$('version-count').textContent=`(${others.length})`;
  for(const v of others){
    const div=document.createElement('div');div.className='version';
    const title=document.createElement('small');title.textContent=(v.device===device?'이 기기':'기기 '+v.device?.slice(0,6))+' · '+new Date(v.time).toLocaleString();
    const p=document.createElement('p');p.textContent=v.text||'(빈 메모)';
    const b=document.createElement('button');b.className='secondary';b.textContent='이 내용을 편집';b.onclick=async()=>{if(editingNote&&$('note').value!==v.text){download('메모-편집사본.txt',$('note').value,'text/plain;charset=utf-8');}editingNote=true;$('note').value=v.text;updateCount();await saveNote().catch(e=>notice(e.message));};
    div.append(title,p,b);$('note-versions').append(div);
  }
}
async function loadClip(){
  const local=await chrome.storage.local.get(['clipboardImport','clipError','noteImages']);
  const on=!!local.clipboardImport,error=local.clipError||'';
  $('clip-toggle').checked=on;
  $('clip-state').textContent=error?'연결 안 됨':on?'가져오는 중':'꺼짐';
  $('clip-state').classList.toggle('on',on&&!error);
  if(error)notice(error);
  const shots=(local.noteImages||{})[currentNoteId]||[];
  $('shots').hidden=!shots.length;
  $('image-count').textContent=shots.length?`(${shots.length})`:'';
  const box=$('note-images');box.replaceChildren();
  for(const shot of shots){
    const row=document.createElement('div');row.className='shot';
    const image=document.createElement('img');image.alt=shot.name;
    image.onerror=()=>{image.removeAttribute('src');image.classList.add('missing');};
    if(shot.thumb)image.src='data:image/png;base64,'+shot.thumb; else image.classList.add('missing');
    const meta=document.createElement('div');meta.className='shot-meta';
    const name=document.createElement('small');name.textContent=shot.name;
    const size=document.createElement('small');size.textContent=`${shot.width}×${shot.height} · 바탕화면`;
    meta.append(name,size);
    const copy=document.createElement('button');copy.className='secondary';copy.textContent='복사';
    copy.onclick=async()=>{try{notice();await api('clip-copy',{file:shot.file});notice('이미지를 클립보드에 올렸습니다. 붙여넣을 곳에서 Ctrl+V(Mac은 Command+V) 하세요.');}catch(error){notice(error.message);}};
    const drop=document.createElement('button');drop.className='quiet';drop.textContent='빼기';
    drop.onclick=async()=>{try{notice();await api('clip-remove',{id:shot.id,note:currentNoteId});await loadClip();}catch(error){notice(error.message);}};
    row.append(image,meta,copy,drop);box.append(row);
  }
}
event('clip-toggle','change',async()=>{
  const on=$('clip-toggle').checked;
  try{await api('clip-toggle',{on});}finally{await loadClip();}
  if(on)notice('켠 뒤에 복사하거나 캡처한 내용만 가져옵니다. 비밀번호 같은 민감한 내용이 클립보드에 들어오면 그대로 메모에 남습니다.');
});
async function saveNote(){
  if(!currentNoteId)return;
  if(!$('note-title').value.trim())$('note-title').value=stampTitle();
  const saved=await api('note-save',{id:currentNoteId,title:$('note-title').value,text:$('note').value,tag:windowTag});
  myRevision=saved?.revision||'';
  unsavedNote=false;$('note-status').textContent='이 기기에 저장 · 동기화 대기';
}
// 글자마다 저장하면 저장 -> 저장소 변경 -> 다시 그리기가 타건 속도로 돌아 IME 를 덮친다.
// 손이 잠깐 멈추면 한 번만 쓴다. 조합이 끝나거나 글상자를 떠날 때도 바로 밀어 넣는다.
let saveTimer=0;
function saveSoon(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saveTimer=0;saveNote().catch(e=>notice(e.message));},350);
}
async function saveNow(){clearTimeout(saveTimer);saveTimer=0;await saveNote();}
event('note','input',()=>{editingNote=true;updateCount();saveSoon();});
event('note-title','input',()=>{editingNote=true;saveSoon();});
event('note','blur',async()=>{composing=false;await saveNow();});
event('note-title','blur',async()=>{composing=false;await saveNow();});
watchIME('note');watchIME('note-title');

event('add-note','click',async()=>{startNote();renderTabs(noteList(await chrome.storage.sync.get(null)));$('note-title').select();});
event('delete-note','click',async()=>{
  if(!currentNoteId)return;
  if(unsavedNote){startNote();notice('저장하지 않은 새 메모를 비웠습니다.');return;}
  if(!confirm(`“${$('note-title').value}” 메모를 지울까요? 다른 기기에서도 사라집니다.`))return;
  await api('note-delete',{id:currentNoteId});
  currentNoteId=null;editingNote=false;unsavedNote=false;
  await loadNotes();notice('메모를 지웠습니다.');
});
event('save-note','click',async()=>{await saveNow();await api('note-flush');editingNote=false;await loadNotes();});
event('print-note','click',async()=>{
  const shots=[...$('note-images').querySelectorAll('img')].filter(image=>image.getAttribute('src')).map(image=>image.src);
  await chrome.storage.local.set({printJob:{title:$('note-title').value||'메모',text:$('note').value,shots,time:Date.now()}});
  await chrome.tabs.create({url:chrome.runtime.getURL('print.html')});
});
event('export-note','click',()=>download(($('note-title').value||'빠른-메모')+'.txt',$('note').value,'text/plain;charset=utf-8'));
// 발표 도우미 앱을 확장 안에 넣어 두고 그대로 내려받게 한다. 파일을 따로 주고받지 않아도
// 되니 남에게 건넬 때 ZIP 하나로 끝난다. 설치는 사람이 해야 한다 — 확장은 남의 컴퓨터에
// 프로그램을 설치할 수 없다(브라우저가 그렇게 두지 않는다).
const APPS={
  mac:{file:'presenter/macos.zip',name:'다있쌤-발표도우미-맥.zip'},
  win:{file:'presenter/windows.zip',name:'다있쌤-발표도우미-윈도우.zip'}
};
async function getApp(which,button){
  const app=APPS[which];
  button.classList.add('busy');button.disabled=true;
  const was=button.textContent;button.textContent='준비 중…';
  try{
    const reply=await fetch(chrome.runtime.getURL(app.file));
    if(!reply.ok)throw Error('앱 파일이 이 확장에 들어 있지 않습니다. 배포본 ZIP을 받아 주세요.');
    const blob=await reply.blob();
    if(!blob.size)throw Error('앱 파일이 비어 있습니다.');
    download(app.name,blob,'application/zip');
    notice(`${app.name} 을 내려받았습니다. 압축을 풀고 위 설명대로 설치하세요.`);
  } finally { button.classList.remove('busy');button.disabled=false;button.textContent=was; }
}
event('get-mac','click',e=>getApp('mac',e.currentTarget));
event('get-win','click',e=>getApp('win',e.currentTarget));
// 쓰는 컴퓨터에 맞는 쪽을 먼저 보여 준다.
(()=>{
  const mac=/Mac/i.test(navigator.platform||navigator.userAgent);
  const first=mac?$('get-mac'):$('get-win');
  first.classList.remove('secondary');first.className='primary';
  first.parentElement.prepend(first);
})();
// The async API needs clipboard permission; execCommand still covers the cases where it is refused.
async function copyText(text){
  try{await navigator.clipboard.writeText(text);return true;}catch{}
  const focused=document.activeElement;
  const area=document.createElement('textarea');area.value=text;area.readOnly=true;
  area.style.cssText='position:fixed;top:-1000px;left:-1000px;opacity:0';
  document.body.append(area);area.select();area.setSelectionRange(0,text.length);
  let copied=false;try{copied=document.execCommand('copy');}catch{}
  area.remove();focused?.focus?.({preventScroll:true});
  return copied;
}
event('copy-note','click',async()=>{
  const text=$('note').value;
  if(!text.trim()){notice('복사할 메모 내용이 없습니다.');return;}
  if(!await copyText(text))throw Error('클립보드에 복사하지 못했습니다. 텍스트 내보내기로 파일에 저장하세요.');
  notice('메모를 복사했습니다. 붙여넣을 곳에서 Ctrl+V(Mac은 Command+V) 하세요.');
});
// ── 발표 단축키 ──────────────────────────────────────────────────────────────
// 맥과 윈도우는 운영체제가 미리 가져간 조합이 서로 달라 한 벌로 맞출 수 없다. 두 벌을
// 따로 보관하고, 이 컴퓨터의 운영체제에 맞는 벌만 발표 도우미 앱으로 보낸다. 다른 벌은
// 그 컴퓨터의 사이드바가 같은 저장소에서 읽어 자기 앱에 보낸다.
const THIS_OS=/Mac/i.test(navigator.userAgent)?'mac':'win';
const OS_NAME={mac:'맥',win:'윈도우'};
let hotkeys={mac:{...HOT_DEFAULTS},win:{...HOT_DEFAULTS}};
let hotOS=THIS_OS,hotArmed=null;
const OS_RULES={
  mac:'맥이 먼저 가져가는 조합은 고를 수 없게 막아 두었습니다 — Command(⌘) 조합 전체, Option+Shift(특수문자 입력), F1~F12(밝기·미션 컨트롤·VoiceOver), 수정 키 하나만 쓰는 조합. ⌃⌥(Control+Option) 조합이 가장 안전합니다.',
  win:'윈도우가 먼저 가져가는 조합은 고를 수 없게 막아 두었습니다 — Windows(⊞) 키 조합 전체, Alt+Shift(키보드 배열 바꾸기), Alt+Tab·Alt+F4·Ctrl+Alt+Del·Ctrl+Shift+Esc, F1~F12, 수정 키 하나만 쓰는 조합. Ctrl+Shift 조합은 고를 수는 있지만 Chrome과 겹치므로 Ctrl+Alt 조합을 권합니다.'
};
const OS_ENTRY={
  mac:'메뉴 막대의 돋보기 아이콘에서 발표를 시작합니다. 발표 중에는 화면이 메뉴 막대를 덮으므로 Esc로 끝냅니다. 핀 단축키는 앱만 켜져 있으면 발표 전에도 듣습니다.',
  win:'트레이(시계 옆) 아이콘을 오른쪽 클릭해 발표를 시작합니다. 발표 중에는 Esc로 끝냅니다. 윈도우는 발표 중에만 단축키를 듣기 때문에, 발표 전에는 트레이 메뉴나 이 버튼을 쓰세요. 화면 확대는 윈도우 제약으로 주 모니터에서만 걸립니다.'
};
function showHotkeys(){
  const set=hotkeys[hotOS]||HOT_DEFAULTS;
  for(const action of HOT_ORDER){
    const chip=$('key-'+action);
    const armed=hotArmed===action;
    chip.textContent=armed?'누르세요…':hotShow(set[action],hotOS);
    chip.classList.toggle('armed',armed);
    chip.title=HOT_LABEL[action]+' 단축키를 바꾸려면 누르세요';
  }
  $('os-mac').classList.toggle('selected',hotOS==='mac');
  $('os-win').classList.toggle('selected',hotOS==='win');
  $('key-wheel').textContent=(hotOS==='mac'?'⌃⌥':'Ctrl+Alt')+' 휠';
  $('key-wheel-ring').textContent=(hotOS==='mac'?'⌃⌥⇧':'Ctrl+Alt+Shift')+' 휠';
  $('presenter-entry').textContent=hotOS==='mac'?'메뉴 막대에서도':'트레이에서도';
  $('os-note').textContent=hotOS===THIS_OS
    ?'이 컴퓨터('+OS_NAME[hotOS]+')의 단축키입니다. 바꾸면 발표 도우미 앱에 바로 적용됩니다.'
    :OS_NAME[hotOS]+' 컴퓨터용 단축키입니다. 여기서 미리 정해 두면, 그 컴퓨터에서 같은 프로필로 켤 때 그대로 적용됩니다. 이 컴퓨터('+OS_NAME[THIS_OS]+')에는 적용되지 않습니다.';
  $('os-rules').textContent=OS_RULES[hotOS];
  $('presenter-entry-hint').textContent=OS_ENTRY[hotOS];
}
async function loadHotkeys(){
  const saved=(await chrome.storage.sync.get('hotkeys')).hotkeys;
  for(const os of ['mac','win'])hotkeys[os]=hotClean(saved&&saved[os]);
  showHotkeys();
}
async function hotSave(){
  showHotkeys();
  await chrome.storage.sync.set({hotkeys});
  // 앱에는 이 컴퓨터의 벌만 보낸다. 조절값과 같은 길로 실어 보내 따로 오갈 일이 없다.
  keyPush={want:'',tries:0,at:0};
  applyPresenterState(await api('presenter-command',knobPayload()).catch(()=>null));
}
for(const action of HOT_ORDER)event('key-'+action,'click',()=>{
  hotArmed=hotArmed===action?null:action;
  $('key-state').textContent=hotArmed
    ?HOT_LABEL[action]+' — 새 조합을 그대로 눌러 주세요. Esc로 그만둡니다.'
    :'키 칸을 누르고 새 조합을 누르세요.';
  showHotkeys();
});
// 잡는 중에는 이 창의 다른 단축키보다 먼저 가로챈다(capture). 브라우저가 먼저 가져가는
// 조합은 여기까지 오지 않으므로, 그때는 다른 조합을 고르도록 안내만 한다.
document.addEventListener('keydown',e=>{
  if(!hotArmed)return;
  e.preventDefault();e.stopPropagation();
  const action=hotArmed;
  if(e.key==='Escape'){hotArmed=null;showHotkeys();$('key-state').textContent='그만두었습니다. 단축키는 그대로입니다.';return;}
  const combo=hotFromEvent(e);
  if(!combo){$('key-state').textContent='수정 키만 눌렀습니다. 글자나 숫자를 함께 눌러 주세요.';return;}
  const verdict=hotCheck(combo,hotOS,action,hotkeys[hotOS]);
  if(!verdict.ok){$('key-state').textContent=verdict.why;return;}
  hotArmed=null;hotkeys[hotOS][action]=combo;
  $('key-state').textContent=HOT_LABEL[action]+' → '+hotShow(combo,hotOS)+(verdict.warn?' · '+verdict.warn:' 로 바꿨습니다.');
  hotSave().catch(err=>notice(err.message));
},true);
event('os-mac','click',()=>{hotArmed=null;hotOS='mac';showHotkeys();});
event('os-win','click',()=>{hotArmed=null;hotOS='win';showHotkeys();});
event('key-reset','click',async()=>{
  hotArmed=null;hotkeys[hotOS]={...HOT_DEFAULTS};
  $('key-state').textContent=OS_NAME[hotOS]+' 단축키를 기본 조합으로 되돌렸습니다.';
  await hotSave();
});
// Read the live binding so a shortcut the user changed in Chrome is never shown wrong.
async function loadShortcuts(){
  $('key-note').textContent='바꾸려면 키 칸을 누르고 새 조합을 그대로 누르세요. 수정 키(Control·Alt·Shift) 두 개 이상과 글자·숫자 하나를 함께 눌러야 합니다. 브라우저가 먼저 가져가는 조합은 여기서 눌러도 잡히지 않습니다 — 그럴 때는 Control+Alt 조합을 쓰세요.';
  await loadHotkeys().catch(()=>{showHotkeys();});
  try{const lock=(await chrome.commands.getAll()).find(c=>c.name==='lock-profile');$('lock-key').textContent=lock?.shortcut||'설정 안 됨';}
  catch{$('lock-key').textContent=THIS_OS==='mac'?'⌘⇧L':'Ctrl+Shift+L';}
}
event('edit-shortcut','click',()=>chrome.tabs.create({url:'chrome://extensions/shortcuts'}));
const PRESENT_DEFAULTS={dim:45,blur:10,ringSize:44,ring:'#dff39c'};
let presentKnobs={...PRESENT_DEFAULTS};
function showKnobs(){
  $('dim').value=presentKnobs.dim;$('dim-out').textContent=presentKnobs.dim+'%';
  $('blur').value=presentKnobs.blur;$('blur-out').textContent=presentKnobs.blur+'단계';
  $('ring-size').value=presentKnobs.ringSize;$('ring-size-out').textContent=presentKnobs.ringSize+'px';
  $('ring-color').value=presentKnobs.ring;
}
async function loadKnobs(){
  const {presentKnobs:saved}=await chrome.storage.local.get('presentKnobs');
  presentKnobs={...PRESENT_DEFAULTS,...(saved||{})};
  showKnobs();showFocus();
}
// 앱은 소수 배율을 받으므로 어둡기만 백분율에서 바꿔 보낸다.
function knobPayload(){return {dim:presentKnobs.dim/100,blur:presentKnobs.blur,ringSize:presentKnobs.ringSize,ring:presentKnobs.ring,keys:hotText(hotkeys[THIS_OS])};}
async function present(action){return api('presenter-command',{action,...knobPayload()});}
async function knobChanged(){
  showKnobs();
  await chrome.storage.local.set({presentKnobs});
  await api('presenter-command',knobPayload()).catch(()=>{});
}
let focusOn=false,presenting=false,pinCount=0,throughCount=0;
// 집중 모드는 발표 중에만 뜻이 있다. 앱이 알려 준 상태 그대로 버튼을 맞춘다.
function showFocus(){
  // 어떤 버튼도 잠그지 않는다. 앱이 시작되는 데 시간이 걸려 상태를 늦게 알려 주면
  // 그 버튼이 영영 눌리지 않는 채로 남는다(v0.12.0 과 같은 실수). 안내는 앱이 직접 한다.
  $('present-focus').setAttribute('aria-checked',String(focusOn));
  $('present-focus').title='포인터 둘레만 남기고 바깥을 가립니다. 발표 중에만 듣습니다.';
  $('present-start').classList.toggle('go',!presenting);
  $('present-stop').classList.toggle('go',presenting);
  $('pin-count').textContent=pinCount?(pinCount+'개'):'';
  $('pin-through').setAttribute('aria-checked',String(throughCount>0));
  $('through-count').textContent=throughCount?(throughCount+'개 통과 중'):'';
  // 도크는 모든 탭에서 보인다. 상태를 색으로만 알린다.
  $('dock-present').classList.toggle('on',presenting);
  $('dock-focus').classList.toggle('on',focusOn);
  $('dock-pins').classList.toggle('on',pinCount>0);
  $('dock-through').classList.toggle('on',throughCount>0);
}
// 누른 직후 몇 초 동안은 앱이 아직 준비 중이라 옛 상태를 돌려준다. 그 답이 방금 누른 것과
// 어긋나면 버튼이 켜졌다 꺼졌다 한다. 뜻이 이루어질 때까지 어긋나는 답만 흘려보낸다.
let wish=null;
// 앱이 꺼져 있으면 도우미가 앱을 켜고 기다린다. 가상 머신에서는 그게 10초를 넘기기도
// 하므로, 그때까지는 누른 대로 둔 채 기다린다. 그래도 안 되면 정직하게 되돌아간다.
function wishFor(patch){ wish={...patch,until:Date.now()+16000}; }
// 앱이 지금 실제로 듣고 있는 단축키를 사이드바에 알린다. 예전에는 보내기만 하고 닿았는지
// 몰라서, 중간에서 버려져도(background.js·윈도우 도우미의 이름 목록) 아무도 알 수 없었다.
// 어긋나면 이 컴퓨터의 벌을 다시 보낸다 — 다른 기기에서 바꾼 조합이 동기화로만 오고
// 이 컴퓨터의 앱에는 닿지 않던 것도 이것으로 맞춰진다.
let keyPush={want:'',tries:0,at:0};
function checkAppKeys(data){
  const box=$('key-app');
  const say=(text,kind='')=>{box.textContent=text;box.className='app-keys'+(kind?' '+kind:'');};
  if(typeof data.running!=='boolean'){
    say('발표 도우미 앱이 옛 버전이라 바꾼 단축키를 받지 못합니다. ‘발표 프로그램 다운로드’에서 새 앱을 받아 다시 설치해 주세요.','warn');return;
  }
  if(!data.running){say('발표 도우미 앱이 꺼져 있습니다. 단축키는 앱이 켜져 있을 때만 듣습니다 — ‘시작’을 누르면 앱이 켜집니다.');return;}
  const want=hotText(hotkeys[THIS_OS]);
  if(typeof data.keys!=='string'){
    say('발표 도우미 앱이 옛 버전이라 바꾼 단축키를 받지 못합니다. ‘발표 프로그램 다운로드’에서 새 앱을 받아 다시 설치해 주세요.','warn');return;
  }
  if(data.keys===want){keyPush={want,tries:0,at:0};say('✓ 발표 도우미 앱이 이 단축키로 듣고 있습니다.','ok');return;}
  if(keyPush.want!==want)keyPush={want,tries:0,at:0};
  if(keyPush.tries>=3){say('앱에 새 단축키를 세 번 보냈지만 적용되지 않았습니다. 메뉴 막대(윈도우는 트레이)에서 앱을 종료했다가 다시 켜 주세요.','warn');return;}
  if(Date.now()-keyPush.at<3000)return;
  keyPush.tries++;keyPush.at=Date.now();
  say('앱에 새 단축키를 보내는 중…');
  api('presenter-command',knobPayload()).then(applyPresenterState).catch(()=>{});
}
function applyPresenterState(data){
  if(!data||typeof data!=='object')return;
  checkAppKeys(data);
  if(wish&&Date.now()>wish.until)wish=null;
  const stale=(key,value)=>!!wish&&wish[key]!==undefined&&value!==wish[key];
  if(typeof data.presenting==='boolean'&&!stale('presenting',data.presenting))presenting=data.presenting;
  if(typeof data.focus==='boolean'&&!stale('focus',data.focus))focusOn=data.focus;
  if(typeof data.pins==='number')pinCount=data.pins;
  if(typeof data.through==='number')throughCount=data.through;
  if(wish){
    let met=true;
    for(const key of ['focus','presenting'])if(wish[key]!==undefined&&data[key]!==wish[key])met=false;
    if(met)wish=null;
  }
  showFocus();
}
async function refreshPresenter(){
  try{applyPresenterState(await api('presenter-command',{action:'state'}));}
  catch{
    presenting=false;focusOn=false;showFocus();
    const box=$('key-app');box.className='app-keys warn';
    box.textContent='발표 도우미에 연결하지 못했습니다. 앱을 설치하고(맥은 메뉴 막대 → 클립보드 도우미 → 등록) Chrome 을 다시 켜 주세요.';
  }
}
// 앱이 화면을 준비하는 데 2~3초가 걸린다. 도우미는 0.4초 뒤에 답하므로 그 답은 아직 옛 상태다.
// 그 답을 그대로 믿으면 버튼이 눌러도 안 움직이는 것처럼 보인다. 누른 대로 먼저 움직이고,
// 잠시 뒤 몇 번 다시 읽어 실제 상태로 맞춘다.
function settleLater(){ for(const wait of [900,2200,4200,7200,11000,16500])setTimeout(()=>{refreshPresenter().catch(()=>{});},wait); }
event('present-start','click',async()=>{
  wishFor({presenting:true});presenting=true;showFocus();
  await present('start');
  notice('발표를 시작했습니다. 확대는 Control+Option+휠입니다.');
  settleLater();
});
event('present-stop','click',async()=>{
  wishFor({presenting:false,focus:false});
  presenting=false;focusOn=false;showFocus();
  await present('stop');
  notice('발표를 끝냈습니다.');
  settleLater();
});
event('present-focus','click',async()=>{
  const next=!focusOn;
  wishFor(next?{focus:true,presenting:true}:{focus:false});
  focusOn=next; if(next)presenting=true; showFocus();
  await present(next?'focus-on':'focus-off');
  notice(next?'집중 모드를 켭니다. 발표가 함께 켜집니다.':'집중 모드를 껐습니다.');
  settleLater();
});
// 화면 조각 핀. 발표 중이 아니어도 앱만 떠 있으면 쓸 수 있어 상태를 보고 막지 않는다.
event('pin-snip','click',async()=>{applyPresenterState(await present('snip'));notice('화면에서 붙일 부분을 끌어 주세요. Esc 또는 오른쪽 클릭으로 취소합니다.');});
event('pin-clip','click',async()=>{applyPresenterState(await present('pin-clip'));notice('클립보드에 있던 그림이나 글을 화면에 붙였습니다.');});
event('pin-through','click',async()=>{
  // 핀 위에서만 켤 수 있으면 켜고 끄는 길이 어긋난다. 여기서 모든 핀을 한 번에 뒤집는다.
  applyPresenterState(await present('pins-through'));
  notice(throughCount?'핀이 클릭을 통과시킵니다. 다시 누르려면 이 스위치를 끄세요.':'핀을 다시 누를 수 있게 했습니다.');
});
event('pin-clear','click',async()=>{applyPresenterState(await present('pins-clear'));notice('붙여 둔 핀을 모두 닫았습니다.');});
event('dim','input',async()=>{presentKnobs.dim=Number($('dim').value);await knobChanged();});
event('blur','input',async()=>{presentKnobs.blur=Number($('blur').value);await knobChanged();});
event('ring-size','input',async()=>{presentKnobs.ringSize=Number($('ring-size').value);await knobChanged();});
event('ring-color','input',async()=>{presentKnobs.ring=$('ring-color').value;await knobChanged();});
function markRecords(all){return Object.entries(all).filter(([k,v])=>k.startsWith('marks_')&&v?.kind==='bookmarks'&&Array.isArray(v.items)).map(([,v])=>v);}
function closeVault(){vaultEpoch++;vaultItems=[];$('bookmarks').replaceChildren();}
async function loadMarks(){
  if(!profileState?.configured||profileState.locked)return;
  const all=await chrome.storage.sync.get(null);
  const snapshots=markRecords(all);
  vaultItems=snapshots.length?mergeBookmarks(snapshots):[];
  $('legacy-vault').hidden=!Object.keys(all).some(key=>key.startsWith('vault_'));
  renderFolders();renderBookmarks();
}
function folders(){return vaultItems.filter(item=>!item.deleted&&item.type==='folder').sort((a,b)=>a.title.localeCompare(b.title));}
function renderFolders(){
  const strip=$('folder-tabs');strip.replaceChildren();
  const known=folders();
  if(!known.some(folder=>folder.id===markFolder))markFolder='';
  for(const entry of [{id:'',title:'전체'},...known]){
    const tab=document.createElement('button');
    tab.type='button';tab.className='note-tab';tab.textContent=entry.title;tab.title=entry.title;
    tab.setAttribute('role','tab');
    const chosen=entry.id===markFolder;
    tab.setAttribute('aria-selected',String(chosen));tab.classList.toggle('selected',chosen);
    tab.onclick=()=>{markFolder=entry.id;renderFolders();renderBookmarks();notice();};
    strip.append(tab);
  }
  $('rename-folder').hidden=!markFolder;$('remove-folder').hidden=!markFolder;
}
function renderBookmarks(){
  const box=$('bookmarks');box.replaceChildren();
  const known=folders();
  const links=vaultItems.filter(item=>!item.deleted&&item.type!=='folder')
    .filter(item=>markFolder?item.folder===markFolder:true);
  $('bookmark-count').textContent=links.length+'개'+(markFolder?' · 이 폴더':'');
  if(!links.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='아직 비어 있어요. 보고 있는 페이지를 담아 보세요.';box.append(empty);return;}
  for(const item of links){
    const row=document.createElement('div');row.className='bookmark';
    const link=document.createElement('a');link.href=safeURL(item.url);link.target='_blank';link.rel='noopener noreferrer';
    const title=document.createElement('strong');title.textContent=item.title;
    const host=document.createElement('small');host.textContent=new URL(item.url).hostname;
    link.append(title,host);
    const move=document.createElement('select');move.className='move';move.title='폴더 옮기기';
    for(const entry of [{id:'',title:'폴더 없음'},...known]){
      const option=document.createElement('option');option.value=entry.id;option.textContent=entry.title;
      if(entry.id===(item.folder||''))option.selected=true;
      move.append(option);
    }
    move.onchange=()=>mutateMark(item.id,{...plain(item),folder:move.value}).catch(error=>notice(error.message));
    const remove=document.createElement('button');remove.textContent='삭제';
    remove.onclick=()=>{if(confirm('“'+item.title+'”'+particle(item.title,'을','를')+' 지울까요?'))mutateMark(item.id,{deleted:true}).catch(error=>notice(error.message));};
    row.append(link,move,remove);box.append(row);
  }
}
function plain(item){const {rev,writer,...rest}=item;return rest;}
async function commitMarks(edits){
  if(vaultBusy)throw Error('저장 중입니다. 잠시 후 다시 시도하세요.');
  if(!profileState?.configured||profileState.locked)throw Error('프로필 잠금을 먼저 해제하세요.');
  vaultBusy=true;
  try {
    // Read again before every edit; device specific keys keep offline peers intact.
    const all=await chrome.storage.sync.get(null);
    const snapshots=markRecords(all);
    const current=snapshots.length?mergeBookmarks(snapshots):[];
    const merged=editBookmarks(current,edits,device);
    const value={v:1,kind:'bookmarks',items:merged};
    checkQuota(all,'marks_'+device,value);
    await api('marks-commit',{value,expected:all['marks_'+device]||null});
    vaultItems=merged;renderFolders();renderBookmarks();
  } finally { vaultBusy=false; }
}
function mutateMark(id,fields){return commitMarks([{id,fields}]);}
event('add-folder','click',async()=>{
  const name=(prompt('새 폴더 이름')||'').trim().slice(0,120);
  if(!name)return;
  const id=crypto.randomUUID();
  await mutateMark(id,{type:'folder',title:name,deleted:false});
  markFolder=id;renderFolders();renderBookmarks();
});
event('rename-folder','click',async()=>{
  const folder=folders().find(entry=>entry.id===markFolder);
  if(!folder)return;
  const name=(prompt('폴더 이름',folder.title)||'').trim().slice(0,120);
  if(!name||name===folder.title)return;
  await mutateMark(folder.id,{type:'folder',title:name,deleted:false});
});
event('remove-folder','click',async()=>{
  const folder=folders().find(entry=>entry.id===markFolder);
  if(!folder)return;
  const inside=vaultItems.filter(item=>!item.deleted&&item.type!=='folder'&&item.folder===folder.id);
  if(!confirm('“'+folder.title+'” 폴더를 지울까요? 안에 있던 '+inside.length+'개는 폴더 없음으로 옮겨집니다.'))return;
  await commitMarks([
    {id:folder.id,fields:{deleted:true}},
    ...inside.map(item=>({id:item.id,fields:{...plain(item),folder:''}}))
  ]);
  markFolder='';renderFolders();renderBookmarks();
  notice('폴더를 지웠습니다. 링크는 그대로 남아 있습니다.');
});
event('bookmark-current','click',async()=>{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab)throw Error('현재 탭을 찾을 수 없습니다.');
  if(!tab.url)throw Error('이 페이지의 주소를 읽을 수 없습니다. Chrome 내부 화면은 저장할 수 없습니다.');
  const url=safeURL(tab.url);
  const title=(tab.title||url).trim().slice(0,120);
  if(vaultItems.some(item=>!item.deleted&&item.type!=='folder'&&item.url===url))throw Error('이미 저장된 페이지입니다.');
  await mutateMark(crypto.randomUUID(),{title,url,folder:markFolder,deleted:false});
  notice('“'+title+'”'+particle(title,'을','를')+' 북마크에 넣었습니다.');
});
event('bookmark-form','submit',async e=>{
  e.preventDefault();
  const title=$('bookmark-title').value.trim();
  if(!title)throw Error('이름을 입력하세요.');
  await mutateMark(crypto.randomUUID(),{title:title.slice(0,120),url:safeURL($('bookmark-url').value),folder:markFolder,deleted:false});
  $('bookmark-title').value='';$('bookmark-url').value='';
});
event('legacy-form','submit',async e=>{
  e.preventDefault();
  const pin=$('legacy-pin').value;assertPin(pin);
  const all=await chrome.storage.sync.get(null);
  const old=Object.entries(all).filter(([key])=>key.startsWith('vault_'));
  if(!old.length){$('legacy-vault').hidden=true;return;}
  let carried;
  try { carried=mergeBookmarks(await Promise.all(old.map(([,blob])=>unseal(pin,blob)))); }
  catch { throw Error('PIN이 맞지 않거나 이전 보관함이 손상되었습니다.'); }
  const fresh=carried.filter(item=>!item.deleted);
  if(fresh.length)await commitMarks(fresh.map(item=>({id:item.id,fields:{title:item.title,url:item.url,folder:'',deleted:false}})));
  await api('marks-drop-legacy');
  $('legacy-pin').value='';$('legacy-vault').hidden=true;
  await loadMarks();
  notice(fresh.length+'개를 북마크로 옮기고 이전 보관함을 지웠습니다.');
});
event('vault-export','click',()=>{
  const items=vaultItems.filter(item=>!item.deleted);
  download('북마크-백업.json',JSON.stringify({format:'sheriff-bookmarks-1',items},null,2),'application/json');
});
event('vault-import','change',async()=>{
  const file=$('vault-import').files[0];$('vault-import').value='';
  if(!file)return;
  if(file.size>200000)throw Error('백업 파일이 너무 큽니다.');
  const data=JSON.parse(await file.text());
  if(data.format!=='sheriff-bookmarks-1'||!Array.isArray(data.items))throw Error('북마크 백업 파일이 아닙니다.');
  const edits=data.items.filter(item=>typeof item.id==='string').map(item=>({id:item.id,fields:{
    ...(item.type==='folder'?{type:'folder',title:String(item.title||'').slice(0,120)}
                            :{title:String(item.title||'').slice(0,120),url:safeURL(item.url),folder:typeof item.folder==='string'?item.folder:''}),
    deleted:false}}));
  if(!edits.length)throw Error('가져올 항목이 없습니다.');
  await commitMarks(edits);
  notice(edits.length+'개를 합쳤습니다.');
});
chrome.runtime.onMessage.addListener(m=>{if(m.type==='state-changed')renderState(m.state).catch(e=>notice(e.message));});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='sync'){
    if(Object.keys(changes).some(k=>k.startsWith('note_')))loadNotes().catch(e=>notice(e.message));
    if(Object.keys(changes).some(k=>k.startsWith('marks_')||k.startsWith('vault_'))&&!vaultBusy)loadMarks().catch(e=>notice(e.message));
    if(changes.hotkeys&&!hotArmed)loadHotkeys().then(refreshPresenter).catch(()=>{});
  }
  if(area==='local'&&(changes.pendingNotes||changes.noteSyncError)){
    // pendingNotes 는 이 기기만 쓴다. 다른 기기의 글은 sync 로 온다. 방금 내가 쓴 것을
    // 남의 글로 착각해 editingNote 를 내리면, 치는 중인 글상자를 통째로 덮어써 버린다.
    const writer=changes.lastNoteWriter?.newValue;
    const mine=changes.pendingNotes?.newValue?.[currentNoteId]?.revision;
    if(editingNote&&mine&&mine!==myRevision&&writer&&writer!==windowTag)editingNote=false;
    loadNotes().catch(e=>notice(e.message));
  }
  if(area==='local'&&changes.lastImportId?.newValue&&!editingNote){
    currentNoteId=changes.lastImportId.newValue;unsavedNote=false;
    loadNotes().then(loadClip).catch(e=>notice(e.message));
    return;
  }
  if(area==='local'&&(changes.noteImages||changes.clipboardImport||changes.clipError))loadClip().catch(e=>notice(e.message));
});
// 저장을 350ms 미뤘으므로, 사이드바가 닫히거나 가려지면 미뤄 둔 글을 먼저 밀어 넣는다.
function flushNote(){if(!saveTimer)return;clearTimeout(saveTimer);saveTimer=0;saveNote().catch(()=>{});}
document.addEventListener('visibilitychange',()=>{if(document.hidden){flushNote();closeVault();}});
window.addEventListener('pagehide',flushNote);
try{$('version').textContent='v'+chrome.runtime.getManifest().version;}catch{$('version').textContent='';}
// ── 캡처 탭 ─────────────────────────────────────────────────────────────────
// 사진(웹페이지·화면)과 영상(화면 녹화). 무거운 일은 서비스 워커(capture-core.js)와
// 녹화 창(record.js)이 하고, 여기서는 고르고 부르기만 한다.
const CAP_DEFAULTS={after:'editor',format:'png',quality:92,delay:3,hideFixed:true,hideScrollbar:true,hideSide:true};
const REC_DEFAULTS={mode:'desktop',camera:false,cameraId:'',cameraName:'',camMix:false,mic:true,micId:'',controlBar:true,res:'1080',format:'mp4',countdown:3,limit:0,sound:true};
let capOptions={...CAP_DEFAULTS},recOptions={...REC_DEFAULTS};
function capSay(text){$('cap-status').textContent=text||'';}
async function loadCapture(){
  const saved=await chrome.storage.local.get(['captureOptions','recordOptions']);
  capOptions={...CAP_DEFAULTS,...(saved.captureOptions||{})};
  recOptions={...REC_DEFAULTS,...(saved.recordOptions||{})};
  $('cap-after').value=capOptions.after;$('cap-delay-sec').value=String(capOptions.delay);
  $('cap-format').value=capOptions.format;$('cap-quality').value=String(capOptions.quality);$('cap-quality-out').textContent=String(capOptions.quality);
  $('cap-hide-fixed').checked=capOptions.hideFixed!==false;$('cap-hide-bar').checked=capOptions.hideScrollbar!==false;
  $('cap-hide-side').checked=capOptions.hideSide!==false;
  $('rec-cam').checked=!!recOptions.camera;$('rec-cam-mix').checked=!!recOptions.camMix;$('rec-mic').checked=recOptions.mic!==false;
  $('rec-control').setAttribute('aria-checked',String(recOptions.controlBar!==false));
  $('rec-res').value=String(recOptions.res);$('rec-format').value=recOptions.format;
  $('rec-count').value=String(recOptions.countdown);$('rec-limit').value=String(recOptions.limit);$('rec-sound').checked=recOptions.sound!==false;
  showRecMode();checkRecFormat();
  // 사이드바를 닫고 찍은 캡처가 방금 끝났다면, 사이드바가 돌아왔을 때 그 결과를 여기서 알린다.
  const {lastCapture}=await chrome.storage.local.get('lastCapture');
  if(lastCapture?.text&&Date.now()-lastCapture.at<30000){
    await chrome.storage.local.remove('lastCapture');
    showPage('capture');capSay(lastCapture.text);
  }
}
async function saveCapture(){
  capOptions={...capOptions,after:$('cap-after').value,delay:Number($('cap-delay-sec').value)||3,format:$('cap-format').value,
    quality:Number($('cap-quality').value)||92,hideFixed:$('cap-hide-fixed').checked,hideScrollbar:$('cap-hide-bar').checked,hideSide:$('cap-hide-side').checked};
  $('cap-quality-out').textContent=String(capOptions.quality);
  await chrome.storage.local.set({captureOptions:capOptions});
}
for(const id of ['cap-after','cap-delay-sec','cap-format','cap-hide-fixed','cap-hide-bar','cap-hide-side'])event(id,'change',saveCapture);
event('cap-quality','input',saveCapture);
// 캡처 하나. 오래 걸릴 수 있어(전체 페이지는 장마다 0.6초) 그동안 단추를 잠가 두 번 누르지 않게 한다.
let capturing=false;
async function runCapture(mode,after,hint){
  if(capturing){notice('앞의 캡처가 아직 끝나지 않았습니다.');return;}
  capturing=true;document.body.classList.add('capturing');
  capSay(hint);
  try{
    await saveCapture();
    // 사이드바가 열려 있으면 페이지가 그만큼 좁아져 좁게 찍힌다. 닫고 찍은 뒤 알림으로 알린다.
    if(capOptions.hideSide&&mode!=='delay'){
      chrome.runtime.sendMessage({type:'capture',mode,...(after?{after}:{}),notify:true,widen:true}).catch(()=>{});
      capSay('사이드바를 닫고 찍습니다. 끝나면 사이드바가 돌아옵니다.');
      setTimeout(()=>window.close(),80);
      return;
    }
    const result=await api('capture',after?{mode,after}:{mode});
    if(result?.cancelled){capSay('캡처를 그만두었습니다.');return;}
    capSay(result?.message||'캡처했습니다.');
  }catch(error){capSay('');throw error;}
  finally{capturing=false;document.body.classList.remove('capturing');}
}
event('cap-visible','click',()=>runCapture('visible','','보이는 부분을 찍는 중…'));
event('cap-full','click',()=>runCapture('full','','페이지를 내려가며 찍는 중… 끝날 때까지 페이지를 건드리지 마세요.'));
event('cap-area','click',()=>runCapture('area','','페이지에서 끌어 캡처할 곳을 고르세요. Esc 로 그만둡니다.'));
event('cap-delay','click',()=>runCapture('delay','',`${$('cap-delay-sec').value}초 뒤에 찍습니다. 원하는 화면을 띄워 두세요(확장 아이콘에 남은 초가 보입니다).`));
event('cap-ocr','click',()=>runCapture('ocr','','글자를 뽑을 곳을 페이지에서 끌어 고르세요.'));
// 도크의 빠른 캡처 두 개: 설정과 상관없이 늘 폴더 저장 + 클립보드 복사(바로 붙여넣기).
event('dock-cap-area','click',()=>runCapture('area','both','페이지에서 끌어 고르세요 — 캡처이미지 폴더에 저장하고 복사합니다.'));
event('dock-cap-full','click',()=>runCapture('full','both','페이지를 내려가며 찍는 중… — 캡처이미지 폴더에 저장하고 복사합니다.'));
// 바탕화면·다른 앱 창. 사이드바에서 누른 그 손길로 바로 화면 고르기 창을 띄워야 해서
// (getDisplayMedia 는 누른 직후에만 된다) 서비스 워커가 아니라 여기서 찍는다.
event('cap-screen','click',async()=>{
  await saveCapture();
  let stream;
  try{stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'monitor'},audio:false,selfBrowserSurface:'exclude'});}
  catch{capSay('화면 고르기를 그만두었습니다.');return;}
  let blob;
  try{
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play();
    // 고르기 창이 닫힌 뒤의 화면을 찍는다.
    await new Promise(resolve=>setTimeout(resolve,450));
    const canvas=new OffscreenCanvas(video.videoWidth,video.videoHeight);
    canvas.getContext('2d').drawImage(video,0,0);
    blob=capOptions.format==='jpg'?await canvas.convertToBlob({type:'image/jpeg',quality:capOptions.quality/100}):await canvas.convertToBlob({type:'image/png'});
  }finally{stream.getTracks().forEach(track=>track.stop());}
  const result=await deliver(blob,capOptions.after,{mode:'screen',title:'전체 화면'});
  capSay(result.after==='editor'?(result.fallback?'편집기로 열었습니다 — '+result.fallback:'편집기로 열었습니다.')
    :[result.path?'캡처이미지 폴더에 저장했습니다.':'',result.copied?'클립보드에 복사했습니다.':''].join(' '));
});
event('cap-local','click',()=>chrome.tabs.create({url:chrome.runtime.getURL('capture.html#new')}));
event('cap-keys','click',()=>chrome.tabs.create({url:'chrome://extensions/shortcuts'}));

// ── 영상 ──
function showRecMode(){
  for(const tile of document.querySelectorAll('.cap-tile.rec')){
    const on=tile.dataset.rec===recOptions.mode;
    tile.classList.toggle('selected',on);tile.setAttribute('aria-checked',String(on));
  }
  const camOnly=recOptions.mode==='camera';
  $('rec-cam').disabled=camOnly;
  $('rec-note').textContent={
    desktop:'Chrome 이 띄우는 창에서 녹화할 화면(전체 화면·창·탭)을 고릅니다.',
    camera:'카메라 창이 열립니다. 거기서 카메라·마이크를 고르고 녹화합니다.',
    tab:'Chrome 이 띄우는 창에서 이 탭을 고르면 탭 화면과 소리를 녹화합니다.',
    area:'페이지에서 녹화할 곳을 끌어 고른 뒤, Chrome 창에서 이 탭을 고르세요. 고른 곳만 잘라 담습니다.'
  }[recOptions.mode]||'';
}
function checkRecFormat(){
  const mp4=typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  $('rec-format').querySelector('option[value=mp4]').textContent=mp4?'MP4':'MP4 (이 Chrome 은 WebM 으로)';
}
async function saveRecord(){
  // 카메라 이름도 함께 둔다. 전체 화면 녹화에서는 발표 도우미 앱이 같은 카메라를 열어야 한다.
  recOptions={...recOptions,camera:$('rec-cam').checked,cameraId:$('rec-cam-dev').value,cameraName:$('rec-cam-dev').selectedOptions[0]?.textContent||'',camMix:$('rec-cam-mix').checked,
    mic:$('rec-mic').checked,micId:$('rec-mic-dev').value,
    controlBar:$('rec-control').getAttribute('aria-checked')==='true',res:$('rec-res').value,format:$('rec-format').value,
    countdown:Number($('rec-count').value)||0,limit:Number($('rec-limit').value)||0,sound:$('rec-sound').checked};
  await chrome.storage.local.set({recordOptions:recOptions});
}
for(const tile of document.querySelectorAll('.cap-tile.rec'))tile.addEventListener('click',async()=>{recOptions.mode=tile.dataset.rec;showRecMode();await saveRecord();});
for(const id of ['rec-cam','rec-cam-mix','rec-cam-dev','rec-mic','rec-mic-dev','rec-res','rec-format','rec-count','rec-limit','rec-sound'])event(id,'change',saveRecord);
event('rec-control','click',async()=>{const next=$('rec-control').getAttribute('aria-checked')!=='true';$('rec-control').setAttribute('aria-checked',String(next));await saveRecord();});
event('rec-more','click',()=>{const box=$('rec-more-box');box.hidden=!box.hidden;$('rec-more').setAttribute('aria-expanded',String(!box.hidden));$('rec-more').textContent=box.hidden?'더 보기 ›':'접기 ‹';});
// 장치 이름은 한 번이라도 카메라·마이크를 허용한 뒤에만 보인다. 그 전에는 ‘카메라 1’ 처럼 적는다.
async function listRecDevices(){
  let devices=[];try{devices=await navigator.mediaDevices.enumerateDevices();}catch{return;}
  const fill=(select,kind,label,chosen)=>{
    const found=devices.filter(d=>d.kind===kind&&d.deviceId&&d.deviceId!=='default'&&d.deviceId!=='communications');
    select.replaceChildren(new Option(label+' (기본)',''),...found.map((d,i)=>new Option(d.label||(label+' '+(i+1)),d.deviceId)));
    select.value=found.some(d=>d.deviceId===chosen)?chosen:'';
  };
  fill($('rec-cam-dev'),'videoinput','카메라',recOptions.cameraId);
  fill($('rec-mic-dev'),'audioinput','마이크',recOptions.micId);
}
try{navigator.mediaDevices.addEventListener('devicechange',()=>{listRecDevices().catch(()=>{});});}catch{}
event('rec-start','click',async()=>{
  await saveRecord();
  if(recOptions.mode==='camera'){
    await chrome.windows.create({url:chrome.runtime.getURL('camera.html'),type:'popup',width:760,height:680});
    return;
  }
  if(recOptions.mode==='area')capSay('페이지에서 녹화할 곳을 끌어 고르세요. Esc 로 그만둡니다.');
  const {mode,...options}=recOptions;
  if(capOptions.hideSide){
    chrome.runtime.sendMessage({type:'record-open',mode,options:{...options,hideSide:true}}).catch(()=>{});
    capSay('사이드바를 닫고 녹화를 준비합니다…');
    setTimeout(()=>window.close(),80);
    return;
  }
  const result=await api('record-open',{mode,options});
  capSay(result?.cancelled?'녹화를 그만두었습니다.':'녹화 창을 열었습니다. 창을 닫거나 ■ 를 누르면 끝납니다.');
});
loadCapture().then(listRecDevices).catch(()=>{});
await loadShortcuts().catch(()=>{});
await loadKnobs().catch(()=>{});
refreshPresenter();
try{await renderState(await api('state'));device=(await chrome.storage.local.get('device')).device;await loadNotes();}catch(e){notice(e.message);}

// ── 메모 핀 ─────────────────────────────────────────────────────────────
function renderPins(list){
  const deck=$('pin-deck');deck.replaceChildren();
  for(const note of list.filter(item=>item.current.pinned)){
    const card=document.createElement('div');card.className='pin-card';
    const head=document.createElement('div');head.className='pin-head';
    const title=document.createElement('strong');title.textContent=note.current.title;
    title.style.cursor='pointer';title.title='이 메모 편집하기';
    title.onclick=()=>pickNote(note.id).catch(error=>notice(error.message));
    const off=document.createElement('button');off.type='button';off.textContent='고정 해제';
    off.onclick=async()=>{try{notice();await api('note-pin',{id:note.id,pinned:false});await loadNotes();}catch(error){notice(error.message);}};
    head.append(title,off);
    const body=document.createElement('div');body.className='pin-body';
    body.textContent=note.current.text||'(내용 없음)';
    card.append(head,body);deck.append(card);
  }
}
function showPin(list){
  const note=list.find(item=>item.id===currentNoteId);
  const on=!!note?.current.pinned;
  $('pin-note').classList.toggle('on',on);
  $('pin-note').title=on?'고정 해제':'이 메모를 위에 고정';
}
event('pin-note','click',async()=>{
  if(!currentNoteId)return;
  if(unsavedNote){notice('내용을 적으면 고정할 수 있습니다.');return;}
  const on=$('pin-note').classList.contains('on');
  await api('note-pin',{id:currentNoteId,pinned:!on});
  await loadNotes();
  notice(on?'고정을 풀었습니다.':'위에 고정했습니다.');
});

// ── 스톱워치 ────────────────────────────────────────────────────────────
let watchFrom=0,watchHeld=0,watchTick=null,watchLaps=[];
function watchSave(){chrome.storage.local.set({watch:{from:watchFrom,held:watchHeld,laps:watchLaps}}).catch(()=>{});}
function watchRun(){
  clearInterval(watchTick);watchTick=null;
  if(watchFrom)watchTick=setInterval(watchDraw,100);
  $('watch-go').textContent=watchFrom?'멈춤':'시작';
  watchDraw();
}
function watchLapList(){
  $('watch-laps').replaceChildren();
  watchLaps.forEach((value,index)=>{
    const row=document.createElement('div');row.textContent=`${watchLaps.length-index}. ${watchFace(value)}`;
    $('watch-laps').append(row);
  });
}
function watchFace(ms){
  const total=Math.floor(ms/100);
  return `${String(Math.floor(total/600)).padStart(2,'0')}:${String(Math.floor(total/10)%60).padStart(2,'0')}.${total%10}`;
}
function watchDraw(){$('watch-face').textContent=watchFace(watchHeld+(watchFrom?Date.now()-watchFrom:0));}
event('watch-go','click',()=>{
  if(watchFrom){watchHeld+=Date.now()-watchFrom;watchFrom=0;}
  else watchFrom=Date.now();
  watchRun();watchSave();
});
event('watch-lap','click',()=>{
  watchLaps.unshift(watchHeld+(watchFrom?Date.now()-watchFrom:0));
  watchLaps=watchLaps.slice(0,40);
  watchLapList();watchSave();
});
event('watch-zero','click',()=>{
  watchFrom=0;watchHeld=0;watchLaps=[];
  watchRun();watchLapList();watchSave();
});

// ── 타이머 (사이드바를 닫아도 서비스 워커의 알람이 지킨다) ──────────────
let timerTick=null;
function timerDraw(endsAt){
  clearInterval(timerTick);timerTick=null;
  if(!endsAt){$('timer-go').textContent='타이머 시작';return;}
  const paint=()=>{
    const left=Math.max(0,Math.round((endsAt-Date.now())/1000));
    $('timer-go').textContent=`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')} 남음`;
    if(left<=0){clearInterval(timerTick);timerTick=null;$('timer-go').textContent='타이머 시작';}
  };
  paint();timerTick=setInterval(paint,500);
}
event('timer-go','click',async()=>{
  const seconds=Number($('timer-min').value||0)*60+Number($('timer-sec').value||0);
  if(seconds<1){notice('시간을 정해 주세요.');return;}
  timerDraw((await api('tool-timer',{seconds})).endsAt);
  notice('타이머를 맞췄습니다. 사이드바를 닫아도 울립니다.');
});
event('timer-stop','click',async()=>{await api('tool-timer-stop');timerDraw(0);notice('타이머를 멈췄습니다.');});

// ── 수업 시보 ───────────────────────────────────────────────────────────
function bellRow(value){
  const row=document.createElement('div');row.className='pad-row';
  const input=document.createElement('input');input.type='time';input.value=value||'09:00';input.className='bell-time';
  const drop=document.createElement('button');drop.type='button';drop.className='quiet';drop.textContent='빼기';
  drop.onclick=()=>row.remove();
  row.append(input,drop);$('bell-rows').append(row);
}
function bellTimes(){return [...document.querySelectorAll('.bell-time')].map(input=>input.value).filter(Boolean);}
event('bell-add','click',()=>bellRow());
event('bell-save','click',async()=>{
  const saved=await api('tool-bells',{times:bellTimes(),on:$('bell-on').checked});
  notice(saved.on?`${saved.times.length}개 시각에 시보를 맞췄습니다.`:'시보를 껐습니다.');
});
event('bell-on','change',async()=>{await api('tool-bells',{times:bellTimes(),on:$('bell-on').checked});});

// ── 알림 소리 ───────────────────────────────────────────────────────────
async function saveSound(kind,preview){
  const tone=kind==='bell'?$('bell-tone').value:$('alarm-tone').value;
  const volume=Number(kind==='bell'?$('bell-volume').value:$('alarm-volume').value);
  await api('tool-sound',{kind,tone,volume,preview});
}
event('alarm-tone','change',()=>saveSound('alarm',false));
event('alarm-volume','input',()=>{$('vol-out').textContent=$('alarm-volume').value+'%';});
event('alarm-volume','change',()=>saveSound('alarm',false));
event('alarm-test','click',()=>saveSound('alarm',true));
event('bell-tone','change',()=>saveSound('bell',false));
event('bell-volume','input',()=>{$('bell-vol-out').textContent=$('bell-volume').value+'%';});
event('bell-volume','change',()=>saveSound('bell',false));
event('bell-test','click',()=>saveSound('bell',true));

// 3) 팀 포인트 판
let teams=[];
function teamRow(team,index){
  const row=document.createElement('div');row.className='team-row';
  const name=document.createElement('input');name.className='team-name';name.value=team.name;name.maxLength=20;name.placeholder=`${index+1}팀`;
  name.oninput=()=>{teams[index].name=name.value;saveTeams();};
  const down=document.createElement('button');down.type='button';down.textContent='−';
  const score=document.createElement('input');score.className='team-score';score.type='number';score.value=team.score;
  const up=document.createElement('button');up.type='button';up.textContent='+';
  const bump=step=>{teams[index].score=Math.max(-999,Math.min(9999,teams[index].score+step));score.value=teams[index].score;saveTeams();};
  down.onclick=()=>bump(-1);up.onclick=()=>bump(1);
  score.onchange=()=>{teams[index].score=Math.max(-999,Math.min(9999,Math.round(Number(score.value)||0)));score.value=teams[index].score;saveTeams();};
  row.append(name,down,score,up);return row;
}
function drawTeams(){
  $('team-board').replaceChildren(...teams.map(teamRow));
  $('team-count').value=teams.length;
}
async function saveTeams(){await api('tool-teams',{teams}).catch(()=>{});}
event('team-apply','click',async()=>{
  const want=Math.max(1,Math.min(12,Number($('team-count').value)||1));
  while(teams.length<want)teams.push({name:'',score:0});
  teams=teams.slice(0,want);
  drawTeams();await saveTeams();
});
event('team-zero','click',async()=>{teams=teams.map(team=>({...team,score:0}));drawTeams();await saveTeams();});
event('team-clear','click',async()=>{
  if(!confirm('팀 이름과 점수를 모두 지울까요?'))return;
  teams=teams.map(()=>({name:'',score:0}));drawTeams();await saveTeams();
});

// ── 발표자 뽑기 ─────────────────────────────────────────────────────────
let picked=[];
event('pick-go','click',async()=>{
  const from=Number($('pick-from').value||1),to=Number($('pick-to').value||1);
  if(to<from){notice('번호 범위를 확인해 주세요.');return;}
  let pool=[];for(let n=from;n<=to;n++)pool.push(n);
  if($('pick-unique').checked)pool=pool.filter(n=>!picked.includes(n));
  if(!pool.length){$('pick-done').textContent='모두 뽑았습니다. 기록을 지우고 다시 시작하세요.';return;}
  const face=$('pick-number');face.classList.remove('landed');face.classList.add('rolling');
  $('pick-go').disabled=true;
  const spin=setInterval(()=>{face.textContent=pool[Math.floor(Math.random()*pool.length)];},70);
  await new Promise(done=>setTimeout(done,1400));
  clearInterval(spin);
  const chosen=pool[Math.floor(Math.random()*pool.length)];
  picked.push(chosen);
  face.classList.remove('rolling');face.textContent=chosen;face.classList.add('landed');
  $('pick-go').disabled=false;
  $('pick-done').textContent=`지금까지 ${picked.length}명: ${picked.join(', ')}`;
});
event('pick-reset','click',()=>{picked=[];$('pick-done').textContent='';$('pick-number').textContent='?';});

// ── 소음 측정기 ─────────────────────────────────────────────────────────
let micStream=null,micTick=null;
event('noise-go','click',async()=>{
  if(micStream)return;
  try{micStream=await navigator.mediaDevices.getUserMedia({audio:true});}
  catch{notice('마이크를 쓸 수 없습니다. 브라우저 권한을 확인해 주세요.');return;}
  const context=new AudioContext();
  const analyser=context.createAnalyser();analyser.fftSize=1024;
  context.createMediaStreamSource(micStream).connect(analyser);
  const buffer=new Float32Array(analyser.fftSize);
  micTick=setInterval(()=>{
    analyser.getFloatTimeDomainData(buffer);
    let sum=0;for(const sample of buffer)sum+=sample*sample;
    const level=Math.min(100,Math.round(Math.sqrt(sum/buffer.length)*400));
    $('noise-bar').style.width=level+'%';
    $('noise-face').textContent=level<25?`조용함 ${level}`:level<60?`보통 ${level}`:`시끄러움 ${level}`;
  },100);
  notice('측정 중입니다. 녹음하지 않습니다.');
});
event('noise-stop','click',()=>{
  clearInterval(micTick);micTick=null;
  if(micStream){micStream.getTracks().forEach(track=>track.stop());micStream=null;}
  $('noise-bar').style.width='0';$('noise-face').textContent='꺼짐';
});

// ── 유튜브 뮤직 조종기 ──────────────────────────────────────────────────
event('music-open','click',()=>chrome.tabs.create({url:'https://music.youtube.com/'}));
event('music-prev','click',()=>musicDo('prev'));
event('music-next','click',()=>musicDo('next'));
event('music-play','click',()=>musicDo('toggle'));
event('music-search','click',()=>musicDo('search',$('music-query').value.trim()));
async function musicDo(action,text){
  const reply=await api('music-control',{action,text});
  $('music-now').textContent=reply?.now||'연결되지 않음';
  if(reply?.opened)notice('유튜브 뮤직 탭을 열었습니다. 곡을 재생한 뒤 다시 눌러 주세요.');
}

// ── 웹캠 ────────────────────────────────────────────────────────────────
// ── 녹음기 ──────────────────────────────────────────────────────────────
// 소리마다 흐름이 같다. stream 은 실제 장치, gain 은 합칠 때의 크기, meter 는 화면 표시용.
const recSources={
  mic:{stream:null,gain:null,meter:null,outlet:null,recorder:null,parts:[],label:'마이크',
       use:'rec-mic',vol:'rec-mic-vol',bar:'rec-mic-level'},
  sys:{stream:null,gain:null,meter:null,outlet:null,recorder:null,parts:[],label:'시스템소리',
       use:'rec-sys',vol:'rec-sys-vol',bar:'rec-sys-level'}
};
let recAudio=null,recMixed=null,recMixRecorder=null,recMixParts=[],recRunning=false,recPaused=false;
let recFrom=0,recHeld=0,recHeldAt=0,recClockTick=null,recPaint=null;
const recWave=[];                       // 최근 소리 크기. 파형처럼 흘러간다.
const recStamp=()=>new Date().toISOString().replace(/[:T]/g,'-').slice(0,19);
// 마이크가 여러 대일 수 있다. 이름은 권한을 준 뒤에야 보이므로 켠 다음에도 다시 채운다.
async function recListMics(){
  const box=$('rec-mic-pick');
  let devices=[];
  try{devices=await navigator.mediaDevices.enumerateDevices();}catch{return;}
  const mics=devices.filter(device=>device.kind==='audioinput');
  const chosen=box.value;
  box.replaceChildren(...[...box.querySelectorAll('option')].filter(option=>!option.dataset.device));
  mics.forEach((device,index)=>{
    const option=document.createElement('option');
    option.value=device.deviceId;option.dataset.device='1';
    option.textContent=device.label||`마이크 ${index+1}`;
    box.append(option);
  });
  if([...box.options].some(option=>option.value===chosen))box.value=chosen;
}
try{navigator.mediaDevices.addEventListener('devicechange',()=>{recListMics().catch(()=>{});});}catch{}
recListMics().catch(()=>{});
function recSay(text,busy){$('rec-state').textContent=text;$('rec-state').classList.toggle('on',!!busy);}
function recWarn(text){$('rec-warn').textContent=text||'';$('rec-warn').hidden=!text;}
function recType(){
  for(const type of ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'])
    if(MediaRecorder.isTypeSupported(type))return type;
  return '';
}
function recClock(){
  const ms=(recPaused?recHeldAt:Date.now())-recFrom-recHeld;
  const total=Math.max(0,Math.floor(ms/1000));
  const h=Math.floor(total/3600),m=Math.floor(total%3600/60),sec=total%60;
  $('rec-clock').textContent=(h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
}
function recLevel(source){
  if(!source.meter)return 0;
  const data=new Uint8Array(source.meter.fftSize);
  source.meter.getByteTimeDomainData(data);
  let sum=0;for(const value of data){const v=(value-128)/128;sum+=v*v;}
  return Math.min(1,Math.sqrt(sum/data.length)*2.6);
}
function recDraw(){
  const canvas=$('rec-wave'),box=canvas.getBoundingClientRect();
  if(box.width>0){const want=Math.round(box.width*devicePixelRatio);if(canvas.width!==want)canvas.width=want;}
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  let loudest=0;
  for(const key of Object.keys(recSources)){
    const source=recSources[key],level=recLevel(source);
    $(source.bar).style.width=Math.round(level*100)+'%';
    if(level>loudest)loudest=level;
  }
  if(!recPaused)recWave.push(loudest);
  const bars=Math.floor(w/5);
  while(recWave.length>bars)recWave.shift();
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#16342b';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='rgba(223,243,156,.16)';ctx.fillRect(0,h/2-1,w,2);
  for(let i=0;i<recWave.length;i++){
    const value=recWave[i],tall=Math.max(2,value*(h-14));
    ctx.fillStyle=recRunning&&!recPaused?'#dff39c':'rgba(223,243,156,.42)';
    ctx.fillRect(w-(recWave.length-i)*5,(h-tall)/2,3,tall);
  }
  recPaint=requestAnimationFrame(recDraw);
}
function recWatch(){if(!recPaint)recPaint=requestAnimationFrame(recDraw);}
function recStopWatching(){if(recPaint){cancelAnimationFrame(recPaint);recPaint=null;}}
function recContext(){
  if(!recAudio)recAudio=new AudioContext();
  if(recAudio.state==='suspended')recAudio.resume();
  return recAudio;
}
function recAttach(key,stream){
  const source=recSources[key],ctx=recContext();
  source.stream=stream;
  const node=ctx.createMediaStreamSource(stream);
  source.gain=ctx.createGain();
  source.gain.gain.value=Number($(source.vol).value)/100;
  source.meter=ctx.createAnalyser();source.meter.fftSize=1024;
  node.connect(source.gain);source.gain.connect(source.meter);
  recWatch();
}
function recRelease(key){
  const source=recSources[key];
  if(source.stream)source.stream.getTracks().forEach(track=>track.stop());
  try{source.gain&&source.gain.disconnect();}catch{}
  source.stream=null;source.gain=null;source.meter=null;
  $(source.bar).style.width='0%';
  if(!recSources.mic.stream&&!recSources.sys.stream&&!recRunning)recStopWatching();
}
async function recOpenMic(){
  // 고른 마이크로 연다. 그 장치를 못 열면 기본 마이크로 한 번 더 해 본다.
  const wanted=$('rec-mic-pick').value;
  const shape={echoCancellation:false,noiseSuppression:false,autoGainControl:false};
  let got=null;
  try{ got=await navigator.mediaDevices.getUserMedia({audio:wanted?{...shape,deviceId:{exact:wanted}}:shape}); }
  catch(error){
    if(!wanted)throw error;
    recWarn('고른 마이크를 열지 못해 기본 마이크로 켰습니다.');
    got=await navigator.mediaDevices.getUserMedia({audio:shape});
  }
  recAttach('mic',got);
  await recListMics();
}
async function recOpenSystem(){
  // Chrome 은 소리만 달라고 하면 거절한다. 화면 트랙을 함께 받아 두고 쓰지 않는다.
  // 화면 트랙을 끄면 공유 자체가 끝나 소리도 함께 끊긴다.
  const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
  if(!stream.getAudioTracks().length){
    stream.getTracks().forEach(track=>track.stop());
    throw new Error('소리 없이 화면만 공유되었습니다. 공유 창에서 ‘소리 공유’를 켜고 다시 해 주세요.');
  }
  recAttach('sys',stream);
  stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{
    $('rec-sys').checked=false;recRelease('sys');
    if(recRunning)recWarn('화면 공유가 끝나 시스템 소리가 멈췄습니다. 녹음은 계속됩니다.');
  }));
}
function recReady(){
  $('rec-go').classList.toggle('on',recRunning);
  $('rec-go').setAttribute('aria-label',recRunning?'녹음 끝내고 저장':'녹음 시작');
  $('rec-hold').disabled=!recRunning;$('rec-stop').disabled=!recRunning;
  $('rec-mic').disabled=recRunning;$('rec-sys').disabled=recRunning;
  document.querySelectorAll('input[name=rec-mix]').forEach(box=>{box.disabled=recRunning;});
}
for(const key of Object.keys(recSources)){
  const source=recSources[key];
  event(source.use,'change',async()=>{
    recWarn('');
    if(!$(source.use).checked){recRelease(key);return;}
    try{ key==='mic' ? await recOpenMic() : await recOpenSystem(); }
    catch(error){
      $(source.use).checked=false;
      recWarn(error?.message&&!/Permission denied|NotAllowed/i.test(error.message)?error.message
        :(key==='mic'?'마이크를 열지 못했습니다. 주소창 왼쪽 자물쇠에서 권한을 확인해 주세요.':'화면·소리 공유가 취소되었습니다.'));
    }
  });
  event(source.vol,'input',()=>{
    const value=Number($(source.vol).value);
    $(source.vol+'-out').textContent=value+'%';
    if(source.gain)source.gain.gain.value=value/100;
  });
}
function recStart(stream,bucket,type){
  const recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined);
  recorder.ondataavailable=e=>{if(e.data.size)bucket.push(e.data);};
  recorder.start(1000);
  return recorder;
}
async function recBegin(){
  recWarn('');
  // 체크는 처음부터 켜져 있지만 소리 장치는 change 가 울릴 때만 열렸다. 그래서 켜자마자
  // 녹음을 누르면 열린 것이 하나도 없어 아무 일도 없었고, 체크를 껐다 켜야 동작했다.
  // 누른 시점에 '켜져 있는데 아직 안 열린' 것을 열어 준다.
  for(const key of Object.keys(recSources)){
    if(!$(recSources[key].use).checked||recSources[key].stream)continue;
    try{
      recSay('소리를 여는 중…');
      key==='mic' ? await recOpenMic() : await recOpenSystem();
    }catch(error){
      $(recSources[key].use).checked=false;
      recWarn(error?.message&&!/Permission denied|NotAllowed/i.test(error.message)?error.message
        :(key==='mic'?'마이크를 열지 못했습니다. 주소창 왼쪽 자물쇠에서 권한을 확인해 주세요.':'화면·소리 공유가 취소되었습니다.'));
    }
  }
  const live=Object.keys(recSources).filter(key=>recSources[key].stream);
  if(!live.length){recSay('꺼짐');recWarn('녹음할 소리를 먼저 켜 주세요. 마이크나 시스템 소리 중 하나는 있어야 합니다.');return;}
  const type=recType(),together=document.querySelector('input[name=rec-mix]:checked').value==='together';
  recMixParts=[];for(const key of live)recSources[key].parts=[];
  const ctx=recContext();
  if(together){
    recMixed=ctx.createMediaStreamDestination();
    for(const key of live)recSources[key].gain.connect(recMixed);
    recMixRecorder=recStart(recMixed.stream,recMixParts,type);
  } else {
    for(const key of live){
      const out=ctx.createMediaStreamDestination();
      recSources[key].gain.connect(out);recSources[key].outlet=out;
      recSources[key].recorder=recStart(out.stream,recSources[key].parts,type);
    }
  }
  recRunning=true;recPaused=false;recFrom=Date.now();recHeld=0;recWave.length=0;
  recReady();recWatch();recSay('녹음 중',true);recClock();recClockTick=setInterval(recClock,250);
}
// WebM(Opus) 은 작지만 편집 프로그램에서 못 여는 경우가 있다. 브라우저가 이미 갖고 있는
// 디코더로 소리를 풀어 WAV(PCM 16비트)로 다시 쓴다. 바깥으로 나가는 것은 없다.
async function recToWav(blob){
  const bytes=await blob.arrayBuffer();
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  let sound;
  try{ sound=await ctx.decodeAudioData(bytes); } finally { ctx.close().catch(()=>{}); }
  const channels=sound.numberOfChannels, frames=sound.length, rate=sound.sampleRate;
  const tracks=[];for(let c=0;c<channels;c++)tracks.push(sound.getChannelData(c));
  const body=frames*channels*2;
  const out=new DataView(new ArrayBuffer(44+body));
  const tag=(at,text)=>{for(let i=0;i<text.length;i++)out.setUint8(at+i,text.charCodeAt(i));};
  tag(0,'RIFF');out.setUint32(4,36+body,true);tag(8,'WAVE');
  tag(12,'fmt ');out.setUint32(16,16,true);out.setUint16(20,1,true);      // 1 = PCM
  out.setUint16(22,channels,true);out.setUint32(24,rate,true);
  out.setUint32(28,rate*channels*2,true);out.setUint16(32,channels*2,true);out.setUint16(34,16,true);
  tag(36,'data');out.setUint32(40,body,true);
  let at=44;
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){
    const value=Math.max(-1,Math.min(1,tracks[c][i]));
    out.setInt16(at,value<0?value*0x8000:value*0x7fff,true);at+=2;
  }
  return new Blob([out.buffer],{type:'audio/wav'});
}
// 끝내면 바로 내려받지 않는다. 들어 보고 저장을 누를 때 내려받는다.
let recTakes=[];
function recShowTakes(){
  const host=$('rec-takes');host.replaceChildren();
  for(const take of recTakes){
    const card=document.createElement('div');card.className='rec-take';
    const head=document.createElement('div');head.className='rec-take-head';
    const label=document.createElement('span');label.textContent=take.name;
    const keep=document.createElement('button');keep.className='keep';keep.textContent='WebM 저장';
    keep.addEventListener('click',()=>{
      download(take.name,take.blob,take.blob.type||'audio/webm');
      take.kept=true;keep.textContent='저장됨';keep.classList.remove('keep');keep.classList.add('kept');
    });
    const wav=document.createElement('button');wav.className='wav';wav.textContent='WAV 저장';
    wav.addEventListener('click',async()=>{
      const was=wav.textContent;wav.disabled=true;wav.textContent='바꾸는 중…';
      try{
        const made=await recToWav(take.blob);
        download(take.name.replace(/\.webm$/i,'')+'.wav',made,'audio/wav');
        wav.textContent='저장됨';wav.classList.remove('wav');
      }catch{ wav.textContent=was;wav.disabled=false;notice('WAV 로 바꾸지 못했습니다. WebM 으로 저장해 주세요.'); }
    });
    const drop=document.createElement('button');drop.textContent='지우기';
    drop.addEventListener('click',()=>{
      URL.revokeObjectURL(take.url);recTakes=recTakes.filter(one=>one!==take);recShowTakes();
    });
    head.append(label,keep,wav,drop);
    const player=document.createElement('audio');player.controls=true;player.preload='metadata';player.src=take.url;
    card.append(head,player);host.append(card);
  }
}
function recFinish(recorder,bucket,name,type){
  return new Promise(done=>{
    if(!recorder||recorder.state==='inactive'){done(null);return;}
    recorder.onstop=()=>{
      if(!bucket.length){done(null);return;}
      const blob=new Blob(bucket,{type:type||'audio/webm'});
      done({name,blob,url:URL.createObjectURL(blob),kept:false});
    };
    recorder.stop();
  });
}
async function recEnd(){
  if(!recRunning)return;
  recRunning=false;recPaused=false;clearInterval(recClockTick);recClockTick=null;
  $('rec-hold').textContent='❚❚';recReady();recSay('마무리하는 중…');
  const type=recType(),when=recStamp(),made=[];
  const one=await recFinish(recMixRecorder,recMixParts,`녹음-${when}.webm`,type);
  if(one)made.push(one);
  for(const key of Object.keys(recSources)){
    const source=recSources[key];
    const take=await recFinish(source.recorder,source.parts,`녹음-${source.label}-${when}.webm`,type);
    if(take)made.push(take);
    if(source.outlet){try{source.gain&&source.gain.disconnect(source.outlet);}catch{}}
    source.recorder=null;source.outlet=null;source.parts=[];
  }
  if(recMixed)for(const key of Object.keys(recSources)){try{recSources[key].gain&&recSources[key].gain.disconnect(recMixed);}catch{}}
  recMixRecorder=null;recMixParts=[];recMixed=null;
  recTakes=made.concat(recTakes);recShowTakes();
  recSay(made.length?'들어 보고 저장을 누르세요':'녹음된 소리가 없습니다.');
}
event('rec-go','click',async()=>{ recRunning ? await recEnd() : await recBegin(); });
event('rec-stop','click',async()=>{ await recEnd(); });
event('rec-hold','click',()=>{
  const all=[recMixRecorder,...Object.values(recSources).map(s=>s.recorder)].filter(Boolean);
  if(!recPaused){
    all.forEach(r=>{if(r.state==='recording')r.pause();});
    recPaused=true;recHeldAt=Date.now();$('rec-hold').textContent='▶';recSay('잠시 멈춤',true);
  } else {
    recHeld+=Date.now()-recHeldAt;
    all.forEach(r=>{if(r.state==='paused')r.resume();});
    recPaused=false;$('rec-hold').textContent='❚❚';recSay('녹음 중',true);
  }
  recClock();
});
// 사이드바가 닫히면 녹음도 끝난다. 최소한 그때까지의 소리는 건진다.
window.addEventListener('pagehide',()=>{
  if(recRunning)recEnd().catch(()=>{});
  for(const key of Object.keys(recSources))recRelease(key);
  for(const take of recTakes)URL.revokeObjectURL(take.url);
});
event('tool-rec','toggle',()=>{ if($('tool-rec').open)recWatch(); else if(!recRunning)recStopWatching(); });
recReady();
event('rec-open','click',()=>chrome.windows.create({url:chrome.runtime.getURL('recorder.html'),type:'popup',width:520,height:820}));
// 조작 줄·영상·결과 목록이 스크롤 없이 들어가는 크기. 예전 760x620 은 단추가 잘렸다.
event('cam-open','click',()=>chrome.windows.create({url:chrome.runtime.getURL('camera.html'),type:'popup',width:820,height:860}));

async function loadTools(){
  const local=await chrome.storage.local.get(['bellTimes','bellOn','toneBell','volumeBell','toneAlarm','volumeAlarm','timerEndsAt','teams','watch','soundError']);
  $('bell-rows').replaceChildren();
  for(const time of local.bellTimes||[])bellRow(time);
  if(!(local.bellTimes||[]).length)bellRow('09:00');
  $('bell-on').checked=!!local.bellOn;
  $('bell-tone').value=local.toneBell||'school';
  $('bell-volume').value=local.volumeBell??70;
  $('bell-vol-out').textContent=$('bell-volume').value+'%';
  $('alarm-tone').value=local.toneAlarm||'chime';
  $('alarm-volume').value=local.volumeAlarm??60;
  $('vol-out').textContent=$('alarm-volume').value+'%';
  $('sound-note').textContent=local.soundError?('지난번 소리 재생 오류: '+local.soundError):'';
  if(local.timerEndsAt&&local.timerEndsAt>Date.now())timerDraw(local.timerEndsAt);
  teams=Array.isArray(local.teams)&&local.teams.length?local.teams:[{name:'',score:0},{name:'',score:0},{name:'',score:0},{name:'',score:0}];
  drawTeams();
  // 스톱워치는 사이드바를 닫아도 흐른다. 저장해 둔 시점에서 이어 그린다.
  const kept=local.watch||{};
  watchFrom=Number(kept.from)||0;watchHeld=Number(kept.held)||0;watchLaps=Array.isArray(kept.laps)?kept.laps:[];
  watchRun();watchLapList();
}
loadTools().catch(()=>{});
