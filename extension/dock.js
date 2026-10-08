// 도크만 따로 띄운 작은 창. 단추 줄 하나뿐이고, 자리는 사용자가 제목 표시줄을 끌어 옮긴다.
// 처음 열 때만 화면 위쪽 가운데에 둔다. 누르는 것은 사이드바의 도크와 똑같은 명령을 보낸다.
const $ = id => document.getElementById(id);
let tipTimer = 0;
function tip(text, ms = 2600) {
  const box = $('tip');
  clearTimeout(tipTimer);
  if (!text) { box.hidden = true; box.textContent = ''; return; }
  box.textContent = text; box.hidden = false;
  tipTimer = setTimeout(() => { box.hidden = true; }, ms);
}
// 이름은 운영체제 풍선말(title)로 보여 준다 — 창에 줄을 더 만들지 않기 위해서다.
for (const button of document.querySelectorAll('[data-tip]')) button.title = button.dataset.tip;
async function api(type, data = {}) {
  const reply = await chrome.runtime.sendMessage({type, ...data});
  if (!reply?.ok) throw new Error(reply?.error || '확장에 연결할 수 없습니다.');
  return reply.data;
}
function act(id, run, saying) {
  $(id).addEventListener('click', async () => {
    tip(saying);
    try { await run(); } catch (error) {
      // 발표 도우미 앱이 없을 때는 무엇을 해야 하는지 짧게, 오래 보여 준다(사용자 보고: 눌러도 안내가 없다).
      const missing = String(error.message).startsWith('발표 도우미 앱이 필요합니다');
      tip(missing ? '⚠ 발표 도우미 앱이 필요합니다 · 사이드바 발표 탭에서 받으세요' : error.message, missing ? 8000 : 4000);
      return;
    }
    setTimeout(() => { refresh().catch(() => {}); }, 600);
  });
}
const present = action => api('presenter-command', {action});
act('d-present', () => present('start'), '발표를 시작합니다…');
act('d-stop', () => present('stop'), '발표를 끝냅니다…');
act('d-focus', () => present(state.focus ? 'focus-off' : 'focus-on'), '집중 모드…');
act('d-snip', () => present('snip'), '자를 곳을 끌어 주세요');
act('d-clip', () => present('pin-clip'), '클립보드를 붙입니다…');
act('d-through', () => present('pins-through'), '핀 클릭 통과…');
act('d-pins', () => present('pins-clear'), '핀을 모두 닫습니다…');
// 선택 영역은 '화면 전체에서' 고른다. 브라우저 탭만 찍으면 다른 앱도 다른 모니터도 담기지
// 않는다(사용자 보고). 발표 도우미 앱이 화면을 직접 찍어 폴더에 저장하고 복사까지 한다.
// 앱이 없으면 예전처럼 브라우저 탭에서 고른다.
act('d-area', async () => {
  try { await present('snip-save'); }
  catch { await api('capture', {mode: 'area', after: 'both', notify: true}); }
}, '화면에서 끌어 고르세요 · Esc 로 그만둡니다');
act('d-full', () => api('capture', {mode: 'full', after: 'both', notify: true}), '페이지를 내려가며 찍는 중…');
// 사이드바(다있쌤 패널) 다시 열기. 캡처·녹화 때 저절로 닫히므로 여기서 도로 연다.
// 누른 그 손길로 바로 열어야 Chrome 이 허락한다.
// 이 창은 팝업이라 '마지막 초점 창' 이 도크 자신이다. 보통 창을 따로 찾아야 한다 —
// 예전에는 그것을 놓쳐 이 단추가 늘 실패하고 안내만 띄웠다(사용자 보고).
async function browserWindow() {
  let last = 0;
  try { last = (await chrome.storage.session.get('lastNormalWindow')).lastNormalWindow || 0; } catch {}
  const windows = await chrome.windows.getAll({windowTypes: ['normal']});
  if (!windows.length) return 0;
  const found = windows.find(one => one.id === last) || windows.find(one => one.focused) || windows[windows.length - 1];
  return found?.id || 0;
}
$('d-panel').addEventListener('click', async () => {
  try {
    const windowId = await browserWindow();
    if (!windowId) throw new Error('브라우저 창이 없습니다. 창을 하나 열어 주세요.');
    await chrome.sidePanel.open({windowId});
    tip('사이드바를 열었습니다.');
  } catch (error) {
    tip(error?.message?.includes('user gesture') ? '확장 아이콘(✳)을 눌러 사이드바를 열어 주세요.' : (error.message || '사이드바를 열지 못했습니다.'));
  }
});
$('d-close').addEventListener('click', () => window.close());

// ── 창 자리 ──
// 처음 열 때는 화면 위쪽 가운데. 그 뒤로는 사용자가 옮긴 자리를 그대로 쓴다.
export const DOCK_SIZE = {width: 404, height: 76};
// 창 안쪽이 이만큼이면 단추 줄이 딱 들어간다. 바깥 크기는 제목 표시줄 두께만큼 더 크고,
// 그 두께는 Chrome 판마다 다르다(시험용 Chrome 에서는 88px 이나 됐다). 그래서 실제 안쪽을
// 재서 바깥 크기를 맞춘다. 이 손질이 없으면 단추 줄이 잘려 8px 만 보였다.
const INSIDE = {width: 404, height: 40};
async function fit() {
  for (let step = 0; step < 4; step++) {
    const me = await chrome.windows.getCurrent();
    const offY = INSIDE.height - innerHeight, offX = INSIDE.width - innerWidth;
    if (Math.abs(offY) <= 1 && Math.abs(offX) <= 1) return;
    await chrome.windows.update(me.id, {width: me.width + offX, height: me.height + offY});
    await new Promise(resolve => setTimeout(resolve, 130));
  }
}
async function firstPlace() {
  const {dockSpot} = await chrome.storage.local.get('dockSpot');
  const me = await chrome.windows.getCurrent();
  const box = dockSpot && Number.isFinite(dockSpot.left) ? {left: dockSpot.left, top: dockSpot.top}
    : {left: Math.round(screen.availLeft + (screen.availWidth - DOCK_SIZE.width) / 2), top: screen.availTop + 12};
  await chrome.windows.update(me.id, {state: 'normal', ...box, ...DOCK_SIZE});
  await fit();
}
// 사용자가 옮긴 자리를 기억한다. 창을 끌어도 페이지에는 알림이 오지 않으므로 가끔 들여다본다.
let lastSpot = '';
async function remember() {
  const me = await chrome.windows.getCurrent();
  if (me.state !== 'normal' || !Number.isFinite(me.left)) return;
  const now = me.left + ',' + me.top;
  if (now === lastSpot) return;
  lastSpot = now;
  await chrome.storage.local.set({dockSpot: {left: me.left, top: me.top}});
}

// ── 상태 ──
let state = {presenting: false, focus: false, pins: 0, through: 0};
function show() {
  $('d-present').classList.toggle('on', state.presenting);
  $('d-focus').classList.toggle('on', state.focus);
  $('d-pins').classList.toggle('on', state.pins > 0);
  $('d-through').classList.toggle('on', state.through > 0);
}
async function refresh() {
  try { state = {...state, ...await api('presenter-command', {action: 'state'})}; show(); } catch {}
}
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'capture-done') tip(message.text || ''); });
(async () => {
  await firstPlace().catch(() => {});
  await refresh();
  setInterval(() => { refresh().catch(() => {}); remember().catch(() => {}); }, 3000);
})();
