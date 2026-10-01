// Chrome 이 갑자기 죽어도(전원 차단·강제 종료·충돌) 이미 ‘저장됨’ 을 받은 것은 남아 있는가.
//   node tests/e2e/crash-recovery.e2e.mjs [반복=4]
// 방법: 메모·북마크·설정·수업 도구를 쓰고 확인을 받자마자 Chrome 을 SIGKILL(정리할 틈을 주지 않는다)한 뒤, 같은 프로필로 다시 띄워 모두 있는지 본다.
// 매번 이어서 더 쓰고 또 죽인다 — 죽은 뒤 되살아난 상태에서 계속 쓸 수 있어야 한다.
import os from 'node:os';
import net from 'node:net';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const ID = 'ehgodopakibamgeopmelemjmjdjhbdgm';
const ROUNDS = Number(process.argv[2] || 4);
const profile = os.tmpdir() + '/e2e-crash-' + Date.now() + '/p';
const freePort = () => new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail).slice(0, 300))); if (!cond) failed++; };
const send = (page, type, data = {}) => page.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
const killHard = chrome => {
  // 브라우저와 모든 자식 프로세스를 정리할 틈 없이 죽인다
  const rows = execSync('ps -axo pid=,ppid=', {encoding: 'utf8'}).trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
  const kids = new Map(); for (const [pid, ppid] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(pid); }
  const all = []; const walk = p => { for (const k of kids.get(p) || []) { all.push(k); walk(k); } }; walk(chrome.proc.pid);
  for (const pid of [chrome.proc.pid, ...all]) { try { process.kill(pid, 'SIGKILL'); } catch {} }
};
const open = async () => {
  const chrome = new Chrome({ext: EXT, profile, port: await freePort(), downloads: os.tmpdir() + '/e2e-crash-dl'});
  await chrome.start();
  const panel = await chrome.open(`chrome-extension://${ID}/panel.html`);
  return {chrome, panel};
};

const expected = {notes: new Map(), bookmarks: new Set(), teams: null, font: null, bells: null};
let {chrome, panel} = await open();
await panel.waitFor(panel.visible('#gate-form'), 15000, '처음 화면');
await send(panel, 'setup', {pin: '246810', name: '충돌 시험'});
await send(panel, 'settings', {name: '충돌 시험', idleMinutes: 0, startLocked: false, lockOnAway: false, wheelZoom: true});
const device = await panel.eval(`chrome.storage.local.get('device').then(x=>x.device)`);

for (let round = 1; round <= ROUNDS; round++) {
  // 쓰고, 확인(ack)을 받는다
  for (let i = 0; i < 8; i++) {
    const id = `r${round}-n${i}`, text = `라운드 ${round} · ${i}번 메모 ${'가나다 '.repeat(i * 3)}😀`;
    const r = await send(panel, 'note-save', {id, title: `제목 ${round}-${i}`, text});
    if (r.ok) expected.notes.set(id, text);
  }
  const key = 'marks_' + device;
  const current = await panel.eval(`chrome.storage.sync.get('${key}').then(x=>x['${key}']||null)`);
  const items = [...(current?.items || [])];
  items.push({id: `bm${round}`, rev: Math.max(0, ...items.map(i => i.rev)) + 1, writer: device, title: `북마크 ${round}`, url: `https://example.com/${round}`, folder: ''});
  if ((await send(panel, 'marks-commit', {expected: current, value: {v: 1, kind: 'bookmarks', items}})).ok) expected.bookmarks.add(`bm${round}`);
  expected.font = ['gulim', 'malgun', 'dotum', 'apple'][round % 4];
  await panel.eval(`chrome.storage.local.set({uiFont:'${expected.font}'})`);
  expected.teams = [{name: `모둠${round}`, score: round * 10}];
  await send(panel, 'tool-teams', {teams: expected.teams});
  expected.bells = ['08:50', `0${round}:15`];
  await send(panel, 'tool-bells', {times: expected.bells, on: true});
  // 확인을 받자마자 죽인다(일부러 flush 도 하지 않는다 — 동기화를 기다리는 메모가 있는 채로)
  killHard(chrome);
  await chrome.stop().catch(() => {});
  await sleep(800);

  // 같은 프로필로 다시 띄운다
  ({chrome, panel} = await open());
  await panel.waitFor(`document.readyState==='complete'`, 15000);
  await sleep(1500);
  const state = (await send(panel, 'state')).data;
  ok(`[${round}] 죽었다 살아난 뒤에도 프로필이 그대로다`, state.configured === true && state.name === '충돌 시험', state);
  ok(`[${round}] 자동 잠금 설정도 그대로(잠기지 않고 열려 있다)`, state.startLocked === false && state.locked === false, state);
  const local = await panel.eval(`chrome.storage.local.get(null)`);
  const sync = await panel.eval(`chrome.storage.sync.get(null)`);
  let lost = [];
  for (const [id, text] of expected.notes) if (local.draftNotes?.[id]?.text !== text) lost.push(id);
  ok(`[${round}] 확인받은 메모 ${expected.notes.size}개가 모두 남아 있다`, lost.length === 0, {lost: lost.slice(0, 5)});
  const live = (sync['marks_' + device]?.items || []).map(i => i.id);
  ok(`[${round}] 확인받은 북마크가 모두 남아 있다`, [...expected.bookmarks].every(id => live.includes(id)), {live});
  ok(`[${round}] 설정(글꼴)과 수업 도구(모둠·종 알람)가 남아 있다`, local.uiFont === expected.font && JSON.stringify(local.teams) === JSON.stringify(expected.teams) && JSON.stringify(local.bellTimes) === JSON.stringify(expected.bells), {font: local.uiFont, teams: local.teams, bells: local.bellTimes});
  // 동기화를 기다리던 메모는 되살아난 뒤 스스로 올라간다(알람을 다시 만든다)
  const pending = Object.keys(local.pendingNotes || {});
  const alarm = await panel.eval(`chrome.alarms.getAll().then(a=>a.map(x=>x.name).includes('flush-notes'))`);
  ok(`[${round}] 기다리던 메모(${pending.length}개)가 있으면 알람이 다시 만들어진다`, pending.length === 0 || alarm === true, {pending: pending.length, alarm});
  await send(panel, 'note-flush'); await sleep(500);
  const after = await panel.eval(`Promise.all([chrome.storage.local.get('pendingNotes'),chrome.storage.sync.get(null)])`);
  const stillPending = Object.keys(after[0].pendingNotes || {});
  const missing = [...expected.notes].filter(([id, text]) => Buffer.byteLength(text) <= 5500 && after[1][`note_${device}_${id}`]?.text !== text).map(([id]) => id);
  ok(`[${round}] 되살아난 뒤 flush 하면 모든 메모가 동기화 저장소에 올라간다`, stillPending.length === 0 && missing.length === 0, {stillPending, missing: missing.slice(0, 5)});
}
killHard(chrome); await chrome.stop().catch(() => {});
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
process.exit(failed ? 1 : 0);
