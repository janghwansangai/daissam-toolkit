// 전체 백업 — 이 확장이 이 컴퓨터에 가진 기록과 설정을 파일 하나로 묶고, 그 파일에서 다시 풀어 넣는다.
//
// 여기에는 chrome.* 호출이 없다. 저장소를 읽고 쓰는 일은 부르는 쪽이 하고, 이 파일은 파일의 모양과
// 검사만 맡는다. 그래서 브라우저 없이 시험할 수 있고, 남이 만든(또는 망가진) 파일을 믿지 않고
// 걸러 내는 자리가 이곳 한 곳이 된다. 복원하는 쪽은 반드시 cleanBackup() 을 거친 값만 쓴다.
//
// 일부러 담지 않는 것(이 컴퓨터에만 뜻이 있는 값이다):
//  · device            — 기기 고유 번호. 옮겨 심으면 두 컴퓨터가 같은 번호를 쓰게 되어 동기화가 엉킨다.
//  · dockSpot          — 도크 창의 화면 좌표. 다른 모니터 배치에서는 화면 밖에 뜰 수 있다.
//  · recordOptions 의 카메라·마이크 번호 — 컴퓨터마다 장치 번호가 다르다.
//  · clipboardImport   — 클립보드 도우미는 그 컴퓨터에 앱이 있어야 한다. 켠 채로 옮기지 않는다.
//  · authorized·attempts·watch·timerEndsAt 등 — 잠금 해제 상태, 실행 중인 타이머 같은 순간 값.
//  · 바탕화면 ‘캡처이미지’ 폴더의 그림 파일 — 확장은 그 폴더를 읽을 수 없다(썸네일만 담는다).
import {noteGroups, noteKey, safeURL, validateNoteId, mergeBookmarks, editBookmarks, checkQuota, TITLE_MAX} from './data.js';
import {hotClean} from './keys.js';

export const BACKUP_FORMAT = 'daissam-backup';
export const BACKUP_VERSION = 1;
export const KDF_ITERATIONS = 600000;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MIN_PASSPHRASE = 8;
// 메모 그림 썸네일 상한. background.js 의 클립보드 가져오기와 같은 값을 쓴다.
export const IMAGES_PER_NOTE = 12, IMAGES_TOTAL = 40;
const LIMITS = {notes: 1000, noteText: 200000, marks: 800, vault: 8, thumb: 250000};

const BAD_FILE = '다있쌤 백업 파일이 아니거나 내용이 손상되었습니다.';
const enc = new TextEncoder(), dec = new TextDecoder();
const AAD = enc.encode('daissam-backup:v1');
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const NOTE_ID = /^[A-Za-z0-9-]{1,40}$/;
const MARK_ID = /^[A-Za-z0-9_-]{1,64}$/;

// ── 바이트 ↔ 글 ─────────────────────────────────────────────────────────
// btoa(String.fromCharCode(...큰배열)) 는 인자가 너무 많아 터진다. 조각내어 붙인다.
function b64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function unb64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }

// ── 암호 ────────────────────────────────────────────────────────────────
export function checkPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || [...passphrase].length < MIN_PASSPHRASE)
    throw new Error(`백업 암호는 ${MIN_PASSPHRASE}자 이상으로 정해 주세요.`);
}
// 한글은 맥과 윈도우가 조합 방식(NFC·NFD)을 달리 내놓는 일이 있다. 같은 암호가 다른 글자가 되지 않게 맞춘다.
async function deriveKey(passphrase, salt, iterations, usage) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, usage);
}
// 암호를 건 파일. 잠금 PIN 까지 담을 수 있는 건 이 모양뿐이다.
export async function sealBackup(payload, passphrase, iterations = KDF_ITERATIONS) {
  checkPassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: AAD}, key, enc.encode(JSON.stringify(payload))));
  return JSON.stringify({format: BACKUP_FORMAT, v: BACKUP_VERSION, encrypted: true, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(data)});
}
// 암호 없는 파일. 짧은 PIN 의 검증값은 오프라인에서 몇 분이면 풀린다 — 그래서 PIN 은 절대 이쪽에 담지 않는다.
export function plainBackup(payload) {
  if (payload?.lock) throw new Error('잠금 PIN이 든 백업은 암호를 걸어야 저장할 수 있습니다.');
  return JSON.stringify({format: BACKUP_FORMAT, v: BACKUP_VERSION, encrypted: false, payload}, null, 1);
}
// 파일 글을 열어 검사까지 마친 내용을 돌려준다. 암호가 필요한데 없으면 code 가 NEEDS_PASSPHRASE 인 오류를 던져
// 화면이 암호를 묻게 한다.
export async function openBackup(text, passphrase) {
  if (typeof text !== 'string' || text.length > MAX_FILE_BYTES) throw new Error('백업 파일이 너무 큽니다.');
  let file;
  try { file = JSON.parse(text); } catch { throw new Error(BAD_FILE); }
  if (!isPlain(file) || file.format !== BACKUP_FORMAT) throw new Error(BAD_FILE);
  if (file.v !== BACKUP_VERSION)
    throw new Error(Number(file.v) > BACKUP_VERSION ? '더 새로운 다있쌤으로 만든 백업입니다. 확장을 먼저 업데이트해 주세요.' : '지원하지 않는 백업 형식입니다.');
  if (!file.encrypted) return {encrypted: false, payload: cleanBackup(file.payload)};
  const iterations = file.iterations;
  // 반복 횟수는 파일이 정한다. 터무니없이 큰 값으로 컴퓨터를 붙들어 두지 못하게 막는다.
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 2000000) throw new Error(BAD_FILE);
  for (const part of [file.salt, file.iv, file.data]) if (typeof part !== 'string' || !BASE64.test(part)) throw new Error(BAD_FILE);
  if (!passphrase) { const error = new Error('이 백업은 암호로 잠겨 있습니다.'); error.code = 'NEEDS_PASSPHRASE'; throw error; }
  let plain;
  try {
    const key = await deriveKey(passphrase, unb64(file.salt), iterations, ['decrypt']);
    plain = dec.decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(file.iv), additionalData: AAD}, key, unb64(file.data)));
  } catch { throw new Error('백업 암호가 맞지 않거나 파일이 손상되었습니다.'); }
  let payload;
  try { payload = JSON.parse(plain); } catch { throw new Error(BAD_FILE); }
  return {encrypted: true, payload: cleanBackup(payload)};
}

// ── 검사: 남이 준 파일은 한 칸씩 의심한다 ────────────────────────────────
const text = (value, max, fallback = '') => typeof value === 'string' ? value.slice(0, max) : fallback;
const stamp = value => Number.isFinite(value) && value > 0 && value < 4e12 ? Math.floor(value) : 0;
const number = (value, lo, hi) => Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : undefined;
const cleanTitle = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || '새 메모';
function isBlob(blob) {
  return isPlain(blob) && blob.v === 1 && [blob.s, blob.i, blob.c].every(part => typeof part === 'string' && BASE64.test(part))
    && blob.s.length <= 64 && blob.i.length <= 32 && blob.c.length <= 14000 && blob.c.length > 0;
}
function cleanMade(made) {
  const source = isPlain(made) ? made : {};
  return {at: typeof source.at === 'string' && !Number.isNaN(Date.parse(source.at)) ? source.at.slice(0, 40) : '',
    version: text(source.version, 20), os: ['mac', 'win'].includes(source.os) ? source.os : 'other', profile: text(source.profile, 40)};
}
function cleanNotes(list, skip) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > LIMITS.notes) throw new Error(BAD_FILE);
  const seen = new Set(), out = [];
  for (const note of list) {
    let id = null;
    try { id = isPlain(note) ? validateNoteId(note.id) : null; } catch { id = null; }
    if (!id || seen.has(id) || typeof note.text !== 'string' || note.text.length > LIMITS.noteText) { skip.n++; continue; }
    seen.add(id);
    const time = stamp(note.time);
    out.push({id, title: cleanTitle(note.title), text: note.text, time, created: stamp(note.created) || time, pinned: note.pinned === true});
  }
  return out;
}
function cleanImages(map, noteIds, skip) {
  if (map === undefined) return {};
  if (!isPlain(map)) throw new Error(BAD_FILE);
  const out = {};
  let total = 0;
  for (const id of Object.keys(map)) {
    // 키는 정규식을 통과한 것만 쓴다. ‘__proto__’ 같은 이름이 객체의 바탕을 바꾸지 못하게 하는 문이기도 하다.
    if (!NOTE_ID.test(id) || !noteIds.has(id) || !Array.isArray(map[id])) continue;
    const list = [];
    for (const shot of map[id].slice(0, IMAGES_PER_NOTE)) {
      if (!isPlain(shot) || typeof shot.thumb !== 'string' || shot.thumb.length > LIMITS.thumb || !BASE64.test(shot.thumb)) { skip.n++; continue; }
      if (total >= IMAGES_TOTAL) break;
      list.push({id: text(shot.id, 64) || crypto.randomUUID(), file: text(shot.file, 1024), name: text(shot.name, 200, '캡처.png'),
        thumb: shot.thumb, width: Math.floor(number(shot.width, 0, 20000) || 0), height: Math.floor(number(shot.height, 0, 20000) || 0), time: stamp(shot.time)});
      total++;
    }
    if (list.length) out[id] = list;
  }
  return out;
}
function cleanMarks(list, skip) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > LIMITS.marks) throw new Error(BAD_FILE);
  const seen = new Set(), folders = new Set();
  const kept = [];
  for (const item of list) {
    if (!isPlain(item) || typeof item.id !== 'string' || !MARK_ID.test(item.id) || seen.has(item.id)) { skip.n++; continue; }
    if (item.type === 'folder') {
      seen.add(item.id); folders.add(item.id);
      kept.push({id: item.id, type: 'folder', title: text(item.title, 120) || '폴더'});
      continue;
    }
    let url;
    try { url = safeURL(item.url); } catch { skip.n++; continue; }
    seen.add(item.id);
    kept.push({id: item.id, title: text(item.title, 120), url, folder: typeof item.folder === 'string' ? item.folder : ''});
  }
  // 없는 폴더를 가리키는 북마크는 맨 위로 올린다. 그대로 두면 어느 폴더에서도 보이지 않는다.
  return kept.map(item => item.type === 'folder' || folders.has(item.folder) ? item : {...item, folder: ''});
}
function cleanVault(map, skip) {
  if (map === undefined) return {};
  if (!isPlain(map)) throw new Error(BAD_FILE);
  const out = {};
  for (const key of Object.keys(map).slice(0, LIMITS.vault)) {
    if (!/^vault_[A-Za-z0-9-]{1,64}$/.test(key) || !isBlob(map[key])) { skip.n++; continue; }
    const {v, s, i, c} = map[key];
    out[key] = {v, s, i, c};
  }
  return out;
}
function cleanHotkeys(hot) {
  if (!isPlain(hot)) return null;
  return {mac: hotClean(isPlain(hot.mac) ? hot.mac : null), win: hotClean(isPlain(hot.win) ? hot.win : null)};
}
// 설정마다 허용하는 값의 모양. 모르는 이름은 읽지도 않고, 모양이 틀린 값은 버려서 그 설정이 원래 값을 지킨다.
const rule = {
  pick: values => ({ok: v => values.includes(v)}),
  range: (lo, hi, whole = true) => ({ok: v => Number.isFinite(v), fix: v => whole ? Math.round(Math.min(hi, Math.max(lo, v))) : Math.min(hi, Math.max(lo, v))}),
  bool: () => ({ok: v => typeof v === 'boolean'}),
  match: re => ({ok: v => typeof v === 'string' && re.test(v)})
};
const SCHEMA = {
  presentKnobs: {dim: rule.range(0, 90), blur: rule.range(2, 30), ringSize: rule.range(16, 140), ring: rule.match(/^#[0-9a-fA-F]{6}$/)},
  captureOptions: {after: rule.pick(['editor', 'both', 'save', 'copy']), format: rule.pick(['png', 'jpg']), quality: rule.range(50, 100),
    delay: rule.range(0, 60), hideFixed: rule.bool(), hideScrollbar: rule.bool(), hideSide: rule.bool()},
  // 카메라·마이크 장치 번호(cameraId·micId·cameraName)는 컴퓨터마다 달라 일부러 뺀다.
  recordOptions: {mode: rule.pick(['area', 'camera', 'desktop', 'tab']), camera: rule.bool(), mic: rule.bool(), controlBar: rule.bool(),
    res: rule.pick(['720', '1080', '1440', '2160']), format: rule.pick(['mp4', 'webm']), countdown: rule.range(0, 60), limit: rule.range(0, 600), sound: rule.bool()}
};
function pickOptions(raw, schema) {
  if (!isPlain(raw)) return undefined;
  const out = {};
  for (const [name, check] of Object.entries(schema)) {
    const value = raw[name];
    if (value === undefined || !check.ok(value)) continue;
    out[name] = check.fix ? check.fix(value) : value;
  }
  return Object.keys(out).length ? out : undefined;
}
function cleanSettings(raw) {
  if (!isPlain(raw)) return null;
  const out = {};
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
  if (name) out.name = name;
  if ([0, 1, 5, 15, 30].includes(raw.idleMinutes)) out.idleMinutes = raw.idleMinutes;
  for (const flag of ['startLocked', 'lockOnAway', 'wheelZoom']) if (typeof raw[flag] === 'boolean') out[flag] = raw[flag];
  if (typeof raw.uiFont === 'string' && /^[a-z]{1,24}$/.test(raw.uiFont)) out.uiFont = raw.uiFont;
  const size = number(raw.uiSize, 12, 19); if (size !== undefined) out.uiSize = Math.round(size);
  const track = number(raw.uiTrack, -4, 12); if (track !== undefined) out.uiTrack = Math.round(track);
  for (const group of Object.keys(SCHEMA)) { const picked = pickOptions(raw[group], SCHEMA[group]); if (picked) out[group] = picked; }
  return Object.keys(out).length ? out : null;
}
const TONES = ['school', 'bell', 'chime', 'beep', 'soft'];
function cleanTools(raw) {
  if (!isPlain(raw)) return null;
  const out = {};
  if (Array.isArray(raw.bellTimes)) out.bellTimes = raw.bellTimes.filter(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 16);
  if (typeof raw.bellOn === 'boolean') out.bellOn = raw.bellOn;
  for (const key of ['toneBell', 'toneAlarm']) if (TONES.includes(raw[key])) out[key] = raw[key];
  for (const key of ['volumeBell', 'volumeAlarm']) { const volume = number(raw[key], 0, 100); if (volume !== undefined) out[key] = Math.round(volume); }
  if (Array.isArray(raw.teams)) out.teams = raw.teams.slice(0, 12).map(team => ({name: text(team?.name, 20), score: Math.round(number(Number(team?.score), -999, 9999) ?? 0)}));
  return Object.keys(out).length ? out : null;
}
function cleanLock(lock) { return isPlain(lock) && isBlob(lock.proof) ? {proof: {v: 1, s: lock.proof.s, i: lock.proof.i, c: lock.proof.c}} : null; }

export function cleanBackup(raw) {
  if (!isPlain(raw) || raw.kind !== BACKUP_FORMAT) throw new Error(BAD_FILE);
  const skip = {n: 0};
  const notes = cleanNotes(raw.notes, skip);
  return {
    kind: BACKUP_FORMAT, v: BACKUP_VERSION, made: cleanMade(raw.made),
    notes, images: cleanImages(raw.images, new Set(notes.map(note => note.id)), skip),
    bookmarks: cleanMarks(raw.bookmarks, skip), vault: cleanVault(raw.vault, skip),
    hotkeys: cleanHotkeys(raw.hotkeys), settings: cleanSettings(raw.settings), tools: cleanTools(raw.tools),
    lock: cleanLock(raw.lock), skipped: skip.n
  };
}

// ── 담기: 저장소 → 백업 내용 ────────────────────────────────────────────
// 사이드바가 목록에 보여 주는 것과 같은 기준으로 메모를 모은다. 동기화를 기다리는 글이 이 기기의 최신본이고,
// 용량이 커서 동기화되지 못한 초안도 목록에 남아 있으므로 함께 담는다.
export function mergedNotes(sync, local) {
  const merged = {...sync};
  const device = local.device;
  for (const [id, value] of Object.entries(local.pendingNotes || {})) merged[noteKey(value.device || device, id)] = value;
  for (const [id, value] of Object.entries(local.draftNotes || {})) {
    const key = noteKey(value.device || device, id);
    if (!(key in merged)) merged[key] = value;
  }
  return merged;
}
export function collectNotes(sync, local) {
  return [...noteGroups(mergedNotes(sync, local)).values()].map(versions => versions[0]).filter(note => !note.deleted)
    .sort((a, b) => (a.created - b.created) || a.id.localeCompare(b.id))
    .map(({id, title, text, time, created, pinned}) => ({id, title, text, time, created, pinned}));
}
export function markSnapshots(sync) {
  return Object.entries(sync).filter(([key, value]) => key.startsWith('marks_') && value?.kind === 'bookmarks' && Array.isArray(value.items)).map(([, value]) => value);
}
export function currentMarks(sync) {
  const snapshots = markSnapshots(sync);
  return snapshots.length ? mergeBookmarks(snapshots) : [];
}
export function collectBackup({sync = {}, local = {}, version = '', os = 'other', includeLock = false, now = Date.now()} = {}) {
  const notes = collectNotes(sync, local);
  const have = new Set(notes.map(note => note.id));
  const images = {};
  for (const [id, list] of Object.entries(isPlain(local.noteImages) ? local.noteImages : {})) if (have.has(id) && Array.isArray(list) && list.length) images[id] = list;
  const vault = {};
  for (const [key, value] of Object.entries(sync)) if (key.startsWith('vault_') && isBlob(value)) vault[key] = value;
  const marks = currentMarks(sync).filter(item => !item.deleted).map(item => item.type === 'folder'
    ? {id: item.id, type: 'folder', title: item.title} : {id: item.id, title: item.title, url: item.url, folder: item.folder || ''});
  const p = isPlain(local.profile) ? local.profile : null;
  const payload = {
    kind: BACKUP_FORMAT, v: BACKUP_VERSION,
    made: {at: new Date(now).toISOString(), version, os, profile: p?.name || ''},
    notes, images, bookmarks: marks, vault,
    hotkeys: isPlain(sync.hotkeys) ? sync.hotkeys : null,
    settings: {name: p?.name, idleMinutes: p?.idleMinutes, startLocked: local.startLocked, lockOnAway: local.lockOnAway, wheelZoom: local.wheelZoom,
      uiFont: local.uiFont, uiSize: local.uiSize, uiTrack: local.uiTrack,
      presentKnobs: local.presentKnobs, captureOptions: local.captureOptions, recordOptions: local.recordOptions},
    tools: {bellTimes: local.bellTimes, bellOn: local.bellOn, toneBell: local.toneBell, volumeBell: local.volumeBell,
      toneAlarm: local.toneAlarm, volumeAlarm: local.volumeAlarm, teams: local.teams},
    lock: includeLock && p?.proof ? {proof: p.proof} : null
  };
  // 내보내는 값도 읽을 때와 같은 검사를 거친다. 다시 읽지 못할 모양은 처음부터 담지 않는다.
  return cleanBackup(payload);
}
// 미리보기 줄에 쓸 개수.
export function describeBackup(payload) {
  const links = payload.bookmarks.filter(item => item.type !== 'folder').length;
  return {notes: payload.notes.length, images: Object.values(payload.images).reduce((sum, list) => sum + list.length, 0),
    links, folders: payload.bookmarks.length - links, vault: Object.keys(payload.vault).length,
    hotkeys: !!payload.hotkeys, settings: !!payload.settings, tools: !!payload.tools, lock: !!payload.lock,
    made: payload.made, skipped: payload.skipped};
}

// ── 넣기: 이 컴퓨터에 합치는 규칙 ───────────────────────────────────────
// 원칙: 더하기만 한다. 이 컴퓨터에 있는 메모·북마크는 지우지도 덮어쓰지도 않는다.
// 같은 백업을 두 번 풀어도 두 번째에는 아무것도 늘지 않는다(사본 이름표를 원래 이름에서 정해 두기 때문이다).
export function copyId(id) { return 'b-' + String(id).slice(0, 36); }
export function copyTitle(title) { return String(title).slice(0, TITLE_MAX - 5) + ' (백업)'; }
// groups: noteGroups(mergedNotes(...)) — 지움 표시도 들어 있다. 돌려주는 add 의 각 메모에는 넣을 id 가 정해져 있고,
// target 은 백업의 id → 실제로 가리키게 된 id 표다(그림을 붙일 때 쓴다).
export function planNotes(groups, incoming) {
  const add = [], target = new Map();
  let same = 0, copies = 0, revived = 0;
  // 지금 보이는 메모(가장 새 사본이 지움 표시가 아닌 것)가 같은 제목·내용을 가졌는가.
  const holds = (id, note) => {
    const versions = groups.get(id) || [];
    return versions.length > 0 && !versions[0].deleted && versions.some(v => !v.deleted && v.title === note.title && v.text === note.text);
  };
  for (const note of incoming) {
    if (holds(note.id, note)) { same++; target.set(note.id, note.id); continue; }
    const versions = groups.get(note.id);
    if (!versions) { add.push(note); target.set(note.id, note.id); continue; }
    // 이미 있는 id 인데 내용이 다르거나(고친 글), 지운 글이다(지움 표시가 더 새로워 같은 id 로는 되살릴 수 없다).
    // 원래 id 에서 정한 사본 id 로 넣는다. 사본 id 가 이미 쓰였다면 앞서 가져온 것(고쳤거나 지웠을 수 있다)이므로
    // 다시 만들지 않는다 — 같은 백업을 몇 번 풀어도 사본이 늘지 않는다.
    const alias = copyId(note.id);
    const old = groups.get(alias);
    if (old || add.some(item => item.id === alias)) { same++; if (!old?.[0]?.deleted) target.set(note.id, alias); continue; }
    const dead = versions[0].deleted;
    add.push({...note, id: alias, title: dead ? note.title : copyTitle(note.title)});
    target.set(note.id, alias);
    if (dead) revived++; else copies++;
  }
  return {add, same, copies, revived, target};
}
// 그림 썸네일을 합친다. 같은 그림 id 는 한 번만, 메모마다 12장·전체 40장을 넘으면 오래된 것부터 뺀다.
export function mergeImages(current, incoming, target) {
  const next = {};
  for (const [id, list] of Object.entries(isPlain(current) ? current : {})) next[id] = [...list];
  for (const [old, list] of Object.entries(incoming)) {
    const id = target.get(old);
    if (!id) continue;
    const have = new Set((next[id] || []).map(shot => shot.id));
    const fresh = list.filter(shot => !have.has(shot.id));
    if (fresh.length) next[id] = [...(next[id] || []), ...fresh].sort((a, b) => b.time - a.time).slice(0, IMAGES_PER_NOTE);
  }
  let total = Object.values(next).reduce((sum, list) => sum + list.length, 0);
  while (total > IMAGES_TOTAL) {
    let oldest = null, at = Infinity;
    for (const [id, list] of Object.entries(next)) { const last = list[list.length - 1]; if (last && last.time < at) { at = last.time; oldest = id; } }
    if (!oldest) break;
    next[oldest] = next[oldest].slice(0, -1); total--;
  }
  for (const id of Object.keys(next)) if (!next[id].length) delete next[id];
  return next;
}
// 북마크: 지금 있는 것(live)은 그대로 두고, 없거나 지워진 것만 되살려 더한다. 동기화 한 칸(약 8KB)에 다 안 들어가면
// 들어가는 데까지만 넣는다 — 폴더를 앞에 두므로 넣은 북마크의 폴더는 항상 함께 있다.
export function planMarks(all, device, incoming) {
  const current = currentMarks(all);
  const live = new Set(current.filter(item => !item.deleted).map(item => item.id));
  const wanted = incoming.filter(item => !live.has(item.id));
  const same = incoming.length - wanted.length;
  const ordered = [...wanted.filter(item => item.type === 'folder'), ...wanted.filter(item => item.type !== 'folder')];
  const key = 'marks_' + device;
  const build = count => {
    const edits = ordered.slice(0, count).map(item => ({id: item.id, fields: item.type === 'folder'
      ? {type: 'folder', title: item.title, deleted: false}
      : {title: item.title, url: item.url, folder: item.folder, deleted: false}}));
    return {kind: 'bookmarks', v: 1, items: editBookmarks(current, edits, device)};
  };
  const fits = count => { try { checkQuota(all, key, build(count)); return true; } catch { return false; } };
  let lo = 0, hi = ordered.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
  const taken = ordered.slice(0, lo), folders = taken.filter(item => item.type === 'folder').length;
  return {key, value: lo ? build(lo) : null, added: lo, folders, links: lo - folders, wanted: ordered.length, same, left: ordered.length - lo};
}
