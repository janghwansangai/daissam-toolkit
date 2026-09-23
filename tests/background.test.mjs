import test from 'node:test';import assert from 'node:assert/strict';import {createChrome} from './chrome-mock.mjs';import {seal} from '../extension/lib/crypto.js';import {noteList} from '../extension/lib/data.js';
const mock=createChrome();globalThis.chrome=mock.chrome;
await import('../extension/background.js');
const send=async(type,data={},sender)=>{const r=await mock.send({type,...data},sender);return r;};
test('profile setup, guard rule, PIN failure, correct unlock, startup lock',async()=>{
  let r=await send('setup',{pin:'123456',name:'Test'});assert.equal(r.ok,true);assert.equal(r.data.locked,false);
  r=await send('lock');assert.equal(r.data.locked,true);assert.equal(mock.rules.size,1);const revision=r.data.revision;
  const rule=[...mock.rules.values()][0];
  assert.equal(rule.action.type,'redirect');
  assert.equal(rule.action.redirect.regexSubstitution,'chrome-extension://test/locked.html#\\0');
  assert.equal(rule.condition.resourceTypes[0],'main_frame');
  assert.equal((await send('unlock',{pin:'654321'})).ok,false);assert.equal(mock.rules.size,1);
  r=await send('unlock',{pin:'123456'});assert.equal(r.ok,true);assert.ok(r.data.revision>revision);assert.equal(mock.rules.size,0);
  mock.events.start.emit();r=await send('state');assert.equal(r.data.locked,true);assert.equal(mock.rules.size,1);
});
test('web content cannot invoke profile unlock or data writes',async()=>{
  const sender={url:'https://example.test',tab:{id:1,windowId:1}};
  assert.equal((await send('unlock',{pin:'123456'},sender)).ok,false);
  assert.equal((await send('note-save',{id:'legacy',text:'attack'},sender)).ok,false);
});
test('oversized note survives locally without overwriting cloud copy',async()=>{
  await send('unlock',{pin:'123456'});
  assert.equal((await send('note-save',{id:'legacy',title:'빠른 메모',text:'valid draft'})).ok,true);await send('note-flush');
  const key='note_'+mock.data.local.device+'_legacy';assert.equal(mock.data.sync[key].text,'valid draft');
  const large='한'.repeat(1900);assert.equal((await send('note-save',{id:'legacy',text:large})).ok,false);
  assert.equal(mock.data.local.draftNotes.legacy.text,large);assert.equal(mock.data.local.pendingNotes.legacy,undefined);
  await send('note-flush');assert.equal(mock.data.sync[key].text,'valid draft');
});
test('quota failure preserves retry and a later flush succeeds',async()=>{
  mock.data.sync.filler='x'.repeat(96000);await send('note-save',{id:'legacy',text:'offline draft'});await send('note-flush');
  assert.ok(mock.data.local.pendingNotes.legacy);assert.ok(mock.data.local.noteSyncError);
  delete mock.data.sync.filler;await send('note-flush');assert.equal(mock.data.local.pendingNotes.legacy,undefined);
});
test('two panel writes use compare-and-swap and reject stale snapshot',async()=>{
  const first=await seal('123456',{kind:'bookmarks',items:[]});
  const second=await seal('123456',{kind:'bookmarks',items:[]});
  assert.equal((await send('vault-commit',{blob:first,expected:null})).ok,true);
  assert.equal((await send('vault-commit',{blob:second,expected:null})).ok,false);
  assert.deepEqual(mock.data.sync['vault_'+mock.data.local.device],first);
});
test('several notes keep their own sync keys and delete leaves a tombstone',async()=>{
  const device=mock.data.local.device;
  assert.equal((await send('note-save',{id:'aaa',title:'회의 준비',text:'첫 메모'})).ok,true);
  assert.equal((await send('note-save',{id:'bbb',title:'장보기',text:'둘째 메모'})).ok,true);
  await send('note-flush');
  assert.equal(mock.data.sync['note_'+device+'_aaa'].text,'첫 메모');
  assert.equal(mock.data.sync['note_'+device+'_bbb'].title,'장보기');
  assert.equal((await send('note-save',{id:'../evil',text:'x'})).ok,false);
  assert.equal((await send('note-delete',{id:'aaa'})).ok,true);
  assert.equal(mock.data.sync['note_'+device+'_aaa'].deleted,true);
  assert.equal(mock.data.local.draftNotes.aaa,undefined);
  const ids=noteList(mock.data.sync).map(note=>note.id);
  assert.ok(ids.includes('bbb'));assert.ok(!ids.includes('aaa'));
});
test('locked profile rejects note and vault mutations',async()=>{
  await send('lock');assert.equal((await send('note-save',{id:'legacy',text:'no'})).ok,false);
  assert.equal((await send('note-delete',{id:'bbb'})).ok,false);
  assert.equal((await send('vault-commit',{blob:{v:1,c:'cipher'}})).ok,false);
});
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
test('가져오기는 건마다 날짜·시각 이름의 새 메모가 되고 캡처는 동기화되지 않는다',async()=>{
  await send('unlock',{pin:'123456'});
  const status=await send('clip-toggle',{on:true});
  assert.equal(status.data.connected,true);
  const port=mock.nativePorts.at(-1);
  assert.deepEqual(port.sent[0],{type:'start'});

  port.onMessage.emit({kind:'text',text:'첫 번째 복사'});
  await settle();
  port.onMessage.emit({kind:'text',text:'두 번째 복사'});
  await settle();
  const drafts=Object.values(mock.data.local.draftNotes);
  const first=drafts.find(note=>note.text==='첫 번째 복사');
  const second=drafts.find(note=>note.text==='두 번째 복사');
  assert.ok(first&&second,'두 건이 모두 저장된다');
  assert.notEqual(first.id,second.id,'연속 가져오기는 따로 저장된다');
  assert.match(first.title,/^\d+\/\d+ \d\d:\d\d:\d\d$/,'이름은 날짜와 시각이다');

  const file='/Users/tester/Desktop/보완관-캡처-20260918-101500.png';
  port.onMessage.emit({kind:'image',file,name:'보완관-캡처-20260918-101500.png',thumb:'QUJD',width:1200,height:800});
  await settle();
  const shot=Object.values(mock.data.local.draftNotes).find(note=>note.text===''&&mock.data.local.noteImages[note.id]);
  assert.ok(shot,'캡처도 새 메모를 만든다');
  assert.equal(mock.data.local.noteImages[shot.id].length,1);
  assert.equal(mock.data.local.noteImages[shot.id][0].file,file);
  assert.ok(!Object.keys(mock.data.sync).some(key=>key.startsWith('image')),'캡처는 동기화하지 않는다');

  assert.equal((await send('clip-copy',{file})).ok,true);
  assert.deepEqual(port.sent.at(-1),{type:'copy-file',file});

  await send('lock');
  assert.equal((await send('clip-state')).data.connected,false);
});
test('a helper that is not registered turns the toggle back off',async()=>{
  await send('unlock',{pin:'123456'});
  mock.native.available=false;
  const status=await send('clip-toggle',{on:true});
  assert.equal(status.data.connected,false);
  assert.equal(mock.data.local.clipboardImport,false);
  assert.match(mock.data.local.clipError,/클립보드 도우미/);
  assert.equal((await send('clip-copy',{file:'/tmp/x.png'})).ok,false);
  mock.native.available=true;
});
test('제거 시 로그아웃 기능은 완전히 빠졌다',async()=>{
  await send('unlock',{pin:'123456'});
  // 되지 않는 기능이었으므로 흔적까지 지운다. 예전에 켜 둔 주소도 비워져 있어야 한다.
  assert.equal(mock.uninstallURL.value,'','제거 주소는 늘 비어 있다');
  const r=await send('settings',{name:'Test',idleMinutes:0});
  assert.equal(r.ok,true);
  assert.equal(r.data.logoutOnRemove,undefined,'상태에 남아 있지 않다');
  assert.equal(mock.uninstallURL.value,'');
  assert.equal((await send('uninstall-safe',{pin:'123456'})).ok,false,'안전 제거 명령도 사라졌다');
  assert.equal((await send('settings',{name:'Test',idleMinutes:7})).ok,false,'잘못된 시간은 그대로 거부');
});
test('사이드바 발표 명령은 도우미로 그대로 전달된다',async()=>{
  await send('unlock',{pin:'123456'});
  const r=await send('presenter-command',{action:'focus',dim:0.7,blur:14,ring:'#ff5533',ringSize:80});
  assert.equal(r.ok,true);
  assert.equal(r.data.kind,'presenter');
  const sent=mock.nativeMessages.at(-1);
  assert.equal(sent.name,'app.browsersheriff.presenter');
  assert.deepEqual(sent.message,{type:'presenter',action:'focus',dim:'0.7',blur:'14',ring:'#ff5533',ringSize:'80'});
  // 단축키도 앱까지 가야 한다. 이 이름을 빠뜨려 앱이 늘 기본 조합만 듣던 적이 있다.
  await send('presenter-command',{action:'snip',keys:'present=ctrl+alt+P;focus=ctrl+shift+G'});
  assert.equal(mock.nativeMessages.at(-1).message.keys,'present=ctrl+alt+P;focus=ctrl+shift+G');
  const knobs=await send('presenter-command',{dim:0.2});
  assert.equal(knobs.ok,true);
  assert.equal(mock.nativeMessages.at(-1).message.action,undefined,'조절값만 보낼 수도 있다');
  mock.native.available=false;
  assert.equal((await send('presenter-command',{action:'start'})).ok,false,'도우미가 없으면 안내로 끝난다');
  mock.native.available=true;
});
test('잠금 화면의 게스트 버튼은 도우미가 없으면 시크릿 창으로 대신한다',async()=>{
  const page={url:'https://example.test',tab:{id:1,windowId:1}};
  await send('unlock',{pin:'123456'});
  mock.native.available=true;
  let r=await send('guest-window',{});
  assert.equal(r.data.mode,'guest','도우미가 있으면 게스트 창');
  mock.native.available=false;
  r=await send('guest-window',{});
  assert.equal(r.data.mode,'incognito','없으면 시크릿 창');
  mock.native.available=true;
  await send('lock');
  assert.equal((await send('guest-window',{},page)).ok,true,'잠금 화면에서도 쓸 수 있다');
});
test('부팅 잠금과 자리 비움 잠금은 따로 켜고 끈다',async()=>{
  await send('unlock',{pin:'123456'});
  const first=(await send('state')).data;
  assert.equal(first.startLocked,true,'부팅 잠금 기본값은 켜짐');
  assert.equal(first.lockOnAway,true,'자리 비움 잠금 기본값도 켜짐');

  // 둘 다 켜진 상태: 재시작과 화면 잠금 모두에서 잠긴다
  mock.events.start.emit();
  await new Promise(r=>setTimeout(r,30));
  assert.equal((await send('state')).data.locked,true,'재시작하면 잠긴다');
  await send('unlock',{pin:'123456'});
  mock.events.idleEvent.emit('locked');
  await new Promise(r=>setTimeout(r,30));
  assert.equal((await send('state')).data.locked,true,'화면이 잠기면 잠긴다');

  // 자리 비움만 끈다: 부팅 잠금은 그대로 남아야 한다
  await send('unlock',{pin:'123456'});
  await send('settings',{name:'Test',idleMinutes:0,startLocked:true,lockOnAway:false});
  assert.equal((await send('state')).data.lockOnAway,false);
  mock.events.idleEvent.emit('locked');
  await new Promise(r=>setTimeout(r,30));
  assert.equal((await send('state')).data.locked,false,'자리 비움을 끄면 화면 잠금에 반응하지 않는다');
  mock.data.session={};                       // 브라우저를 닫으면 세션 저장소가 비워진다
  mock.events.start.emit();
  await new Promise(r=>setTimeout(r,30));
  assert.equal((await send('state')).data.locked,true,'자리 비움을 꺼도 재시작하면 잠긴다');

  // 부팅 잠금을 끄면 재시작해도 열린 채로 남는다
  await send('unlock',{pin:'123456'});
  await send('settings',{name:'Test',idleMinutes:0,startLocked:false,lockOnAway:false});
  mock.data.session={};
  mock.events.start.emit();
  await new Promise(r=>setTimeout(r,30));
  assert.equal((await send('state')).data.locked,false,'끄면 재시작해도 열린 상태');

  await send('unlock',{pin:'123456'});
  await send('settings',{name:'Test',idleMinutes:0,startLocked:true,lockOnAway:true});
});
test('Command 휠 배율은 Chrome 과 같은 계단을 밟고 설정으로 끌 수 있다',async()=>{
  await send('unlock',{pin:'123456'});
  assert.equal((await send('state')).data.wheelZoom,true,'기본값은 켜짐');
  const page=(step)=>mock.chrome.runtime.onMessage.listeners.length
    ? new Promise((done,fail)=>{
        let handled=false;
        for(const listener of mock.chrome.runtime.onMessage.listeners){
          if(listener({type:'page-zoom',step},{tab:{id:7}},r=>{handled=true;r?.ok?done(r.data):fail(new Error(r?.error));})===true)handled=true;
        }
        if(!handled)done(undefined);
      })
    : Promise.resolve(undefined);
  assert.equal(await page(1),1.1,'한 칸 키우면 110%');
  assert.equal(await page(1),1.25,'다음 칸은 125%');
  assert.equal(await page(-1),1.1,'되돌리면 110%');
  assert.equal(await page(-1),1,'원래 크기');
  assert.equal(await page(-1),0.9,'더 줄이면 90%');

  await send('settings',{name:'Test',idleMinutes:0,startLocked:true,lockOnAway:true,wheelZoom:false});
  assert.equal((await send('state')).data.wheelZoom,false);
  assert.equal(await page(1),false,'끄면 배율을 바꾸지 않는다');
  assert.equal(await mock.chrome.tabs.getZoom(7),0.9,'끈 뒤에는 그대로');
  await send('settings',{name:'Test',idleMinutes:0,startLocked:true,lockOnAway:true,wheelZoom:true});
});
test('발표 명령은 앱이 알려 준 현재 상태를 함께 돌려준다',async()=>{
  await send('unlock',{pin:'123456'});
  mock.native.presenter={presenting:false,focus:false};
  let r=await send('presenter-command',{action:'state'});
  assert.equal(r.data.presenting,false,'발표 전에는 꺼짐으로 온다');
  assert.equal(mock.nativeMessages.at(-1).message.action,'state');
  mock.native.presenter={presenting:true,focus:false};
  r=await send('presenter-command',{action:'start'});
  assert.equal(r.data.presenting,true);
  mock.native.presenter={presenting:true,focus:true};
  r=await send('presenter-command',{action:'focus-on'});
  assert.equal(r.data.focus,true);
  mock.native.presenter={presenting:false,focus:false};
});
test('타이머·시보·알림음이 알람과 소리로 이어진다',async()=>{
  await send('unlock',{pin:'123456'});
  const t=await send('tool-timer',{seconds:90});
  assert.ok(t.data.endsAt>Date.now());
  assert.ok(mock.alarmNames2.has('utility-timer'));
  mock.events.alarmsEvent.emit({name:'utility-timer'});
  await new Promise(r=>setTimeout(r,40));
  assert.equal(mock.notified.at(-1).title,'타이머','알림이 뜬다');
  assert.equal(mock.data.local.timerEndsAt,0,'끝나면 비워진다');
  assert.equal((await send('tool-timer-stop')).ok,true);

  const bells=await send('tool-bells',{times:['09:00','25:99','13:40'],on:true});
  assert.deepEqual(bells.data.times,['09:00','13:40'],'잘못된 시각은 걸러진다');
  assert.ok(mock.alarmNames2.has('bell-0')&&mock.alarmNames2.has('bell-1'));
  mock.events.alarmsEvent.emit({name:'bell-0'});
  await new Promise(r=>setTimeout(r,40));
  assert.equal(mock.notified.at(-1).title,'수업 시보');

  await send('tool-bells',{times:[],on:false});
  assert.ok(!mock.alarmNames2.has('bell-0'),'끄면 알람이 사라진다');
});
test('소리는 값을 주소에 실어 재생하고 시보와 타이머가 따로 논다',async()=>{
  await send('unlock',{pin:'123456'});
  assert.equal((await send('tool-sound',{kind:'bell',tone:'school',volume:80,preview:true})).ok,true);
  assert.equal(mock.data.local.toneBell,'school');
  assert.equal(mock.data.local.volumeBell,80);
  // 예전에는 문서를 띄운 뒤 메시지를 보내 소리가 나지 않았다. 이제 값이 주소에 실린다.
  assert.match(mock.offscreen.url,/tone=school/);
  assert.match(mock.offscreen.url,/volume=80/);
  assert.match(mock.offscreen.url,/repeat=2/,'시보는 두 번 울린다');
  await send('tool-sound',{kind:'alarm',tone:'soft',volume:35,preview:true});
  assert.equal(mock.data.local.toneAlarm,'soft');
  assert.equal(mock.data.local.toneBell,'school','시보 설정은 그대로');
  assert.match(mock.offscreen.url,/tone=soft/);
  assert.match(mock.offscreen.url,/repeat=1/);
});
test('팀 포인트 판은 값을 다듬어 저장한다',async()=>{
  await send('unlock',{pin:'123456'});
  const r=await send('tool-teams',{teams:[{name:'파랑',score:3},{name:'x'.repeat(40),score:99999},{name:'빨강',score:-5000}]});
  assert.equal(r.data.teams.length,3);
  assert.equal(r.data.teams[0].score,3);
  assert.equal(r.data.teams[1].name.length,20,'이름은 20자로 자른다');
  assert.equal(r.data.teams[1].score,9999,'점수 상한');
  assert.equal(r.data.teams[2].score,-999,'점수 하한');
});
test('메모 핀은 저장된 메모에만 걸리고 내용을 유지한다',async()=>{
  await send('unlock',{pin:'123456'});
  assert.equal((await send('note-pin',{id:'nope',pinned:true})).ok,false,'없는 메모는 거부');
  await send('note-save',{id:'keep',title:'수업 순서',text:'1교시 안내'});
  assert.equal((await send('note-pin',{id:'keep',pinned:true})).ok,true);
  assert.equal(mock.data.local.draftNotes.keep.pinned,true);
  assert.equal(mock.data.local.draftNotes.keep.text,'1교시 안내','핀을 걸어도 내용은 그대로');
  await send('note-save',{id:'keep',title:'수업 순서',text:'1교시 안내 · 고침'});
  assert.equal(mock.data.local.draftNotes.keep.pinned,true,'다시 저장해도 핀이 유지된다');
  assert.equal((await send('note-pin',{id:'keep',pinned:false})).ok,true);
  assert.equal(mock.data.local.draftNotes.keep.pinned,false);
});
test('유튜브 뮤직 조종은 열린 탭에서만 하고 없으면 탭을 연다',async()=>{
  await send('unlock',{pin:'123456'});
  const r=await send('music-control',{action:'toggle'});
  assert.equal(r.ok,true);
  assert.equal(r.data.now,'곡 제목 — 가수');
});

test('빈 메모는 동기화하지 않고, 글이 들어가면 그때 올라간다',async()=>{
  await send('unlock',{pin:'123456'});
  const id='11111111-1111-4111-8111-111111111111';
  const key='note_'+mock.data.local.device+'_'+id;
  // 캡처가 만든 메모: 제목만 있고 글은 비어 있다. 그림은 이 기기에만 남는다.
  assert.equal((await send('note-save',{id,title:'캡처',text:''})).ok,true);
  await send('note-flush');
  assert.equal(mock.data.sync[key],undefined,'빈 메모가 동기화로 넘어갔다');
  assert.equal(mock.data.local.pendingNotes[id],undefined,'보내지 않기로 한 메모가 대기줄에 남았다');
  assert.equal(mock.data.local.draftNotes[id].title,'캡처','이 기기에서는 메모가 사라지면 안 된다');
  // 공백만 있는 것도 빈 것으로 본다.
  await send('note-save',{id,title:'캡처',text:'   \n  '});await send('note-flush');
  assert.equal(mock.data.sync[key],undefined);
  // 글을 쓰면 그때 올라간다.
  await send('note-save',{id,title:'캡처',text:'이제 내용이 있다'});await send('note-flush');
  assert.equal(mock.data.sync[key].text,'이제 내용이 있다');
  // 이미 올라간 메모를 비운 것은 그대로 반영한다. 기기끼리 어긋나면 안 된다.
  await send('note-save',{id,title:'캡처',text:''});await send('note-flush');
  assert.equal(mock.data.sync[key].text,'');
  // 지움 표시는 글이 비어 있어도 반드시 건너가야 한다.
  await send('note-delete',{id});
  assert.equal(mock.data.sync[key].deleted,true);
});

test('note-save 는 글을 쓴 창을 남겨 사이드바가 제 글을 남의 글로 보지 않게 한다',async()=>{
  await send('unlock',{pin:'123456'});
  const id='22222222-2222-4222-8222-222222222222';
  await send('note-save',{id,title:'ㅁ',text:'가',tag:'abcd1234'});
  assert.equal(mock.data.local.lastNoteWriter,'abcd1234');
  await send('note-save',{id,title:'ㅁ',text:'가나',tag:'ffff0000'});
  assert.equal(mock.data.local.lastNoteWriter,'ffff0000');
});
test('캡처는 잠긴 프로필과 웹페이지에서는 부를 수 없다',async()=>{
  await send('unlock',{pin:'123456'});
  await send('lock');
  const locked=await send('capture',{mode:'visible',after:'editor'});
  assert.equal(locked.ok,false);assert.match(locked.error,/잠금/);
  await send('unlock',{pin:'123456'});
  const fromWeb=await send('capture',{mode:'visible'},{url:'https://example.test',tab:{id:1,windowId:1}});
  assert.equal(fromWeb.ok,false,'웹페이지가 캡처를 시켜 남의 화면을 가져가지 못한다');
});
