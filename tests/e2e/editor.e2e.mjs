// v0.46.1 ① 발표 도우미 앱이 있어도(v0.46.2: 도크 세 곳의 캡처도 같은 설정을 따른다) ‘캡처 후: 편집기에서 꾸미기’ 면 선택 영역이 편집기로 열린다(예전에는 앱이 폴더 저장 + 복사만
// 하고 편집기가 열리지 않았다 — 사용자 보고, 맥 · 윈도우). ② 유틸리티에서 이미지 편집기를 연다.
// 앱 대신 시험용 가짜 도우미를 이 시험 프로필 안에만 등록한다(user-data-dir/NativeMessagingHosts). 받은 명령을 파일에 적는다.
// 사용: node tests/e2e/editor.e2e.mjs   (CHROME_BIN 으로 다른 Chrome 판)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {Chrome, Page, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const ORIGIN = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm';
const PANEL = ORIGIN + '/panel.html';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-editor-'));
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail).slice(0, 300))); if (!cond) failed++; };

// ── 가짜 발표 도우미(받은 것을 적고 ‘됐다’ 고만 답한다) ──
const profile = path.join(root, 'p'), log = path.join(root, 'host.log');
const hostJs = path.join(root, 'host.mjs'), hostSh = path.join(root, 'host.sh');
fs.writeFileSync(hostJs, `import fs from 'node:fs';
let buf=Buffer.alloc(0);
process.stdin.on('data',d=>{buf=Buffer.concat([buf,d]);
  while(buf.length>=4){const n=buf.readUInt32LE(0);if(buf.length<4+n)break;const m=JSON.parse(buf.subarray(4,4+n).toString());buf=buf.subarray(4+n);
    fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
    // 발표 명령 밖(자동 백업 등)은 ‘모른다’ 고 답한다 — 답하지 않으면 확장이 그 답을 기다리며 멈춘다. 실제 폴더는 건드리지 않는다.
    const out=Buffer.from(JSON.stringify(m.type==='presenter'?{kind:'presenter',ok:true,launched:false,presenting:false,focus:false,pins:0}:{kind:'unknown',ok:false}));
    const head=Buffer.alloc(4);head.writeUInt32LE(out.length);process.stdout.write(Buffer.concat([head,out]));}});
`);
fs.writeFileSync(hostSh, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(hostJs)} "$@"\n`, {mode: 0o755});
fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'), {recursive: true});
fs.writeFileSync(path.join(profile, 'NativeMessagingHosts', 'app.browsersheriff.presenter.json'),
  JSON.stringify({name: 'app.browsersheriff.presenter', description: 'e2e', path: hostSh, type: 'stdio', allowed_origins: [ORIGIN + '/']}));
const said = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).action) : [];

const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<!doctype html><title>시험 페이지</title><body style="margin:0;background:#fff;height:1600px"><h1 style="margin:40px">캡처할 글</h1></body>'); }).listen(0);
await new Promise(r => server.on('listening', r));
const WEB = `http://127.0.0.1:${server.address().port}/`;
const C = new Chrome({ext: EXT, profile, port: 9646, downloads: path.join(root, 'dl'), args: ['--window-size=1280,900']});
await C.start();
try {
  const p = await C.open(PANEL, {width: 400, height: 900});
  await p.waitFor(p.visible('#gate-guest'), 15000, '처음 화면');
  await p.eval(`document.getElementById('gate-guest').click()`);
  await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
  const pages = async prefix => (await C.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page' && t.url.startsWith(prefix));
  const waitPage = async (prefix, before = []) => { for (let i = 0; i < 60; i++) { const found = (await pages(prefix)).find(t => !before.includes(t.targetId)); if (found) return found; await sleep(150); } return null; };
  const attach = async t => { const {sessionId} = await C.send('Target.attachToTarget', {targetId: t.targetId, flatten: true}); const page = new Page(C, sessionId, t.targetId); await page.cmd('Runtime.enable'); return page; };

  // 앱이 연결되었는지(가짜 도우미가 상태 질문을 받는지)부터 본다 — 이것이 안 되면 아래 비교가 뜻이 없다.
  ok('(준비) 시험 프로필의 가짜 도우미가 확장과 이어진다', (await p.eval(`chrome.runtime.sendMessage({type:'presenter-command',action:'state'})`))?.ok === true && said().includes('state'), said());

  const {targetId: webId} = await C.send('Target.createTarget', {url: WEB});
  const web = await attach({targetId: webId});
  await web.waitFor(`document.readyState==='complete'&&location.href.startsWith('http')`, 10000);
  await C.send('Target.activateTarget', {targetId: webId}); await sleep(400);

  // 캡처 탭: 사이드바를 닫지 않고 찍게 둔다(이 시험의 패널은 탭이다).
  await p.eval(`(()=>{document.querySelector('nav button[data-page="capture"]').click();const h=document.getElementById('cap-hide-side');if(h.checked){h.click();}const a=document.getElementById('cap-after');a.value='editor';a.dispatchEvent(new Event('change'));})()`);
  await sleep(600);
  const label = await p.eval(`document.getElementById('cap-area-mode').textContent`);
  ok('편집기에서 꾸미기면 선택 영역 안내가 ‘이 탭 안에서 · 편집기로 엽니다’', /이 탭 안에서/.test(label) && /편집기로/.test(label), label);

  const before = said().length;
  await p.eval(`document.getElementById('cap-area').click()`);
  let pick = false; for (let i = 0; i < 60 && !pick; i++) { pick = await web.eval(`!!document.getElementById('__dais_pick')`); if (!pick) await sleep(100); }
  ok('편집기에서 꾸미기 + 앱 있음: 앱에 맡기지 않는다(snip-save 를 보내지 않음)', !said().slice(before).includes('snip-save'), said().slice(before));
  ok('편집기에서 꾸미기 + 앱 있음: 페이지에서 고르는 화면이 뜬다', pick);
  const editorsBefore = (await pages(ORIGIN + '/capture.html')).map(t => t.targetId);
  if (pick) {
    const m = (type, x, y) => C.send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1}, web.sessionId);
    await m('mousePressed', 100, 100); await m('mouseMoved', 260, 180); await m('mouseMoved', 420, 260); await m('mouseReleased', 420, 260);
  }
  const editor = await waitPage(ORIGIN + '/capture.html#', editorsBefore);
  ok('고르면 편집기(꾸미기 화면)가 그 그림으로 열린다', !!editor && !/#new/.test(editor.url), editor?.url);
  if (editor) {
    const e = await attach(editor);
    await e.waitFor(`document.getElementById('empty').hidden===true&&document.readyState==='complete'`, 8000).catch(() => {});
    ok('편집기에 그림이 들어 있다(빈 화면이 아님)', await e.eval(`document.getElementById('empty').hidden===true`));
    await C.send('Target.closeTarget', {targetId: editor.targetId});
  }

  // ── v0.46.2 도크의 캡처도 ‘캡처 후’ 설정대로(편집기) ──
  const drag = async () => { const m = (type, x, y) => C.send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1}, web.sessionId);
    await m('mousePressed', 120, 110); await m('mouseMoved', 300, 200); await m('mouseMoved', 460, 280); await m('mouseReleased', 460, 280); };
  const waitPick = async () => { for (let i = 0; i < 60; i++) { if (await web.eval(`!!document.getElementById('__dais_pick')`)) return true; await sleep(100); } return false; };
  const editorFrom = async (name, press, {area}) => {
    await C.send('Target.activateTarget', {targetId: webId}); await sleep(400);
    const from = said().length, open = (await pages(ORIGIN + '/capture.html')).map(t => t.targetId);
    await press();
    if (area) { const seen = await waitPick(); ok(`${name}: 페이지에서 고르는 화면이 뜬다`, seen); if (seen) await drag(); }
    const ed = await waitPage(ORIGIN + '/capture.html#', open);
    ok(`${name}: 앱에 맡기지 않는다`, !said().slice(from).includes('snip-save'), said().slice(from));
    let filled = false;
    if (ed) { const e = await attach(ed); await e.waitFor(`document.getElementById('empty').hidden===true`, 15000).catch(() => {}); filled = await e.eval(`document.getElementById('empty').hidden===true`); await C.send('Target.closeTarget', {targetId: ed.targetId}); }
    // why= 가 붙은 편집기는 ‘저장하지 못해 대신 연 것’ 이다 — 설정대로 연 것이 아니다.
    ok(`${name}: 꾸미기 화면이 그 그림으로 열린다`, !!ed && !/#new|why=/.test(ed.url) && filled, ed?.url);
  };
  await editorFrom('사이드바 도크 · 선택 영역', () => p.eval(`document.getElementById('dock-cap-area').click()`), {area: true});
  await editorFrom('사이드바 도크 · 스크롤 캡처', () => p.eval(`document.getElementById('dock-cap-full').click()`), {area: false});
  // 따로 띄운 도크(작은 창)
  await p.eval(`chrome.windows.create({url:chrome.runtime.getURL('dock.html'),type:'popup',width:404,height:76}).then(w=>w.id)`);
  const dockT = await waitPage(ORIGIN + '/dock.html');
  const dk = dockT && await attach(dockT);
  if (dk) await dk.waitFor(`document.readyState==='complete'&&!!document.getElementById('d-area')`, 8000);
  ok('따로 띄운 도크 창이 열린다', !!dk);
  if (dk) {
    await editorFrom('따로 띄운 도크 · 선택 영역', () => dk.eval(`document.getElementById('d-area').click()`), {area: true});
    await editorFrom('따로 띄운 도크 · 스크롤 캡처', () => dk.eval(`document.getElementById('d-full').click()`), {area: false});
  }

  // 대조: 저장 · 복사를 고르면 예전처럼 앱이 화면 전체에서 고른다.
  await C.send('Target.activateTarget', {targetId: webId}); await sleep(300);
  await p.eval(`(()=>{const a=document.getElementById('cap-after');a.value='both';a.dispatchEvent(new Event('change'));})()`);
  await sleep(600);
  ok('저장 + 복사면 안내가 ‘화면 전체에서 고릅니다’', /화면 전체에서/.test(await p.eval(`document.getElementById('cap-area-mode').textContent`)));
  const before2 = said().length;
  await p.eval(`document.getElementById('cap-area').click()`); await sleep(1200);
  ok('저장 + 복사 + 앱 있음: 그대로 앱에 맡긴다(다른 앱 · 다른 모니터도 고르기)', said().slice(before2).includes('snip-save'), said().slice(before2));
  ok('저장 + 복사 + 앱 있음: 페이지 안 고르기는 뜨지 않는다', !(await web.eval(`!!document.getElementById('__dais_pick')`)));
  if (dk) {
    const from = said().length;
    await dk.eval(`document.getElementById('d-area').click()`); await sleep(1200);
    ok('저장 + 복사 + 앱 있음: 따로 띄운 도크의 선택 영역도 앱에 맡긴다', said().slice(from).includes('snip-save'), said().slice(from));
    await C.send('Target.closeTarget', {targetId: dockT.targetId});
  }

  // ② 유틸리티의 이미지 편집기
  await p.eval(`document.querySelector('nav button[data-page="tools"]').click()`); await sleep(300);
  const card = await p.eval(`(()=>{const d=document.getElementById('tool-editor');return d?{name:d.querySelector('summary').textContent,inTools:document.getElementById('tools').contains(d)}:null;})()`);
  ok('유틸리티에 ‘이미지 편집기’ 칸이 있다', card?.inTools === true && card.name === '이미지 편집기', card);
  const blankBefore = (await pages(ORIGIN + '/capture.html')).map(t => t.targetId);
  await p.eval(`(()=>{const d=document.getElementById('tool-editor');d.open=true;document.getElementById('editor-open').click();})()`);
  const blank = await waitPage(ORIGIN + '/capture.html#new', blankBefore);
  ok('누르면 빈 편집기가 새 탭으로 열린다', !!blank, blank?.url);
  if (blank) {
    const b = await attach(blank);
    await b.waitFor(`document.getElementById('empty').hidden===false`, 8000).catch(() => {});
    ok('빈 편집기는 그림을 끌어 놓기 · 붙여 넣기 · 파일 고르기로 받는다', await b.eval(`document.getElementById('empty').hidden===false&&!!document.getElementById('file')&&!!document.getElementById('paste')`));
  }
} finally {
  console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
  await C.stop(); server.close();
}
process.exit(failed ? 1 : 0);
