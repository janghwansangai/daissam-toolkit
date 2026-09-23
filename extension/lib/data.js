export const NOTE_BYTES = 5500;
export const ITEM_BYTES = 7900;
export const TOTAL_BYTES = 96000;
export function size(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
export function validateNote(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > NOTE_BYTES) throw new Error('메모는 UTF-8 기준 5,500바이트까지 동기화할 수 있습니다. 긴 내용은 파일로 보관하세요.');
  return text;
}
export function safeURL(value) {
  const url = new URL(value);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error('로그인 정보가 없는 http/https 주소만 저장할 수 있습니다.');
  if (url.href.length > 1600) throw new Error('주소가 너무 깁니다.');
  return url.href;
}
export function checkQuota(all, key, value) {
  if (size(value) + new TextEncoder().encode(key).length > ITEM_BYTES) throw new Error('이 기기의 동기화 보관함이 가득 찼습니다. 내보내기로 보관하세요.');
  if (size({...all,[key]:value}) > TOTAL_BYTES) throw new Error('Chrome 동기화 공간이 가득 찼습니다. 로컬 사본은 보존됩니다.');
}
export const TITLE_MAX = 40;
export const LEGACY_NOTE = 'legacy';
// Sync keys are note_<device>_<id>. The two part form is the single note of v0.1 and reads as one legacy id.
export function noteKey(device, id) { return `note_${device}_${id}`; }
export function parseNoteKey(key) {
  const parts = String(key).split('_');
  if (parts[0] !== 'note' || parts.length < 2 || parts.length > 3 || !parts[1]) return null;
  if (parts.length === 3 && !parts[2]) return null;
  return {device: parts[1], id: parts.length === 3 ? parts[2] : LEGACY_NOTE};
}
export function validateNoteId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(id)) throw new Error('메모를 찾을 수 없습니다.');
  return id;
}
export function validateTitle(title) {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > TITLE_MAX) throw new Error(`제목은 ${TITLE_MAX}자까지 쓸 수 있습니다.`);
  return text || '새 메모';
}
export function noteGroups(all) {
  const groups = new Map();
  for (const [key, value] of Object.entries(all)) {
    const parsed = parseNoteKey(key);
    if (!parsed || !value || typeof value !== 'object') continue;
    if (value.v !== 1 && value.v !== 2) continue;
    if (!value.deleted && typeof value.text !== 'string') continue;
    const version = {
      key, id: parsed.id, device: parsed.device,
      title: typeof value.title === 'string' && value.title ? value.title : '빠른 메모',
      text: typeof value.text === 'string' ? value.text : '',
      time: Number(value.time) || 0, created: Number(value.created) || Number(value.time) || 0,
      pinned: value.pinned === true,
      deleted: !!value.deleted
    };
    const list = groups.get(parsed.id) || [];
    list.push(version);
    groups.set(parsed.id, list);
  }
  for (const list of groups.values()) list.sort((a, b) => (b.time - a.time) || b.key.localeCompare(a.key));
  return groups;
}
// A note is gone once the newest copy across devices is a tombstone; older copies stay readable until then.
// Tabs are ordered by creation, which never changes, so they do not jump around while typing.
export function noteList(all) {
  return [...noteGroups(all)].map(([id, versions]) => ({id, versions, current: versions[0]}))
    .filter(note => !note.current.deleted)
    .sort((a, b) => (b.current.created - a.current.created) || a.id.localeCompare(b.id));
}
// 가져오기는 초까지 붙여 같은 분에 여러 건이 들어와도 이름이 겹치지 않게 한다.
export function autoTitle(when = new Date()) {
  return stampTitle(when, true);
}
// 받침 유무에 따라 조사를 고른다. 한글이 아닌 끝글자는 받침 없는 쪽을 쓴다.
export function particle(word, withFinal, withoutFinal) {
  const last = String(word || '').trim().slice(-1);
  const code = last.charCodeAt(0);
  if (!(code >= 0xAC00 && code <= 0xD7A3)) return withoutFinal;
  return (code - 0xAC00) % 28 ? withFinal : withoutFinal;
}
export function stampTitle(when = new Date(), seconds = false) {
  const pad = value => String(value).padStart(2, '0');
  const clock = `${pad(when.getHours())}:${pad(when.getMinutes())}` + (seconds ? `:${pad(when.getSeconds())}` : '');
  return `${when.getMonth() + 1}/${when.getDate()} ${clock}`;
}
export function mergeBookmarks(snapshots) {
  const result = new Map();
  for (const snapshot of snapshots) {
    if (snapshot?.kind !== 'bookmarks' || !Array.isArray(snapshot.items)) throw new Error('북마크 보관함 형식이 올바르지 않습니다.');
    for (const item of snapshot.items) {
      if (typeof item.id !== 'string' || !Number.isSafeInteger(item.rev) || typeof item.writer !== 'string') throw new Error('손상된 북마크입니다.');
      if (!item.deleted) {
        if (typeof item.title !== 'string' || item.title.length > 120) throw new Error('손상된 제목입니다.');
        // Entries without a type are links from before folders existed.
        if (item.type === 'folder') { if (item.url !== undefined) throw new Error('손상된 폴더입니다.'); }
        else { safeURL(item.url); if (item.folder !== undefined && typeof item.folder !== 'string') throw new Error('손상된 폴더 지정입니다.'); }
      }
      const old = result.get(item.id);
      if (!old || item.rev>old.rev || (item.rev===old.rev && item.writer>old.writer)) result.set(item.id,item);
    }
  }
  return [...result.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function editBookmark(items, id, fields, writer) {
  return editBookmarks(items, [{id, fields}], writer);
}
// Deleting a folder also moves its links, so several records must land in one revision run.
export function editBookmarks(items, edits, writer) {
  let rev = Math.max(0, ...items.map(i => i.rev)) + 1;
  const written = edits.map(({id, fields}) => ({id, rev: rev++, writer, ...fields}));
  return mergeBookmarks([{kind:'bookmarks', items:[...items, ...written]}]);
}
export function isFolder(item) { return item.type === 'folder'; }
