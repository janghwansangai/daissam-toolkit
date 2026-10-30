// v0.43.0: 비밀 메모 표시 · PIN 만들기 · 그림이 한 메모에 쌓이기 · 붙여 넣은 그림 받기 · 연결이 끊긴 까닭 안내.
import test from 'node:test';import assert from 'node:assert/strict';import {createChrome} from './chrome-mock.mjs';
import {collectNotes,plainBackup,openBackup} from '../extension/lib/backup.js';
const mock=createChrome();globalThis.chrome=mock.chrome;
await import('../extension/background.js');
const send=(type,data={})=>mock.send({type,...data});
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
const device=()=>mock.data.local.device;

test('게스트는 PIN 이 없어 비밀 메모를 켜지 못하고, pin-make 로 만들면 잠금은 꺼진 채 PIN 이 생긴다',async()=>{
  assert.equal((await send('setup',{guest:true,name:'게스트'})).ok,true);
  assert.equal((await send('state')).data.guest,true);
  assert.equal((await send('note-save',{id:'s1',title:'통장',text:'비밀 내용 123'})).ok,true);
  const refused=await send('note-secret',{id:'s1',on:true});
  assert.equal(refused.ok,false);assert.match(refused.error,/PIN/);
  assert.equal((await send('pin-make',{pin:'12'})).ok,false,'짧은 PIN 은 받지 않는다');
  const made=await send('pin-make',{pin:'246810'});
  assert.equal(made.ok,true);
  assert.equal(made.data.guest,false);assert.equal(made.data.locked,false);
  assert.equal(made.data.startLocked,false);assert.equal(made.data.lockOnAway,false);
  assert.equal((await send('pin-make',{pin:'135790'})).ok,false,'이미 PIN 이 있으면 바꾸지 않는다');
});
test('비밀 표시는 켜고 · 글을 고쳐도 남고 · 끌 때는 맞는 PIN 이 필요하다',async()=>{
  assert.equal((await send('note-secret',{id:'s1',on:true})).ok,true);
  assert.equal(mock.data.local.pendingNotes.s1.secret,true);
  await send('note-flush');
  assert.equal(mock.data.sync['note_'+device()+'_s1'].secret,true,'동기화에도 표시가 간다');
  assert.equal((await send('note-save',{id:'s1',title:'통장',text:'비밀 내용 456'})).ok,true);
  assert.equal(mock.data.local.pendingNotes.s1.secret,true,'글만 고쳐도 비밀 표시가 남는다');
  assert.equal((await send('note-secret',{id:'s1',on:false,pin:'000000'})).ok,false);
  assert.equal(mock.data.local.pendingNotes.s1.secret,true,'틀린 PIN 이면 그대로');
  assert.equal((await send('note-secret',{id:'s1',on:false,pin:'246810'})).ok,true);
  assert.equal(mock.data.local.pendingNotes.s1.secret,undefined,'끄면 칸이 없어진다(예전 모양)');
  assert.equal((await send('note-secret',{id:'nope',on:true})).ok,false,'없는 메모는 거절');
  assert.equal((await send('note-secret',{id:'s1',on:false})).ok,false,'PIN 없이 끄지 못한다');
  assert.equal((await send('note-secret',{id:'../x',on:true})).ok,false,'이상한 id 는 거절');
});
test('다른 컴퓨터에서 켠 비밀 · 고정 표시는 이 컴퓨터의 옛 사본으로 고쳐도 사라지지 않는다',async()=>{
  mock.data.local.draftNotes={...mock.data.local.draftNotes,s2:{v:2,id:'s2',title:'옛 제목',text:'옛 글',time:1000,created:500,pinned:false,device:device()}};
  mock.data.sync.note_other_s2={v:2,id:'s2',title:'새 제목',text:'새 글',time:2000,created:500,pinned:true,secret:true,device:'other'};
  assert.equal((await send('note-save',{id:'s2',title:'새 제목',text:'이 컴퓨터에서 고친 글'})).ok,true);
  const saved=mock.data.local.pendingNotes.s2;
  assert.equal(saved.secret,true);assert.equal(saved.pinned,true);assert.equal(saved.created,500);
  // 고정은 가장 새 사본의 글로 한다 — 이 컴퓨터의 옛 글로 되돌리지 않는다.
  mock.data.sync.note_other_s3={v:2,id:'s3',title:'회의',text:'다른 컴퓨터에서 고친 글',time:Date.now()+60000,created:1,device:'other'};
  mock.data.local.draftNotes={...mock.data.local.draftNotes,s3:{v:2,id:'s3',title:'회의',text:'옛 글',time:1,created:1,device:device()}};
  assert.equal((await send('note-pin',{id:'s3',pinned:true})).ok,true);
  assert.equal(mock.data.local.pendingNotes.s3.text,'다른 컴퓨터에서 고친 글');
});
test('백업에도 비밀 표시가 따라간다',async()=>{
  const sync={['note_'+device()+'_b1']:{v:2,id:'b1',title:'비밀',text:'글',time:5,created:5,secret:true},['note_'+device()+'_b2']:{v:2,id:'b2',title:'보통',text:'글',time:5,created:6}};
  const notes=collectNotes(sync,{device:device()});
  assert.equal(notes.find(n=>n.id==='b1').secret,true);
  assert.equal('secret' in notes.find(n=>n.id==='b2'),false);
  const back=await openBackup(plainBackup({kind:'daissam-backup',notes,bookmarks:[],vault:{},images:{}}));
  assert.equal(back.payload.notes.find(n=>n.id==='b1').secret,true);
});
test('자동으로 가져온 그림은 ‘이미지’ 메모 하나에 쌓이고, 그 메모를 지우면 새로 만든다',async()=>{
  const status=await send('clip-toggle',{on:true});
  assert.equal(status.data.connected,true);
  const port=mock.nativePorts.at(-1);
  const image=n=>({kind:'image',file:'/Users/t/Desktop/캡처이미지/다있쌤-캡처-'+n+'.png',name:'다있쌤-캡처-'+n+'.png',thumb:'QUJD',width:800,height:600});
  port.onMessage.emit(image(1));await settle();
  port.onMessage.emit(image(2));await settle();
  const id=mock.data.local.imageNoteId;
  assert.ok(id);
  assert.equal(mock.data.local.draftNotes[id].title,'이미지');
  assert.equal(mock.data.local.noteImages[id].length,2,'두 장이 한 메모에');
  assert.equal(mock.data.local.lastImportId,id);assert.ok(mock.data.local.lastImportAt);
  assert.equal((await send('note-delete',{id})).ok,true);
  assert.equal(mock.data.local.noteImages[id],undefined,'지운 메모의 그림 목록도 빠진다');
  port.onMessage.emit(image(3));await settle();
  assert.notEqual(mock.data.local.imageNoteId,id,'지운 뒤에는 새 ‘이미지’ 메모');
  assert.equal(mock.data.local.noteImages[mock.data.local.imageNoteId].length,1);
});
test('사이드바가 붙여 넣은 그림을 받는다 — 모양을 검사하고 메모당 12장까지',async()=>{
  assert.equal((await send('note-image-add',{note:'p1',shot:{id:'x',thumb:'<script>'}})).ok,false,'base64 가 아니면 거절');
  assert.equal((await send('note-image-add',{note:'../p',shot:{thumb:'QUJD'}})).ok,false,'이상한 메모 id 거절');
  for(let i=0;i<12;i++){
    const r=await send('note-image-add',{note:'p1',shot:{id:'img-'+i,name:'붙인 그림',thumb:'QUJD',width:1920,height:1080}});
    assert.equal(r.ok,true);assert.equal(r.data.id,'img-'+i);
  }
  const full=await send('note-image-add',{note:'p1',shot:{id:'img-12',thumb:'QUJD'}});
  assert.equal(full.ok,false);assert.match(full.error,/12장/);
  const shot=mock.data.local.noteImages.p1.find(s=>s.id==='img-0');
  assert.equal(shot.file,'');assert.equal(shot.width,1920);
});
test('연결이 끊긴 까닭을 할 일로 적는다 — 옛 도우미(이 확장 ID 를 모름)',async()=>{
  await send('clip-toggle',{on:false});
  await send('clip-toggle',{on:true});
  const port=mock.nativePorts.at(-1);
  mock.chrome.runtime.lastError={message:'Access to the specified native messaging host is forbidden.'};
  port.onDisconnect.emit();delete mock.chrome.runtime.lastError;await settle();
  assert.equal(mock.data.local.clipboardImport,false);
  assert.match(mock.data.local.clipError,/옛 버전|모릅니다/);
  assert.match(mock.data.local.clipError,/forbidden/,'Chrome 의 원래 글도 남긴다');
});
test('잠긴 동안에는 비밀 메모 · PIN 만들기 · 그림 넣기를 받지 않는다',async()=>{
  await send('lock');
  for(const [type,data] of [['note-secret',{id:'s1',on:true}],['pin-make',{pin:'111111'}],['note-image-add',{note:'p1',shot:{thumb:'QUJD'}}]])
    assert.equal((await send(type,data)).ok,false,type);
});
