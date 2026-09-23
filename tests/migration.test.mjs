import test from 'node:test';import assert from 'node:assert/strict';import {createChrome} from './chrome-mock.mjs';
// A separate file so this runs against its own worker instance with v0.1 data already in place.
const mock=createChrome({local:{device:'dev1',draftNote:{v:1,text:'옛 초안',time:5}},sync:{note_dev1:{v:1,text:'옛 메모',time:5,revision:'r1'}}});
globalThis.chrome=mock.chrome;
await import('../extension/background.js');
test('a v0.1 single note moves to the multi note layout without losing content',async()=>{
  await mock.send({type:'state'});
  assert.equal(mock.data.sync.note_dev1,undefined,'옛 키는 제거된다');
  assert.equal(mock.data.sync.note_dev1_legacy.text,'옛 메모');
  assert.equal(mock.data.sync.note_dev1_legacy.v,2);
  assert.equal(mock.data.sync.note_dev1_legacy.title,'빠른 메모');
  assert.equal(mock.data.local.draftNote,undefined);
  assert.equal(mock.data.local.draftNotes.legacy.text,'옛 초안');
});
