// 자동 백업(이 컴퓨터의 문서/다있쌤 백업 폴더) — 이름 짓기 · 읽기 · 보관 기간 정리 규칙. 순수 함수만 둔다.
// 파일 쓰기 · 읽기는 발표 도우미 앱이 한다(확장은 문서 폴더에 쓸 수 없다). 그래서 확장을 지웠다 다시 깔아도 파일은 남는다.
//
// 파일 이름: daissam-backup_2026-10-17_14-30-05_change_ab12cd.json
//   날짜 · 시각(이 컴퓨터 시각) · 종류 · 기기(확장 설치마다 다른 번호 앞 6자리)
// 종류: daily(하루 1번) · change(메모 · 북마크가 바뀐 뒤) · manual(지금 백업) · before-restore(복구하기 직전의 안전 사본)
export const KINDS = ['daily', 'change', 'manual', 'before-restore'];
export const KIND_LABEL = {daily: '하루 1번', change: '바뀐 뒤', manual: '직접', 'before-restore': '복구 직전'};
export const NAME_PATTERN = /^daissam-backup_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_(daily|change|manual|before-restore)_([0-9a-f]{6})\.json$/;
export const KEEP_DAYS = 31;          // 한 달이 지난 것은 지운다
export const KEEP_NEWEST = 3;         // 단, 가장 최근 것 3개는 오래돼도 남긴다(한 달 넘게 안 쓴 컴퓨터에서 전부 지워지지 않게)
export const RECENT_DAYS = 2;         // 오늘 · 어제는 모두 남기고, 그 전 날은 하루에 하나(그날의 마지막)만 남긴다
export const CHANGE_GAP_MINUTES = 5;  // 바뀐 뒤 백업은 5분에 한 번까지
export const READ_CHUNK = 512 * 1024; // 도우미 → 확장 한 번에 1MB 한도(Chrome) 안에서 읽는 크기

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function deviceTag(device) {
  const hex = String(device || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return (hex + '000000').slice(0, 6);
}
export function backupName(when, kind, device) {
  if (!KINDS.includes(kind)) throw new Error('알 수 없는 백업 종류입니다.');
  const d = when instanceof Date ? when : new Date(when);
  return `daissam-backup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}_${kind}_${deviceTag(device)}.json`;
}
// 이름을 풀어 날짜(이 컴퓨터 시각) · 종류 · 기기를 돌려준다. 다른 이름이면 null.
export function parseName(name) {
  const m = NAME_PATTERN.exec(String(name || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, s, kind, device] = m;
  const at = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  if (Number.isNaN(at.getTime()) || at.getMonth() !== +mo - 1) return null;
  return {name, at: at.getTime(), day: `${y}-${mo}-${d}`, kind, device};
}
// 최신이 먼저. 여러 컴퓨터(동기화되는 문서 폴더)의 파일이 섞여 있어도 시각으로 줄 세운다.
export function sortBackups(files) {
  return files.map(file => ({...file, ...parseName(file.name)})).filter(file => file.at)
    .sort((a, b) => (b.at - a.at) || b.name.localeCompare(a.name));
}
// 지울 이름들. 이 컴퓨터(device)가 만든 것만 정리한다 — 같은 폴더를 쓰는 다른 컴퓨터의 파일은 그 컴퓨터가 정리한다.
export function pruneList(files, device, now = Date.now()) {
  const tag = deviceTag(device);
  const mine = sortBackups(files).filter(file => file.device === tag);
  const keep = new Set(mine.slice(0, KEEP_NEWEST).map(file => file.name));
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const recentFrom = today.getTime() - (RECENT_DAYS - 1) * 86400000;
  const oldest = now - KEEP_DAYS * 86400000;
  const seenDay = new Set();
  const remove = [];
  for (const file of mine) {
    if (keep.has(file.name)) { seenDay.add(file.day); continue; }
    if (file.at < oldest) { remove.push(file.name); continue; }
    if (file.kind === 'manual' || file.kind === 'before-restore') continue;   // 직접 · 복구 직전은 한 달 동안 모두 둔다
    if (file.at >= recentFrom) continue;                                        // 오늘 · 어제는 모두 둔다
    if (seenDay.has(file.day)) remove.push(file.name);                          // 그 전 날은 그날의 마지막 하나만
    else seenDay.add(file.day);
  }
  return remove;
}
// 같은 내용이면 다시 쓰지 않으려고 내용의 지문을 만든다. 만든 시각(made)은 빼고 본다.
export async function fingerprint(payload) {
  const {made, ...rest} = payload || {};
  const bytes = new TextEncoder().encode(JSON.stringify(rest));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// 비어 있는 백업(새로 깐 직후 등)은 만들지 않는다 — '가장 최신' 이 빈 백업이 되면 복구가 쓸모없어진다.
export function worthKeeping(payload) {
  return (payload?.notes?.length || 0) + (payload?.bookmarks?.length || 0) > 0;
}
