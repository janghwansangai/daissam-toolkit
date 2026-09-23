import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal,assertPin} from '../extension/lib/crypto.js';
import {checkQuota,validateNote,safeURL,mergeBookmarks,editBookmark,noteList,validateTitle,validateNoteId,particle,editBookmarks,autoTitle,stampTitle} from '../extension/lib/data.js';
test('vault encrypts titles/URLs, rejects incorrect PIN and tampering',async()=>{
  const data={kind:'bookmarks',items:[{title:'private',url:'https://example.com'}]};
  const cipher=await seal('123456',data);assert.ok(!JSON.stringify(cipher).includes('private'));
  assert.deepEqual(await unseal('123456',cipher),data);
  await assert.rejects(()=>unseal('654321',cipher));
  await assert.rejects(()=>unseal('123456',{...cipher,c:'AAAA'+cipher.c.slice(4)}));
});
test('random salt/nonce for each write and strict PIN',async()=>{
  assert.notDeepEqual(await seal('123456',{}),await seal('123456',{}));
  // 최소 자리수는 4다. 세 자리·문자·전각 숫자·너무 긴 것은 그대로 거부한다.
  for(const bad of ['123','','abcdef','12a4','1234567890123','１２３４５６'])assert.throws(()=>assertPin(bad),undefined,bad+' 는 거부해야 한다');
  for(const good of ['1234','12345','123456789012'])assert.doesNotThrow(()=>assertPin(good),good+' 는 받아야 한다');
});
test('note byte limit includes Korean and quota failures never truncate',()=>{
  assert.equal(validateNote('한'.repeat(1800)).length,1800);assert.throws(()=>validateNote('한'.repeat(1900)));
  assert.throws(()=>checkQuota({},'note_a','x'.repeat(8000)));
  assert.throws(()=>checkQuota({other:'x'.repeat(95000)},'note_a','x'.repeat(2000)));
});
test('unsafe bookmark URLs rejected',()=>{
  for(const bad of ['javascript:alert(1)','file:///tmp/test','https://user:pass@example.com','data:text/plain,secret'])assert.throws(()=>safeURL(bad));
  assert.equal(safeURL('https://example.com'),'https://example.com/');
});
test('two offline devices preserve additions and delete tombstones',()=>{
  const a=editBookmark([],'a',{title:'A',url:'https://a.test',deleted:false},'device-a');
  const b=editBookmark([],'b',{title:'B',url:'https://b.test',deleted:false},'device-b');
  const merged=mergeBookmarks([{kind:'bookmarks',items:a},{kind:'bookmarks',items:b}]);assert.equal(merged.length,2);
  const deleted=editBookmark(merged,'a',{deleted:true},'device-b');
  const restored=mergeBookmarks([{kind:'bookmarks',items:a},{kind:'bookmarks',items:deleted}]);
  assert.equal(restored.filter(x=>!x.deleted).length,1);assert.equal(restored.find(x=>x.id==='a').deleted,true);
});
test('concurrent records merge deterministically independent of arrival order',()=>{
  const a=editBookmark([],'x',{title:'A',url:'https://a.test'},'a');const b=editBookmark([],'x',{title:'B',url:'https://b.test'},'b');
  const s=x=>({kind:'bookmarks',items:x});assert.deepEqual(mergeBookmarks([s(a),s(b)]),mergeBookmarks([s(b),s(a)]));
});
test('notes retain both device versions',()=>{
  const all={note_a:{v:1,text:'A',time:10},note_b:{v:1,text:'B',time:11},vault_a:{}};
  const [legacy]=noteList(all);
  assert.equal(legacy.id,'legacy');
  assert.deepEqual(legacy.versions.map(v=>v.text),['B','A']);
});
test('notes keep separate ids and the newest tombstone hides a note',()=>{
  const all={
    note_a_n1:{v:2,id:'n1',title:'회의',text:'첫째',time:10},
    note_b_n1:{v:2,id:'n1',title:'회의',text:'둘째',time:20},
    note_a_n2:{v:2,id:'n2',title:'장보기',text:'우유',time:15},
    note_b_n2:{v:2,id:'n2',title:'장보기',text:'',time:30,deleted:true},
    vault_a:{}
  };
  const list=noteList(all);
  assert.deepEqual(list.map(n=>n.id),['n1']);
  assert.equal(list[0].current.text,'둘째');
  assert.equal(list[0].versions.length,2);
  const revived={...all,note_a_n2:{v:2,id:'n2',title:'장보기',text:'다시',time:40}};
  assert.deepEqual(noteList(revived).map(n=>n.id),['n2','n1']);
});
test('note titles are trimmed and ids reject path characters',()=>{
  assert.equal(validateTitle('  긴   제목  '),'긴 제목');
  assert.equal(validateTitle(''),'새 메모');
  assert.equal(validateTitle('   '),'새 메모');
  assert.throws(()=>validateTitle('가'.repeat(41)));
  assert.equal(validateNoteId('legacy'),'legacy');
  assert.throws(()=>validateNoteId('note_x'));
  assert.throws(()=>validateNoteId('../evil'));
  assert.throws(()=>validateNoteId(''));
});
test('조사는 받침에 따라 갈리고 한글이 아니면 받침 없는 쪽을 쓴다',()=>{
  assert.equal(particle('문서','을','를'),'를');
  assert.equal(particle('보관함','을','를'),'을');
  assert.equal(particle('Example','을','를'),'를');
  assert.equal(particle('','을','를'),'를');
});
test('폴더와 링크가 함께 병합되고 폴더는 주소를 갖지 않는다',()=>{
  const items=[
    {id:'f1',rev:1,writer:'a',type:'folder',title:'업무'},
    {id:'b1',rev:1,writer:'a',title:'문서',url:'https://example.test/',folder:'f1'},
    {id:'b2',rev:1,writer:'a',title:'폴더 없는 링크',url:'https://other.test/'}
  ];
  const merged=mergeBookmarks([{kind:'bookmarks',items}]);
  assert.equal(merged.length,3);
  assert.equal(merged.find(i=>i.id==='b1').folder,'f1');
  assert.throws(()=>mergeBookmarks([{kind:'bookmarks',items:[{id:'f2',rev:1,writer:'a',type:'folder',title:'x',url:'https://a.test/'}]}]),/폴더/);
  assert.throws(()=>mergeBookmarks([{kind:'bookmarks',items:[{id:'b3',rev:1,writer:'a',title:'x',url:'https://a.test/',folder:7}]}]));
});
test('폴더를 지우면 안의 링크는 한 번에 폴더 없음으로 옮겨진다',()=>{
  const start=mergeBookmarks([{kind:'bookmarks',items:[
    {id:'f1',rev:1,writer:'a',type:'folder',title:'업무'},
    {id:'b1',rev:1,writer:'a',title:'문서',url:'https://example.test/',folder:'f1'}
  ]}]);
  const after=editBookmarks(start,[
    {id:'f1',fields:{deleted:true}},
    {id:'b1',fields:{title:'문서',url:'https://example.test/',folder:'',deleted:false}}
  ],'a');
  assert.equal(after.find(i=>i.id==='f1').deleted,true);
  assert.equal(after.find(i=>i.id==='b1').folder,'');
  assert.equal(after.find(i=>i.id==='b1').title,'문서');
});
test('메모 이름은 날짜와 시각이고 가져오기는 초까지 붙는다',()=>{
  const when=new Date(2026,8,18,15,4,7);
  assert.equal(stampTitle(when),'9/18 15:04');
  assert.equal(autoTitle(when),'9/18 15:04:07');
});
