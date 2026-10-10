// 웹페이지 캡처 — 보이는 부분 · 선택 영역 · 전체 페이지(스크롤하며 이어 붙이기).
// 서비스 워커에서 돈다. 그림은 OffscreenCanvas 로 자르고 붙이며, 어디로도 보내지 않는다.
import {deliver} from './lib/shots.js';

export const CAPTURE_DEFAULTS = {
  after: 'editor',      // editor · save · copy · both
  format: 'png',        // png · jpg
  quality: 92,          // JPG 품질
  delay: 3,             // 잠시 뒤 캡처(초)
  hideFixed: true,      // 전체 페이지: 둘째 장부터 떠 있는 머리글·버튼 숨기기
  hideScrollbar: true
};
export async function captureOptions() {
  const {captureOptions: saved} = await chrome.storage.local.get('captureOptions');
  return {...CAPTURE_DEFAULTS, ...(saved || {})};
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const isWeb = tab => /^https?:/i.test(tab?.url || '');
// strict: 지금 보고 있는 그 탭만 쓴다. 녹화('이 탭'·'선택 영역')는 몰래 다른 창의 탭으로
// 바꿔치기하면 안 된다 — 엉뚱한 화면이 녹화된다.
export async function targetTab({strict = false} = {}) {
  let [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true, windowType: 'normal'});
  if (strict) {
    if (!tab) throw new Error('브라우저 창을 찾지 못했습니다.');
    if (isWeb(tab)) return tab;
    // 앞에 있는 것이 우리 확장 페이지(편집기·설정 탭 등)면 사용자가 말하는 '이 탭' 이 아니다.
    // 같은 창에서 가장 최근에 보던 웹페이지를 쓴다.
    if ((tab.url || '').startsWith(chrome.runtime.getURL(''))) {
      const web = await chrome.tabs.query({windowId: tab.windowId, url: ['http://*/*', 'https://*/*']});
      const recent = web.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0)).pop();
      if (recent) return recent;
    }
    // 그 밖은 Chrome 이 보호하는 페이지다(새 탭·설정·확장 프로그램·웹 스토어).
    throw new Error('CHROME_PAGE');
  }
  // 찍는 것은 '지금 보고 있는 창' 의 탭이다. 예전에는 그 탭이 http(s) 가 아니면 다른 창의 웹페이지를 찾아가
  // 그 창이 갑자기 앞으로 나왔다(사용자 보고: '한 번씩 다른 창이 활성화되면서 그 창에서 캡처하라는 오류').
  // 확장은 tabs 권한이 없어 about:blank · data: · chrome:// 같은 탭의 주소를 볼 수 없다 — 주소로 가리지 않고
  // 실제로 찍어 보고(canGrab) 막히면 다른 길(화면 고르기 · 발표 도우미)로 간다.
  // 다른 창에서 찾는 것은 앞에 있는 창이 따로 띄운 도크(팝업)라 보통 창의 탭이 잡히지 않을 때뿐이다.
  if (!tab) {
    const normals = await chrome.tabs.query({active: true, windowType: 'normal'});
    let last = 0;
    try { last = (await chrome.storage.session.get('lastNormalWindow')).lastNormalWindow || 0; } catch {}
    tab = normals.find(one => one.windowId === last) || normals[normals.length - 1];
  }
  if (!tab) throw new Error('캡처할 탭을 찾지 못했습니다. 브라우저 창을 하나 열어 두고 다시 해 주세요.');
  // 앞에 있는 것이 우리 편집기 같은 확장 페이지면 같은 창에서 가장 최근에 보던 웹페이지를 찍는다.
  if ((tab.url || '').startsWith(chrome.runtime.getURL(''))) {
    const web = await chrome.tabs.query({windowId: tab.windowId, url: ['http://*/*', 'https://*/*']});
    const recent = web.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0)).pop();
    if (recent) { await chrome.tabs.update(recent.id, {active: true}); return recent; }
  }
  return tab;
}

// Chrome 이 이 탭을 확장에게 찍게 해 주는지 한 번 찍어 본다. 막히면 false.
// (주소 없는 창 about:blank · data: · 새 탭 · chrome:// 설정 · 웹 스토어 · 다른 확장 페이지)
const DENIED = /Cannot access|activeTab|permission|chrome:\/\/|extensions gallery|webstore/i;
async function canGrab(windowId) {
  try { await grab(windowId); return true; }
  catch (error) { if (DENIED.test(String(error?.message))) return false; throw error; }
}
// 이 탭은 확장이 못 찍는다 — background 가 받아 '화면 고르기' 로 넘긴다.
export const TAB_BLOCKED = 'TAB_BLOCKED';

// captureVisibleTab 은 1초에 두 번까지만 된다. 넘으면 Chrome 이 거절한다.
let lastGrab = 0;
async function grab(windowId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = lastGrab + 560 - Date.now();
    if (wait > 0) await sleep(wait);
    lastGrab = Date.now();
    try { return await chrome.tabs.captureVisibleTab(windowId, {format: 'png'}); }
    catch (error) {
      if (!/MAX_CAPTURE|quota/i.test(String(error?.message))) throw new Error('화면을 가져오지 못했습니다: ' + (error?.message || error));
    }
  }
  throw new Error('화면을 가져오지 못했습니다. 잠시 뒤 다시 해 주세요.');
}
async function bitmap(dataURL) { return createImageBitmap(await (await fetch(dataURL)).blob()); }
async function encode(canvas, options) {
  return options.format === 'jpg'
    ? canvas.convertToBlob({type: 'image/jpeg', quality: Math.max(.3, Math.min(1, options.quality / 100))})
    : canvas.convertToBlob({type: 'image/png'});
}

// ── 페이지 안에서 돌리는 함수들. executeScript 로 넣으므로 바깥 변수를 쓰면 안 된다. ──
// 끌어서 영역 고르기. 놓으면 덮개를 걷고 두 프레임 기다린 뒤 좌표를 돌려준다(덮개가 찍히지 않게).
function pickArea(hint) {
  return new Promise(resolve => {
    const old = document.getElementById('__dais_pick'); if (old) old.remove();
    const root = document.createElement('div');
    root.id = '__dais_pick';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(15,30,25,.28);user-select:none';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #dff39c;box-shadow:0 0 0 99999px rgba(15,30,25,.38);display:none;pointer-events:none';
    const size = document.createElement('div');
    size.style.cssText = 'position:fixed;padding:3px 7px;border-radius:6px;background:#173b36;color:#f6f9e9;font:12px/1.4 system-ui,sans-serif;display:none;pointer-events:none';
    const tip = document.createElement('div');
    tip.textContent = hint;
    tip.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);padding:9px 16px;border-radius:10px;background:#173b36;color:#f6f9e9;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none';
    root.append(box, size, tip);
    document.documentElement.append(root);
    let from = null;
    const finish = rect => {
      removeEventListener('keydown', key, true);
      root.remove();
      let done = false;
      const go = () => { if (!done) { done = true; setTimeout(() => resolve(rect), 40); } };
      requestAnimationFrame(() => requestAnimationFrame(go)); setTimeout(go, 300);
    };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    addEventListener('keydown', key, true);
    root.addEventListener('mousedown', e => { if (e.button !== 0) { finish(null); return; } from = {x: e.clientX, y: e.clientY}; e.preventDefault(); });
    root.addEventListener('contextmenu', e => { e.preventDefault(); finish(null); });
    root.addEventListener('mousemove', e => {
      if (!from) return;
      const x = Math.min(from.x, e.clientX), y = Math.min(from.y, e.clientY);
      const w = Math.abs(e.clientX - from.x), h = Math.abs(e.clientY - from.y);
      root.style.background = 'transparent'; tip.style.display = 'none';
      Object.assign(box.style, {display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px'});
      Object.assign(size.style, {display: 'block', left: x + 'px', top: Math.max(0, y - 26) + 'px'});
      size.textContent = Math.round(w) + ' × ' + Math.round(h);
    });
    root.addEventListener('mouseup', e => {
      if (!from) return;
      const x = Math.min(from.x, e.clientX), y = Math.min(from.y, e.clientY);
      const w = Math.abs(e.clientX - from.x), h = Math.abs(e.clientY - from.y);
      // 거의 움직이지 않았으면 보이는 화면 전체로 본다.
      finish(w < 6 || h < 6 ? {x: 0, y: 0, w: innerWidth, h: innerHeight, vw: innerWidth, vh: innerHeight}
                            : {x, y, w, h, vw: innerWidth, vh: innerHeight});
    });
  });
}
function measure() {
  const el = document.scrollingElement || document.documentElement;
  return {vw: innerWidth, vh: innerHeight, sh: el.scrollHeight, x: scrollX, y: scrollY};
}
// 스크롤바·부드러운 스크롤을 끄고, 끈적이는(sticky) 머리글은 제자리에 둔다.
function prepare(hideScrollbar) {
  const style = document.createElement('style');
  style.id = '__dais_full';
  style.textContent = 'html,body{scroll-behavior:auto!important}' +
    (hideScrollbar ? 'html{scrollbar-width:none!important}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important}' : '');
  document.documentElement.append(style);
  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).position === 'sticky') { el.setAttribute('data-dais-sticky', el.style.position || ''); el.style.setProperty('position', 'relative', 'important'); }
  }
}
// 둘째 장부터는 화면에 떠 있는 것(고정 머리글·채팅 단추)을 숨긴다. 그대로 두면 장마다 찍힌다.
function hideFloating() {
  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).position === 'fixed' && !el.hasAttribute('data-dais-hidden')) {
      el.setAttribute('data-dais-hidden', el.style.visibility || '');
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  }
}
function scrollStep(y) {
  window.scrollTo(0, y);
  return new Promise(resolve => {
    let done = false;
    const go = () => { if (!done) { done = true; setTimeout(() => resolve(scrollY), 120); } };
    requestAnimationFrame(() => requestAnimationFrame(go)); setTimeout(go, 400);
  });
}
function restore(x, y) {
  document.getElementById('__dais_full')?.remove();
  for (const el of document.querySelectorAll('[data-dais-hidden]')) { el.style.visibility = el.getAttribute('data-dais-hidden'); el.removeAttribute('data-dais-hidden'); }
  for (const el of document.querySelectorAll('[data-dais-sticky]')) { el.style.position = el.getAttribute('data-dais-sticky'); el.removeAttribute('data-dais-sticky'); }
  window.scrollTo(x, y);
}
// 찍기 전에 페이지를 살핀다.
//  · 잠금을 막 푼 직후에는 잠금 덮개(guard.js)가 아직 남아 있을 수 있다 — 걷힐 때까지 잠깐 기다린다.
//  · 화면에 보이지 않는 탭(다른 창에 가려졌거나 내려간 창)은 Chrome 이 다시 그리지 않아, 찍으면
//    예전 화면이 나온다(실제 Chrome 에서 확인: 가려진 창은 초당 0장). 그런 탭은 찍지 않는다.
// 숨은 탭에서는 requestAnimationFrame 이 오지 않으므로 기다림마다 시간 한도를 둔다.
function readyToShoot() {
  return new Promise(resolve => {
    const started = Date.now();
    const settle = () => {
      let done = false;
      const go = () => { if (!done) { done = true; resolve({visible: document.visibilityState === 'visible'}); } };
      requestAnimationFrame(() => requestAnimationFrame(go)); setTimeout(go, 300);
    };
    const check = () => {
      if (!document.querySelector('[data-browser-sheriff-guard]') || Date.now() - started > 2000) settle();
      else setTimeout(check, 80);
    };
    check();
  });
}
async function inPage(tabId, func, ...args) {
  const [result] = await chrome.scripting.executeScript({target: {tabId}, func, args});
  return result?.result;
}

// ── 캡처 방식 ──
export async function shootVisible(tab, options) {
  const picture = await bitmap(await grab(tab.windowId));
  const canvas = new OffscreenCanvas(picture.width, picture.height);
  canvas.getContext('2d').drawImage(picture, 0, 0);
  return encode(canvas, options);
}
export async function shootArea(tab, options) {
  const rect = await inPage(tab.id, pickArea, '끌어서 캡처할 곳을 고르세요 · 그냥 누르면 보이는 화면 전체 · Esc 취소');
  if (!rect) return null;
  const picture = await bitmap(await grab(tab.windowId));
  const scale = picture.width / rect.vw;
  const sx = Math.round(rect.x * scale), sy = Math.round(rect.y * scale);
  const w = Math.max(1, Math.min(picture.width - sx, Math.round(rect.w * scale)));
  const h = Math.max(1, Math.min(picture.height - sy, Math.round(rect.h * scale)));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(picture, sx, sy, w, h, 0, 0, w, h);
  return encode(canvas, options);
}
// Chrome 의 캔버스 한 변 한도(32767px) 안에서 멈춘다. 넘는 부분은 잘린다고 알린다.
const MAX_HEIGHT = 32000;
export async function shootFull(tab, options, progress = () => {}) {
  const start = await inPage(tab.id, measure);
  await inPage(tab.id, prepare, options.hideScrollbar !== false);
  let canvas = null, scale = 1, truncated = false, drawnTo = 0;
  try {
    const page = await inPage(tab.id, measure);
    const steps = Math.max(1, Math.ceil(page.sh / page.vh));
    let previous = -1;
    for (let index = 0; index < steps; index++) {
      const wanted = index * page.vh;
      const actual = await inPage(tab.id, scrollStep, wanted);
      // 문서가 아니라 안쪽 상자가 스크롤되는 페이지(메일·문서 편집기 등)는 더 내려가지 않는다.
      if (actual === previous) break;
      previous = actual;
      if (index === 1 && options.hideFixed !== false) { await inPage(tab.id, hideFloating); await sleep(60); }
      progress(index + 1, steps);
      const picture = await bitmap(await grab(tab.windowId));
      if (!canvas) {
        scale = picture.width / page.vw;
        const height = Math.round(page.sh * scale);
        truncated = height > MAX_HEIGHT;
        canvas = new OffscreenCanvas(picture.width, Math.min(MAX_HEIGHT, height));
      }
      const top = Math.round(actual * scale);
      canvas.getContext('2d').drawImage(picture, 0, top);
      drawnTo = top + picture.height;
      if (drawnTo >= canvas.height || actual + page.vh >= page.sh) break;
    }
  } finally {
    await inPage(tab.id, restore, start.x, start.y).catch(() => {});
  }
  const blob = await encode(canvas, options);
  return Object.assign(blob, {truncated});
}

// 찍을 탭이 뒤에 있으면 먼저 앞으로 가져온다. 따로 띄운 도크 창에서 부르면 늘 그렇다
// (도크가 앞이고 브라우저는 뒤라 '캡처할 탭이 화면에 보이지 않습니다' 로 막혔다).
// 가려진 탭은 Chrome 이 예전 화면을 주므로 앞으로 가져온 뒤 한 숨 기다린다.
async function bringUp(tab) {
  try {
    const win = await chrome.windows.get(tab.windowId);
    if (win.focused && win.state !== 'minimized') return;
    await chrome.windows.update(tab.windowId, {focused: true, ...(win.state === 'minimized' ? {state: 'normal'} : {})});
    await sleep(340);
  } catch {}
}

// 한 번 캡처하고 설정대로 보낸다. mode: visible · area · full · delay · ocr
export async function captureAndDeliver(mode, overrides = {}, progress = () => {}) {
  const options = {...await captureOptions(), ...overrides};
  const tab = await targetTab();
  await bringUp(tab);
  // 사이드바를 닫는 중이면 페이지가 넓어질 때까지 기다린다. 그러지 않으면 좁은 채로 찍힌다.
  if (overrides.widen) await waitWider(tab.id).catch(() => {});
  if (!(await canGrab(tab.windowId))) { const error = new Error(TAB_BLOCKED); error.mode = mode; throw error; }
  // 찍기는 되는데 페이지 안에 들어갈 수 없는 탭(data: 등)도 있다. 그때는 고르기 · 스크롤을 못 하므로
  // 보이는 부분을 찍어 편집기에서 자르게 한다.
  const reachable = await inPage(tab.id, () => true).then(() => true, () => false);
  if (!reachable) {
    const blob = await shootVisible(tab, options);
    const after = mode === 'area' ? 'crop' : mode === 'ocr' ? 'ocr' : mode === 'full' ? 'editor' : options.after;
    const result = await deliver(blob, after, {title: tab.title || '', url: tab.url || '', mode});
    return {...result, tabId: tab.id, bytes: blob.size,
      ...(mode === 'full' ? {fallback: '이 페이지는 스크롤해 이어 찍을 수 없어 보이는 부분만 담았습니다'} : {})};
  }
  const ready = await inPage(tab.id, readyToShoot).catch(() => ({visible: true}));
  if (ready && ready.visible === false)
    throw new Error('캡처할 탭이 화면에 보이지 않습니다. 그 창을 앞으로 가져온 뒤 다시 해 주세요.');
  if (mode === 'delay') {
    // 확장 아이콘의 숫자만으로는 언제 찍히는지 알기 어렵다(사용자 요청). 페이지 위에도 센다.
    for (let left = Math.max(1, Math.min(30, Number(options.delay) || 3)); left > 0; left--) {
      await chrome.action.setBadgeText({text: String(left)}).catch(() => {});
      await inPage(tab.id, countInPage, left).catch(() => {});
      progress(left, 0);
      await sleep(1000);
    }
    await chrome.action.setBadgeText({text: ''}).catch(() => {});
    await inPage(tab.id, countInPage, 0).catch(() => {});   // 세던 숫자를 지운다
    await sleep(240);                                       // 지운 것이 화면에 반영될 틈
  }
  let blob;
  if (mode === 'full') blob = await shootFull(tab, options, progress);
  else if (mode === 'area' || mode === 'ocr') blob = await shootArea(tab, options);
  else blob = await shootVisible(tab, options);
  if (!blob) return {cancelled: true};
  const after = mode === 'ocr' ? 'ocr' : options.after;
  const result = await deliver(blob, after, {title: tab.title || '', url: tab.url || '', mode});
  // 어느 탭을 찍었는지 함께 돌려준다. 끝난 뒤 그 탭 위에 결과를 알려 주기 위해서다
  // (사이드바를 닫은 탭과 찍은 탭이 다를 수 있다).
  return {...result, tabId: tab.id, truncated: !!blob.truncated, bytes: blob.size};
}

// 잠시 뒤 찍을 때 페이지 위에서 세는 숫자. 0 을 주면 지운다. 찍기 전에 반드시 지운다.
function countInPage(left) {
  const id = 'dais-count';
  const old = document.getElementById(id);
  if (!left) { if (old) old.remove(); return; }
  const box = old || document.createElement('div');
  if (!old) {
    box.id = id;
    Object.assign(box.style, {position: 'fixed', right: '22px', bottom: '22px', zIndex: '2147483647',
      width: '92px', height: '92px', borderRadius: '50%', background: 'rgba(23,59,54,.92)', color: '#dff39c',
      font: '800 42px/92px ui-monospace,SFMono-Regular,Menlo,monospace', textAlign: 'center',
      pointerEvents: 'none', boxShadow: '0 10px 24px rgba(0,0,0,.25)'});
    document.documentElement.append(box);
  }
  box.textContent = String(left);
}

// 사이드바가 닫히면 페이지가 그만큼 넓어진다. 넓어질 때까지(최대 1.3초) 기다린다.
export async function waitWider(tabId) {
  const start = await inPage(tabId, () => innerWidth);
  for (let step = 0; step < 14; step++) {
    await sleep(90);
    const now = await inPage(tabId, () => innerWidth);
    if (now > start) { await sleep(220); return true; }   // 다시 그릴 틈을 준다
  }
  return false;
}
// 녹화의 ‘선택 영역(이 탭)’ 도 같은 고르기 화면을 쓴다. 영상은 이 좌표로 잘라 담는다.
export async function pickTabArea(tab) {
  return inPage(tab.id, pickArea, '녹화할 곳을 끌어서 고르세요 · Esc 취소');
}
