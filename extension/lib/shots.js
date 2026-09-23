// 캡처한 그림을 잠시 담아 두고(편집기로 넘기기 위해), 바탕화면 ‘캡처이미지’ 폴더·클립보드로
// 보낸다. 서비스 워커·사이드바·편집기가 모두 이 파일을 쓴다. 그림은 이 컴퓨터의 확장 저장소
// (IndexedDB)에만 머물고 어디로도 전송하지 않는다.
const HOST = 'app.browsersheriff.presenter';
const DB = 'dais-captures', STORE = 'shots', KEEP = 30;

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function run(mode, work) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = work(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result?.result ?? result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}
export async function putShot(blob, meta = {}) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await run('readwrite', store => store.put({id, blob, at: Date.now(), ...meta}));
  prune().catch(() => {});
  return id;
}
export function getShot(id) { return run('readonly', store => store.get(id)); }
export function dropShot(id) { return run('readwrite', store => store.delete(id)); }
// 오래된 것부터 지워 최근 KEEP 장만 남긴다. 저장소가 끝없이 불어나지 않게 한다.
async function prune() {
  const all = await run('readonly', store => store.getAllKeys());
  const keys = (all || []).slice().sort();
  if (keys.length <= KEEP) return;
  await run('readwrite', store => { for (const key of keys.slice(0, keys.length - KEEP)) store.delete(key); });
}

// 도우미에게 묻되 영원히 기다리지 않는다. 옛 도우미는 모르는 명령에 답하지 않고 가만히 있어서,
// 기다리기만 하면 캡처가 끝나지 않은 채 멈춰 있었다(실제 Chrome 에서 확인).
function ask(message, ms) {
  return Promise.race([
    chrome.runtime.sendNativeMessage(HOST, message),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}
const OLD_APP = '발표 도우미 앱이 답하지 않습니다. 옛 버전이면 이 기능을 모릅니다 — 발표 탭 → 발표 프로그램 다운로드에서 새 앱을 설치해 주세요.';
export function stamp(when = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}.${p(when.getMinutes())}.${p(when.getSeconds())}`;
}
export async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}
// 도우미 앱에 넘긴다. save: 바탕화면 ‘캡처이미지’ 폴더, copy: 클립보드.
// 도우미가 없으면 사람이 읽을 수 있는 이유를 담아 던진다.
export async function sendShot(blob, {save = true, copy = true} = {}) {
  const image = await toBase64(blob);
  let reply;
  try { reply = await ask({type: 'shot', image, save, copy, ext: blob.type === 'image/jpeg' ? 'jpg' : 'png'}, 20000); }
  catch (error) { throw new Error(error.message === 'timeout' ? OLD_APP : '발표 도우미 앱이 없어 바탕화면 저장·클립보드 복사를 하지 못했습니다. 발표 탭 → 발표 프로그램 다운로드에서 설치해 주세요.'); }
  if (!reply?.ok) throw new Error(reply?.kind === 'unknown' ? OLD_APP : reply?.message || '저장하지 못했습니다.');
  return reply;
}
export async function readText(blob) {
  const image = await toBase64(blob);
  let reply;
  try { reply = await ask({type: 'ocr', image}, 60000); }
  catch (error) { throw new Error(error.message === 'timeout' ? OLD_APP : '글자 뽑기는 발표 도우미 앱이 기기 안에서 합니다. 앱을 설치해 주세요.'); }
  if (!reply?.ok) throw new Error(reply?.kind === 'unknown' ? OLD_APP : reply?.message || '글자를 읽지 못했습니다.');
  return reply.text || '';
}
export function editorURL(id, extra = '') { return chrome.runtime.getURL('capture.html') + '#' + id + extra; }
// 캡처 한 장을 설정에 따라 보낸다.
//   editor: 편집기 열기   save: 폴더에 저장   copy: 클립보드   both: 저장+복사   ocr: 편집기+글자 뽑기
// 도우미가 없어 저장·복사를 못 하면 그림을 버리지 않고 편집기로 연다.
export async function deliver(blob, after, meta = {}) {
  if (after === 'save' || after === 'copy' || after === 'both') {
    try {
      const reply = await sendShot(blob, {save: after !== 'copy', copy: after !== 'save'});
      return {after, path: reply.path, copied: reply.copied};
    } catch (error) {
      const id = await putShot(blob, meta);
      await chrome.tabs.create({url: editorURL(id, '&why=' + encodeURIComponent(error.message))});
      return {after: 'editor', fallback: error.message};
    }
  }
  const id = await putShot(blob, meta);
  await chrome.tabs.create({url: editorURL(id, after === 'ocr' ? '&ocr=1' : '')});
  return {after: after === 'ocr' ? 'ocr' : 'editor'};
}
