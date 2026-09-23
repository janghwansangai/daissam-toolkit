// 발표 단축키의 규칙. 맥과 윈도우가 운영체제에 미리 내어 준 조합이 서로 달라 한 벌로
// 맞출 수 없다. 여기서는 글로 적어 둔 조합('ctrl+alt+F')을 읽고 쓰고, 고를 수 있는
// 조합인지 가린다. 발표 도우미 앱(Swift·C#)도 같은 글을 같은 규칙으로 읽는다.
export const HOT_DEFAULTS = {present:'ctrl+alt+P',focus:'ctrl+alt+F',snip:'ctrl+alt+S',clip:'ctrl+alt+V',clear:'ctrl+alt+D',unlock:'ctrl+alt+T'};
export const HOT_ORDER = ['present','focus','snip','clip','clear','unlock'];
export const HOT_LABEL = {present:'발표 시작 · 종료',focus:'집중 모드',snip:'화면 조각 자르기',clip:'클립보드 붙이기',clear:'핀 모두 닫기',unlock:'핀 클릭 통과'};
const MODS = ['ctrl','alt','shift','cmd'];
const MAC_SIGN = {ctrl:'⌃',alt:'⌥',shift:'⇧',cmd:'⌘'};
const WIN_SIGN = {ctrl:'Ctrl',alt:'Alt',shift:'Shift',cmd:'Win'};
// 주 키는 글자와 숫자만. F1~F12 는 맥에서 밝기·미션 컨트롤·VoiceOver 가, 윈도우에서
// 도움말·창 닫기가 이미 쓰고 있어 어느 쪽에서도 온전히 가져올 수 없다.
export function hotParse(text) {
  const mods = new Set();
  let main = '';
  for (const piece of String(text || '').split('+')) {
    const part = piece.trim().toLowerCase();
    if (!part) continue;
    if (part === 'ctrl' || part === 'control') mods.add('ctrl');
    else if (part === 'alt' || part === 'option' || part === 'opt') mods.add('alt');
    else if (part === 'shift') mods.add('shift');
    else if (part === 'cmd' || part === 'meta' || part === 'win') mods.add('cmd');
    else if (main) return null;
    else main = part.toUpperCase();
  }
  if (!/^[A-Z0-9]$/.test(main)) return null;
  return {mods, key: main};
}
// 저장하고 앱에 보낼 때 쓰는 한 가지 모양. 누른 차례가 달라도 같은 글이 된다.
export function hotNorm(text) {
  const combo = hotParse(text);
  return combo ? MODS.filter(m => combo.mods.has(m)).concat(combo.key).join('+') : '';
}
// 맥은 기호로, 윈도우는 글자로 보여 준다. 그 컴퓨터의 자판에 찍힌 대로 읽혀야 한다.
export function hotShow(text, os) {
  const combo = hotParse(text);
  if (!combo) return '없음';
  const mods = MODS.filter(m => combo.mods.has(m));
  return os === 'mac' ? mods.map(m => MAC_SIGN[m]).join('') + combo.key
                      : mods.map(m => WIN_SIGN[m]).concat(combo.key).join('+');
}
// 자판 배열과 입력기를 타지 않는 event.code 로 읽는다. 한글 입력 중에도 KeyF 는 KeyF 다.
export function hotFromEvent(event) {
  const code = event.code || '';
  let main = '';
  if (/^Key[A-Z]$/.test(code)) main = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) main = code.slice(5);
  if (!main) return '';
  const mods = [];
  if (event.ctrlKey) mods.push('ctrl');
  if (event.altKey) mods.push('alt');
  if (event.shiftKey) mods.push('shift');
  if (event.metaKey) mods.push('cmd');
  return mods.concat(main).join('+');
}
export function hotText(set) { return HOT_ORDER.map(action => action + '=' + hotNorm(set[action])).join(';'); }
// 못 읽는 값은 기본 조합으로 되돌린다. 단축키가 하나도 없는 상태로 남지 않게 한다.
export function hotClean(set) {
  const made = {...HOT_DEFAULTS, ...(set || {})};
  for (const action of HOT_ORDER) if (!hotParse(made[action])) made[action] = HOT_DEFAULTS[action];
  for (const key of Object.keys(made)) if (!HOT_ORDER.includes(key)) delete made[key];
  return made;
}
// 운영체제가 먼저 가져가는 조합은 등록해도 앱까지 오지 않는다. 눌러 보고 알기 전에 막는다.
export function hotCheck(combo, os, action, set, label = HOT_LABEL) {
  const parsed = hotParse(combo);
  if (!parsed) return {ok:false, why:'글자(A~Z)나 숫자(0~9) 하나를 함께 눌러 주세요. F1~F12는 두 운영체제 모두 밝기·도움말 같은 기능에 묶여 있어 쓸 수 없습니다.'};
  if (parsed.mods.has('cmd')) return {ok:false, why: os === 'mac'
    ? 'Command(⌘) 조합은 맥이 거의 다 쓰고 있습니다(⌘Space 스포트라이트, ⌘Tab 앱 바꾸기, ⌘⇧3·4·5 화면 캡처). Control·Option·Shift 로만 만들어 주세요.'
    : 'Windows(⊞) 키 조합은 윈도우가 먼저 가져갑니다. Ctrl·Alt·Shift 로만 만들어 주세요.'};
  if (parsed.mods.size < 2) return {ok:false, why:'수정 키를 두 개 이상 함께 눌러 주세요. 하나만 쓰면 다른 프로그램의 기능을 빼앗습니다.'};
  // Alt+Shift 는 윈도우에서 키보드 배열을 바꾸고, 맥에서는 특수문자를 넣는다. 두 곳 다 막는다.
  if (parsed.mods.has('alt') && parsed.mods.has('shift') && !parsed.mods.has('ctrl'))
    return {ok:false, why:'Alt+Shift는 윈도우에서 키보드 배열을 바꾸고, 맥에서는 특수문자를 넣습니다. Control(Ctrl)을 함께 눌러 주세요.'};
  const same = hotNorm(combo);
  const taken = HOT_ORDER.find(other => other !== action && hotNorm((set || {})[other]) === same);
  if (taken) return {ok:false, taken, why:'‘' + label[taken] + '’' + tail(label[taken]) + ' 이미 쓰고 있는 조합입니다. 그 칸을 먼저 다른 조합으로 바꿔 주세요.'};
  // Chrome 이 Ctrl+Shift 를 많이 쓴다(새 탭 되살리기·시크릿 창·개발자 도구). 막지는 않는다.
  const warn = (os === 'win' && parsed.mods.has('ctrl') && parsed.mods.has('shift') && !parsed.mods.has('alt'))
    ? 'Ctrl+Shift 조합은 Chrome이 많이 씁니다(새 탭 되살리기·시크릿 창·개발자 도구). 발표 중에는 그 기능이 멈춥니다.' : '';
  return {ok:true, warn};
}
function tail(word) {
  const last = String(word || '').trim().slice(-1);
  const code = last.charCodeAt(0);
  if (!(code >= 0xAC00 && code <= 0xD7A3)) return '가';
  return (code - 0xAC00) % 28 ? '이' : '가';
}
