// 확장이 직접 찍지 못하는 탭(about:blank · 새 탭 · chrome:// · 웹 스토어)을 위한 길.
// Chrome 의 화면 공유 고르기(getDisplayMedia)는 어떤 탭 · 창 · 화면이든 담을 수 있다. 다만 사람이 누른
// 직후에만 열리므로 이 작은 창의 단추로 연다. 한 장만 찍고 곧바로 공유를 끝낸다 — 녹화하지 않는다.
import {deliver} from './lib/shots.js';
import {captureOptions} from './capture-core.js';
const $ = id => document.getElementById(id);
const want = new URLSearchParams(location.hash.slice(1));
const mode = want.get('mode') || 'visible';
$('go').textContent = mode === 'area' ? '화면 고르기 → 편집기에서 자르기' : '화면 고르기';
$('cancel').addEventListener('click', () => window.close());
$('go').addEventListener('click', async () => {
  $('go').disabled = true; $('say').textContent = '';
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false, selfBrowserSurface: 'exclude'}); }
  catch { $('say').textContent = '고르기를 그만두었습니다. 다시 누르거나 창을 닫으세요.'; $('go').disabled = false; return; }
  try {
    const options = await captureOptions();
    const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
    await new Promise(resolve => setTimeout(resolve, 450));   // 고르기 창이 사라진 뒤의 화면
    const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = options.format === 'jpg'
      ? await canvas.convertToBlob({type: 'image/jpeg', quality: Math.max(.3, Math.min(1, options.quality / 100))})
      : await canvas.convertToBlob({type: 'image/png'});
    // 선택 영역은 편집기에서 자른다. 전체 페이지는 스크롤해 이을 수 없어 보이는 화면을 담는다.
    const after = mode === 'area' ? 'crop' : mode === 'ocr' ? 'ocr' : mode === 'full' ? 'editor' : (want.get('after') || options.after);
    await deliver(blob, after, {mode: 'screen', title: '화면 고르기'});
    window.close();
  } catch (error) {
    $('say').textContent = '찍지 못했습니다: ' + (error?.message || error); $('go').disabled = false;
  } finally { stream.getTracks().forEach(track => track.stop()); }
});
