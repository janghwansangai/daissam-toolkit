// 자동 백업(문서/다있쌤 백업)을 실제 Chrome + 실제 발표 도우미(맥 빌드)로 끝까지 본다. 사용: node tests/e2e/autobackup.e2e.mjs
// 사용자의 문서 폴더 대신 임시 폴더를 쓴다(DAISSAM_BACKUP_DIR — Chrome 이 띄우는 도우미가 물려받는다).
// 도우미 등록은 시험 프로필 안(NativeMessagingHosts)에만 둔다 — 사용자의 Chrome 설정은 건드리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const HOST_BIN = process.env.HOST_BIN || fileURLToPath(new URL('../../dist/Browser Sheriff Presenter.app/Contents/MacOS/Presenter', import.meta.url));
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-autobackup-'));
const dir = path.join(root, '다있쌤 백업');
process.env.DAISSAM_BACKUP_DIR = dir;
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail).slice(0, 400))); if (!cond) failed++; };
const files = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith('daissam-backup_')).sort() : []);
function profileWithHost(name, withHost = true) {
  const p = path.join(root, name);
  fs.mkdirSync(path.join(p, 'NativeMessagingHosts'), {recursive: true});
  if (withHost) fs.writeFileSync(path.join(p, 'NativeMessagingHosts', 'app.browsersheriff.presenter.json'), JSON.stringify({
    name: 'app.browsersheriff.presenter', description: 'test', path: HOST_BIN, type: 'stdio', allowed_origins: ['chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/']}));
  return p;
}
async function guest(p) {
  await p.waitFor(p.visible('#gate-guest'), 15000, '처음 화면');
  await p.eval(`document.getElementById('gate-guest').click()`);
  await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
}
const send = (p, type, data = {}) => p.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);

// ═══ 컴퓨터 A: 쓰던 다있쌤 ═══
const A = new Chrome({ext: EXT, profile: profileWithHost('A'), port: 9591, downloads: path.join(root, 'dl-A')});
await A.start();
const a = await A.open(PANEL);
await guest(a);
const device = await a.eval(`chrome.storage.local.get('device').then(r=>r.device)`);
await send(a, 'note-save', {id: 'n-lesson', title: '3월 학급 운영', text: '1인 1역 정하기'});
await a.eval(`chrome.storage.sync.set({['marks_'+${JSON.stringify(device)}]:{v:1,kind:'bookmarks',items:[{id:'m1',rev:1,writer:${JSON.stringify(device)},title:'수업 자료',url:'https://example.com/'}]}})`);
// 다있쌤이 켜질 때 ‘하루 1번’ 백업이 생긴다(방금 쓴 메모 · 북마크가 담긴다)
let daily = null;
for (let i = 0; i < 20 && !daily; i++) { await sleep(1000); daily = files().find(f => f.includes('_daily_')); }
ok('다있쌤이 켜지면 오늘의 ‘하루 1번’ 백업이 생긴다', !!daily, files());
// 그 뒤에 바꾸면 ‘바뀐 뒤’ 백업이 예약된다
await send(a, 'note-save', {id: 'n-lesson', title: '3월 학급 운영', text: '1인 1역 정하기 · 모둠 자리 바꾸기'});
ok('메모 · 북마크가 바뀌면 ‘바뀐 뒤’ 백업이 예약된다', !!(await a.eval(`chrome.alarms.get('auto-backup-change')`)));
// 바뀐 뒤 백업: 1분 모았다가 쓴다
let changed = null;
for (let i = 0; i < 50 && !changed; i++) { await sleep(2000); changed = files().find(f => f.includes('_change_')); }
ok('1분쯤 뒤 문서/다있쌤 백업에 ‘바뀐 뒤’ 백업 파일이 생긴다', !!changed, files());
if (changed) {
  const body = JSON.parse(fs.readFileSync(path.join(dir, changed), 'utf8'));
  ok('그 파일에 메모와 북마크가 들어 있다(암호 없는 백업 · PIN 없음)', body.format === 'daissam-backup' && !body.encrypted
    && body.payload.notes.some(n => n.title === '3월 학급 운영') && body.payload.bookmarks.some(b => b.title === '수업 자료') && !body.payload.lock, body.payload?.notes);
}
// 지금 백업(직접)
let r = await send(a, 'auto-backup-now');
ok('‘지금 백업’ 이 이름 · 날짜를 정해 저장한다', r.ok && /_manual_/.test(r.data?.name) && files().includes(r.data.name), r);
// 같은 내용이면 자동 백업은 새로 쓰지 않는다(직접은 쓴다)
const before = files().length;
// 한 달 정리: 이 컴퓨터의 40일 전 파일 · 다른 컴퓨터의 40일 전 파일을 넣어 둔다
const tag = device.replace(/[^0-9a-f]/g, '').slice(0, 6);
const old = new Date(Date.now() - 40 * 86400000), pad = n => String(n).padStart(2, '0');
const oldName = dev => `daissam-backup_${old.getFullYear()}-${pad(old.getMonth() + 1)}-${pad(old.getDate())}_08-00-00_daily_${dev}.json`;
fs.copyFileSync(path.join(dir, r.data.name), path.join(dir, oldName(tag)));
fs.copyFileSync(path.join(dir, r.data.name), path.join(dir, oldName('ffffff')));
await send(a, 'note-save', {id: 'n-two', title: '과학 준비물', text: '자석 6모둠분'});
r = await send(a, 'auto-backup-now');
const now = files();
ok('한 달 지난 이 컴퓨터의 백업은 지운다(최근 3개 밖이면)', !now.includes(oldName(tag)), now);
ok('다른 컴퓨터의 백업은 이 컴퓨터가 지우지 않는다', now.includes(oldName('ffffff')), now);
ok('백업이 늘었다', now.length >= before, {before, now});
// 설정 화면: 상태 · 목록
await a.eval(`document.getElementById('dock-settings').click()`); await sleep(2500);
const ui = await a.eval(`({status:document.getElementById('ab-status').textContent,rows:document.querySelectorAll('#ab-list li button').length,on:document.getElementById('ab-on').checked})`);
ok('설정에 자동 백업 상태(마지막 백업 · 폴더)가 보인다', /마지막 백업/.test(ui.status) && ui.status.normalize('NFC').includes(dir.normalize('NFC')), ui.status);
ok('날짜로 복구 목록이 최신부터 보인다', ui.rows >= 3 && ui.on, ui);
// 날짜로 복구: 첫 ‘바뀐 뒤’ 백업(과학 준비물 메모가 없던 때)을 고르면 미리보기 → 복원(더하기만) · 복구 직전 사본
await a.eval(`(()=>{const rows=[...document.querySelectorAll('#ab-list li')];const row=rows.find(li=>li.textContent.includes('바뀐 뒤'));row.querySelector('button').click();})()`);
await a.waitFor(a.visible('#bk-plan'), 15000, '복원 미리보기');
ok('복원 미리보기에 자동 백업 이름이 보인다', /자동 백업/.test(await a.eval(`document.getElementById('bk-title').textContent`)));
const beforeRestore = files().filter(f => f.includes('_before-restore_')).length;
await a.eval(`document.getElementById('bk-go').click()`); await sleep(4000);
const a2 = await A.open(PANEL); await sleep(2500);
const notes = await a2.eval(`chrome.storage.local.get(['pendingNotes','draftNotes']).then(l=>chrome.storage.sync.get(null).then(s=>JSON.stringify([s,l])))`);
ok('복원은 더하기만 한다 — 나중에 쓴 ‘과학 준비물’ 메모가 그대로 있다', notes.includes('과학 준비물') && notes.includes('3월 학급 운영'));
ok('복구하기 직전 모습이 ‘복구 직전’ 백업으로 남는다', files().filter(f => f.includes('_before-restore_')).length === beforeRestore + 1, files());
// 북마크 탭을 오갔다 와도 목록이 그대로다(사라졌다 나타나던 문제)
await a2.eval(`document.querySelector('[data-page="vault"]').click()`); await sleep(600);
const first = await a2.eval(`document.querySelectorAll('#bookmarks .bookmark').length`);
await a2.eval(`document.querySelector('[data-page="notes"]').click()`); await sleep(300);
await a2.eval(`document.querySelector('[data-page="vault"]').click()`); await sleep(800);
ok('북마크 탭을 오갔다 와도 북마크가 보인다', first >= 1 && (await a2.eval(`document.querySelectorAll('#bookmarks .bookmark').length`)) === first, first);
await A.stop();

// ═══ 컴퓨터 A 를 지우고 새로 깐 다있쌤: 같은 폴더에서 살린다 ═══
const B = new Chrome({ext: EXT, profile: profileWithHost('B'), port: 9592, downloads: path.join(root, 'dl-B')});
await B.start();
const b = await B.open(PANEL);
await guest(b);
await b.waitFor(b.visible('#ab-found'), 15000, '자동 백업 발견 안내');
ok('새로 깐 다있쌤에 ‘자동 백업이 있습니다’ 안내가 뜬다', /자동 백업이 \d+개/.test(await b.eval(`document.getElementById('ab-found-text').textContent`)));
await b.eval(`document.getElementById('ab-found-go').click()`); await sleep(5000);
const b2 = await B.open(PANEL); await sleep(3000);
const restored = await b2.eval(`chrome.storage.local.get(['pendingNotes','draftNotes']).then(l=>chrome.storage.sync.get(null).then(s=>JSON.stringify([s,l])))`);
ok('가장 최근 백업으로 메모 · 북마크가 돌아온다', restored.includes('과학 준비물') && restored.includes('3월 학급 운영') && restored.includes('수업 자료'));
// 같은 백업을 ‘닫기’ 로 넘긴 뒤에는 다시 알리지 않는다
const B2 = await B.open(PANEL); await sleep(500);
await B2.eval(`chrome.storage.sync.clear().then(()=>chrome.storage.local.remove(['pendingNotes','draftNotes']))`); await sleep(800);
const b3 = await B.open(PANEL); await b3.waitFor(b3.visible('#ab-found'), 15000, '안내(비운 뒤)');
await b3.eval(`document.getElementById('ab-found-close').click()`); await sleep(500);
const b4 = await B.open(PANEL); await sleep(4000);
ok('‘닫기’ 를 누른 같은 백업은 다시 알리지 않는다', await b4.eval(`document.getElementById('ab-found').hidden`));
await B.stop();

// ═══ 발표 도우미가 없는 컴퓨터: 오류 없이 안내만 ═══
const N = new Chrome({ext: EXT, profile: profileWithHost('N', false), port: 9593, downloads: path.join(root, 'dl-N')});
await N.start();
const n = await N.open(PANEL);
await guest(n);
await n.eval(`document.getElementById('dock-settings').click()`); await sleep(2500);
ok('도우미가 없으면 자동 백업 칸이 앱 설치를 안내한다', /발표 도우미 앱/.test(await n.eval(`document.getElementById('ab-status').textContent`)));
r = await send(n, 'auto-backup-now');
ok('도우미 없이 ‘지금 백업’ 은 이유를 말하며 실패한다', !r.ok && /발표 도우미/.test(r.error || ''), r);
await N.stop();
try { fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 300}); } catch {}
console.log(failed ? `실패 ${failed}건` : '모두 통과');
process.exit(failed ? 1 : 0);
