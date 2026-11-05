// 메모를 저장하는 순간 서비스 워커가 끊겨도 글이 남는가(사용자 보고: 연결이 끊어졌다면서 메모가 사라짐).
// 고치기 전: 40번 중 8번 ‘message channel closed’ 뒤 사이드바를 다시 열면 메모가 없었다. 사용: node tests/e2e/note-link.e2e.mjs [횟수=40]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const ROUNDS = Number(process.argv[2] || 40);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-link-'));
const C = new Chrome({ext: EXT, profile: path.join(root, 'p'), port: 9661, downloads: path.join(root, 'dl')});
await C.start();
const p = await C.open('chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html', {width: 400, height: 900});
await p.waitFor(p.visible('#gate-guest'), 15000, '처음 화면');
await p.eval(`document.getElementById('gate-guest').click()`);
await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
const kill = async () => {
  const w = (await C.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes('ehgodopakibamgeopmelemjmjdjhbdgm'));
  if (w) await C.send('Target.closeTarget', {targetId: w.targetId}).catch(() => {});
};
const saved = async text => Object.values(await p.eval(`chrome.storage.local.get(['draftNotes','pendingNotes']).then(r=>JSON.stringify({...(r.draftNotes||{}),...(r.pendingNotes||{})}))`).then(JSON.parse)).some(n => n.text === text);
let kept = 0, lost = 0, broke = 0;
for (let i = 0; i < ROUNDS; i++) {
  await p.eval(`document.getElementById('add-note').click()`); await sleep(120);
  const text = '메모 ' + i + ' 내용';
  await p.eval(`(()=>{const b=document.getElementById('note');b.focus();b.value=${JSON.stringify(text)};b.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(330 + Math.floor(Math.random() * 50)); await kill(); await sleep(1500);
  const notice = await p.eval(`document.getElementById('notice').hidden?'':document.getElementById('notice').textContent`);
  if (/channel closed|port closed|연결할 수 없|저장하지 못했/.test(notice)) broke++;
  if (await saved(text)) kept++; else { lost++; console.log('FAIL 저장되지 않음', text, notice.slice(0, 100)); }
}
console.log((lost ? 'FAIL ' : 'PASS ') + `저장 순간에 서비스 워커를 끊어도 메모가 남는다 — ${ROUNDS}번 중 남음 ${kept} · 잃음 ${lost} · 오류 글 ${broke}`);
await C.stop();
process.exit(lost || broke ? 1 : 0);
