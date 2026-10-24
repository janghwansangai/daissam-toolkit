// 소개자료(소개자료/)에 넣을 실제 화면을 찍는다 — 예시 메모 · 북마크를 넣은 시험 프로필(Chrome for Testing).
// 사용: node scripts/intro-shots.mjs  → 소개자료/img/*.png
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from '../tests/e2e/cdp.mjs';

const EXT = fileURLToPath(new URL('../extension', import.meta.url));
const OUT = fileURLToPath(new URL('../소개자료/img', import.meta.url));
const APP = fileURLToPath(new URL('../dist/Browser Sheriff Presenter.app/Contents/MacOS/Presenter', import.meta.url));
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
fs.mkdirSync(OUT, {recursive: true});
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-'));
process.env.DAISSAM_BACKUP_DIR = path.join(root, '다있쌤 백업');
const profile = path.join(root, 'p');
if (fs.existsSync(APP)) {
  fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'), {recursive: true});
  fs.writeFileSync(path.join(profile, 'NativeMessagingHosts', 'app.browsersheriff.presenter.json'), JSON.stringify({
    name: 'app.browsersheriff.presenter', description: 'intro', path: APP, type: 'stdio', allowed_origins: ['chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/']}));
}
const C = new Chrome({ext: EXT, profile, port: 9611, downloads: path.join(root, 'dl')});
await C.start();
const p = await C.open(PANEL, {width: 400, height: 760});
await p.cmd('Emulation.setDeviceMetricsOverride', {width: 400, height: 760, deviceScaleFactor: 2, mobile: false});
await p.waitFor(p.visible('#gate-form'), 15000, '처음 화면');
await sleep(600);
await p.shot(OUT + '/0-start.png');
await p.type('#profile-name', '김선생');
await p.eval(`document.getElementById('gate-guest').click()`);
await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
const device = await p.eval(`chrome.storage.local.get('device').then(r=>r.device)`);
const say = (type, data) => p.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
for (const [id, title, text] of [['n1', '3월 학급 운영', '· 1인 1역 정하기\n· 모둠 자리 바꾸기(금)\n· 학부모 상담 주간 안내장 보내기'],
  ['n2', '과학 4단원 준비물', '자석, 클립, 나침반 — 6모둠분\n실험 영상은 북마크 ‘과학’ 폴더'], ['n3', '오늘 할 일', '출석부 마감 · 급식 지도 · 방과후 명단 제출']])
  await say('note-save', {id, title, text});
let rev = 1;
const item = fields => ({rev: rev++, writer: device, ...fields});
await p.eval(`chrome.storage.sync.set({['marks_'+${JSON.stringify(device)}]:${JSON.stringify({v: 1, kind: 'bookmarks', items: [
  item({id: 'f1', type: 'folder', title: '과학'}), item({id: 'f2', type: 'folder', title: '학급 운영'}),
  item({id: 'b1', title: '에듀넷 티-클리어', url: 'https://www.edunet.net/', folder: 'f1'}),
  item({id: 'b2', title: '과학 실험 영상 모음', url: 'https://www.youtube.com/', folder: 'f1'}),
  item({id: 'b3', title: '나이스 업무포털', url: 'https://www.neis.go.kr/', folder: 'f2'}),
  item({id: 'b4', title: '학급 홈페이지', url: 'https://example.com/class', folder: 'f2'})]})}})`);
await say('auto-backup-now', {}).catch(() => {});
await p.eval(`location.reload()`); await sleep(2500);
const shot = async (name, page, after) => {
  await p.eval(`document.querySelector('[data-page="${page}"]').click()`); await sleep(1100);
  if (after) { await p.eval(after); await sleep(700); }
  await p.eval(`document.getElementById('notice').hidden=true`);
  await p.shot(`${OUT}/${name}.png`);
};
await shot('1-notes', 'notes');
await shot('2-bookmarks', 'vault');
await shot('3-capture', 'capture');
await shot('4-presenter', 'presenter');
await shot('5-tools', 'tools');
// 설정 → 자동 백업 칸
await p.eval(`document.getElementById('dock-settings').click()`); await sleep(2500);
// 시험은 임시 폴더를 쓰므로, 화면에는 실제로 쓰는 기본 경로(문서 → 다있쌤 백업)로 보여 준다.
await p.eval(`(()=>{const st=document.getElementById('ab-status');st.textContent=st.textContent.replace(/폴더: .*/,'폴더: 문서 → 다있쌤 백업');
  const card=document.getElementById('auto-backup');window.scrollTo(0,card.getBoundingClientRect().top+scrollY-250);document.getElementById('notice').hidden=true;})()`); await sleep(600);
await p.shot(`${OUT}/6-backup.png`);
await C.stop();
try { fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 300}); } catch {}
console.log('찍은 화면:', fs.readdirSync(OUT).join(', '));
