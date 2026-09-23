// 화면 녹화 창. 이 작은 창이 곧 컨트롤 바다(시간 · 일시 정지 · 마이크 · 멈춤).
// 화면은 Chrome 의 고르기 창(desktopCapture)이나 탭 캡처(tabCapture)로 받고, 마이크·탭 소리를
// 섞고, 카메라 얼굴이나 ‘선택 영역’ 자르기가 필요하면 한 장씩 다시 그려 담는다.
// 녹화 파일은 이 컴퓨터의 내려받기 폴더에만 저장하고 어디로도 보내지 않는다.
import {stamp} from './lib/shots.js';

const $ = id => document.getElementById(id);
const ask = new URLSearchParams(location.search);
const want = {
  mode: ask.get('mode') || 'desktop',
  tab: Number(ask.get('tab')) || 0,
  rect: ask.get('rect') ? JSON.parse(ask.get('rect')) : null,
  camera: ask.get('camera') === 'true', cameraId: ask.get('cameraId') || '', cameraName: ask.get('cameraName') || '',
  mic: ask.get('mic') !== 'false', micId: ask.get('micId') || '',
  controlBar: ask.get('controlBar') !== 'false',
  res: Number(ask.get('res')) || 1080, format: ask.get('format') || 'mp4',
  countdown: Math.max(0, Math.min(10, Number(ask.get('countdown')) || 0)),
  limit: Math.max(0, Number(ask.get('limit')) || 0),
  sound: ask.get('sound') !== 'false'
};
// 앱이 동그란 카메라 창을 띄울 상황인지. 화면을 받아 본 뒤에 정해진다 — 그 창은 '화면
// 전체' 를 담을 때만 영상에 들어가고, 창 하나나 탭을 고르면 그 밖이라 담기지 않는다
// (사용자 보고: 카메라가 화면에는 보이는데 녹화본에는 없음).
// 표시기에 보내는 모든 알림에 이 값을 함께 넣어야 한다 — 빠뜨리면 앱이 '카메라 꺼짐' 으로
// 읽고 띄운 창을 바로 닫는다(v0.33.0 에서 그랬다).
let cameraOnScreen = false;
const wantsCameraView = () => cameraOnScreen;
const SIZES = {720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160]};
const RATE = {720: 2.5e6, 1080: 5e6, 1440: 8e6, 2160: 16e6};
const NAMES = {desktop: '전체 화면', tab: '이 탭', area: '선택 영역(이 탭)'};
let screen = null, mic = null, cam = null, audio = null, recorder = null, chunks = [], started = 0, pausedFor = 0, pausedAt = 0;
let stopping = false, finished = null, ticker = 0, drawing = null, micGain = null;
const say = text => { $('say').textContent = text; };
$('what').textContent = NAMES[want.mode] || '';

// ── 화면 받기 ──
function choose(sources) {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(sources, (id, extra) => id ? resolve({id, audio: !!extra?.canRequestAudioTrack}) : reject(new Error('고르기를 그만두었습니다.')));
  });
}
async function desktopStream(id, withAudio) {
  const [maxWidth, maxHeight] = SIZES[want.res] || SIZES[1080];
  return navigator.mediaDevices.getUserMedia({
    audio: withAudio ? {mandatory: {chromeMediaSource: 'desktop', chromeMediaSourceId: id}} : false,
    video: {mandatory: {chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth, maxHeight, maxFrameRate: 30}}
  });
}
// 탭은 먼저 고르기 창 없이 바로 잡아 본다. Chrome 이 허락하지 않으면(확장 아이콘으로 연
// 탭이 아니면) 고르기 창에서 그 탭을 고르게 한다.
async function tabStream() {
  const [maxWidth, maxHeight] = SIZES[want.res] || SIZES[1080];
  try {
    const id = await chrome.tabCapture.getMediaStreamId({targetTabId: want.tab});
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: want.sound ? {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: id}} : false,
      video: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: id, maxWidth, maxHeight, maxFrameRate: 30}}
    });
    // 탭을 캡처하면 그 탭의 소리가 사용자에게서 끊긴다. 다시 스피커로 흘려 준다.
    if (stream.getAudioTracks().length) {
      const echo = new AudioContext(); echo.createMediaStreamSource(stream).connect(echo.destination);
    }
    return stream;
  } catch {
    say('Chrome 창에서 이 탭을 골라 주세요.');
    const picked = await choose(want.sound ? ['tab', 'audio'] : ['tab']);
    return desktopStream(picked.id, picked.audio && want.sound);
  }
}
// 고르기 창은 이 창이 초점을 잡은 뒤에 띄워야 한다. 사이드바가 닫히며 초점이 움직이는
// 순간과 겹치면 Chrome 이 고르기 창을 그대로 닫아 버린다('취소' 로 돌아온다).
async function focusMe() {
  let me = null;
  try { me = await chrome.windows.getCurrent(); } catch {}
  for (let step = 0; step < 12 && !document.hasFocus(); step++) {
    if (me) await chrome.windows.update(me.id, {focused: true}).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 90));
  }
  await new Promise(resolve => setTimeout(resolve, 120));
}
// 전체 화면은 브라우저의 표준 고르기(getDisplayMedia)로 받는다. 이것은 '사용자가 누른
// 직후' 에만 열리므로 녹화 창의 ‘화면 고르기’ 단추에서 바로 부른다. 확장 API 로 여는
// 고르기 창(desktopCapture)은 초점이 흔들리면 빈 목록으로 뜨거나 그대로 닫혔다(사용자 보고).
async function displayStream() {
  const [maxWidth, maxHeight] = SIZES[want.res] || SIZES[1080];
  const began = Date.now();
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {frameRate: {ideal: 30}},
      audio: want.sound,
      selfBrowserSurface: 'exclude',   // 녹화 창 자신은 고를 수 없게
      systemAudio: want.sound ? 'include' : 'exclude',
      surfaceSwitching: 'include'
    });
  } catch (error) {
    // 고르기 창이 뜨지도 않고 곧바로 돌아오는 일이 있다(맥에서 첫 시도). 사용자가 고른 것이
    // 아니므로, 확장이 여는 고르기 창으로 한 번 더 띄운다 — 이쪽은 손길이 없어도 열린다.
    if (Date.now() - began > 2500) throw error;
    say('고르기 창을 한 번 더 띄웁니다…');
    const picked = await choose(want.sound ? ['screen', 'window', 'tab', 'audio'] : ['screen', 'window', 'tab']);
    return desktopStream(picked.id, picked.audio && want.sound);
  }
  // 4K 화면을 그대로 담으면 너무 크다. 고른 해상도까지 줄여 달라고 부탁한다(안 되면 그대로).
  try { await stream.getVideoTracks()[0].applyConstraints({width: {max: maxWidth}, height: {max: maxHeight}}); } catch {}
  return stream;
}
async function getScreen() {
  if (want.mode === 'tab' || want.mode === 'area') return tabStream();
  return displayStream();
}
// Chrome 의 고르기 창은 이 창 안쪽에 맞춰 그려진다. 창이 작으면 고를 것들이 접혀 하나도
// 보이지 않는다(사용자 보고: 처음엔 아무것도 없고, 두 번째에는 창이 커지며 목록이 나왔다).
// 그래서 고르기 전에는 넉넉히 키우고, 화면을 받은 뒤 다시 작은 조작 줄로 돌아간다.
async function roomForPicker() {
  const me = await chrome.windows.getCurrent().catch(() => null);
  if (!me) return;
  // 이 파일의 screen 은 녹화 중인 화면 스트림이다. 화면 크기는 window.screen 으로 읽어야 한다
  // (전에도 같은 자리에서 물렸다 — 그냥 screen 을 쓰면 null 에서 멈춘다).
  const box = window.screen;
  const width = Math.min(940, Math.max(720, Math.round(box.availWidth * 0.62)));
  const height = Math.min(780, Math.max(600, Math.round(box.availHeight * 0.72)));
  await chrome.windows.update(me.id, {state: 'normal', width, height,
    left: Math.round(box.availLeft + (box.availWidth - width) / 2),
    top: Math.round(box.availTop + (box.availHeight - height) / 3), focused: true}).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 150));
}
async function backToBar() {
  const me = await chrome.windows.getCurrent().catch(() => null);
  if (!me) return;
  await chrome.windows.update(me.id, {width: 400, height: want.controlBar ? 214 : 190}).catch(() => {});
}

// ── 다시 그리기(카메라 얼굴 · 선택 영역). 창이 가려져도 멈추지 않게 프레임 단위로 처리한다. ──
// 카메라는 어느 녹화든 영상 안에 동그랗게 합쳐 넣는다. 예전에는 전체 화면 녹화일 때만
// 따로 창(bubble.html)을 띄웠는데, 그 창은 제목 표시줄이 붙은 네모라 화면에 네모 틀이
// 그대로 보였다. 이제 창은 없고 영상 안에만 동그라미가 남는다.
// 녹화 표시기: 발표 도우미 앱이 그리는 작은 창. 화면 녹화에 담기지 않고, 끌어서 옮길 수 있다.
// 앱이 없으면 false 가 돌아온다 — 그때는 이 창이 하나뿐인 조작 자리라 내리지 않는다.
async function badge(action, extra = {}) {
  try { const reply = await chrome.runtime.sendMessage({type: 'recorder-badge', action, ...extra}); return !!reply?.data?.sent; }
  catch { return false; }
}
chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'recorder-button') return;
  if (message.button === 'pause') $('pause').click();
  else if (message.button === 'stop') stop();
  else if (message.button === 'cancel') $('cancel').click();
});
// 전체 화면 녹화에서는 발표 도우미 앱이 동그란 카메라 창을 화면에 띄운다(그 모습이 화면에
// 보이고 녹화에도 그대로 담긴다). 정말 떴는지는 앱 상태로 확인하고, 못 띄웠으면 예전처럼
// 영상 안에 합쳐 넣는다. 탭·선택 영역 녹화는 그 창이 담기는 자리 밖이라 늘 합쳐 넣는다.
async function appCameraUp() {
  for (let step = 0; step < 12; step++) {
    await new Promise(resolve => setTimeout(resolve, 220));
    try {
      const reply = await chrome.runtime.sendMessage({type: 'presenter-command', action: 'state'});
      if (reply?.ok && reply.data?.camera) return true;
    } catch { return false; }
  }
  return false;
}
async function composed(videoTrack) {
  const settings = videoTrack.getSettings();
  let cut = null;
  if (want.mode === 'area' && want.rect) {
    const k = (settings.width || 1) / want.rect.vw;
    cut = {x: Math.round(want.rect.x * k), y: Math.round(want.rect.y * k), w: Math.max(2, Math.round(want.rect.w * k)) & ~1, h: Math.max(2, Math.round(want.rect.h * k)) & ~1};
  }
  const width = cut ? cut.w : settings.width, height = cut ? cut.h : settings.height;
  const canvas = new OffscreenCanvas(width, height), c = canvas.getContext('2d');
  let face = null;
  const camTrack = cam?.getVideoTracks()[0];
  if (camTrack && 'MediaStreamTrackProcessor' in window) {
    const reader = new MediaStreamTrackProcessor({track: camTrack}).readable.getReader();
    (async () => { for (;;) { const {value, done} = await reader.read(); if (done) break; face?.close(); face = value; } })().catch(() => {});
  }
  const paintFace = () => {
    if (!face) return;
    const d = Math.round(Math.min(width, height) * .24), x = width - d - Math.round(d * .18), y = height - d - Math.round(d * .18);
    const sw = face.displayWidth, sh = face.displayHeight, s = Math.min(sw, sh);
    c.save(); c.beginPath(); c.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); c.clip();
    c.drawImage(face, (sw - s) / 2, (sh - s) / 2, s, s, x, y, d, d); c.restore();
    c.save(); c.lineWidth = Math.max(3, d * .03); c.strokeStyle = '#dff39c'; c.beginPath(); c.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); c.stroke(); c.restore();
  };
  if ('MediaStreamTrackProcessor' in window && 'MediaStreamTrackGenerator' in window) {
    const reader = new MediaStreamTrackProcessor({track: videoTrack}).readable.getReader();
    const out = new MediaStreamTrackGenerator({kind: 'video'}), writer = out.writable.getWriter();
    drawing = {stop: () => { reader.cancel().catch(() => {}); writer.close().catch(() => {}); face?.close(); }};
    (async () => {
      for (;;) {
        const {value: frame, done} = await reader.read(); if (done) break;
        if (cut) c.drawImage(frame, cut.x, cut.y, cut.w, cut.h, 0, 0, width, height); else c.drawImage(frame, 0, 0, width, height);
        paintFace();
        const next = new VideoFrame(canvas, {timestamp: frame.timestamp}); frame.close();
        await writer.write(next).catch(() => {}); next.close();
      }
    })().catch(() => {});
    return out;
  }
  // 옛 Chrome: 보이는 창에서만 그려진다. 그래서 이 경우에는 창을 내리지 않는다.
  const video = document.createElement('video'); video.muted = true; video.srcObject = new MediaStream([videoTrack]); await video.play();
  const shown = document.createElement('canvas'); shown.width = width; shown.height = height;
  const sc = shown.getContext('2d'); let alive = true;
  const loop = () => { if (!alive) return; if (cut) sc.drawImage(video, cut.x, cut.y, cut.w, cut.h, 0, 0, width, height); else sc.drawImage(video, 0, 0, width, height); c.drawImage(shown, 0, 0); requestAnimationFrame(loop); };
  loop(); drawing = {stop: () => { alive = false; }, visibleOnly: true};
  return shown.captureStream(30).getVideoTracks()[0];
}

// ── 소리 섞기 ──
function mixAudio() {
  const tracks = [...(screen?.getAudioTracks() || []), ...(mic?.getAudioTracks() || [])];
  if (!tracks.length) return [];
  audio = new AudioContext();
  const out = audio.createMediaStreamDestination();
  for (const track of screen?.getAudioTracks() || []) audio.createMediaStreamSource(new MediaStream([track])).connect(out);
  if (mic?.getAudioTracks().length) {
    micGain = audio.createGain(); audio.createMediaStreamSource(mic).connect(micGain).connect(out);
  }
  return out.stream.getAudioTracks();
}
function pickType() {
  const mp4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const type of want.format === 'mp4' ? [...mp4, ...webm] : webm) if (MediaRecorder.isTypeSupported(type)) return type;
  return '';
}

// ── 시간 ──
const clock = ms => { const s = Math.floor(ms / 1000); return (s >= 3600 ? String(Math.floor(s / 3600)).padStart(2, '0') + ':' : '') + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const elapsed = () => (pausedAt ? pausedAt : Date.now()) - started - pausedFor;
let badgeAt = 0;
function tick() {
  const text = clock(elapsed());
  $('clock').textContent = text;
  // 표시기는 1초에 한 번만 건드린다(도우미를 거쳐 앱까지 가는 길이라).
  if (Date.now() - badgeAt > 900) {
    badgeAt = Date.now();
    badge('update', {time: text, paused: recorder?.state === 'paused', camera: want.camera,
      cameraView: wantsCameraView(), cameraName: want.cameraName});
  }
  if (want.limit && elapsed() >= want.limit * 60000) stop();
}
async function countdown() {
  if (!want.countdown) return;
  const box = $('count'); box.hidden = false;
  for (let left = want.countdown; left > 0; left--) { box.textContent = String(left); await new Promise(r => setTimeout(r, 1000)); }
  box.hidden = true;
}

// ── 시작 · 멈춤 ──
async function start(fromClick) {
  $('fix').hidden = true; $('mac-help').hidden = true;
  try {
    // 손길로 부른 경우에는 이미 이 창이 앞에 있다. 그때 초점을 또 건드리면 고르기 창이 닫힌다.
    if (!fromClick) await focusMe();
    if (want.mode === 'desktop') await roomForPicker();
    screen = await getScreen();
    // 무엇을 골랐나: monitor(화면 전체) · window(창 하나) · browser(탭).
    const surface = screen.getVideoTracks()[0].getSettings().displaySurface || '';
    cameraOnScreen = want.camera && want.mode === 'desktop' && surface === 'monitor';
    if (want.mode === 'desktop') await backToBar();
    if (want.mic) {
      try { mic = await navigator.mediaDevices.getUserMedia({audio: {...(want.micId ? {deviceId: {exact: want.micId}} : {}), echoCancellation: true, noiseSuppression: true}}); }
      catch { say('마이크를 쓸 수 없어 소리 없이 녹화합니다.'); }
    }
    // 표시기(와 전체 화면이면 동그란 카메라 창)를 먼저 띄운다. 무엇을 합쳐 담을지가 여기서 갈린다.
    // camera 는 표시기에 '카메라' 라고 적기 위한 것이고, cameraView 는 앱이 동그란 창을
    // 띄울지다. 탭·선택 영역 녹화에서는 그 창이 담기지 않으므로 영상 안에 합쳐 넣는다.
    const onBadge = await badge('show', {time: '00:00', camera: want.camera,
      cameraView: wantsCameraView(), cameraName: want.cameraName});
    const appCam = onBadge && cameraOnScreen ? await appCameraUp() : false;
    if (want.camera && !appCam && cameraOnScreen) cameraOnScreen = false;   // 못 띄웠으니 영상 안에 합친다
    if (want.camera && !appCam) {
      try { cam = await navigator.mediaDevices.getUserMedia({video: {...(want.cameraId ? {deviceId: {exact: want.cameraId}} : {}), width: {ideal: 640}, height: {ideal: 640}}}); }
      catch { say('카메라를 쓸 수 없어 화면만 녹화합니다.'); }
    }
    const source = screen.getVideoTracks()[0];
    const video = (cam || (want.mode === 'area' && want.rect)) ? await composed(source) : source;
    const type = pickType();
    recorder = new MediaRecorder(new MediaStream([video, ...mixAudio()]), {mimeType: type || undefined, videoBitsPerSecond: RATE[want.res] || RATE[1080]});
    // 창을 내리면 setInterval 이 느려진다(숨은 창은 Chrome 이 아껴 쓴다). 이 이벤트는
    // 녹화기 자신이 1초마다 주는 것이라 느려지지 않는다 — 시계와 표시기를 여기서도 민다.
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); if (started) tick(); };
    recorder.onstop = finish;
    // Chrome 의 ‘공유 중지’ 를 눌러도 여기서 멈추고 저장 화면으로 간다.
    source.addEventListener('ended', () => stop());
    await countdown();
    // 센 숫자와 이 초록 창이 첫 장면에 함께 담기던 문제(사용자 보고: '1' 이 녹화에 남음).
    // 세고 나서 창을 먼저 내리고, 화면이 가라앉은 뒤에 녹화를 시작한다.
    const away = (onBadge || !want.controlBar) && !drawing?.visibleOnly;
    if (away) {
      const me = await chrome.windows.getCurrent();
      await chrome.windows.update(me.id, {state: 'minimized'}).catch(() => {});
    }
    await new Promise(resolve => setTimeout(resolve, away ? 420 : 280));
    recorder.start(1000);
    started = Date.now(); ticker = setInterval(tick, 250); tick();
    $('dot').className = 'dot live';
    for (const id of ['pause', 'stop']) $(id).disabled = false;
    $('mute').disabled = !micGain;
    say(type.startsWith('video/mp4') || want.format !== 'mp4' ? '녹화 중입니다. 끝나면 ■ 를 누르세요.' : '녹화 중입니다. 이 Chrome 은 MP4 를 만들 수 없어 WebM 으로 저장합니다.');
    // 창은 이미 녹화 전에 내렸다(위). 내리지 못한 경우에만 그 뜻을 알린다.
    if (!away && want.controlBar) {
      say('녹화 중입니다. 끝나면 ■ 를 누르세요. (발표 도우미 앱이 없어 이 창을 띄워 둡니다 — 녹화에 함께 담깁니다.)');
    }
  } catch (error) {
    cleanup();
    $('dot').className = 'dot';
    const gaveUp = error?.name === 'NotAllowedError' || error?.message === '고르기를 그만두었습니다.';
    say(gaveUp ? '화면을 고르지 않았습니다. 아래 단추로 다시 고르세요.' : '녹화를 시작하지 못했습니다: ' + (error?.message || error));
    $('retry').textContent = '화면 고르기 다시';
    $('fix').hidden = false;
    // 맥에서 ‘전체 화면·창’ 이 흐리게 나오는 것은 Chrome 에 화면 기록 권한이 없어서다.
    if (want.mode === 'desktop' && /Mac/i.test(navigator.userAgent)) $('mac-help').hidden = false;
    $('cancel').textContent = '닫기';
    // 안내가 들어갈 만큼 창을 키우고 앞으로 가져온다(고르기 창이 초점을 가져갔을 수 있다).
    const me = await chrome.windows.getCurrent().catch(() => null);
    if (me) chrome.windows.update(me.id, {state: 'normal', height: $('mac-help').hidden ? 260 : 380, focused: true}).catch(() => {});
  }
}
function stop() {
  if (stopping || !recorder || recorder.state === 'inactive') return;
  stopping = true; recorder.stop();
}
function cleanup() {
  clearInterval(ticker);
  badge('hide');
  drawing?.stop();
  for (const stream of [screen, mic, cam]) stream?.getTracks().forEach(track => track.stop());
  audio?.close().catch(() => {});
}
async function finish() {
  cleanup();
  $('dot').className = 'dot';
  if (!chunks.length) { say('녹화된 것이 없습니다.'); return; }
  finished = new Blob(chunks, {type: recorder.mimeType || 'video/webm'});
  const ext = finished.type.startsWith('video/mp4') ? 'mp4' : 'webm';
  finished.fileName = `다있쌤-녹화-${stamp()}.${ext}`;
  $('controls').hidden = true; $('say').hidden = true; $('done').hidden = false;
  $('preview').src = URL.createObjectURL(finished);
  $('meta').textContent = `${clock(elapsed())} · ${(finished.size / 1048576).toFixed(1)}MB · ${ext.toUpperCase()} — 저장하기 전에 한 번 확인해 보세요.`;
  const me = await chrome.windows.getCurrent();
  chrome.windows.update(me.id, {state: 'normal', width: 760, height: 620, focused: true}).catch(() => {});
}
$('pause').addEventListener('click', () => {
  if (!recorder) return;
  if (recorder.state === 'recording') { recorder.pause(); pausedAt = Date.now(); $('pause').textContent = '다시 녹화'; $('dot').className = 'dot paused'; say('잠시 멈췄습니다.'); }
  else if (recorder.state === 'paused') { recorder.resume(); pausedFor += Date.now() - pausedAt; pausedAt = 0; $('pause').textContent = '일시 정지'; $('dot').className = 'dot live'; say('녹화 중입니다.'); }
});
$('mute').addEventListener('click', () => {
  if (!micGain) return;
  const off = micGain.gain.value > 0; micGain.gain.value = off ? 0 : 1;
  $('mute').textContent = off ? '마이크 켜기' : '마이크 끄기';
});
$('stop').addEventListener('click', stop);
$('cancel').addEventListener('click', () => { chunks = []; if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); } cleanup(); window.close(); });
$('save').addEventListener('click', () => {
  if (!finished) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(finished); a.download = finished.fileName; a.click();
  $('meta').textContent = `내려받기 폴더에 ‘${finished.fileName}’ 으로 저장했습니다.`;
});
$('again').addEventListener('click', () => location.reload());
$('retry')?.addEventListener('click', () => start(true));
// 시스템 설정의 ‘화면 및 시스템 오디오 녹음’ 을 연다. 발표 도우미 앱이 대신 열어 준다.
$('open-privacy')?.addEventListener('click', async () => {
  try { await chrome.runtime.sendMessage({type: 'screen-settings'}); say('시스템 설정을 열었습니다. Google Chrome 을 켜고 Chrome 을 다시 시작해 주세요.'); }
  catch { say('시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 녹음에서 Google Chrome 을 켜 주세요.'); }
});
$('close').addEventListener('click', () => window.close());
addEventListener('beforeunload', e => { if (recorder && recorder.state !== 'inactive') { e.preventDefault(); e.returnValue = ''; } });
// 탭·선택 영역은 고르기 창 없이 바로 시작한다. 전체 화면은 '화면 고르기' 를 누른 그 손길로
// 열어야 Chrome 이 고르기 창을 제대로 띄운다 — 그래서 여기서는 단추만 보여 준다.
if (want.mode === 'desktop') {
  say('무엇을 녹화할지 고르세요 — 전체 화면 · 다른 앱 창 · Chrome 탭.');
  $('fix').hidden = false;
  // 창이 초점을 잡기 전에 누르면, 맥에서는 그 첫 누름이 창을 앞으로 가져오는 데만 쓰이고
  // 단추까지 닿지 않는다(‘첫 번째에는 아무 일도 안 생긴다’ 의 원인). 먼저 앞으로 가져온다.
  focusMe().then(() => $('retry').focus()).catch(() => {});
} else {
  start();
}
