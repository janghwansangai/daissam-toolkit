import test from 'node:test';
import assert from 'node:assert/strict';
import {HOT_DEFAULTS,HOT_ORDER,hotParse,hotNorm,hotShow,hotFromEvent,hotCheck,hotText,hotClean} from '../extension/lib/keys.js';

const key=(code,mods={})=>({code,ctrlKey:!!mods.ctrl,altKey:!!mods.alt,shiftKey:!!mods.shift,metaKey:!!mods.meta});

test('조합을 읽고 한 가지 모양으로 적는다', () => {
  assert.equal(hotNorm('alt+ctrl+f'), 'ctrl+alt+F');      // 누른 차례가 달라도 같은 글
  assert.equal(hotNorm(' Ctrl + Shift + 7 '), 'ctrl+shift+7');
  assert.equal(hotParse('ctrl+alt+F5'), null);            // F 키는 두 운영체제가 이미 쓴다
  assert.equal(hotParse('ctrl+A+B'), null);
  assert.equal(hotParse('ctrl+alt'), null);
  assert.equal(hotParse(''), null);
});

test('맥은 기호로, 윈도우는 글자로 보여 준다', () => {
  assert.equal(hotShow('ctrl+alt+shift+M','mac'), '⌃⌥⇧M');
  assert.equal(hotShow('ctrl+alt+shift+M','win'), 'Ctrl+Alt+Shift+M');
  assert.equal(hotShow('망가진 값','mac'), '없음');
});

test('자판 배열과 입력기를 타지 않는 event.code 로 읽는다', () => {
  assert.equal(hotFromEvent(key('KeyF',{ctrl:true,alt:true})), 'ctrl+alt+F');
  assert.equal(hotFromEvent(key('Digit3',{ctrl:true,shift:true})), 'ctrl+shift+3');
  assert.equal(hotFromEvent(key('ShiftLeft',{shift:true})), '');   // 수정 키만 누른 것
  assert.equal(hotFromEvent(key('F5',{ctrl:true,alt:true})), '');
});

test('운영체제가 먼저 가져가는 조합은 막는다', () => {
  const set={...HOT_DEFAULTS};
  assert.equal(hotCheck('ctrl+F','mac','snip',set).ok, false);            // 수정 키 하나
  assert.equal(hotCheck('cmd+alt+G','mac','snip',set).ok, false);         // Command
  assert.equal(hotCheck('win+alt+G','win','snip',set).ok, false);         // Windows 키
  assert.equal(hotCheck('alt+shift+G','win','snip',set).ok, false);       // 키보드 배열 바꾸기
  assert.equal(hotCheck('alt+shift+G','mac','snip',set).ok, false);       // 맥은 특수문자
  assert.equal(hotCheck('ctrl+alt+F5','mac','snip',set).ok, false);
  assert.equal(hotCheck('ctrl+alt+shift+G','mac','snip',set).ok, true);   // Control 이 끼면 된다
  assert.equal(hotCheck('ctrl+alt+G','win','snip',set).ok, true);
});

test('이미 쓰는 조합은 거절하고, 자기 칸은 그대로 둔다', () => {
  const set={...HOT_DEFAULTS};
  const clash=hotCheck('ctrl+alt+F','mac','snip',set);   // 집중 모드가 쓰는 조합
  assert.equal(clash.ok, false);
  assert.equal(clash.taken, 'focus');
  assert.match(clash.why, /집중 모드’가 이미/);           // 받침 없는 말에는 ‘가’
  assert.equal(hotCheck('ctrl+alt+S','mac','snip',set).ok, true);  // 자기 칸은 겹침이 아니다
  assert.equal(hotCheck('ctrl+alt+P','mac','snip',set).taken, 'present');   // 발표 시작 칸도 함께 본다
});

test('윈도우에서 Ctrl+Shift 는 쓸 수는 있지만 Chrome 과 겹친다고 알린다', () => {
  const win=hotCheck('ctrl+shift+K','win','clear',HOT_DEFAULTS);
  assert.equal(win.ok, true);
  assert.match(win.warn, /Chrome/);
  assert.equal(hotCheck('ctrl+shift+K','mac','clear',HOT_DEFAULTS).warn, '');  // 맥 Chrome 은 ⌘⇧ 를 쓴다
});

test('앱에 보내는 글과, 망가진 값이 들어왔을 때의 되돌리기', () => {
  assert.equal(hotText(HOT_DEFAULTS),
    'present=ctrl+alt+P;focus=ctrl+alt+F;snip=ctrl+alt+S;clip=ctrl+alt+V;clear=ctrl+alt+D;unlock=ctrl+alt+T');
  const 고친것=hotClean({focus:'ctrl+shift+G',snip:'망가진 값',사라진칸:'ctrl+alt+Z'});
  assert.equal(고친것.focus, 'ctrl+shift+G');
  assert.equal(고친것.snip, HOT_DEFAULTS.snip);        // 못 읽으면 기본으로
  assert.equal(고친것.clip, HOT_DEFAULTS.clip);        // 빠진 칸도 기본으로
  assert.equal(고친것.사라진칸, undefined);             // 모르는 칸은 버린다
  assert.deepEqual(Object.keys(고친것).sort(), [...HOT_ORDER].sort());
  assert.deepEqual(hotClean(undefined), HOT_DEFAULTS);
});
