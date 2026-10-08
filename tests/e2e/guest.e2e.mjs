// 게스트(PIN 없이) · 잠긴 까닭 · 스토어 판 앱 내려받기 · 도우미 없을 때 안내를 실제 Chrome 에서 본다.
// 사용: node tests/e2e/guest.e2e.mjs   (Chrome for Testing 필요 — cdp.mjs 참고)
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep, waitFile} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
const root = os.tmpdir() + '/e2e-guest-' + Date.now();
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail))); if (!cond) failed++; };
const send = (p, type, data = {}) => p.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
const C = new Chrome({ext: EXT, profile: root + '/p', port: 9511, downloads: root + '/dl'});
await C.start();
const p = await C.open(PANEL);
await p.waitFor(p.visible('#gate-form'), 15000, '처음 화면');
ok('처음 화면에 ‘PIN 없이 바로 쓰기’ 가 보인다', await p.eval(p.visible('#gate-guest')));
await p.eval(`document.getElementById('gate-guest').click()`);
await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
let s = (await send(p, 'state')).data;
ok('게스트 프로필이 만들어진다(잠기지 않음)', s.configured && s.guest && !s.locked, s);
await send(p, 'lock');
s = (await send(p, 'state')).data;
ok('게스트는 잠금 단추를 보내도 잠기지 않는다', !s.locked, s);
ok('게스트에는 잠금 단추 · 잠금 설정이 숨겨진다', await p.eval(`document.getElementById('lock').hidden&&document.getElementById('lock-now').hidden&&[...document.querySelectorAll('.lock-only')].every(n=>n.hidden)`));
// 웹 페이지에 잠금 화면이 없다
const web = await C.open('data:text/html,<h1>hi</h1>'); await sleep(800);
ok('게스트일 때 웹 페이지에 잠금 화면이 없다', !(await web.eval(`!!document.querySelector('[data-browser-sheriff-guard]')`)));
// PIN 만들기 → 잠금이 동작
await p.eval(`document.querySelector('[data-page="settings"],#dock-settings')?.click()`); await sleep(400);
await p.type('#pin-new', '246810'); await p.type('#pin-confirm', '246810');
await p.eval(`document.getElementById('pin-form').requestSubmit()`); await sleep(800);
s = (await send(p, 'state')).data;
ok('설정에서 PIN 을 만들면 게스트가 아니게 된다', !s.guest && !s.locked, s);
const open = await C.open('https://example.com/'); await sleep(1500);
await send(p, 'lock'); await sleep(900);
s = (await send(p, 'state')).data;
ok('PIN 을 만든 뒤에는 잠금 단추로 잠긴다', s.locked, s);
ok('잠긴 까닭(잠금 단추)과 판이 상태에 실린다', /잠금 단추/.test(s.lockText) && /개발자 모드 판/.test(s.lockText), s.lockText);
const overlay = await open.eval(`(()=>{const h=document.querySelector('[data-browser-sheriff-guard]');return h?h.shadowRoot.textContent:'';})()`).catch(() => '');
ok('열려 있던 탭의 잠금 화면에 잠긴 까닭이 보인다', /잠금 단추를 눌러 잠겼습니다/.test(overlay), overlay.slice(0, 200));
const fresh = await C.open('https://example.org/'); await sleep(1500);
const page = await fresh.eval(`location.protocol+' '+(document.getElementById('why')?.textContent||'')`).catch(() => '');
ok('잠긴 동안 새로 연 주소(잠금 안내 페이지)에도 까닭이 보인다', /^chrome-extension: .*잠금 단추/.test(page), page);
ok('잠금 화면 설명에도 까닭이 보인다', /잠금 단추/.test(await p.eval(`document.getElementById('gate-description').textContent`)));
let r = await send(p, 'unlock', {pin: '246810'});
ok('PIN 으로 풀린다', r.ok && !r.data.locked, r);
// 틀린 지금 PIN 으로는 없애지 못한다
r = await send(p, 'pin-remove', {current: '000000'});
ok('틀린 PIN 으로는 PIN 을 없앨 수 없다', !r.ok, r);
r = await send(p, 'pin-remove', {current: '246810'});
ok('맞는 PIN 으로 PIN 없이 쓰기로 바꾼다', r.ok && r.data.guest && !r.data.locked, r);
// 잠금 단축키에 기본 조합이 없다(Ctrl+Shift+L 은 구글 시트 '필터' · 문서 '왼쪽 정렬' 과 겹쳤다)
const cmds = await p.eval(`chrome.commands.getAll()`);
const lockCmd = cmds.find(c => c.name === 'lock-profile-key');
ok('잠금 단축키는 있고 기본 조합은 비어 있다', lockCmd && !lockCmd.shortcut && !cmds.some(c => c.name === 'lock-profile'), cmds);
// 도우미 없음: 도크를 누르면 도크 위 줄에 안내 + 발표 탭 다운로드가 펼쳐진다
await p.eval(`document.querySelector('[data-page="notes"]').click()`); await sleep(300);
await p.eval(`document.getElementById('dock-present').click()`); await sleep(1500);
const tip = await p.eval(`document.getElementById('dock-tip').textContent`);
ok('도우미가 없으면 도크 위 줄에 안내가 뜬다', /발표 도우미 앱이 필요합니다/.test(tip), tip);
ok('아래 안내에 무엇을 할지 적힌다', /발표 프로그램 다운로드/.test(await p.eval(`document.getElementById('notice').textContent`)));
ok('발표 탭으로 옮기고 다운로드 칸을 펼친다', await p.eval(`document.querySelector('[data-page="presenter"]').classList.contains('selected')&&document.getElementById('get-win').closest('details').open`));
// 스토어 판처럼 앱 파일이 없을 때: GitHub 최신 릴리스에서 바로 받는다(예전: 'Failed to fetch')
await p.eval(`document.getElementById('get-mac').click()`);
const got = await waitFile(root + '/dl', /발표도우미-맥\.zip$/, 60000).catch(() => null);
ok('앱 파일이 없으면 최신 릴리스에서 맥 앱을 내려받는다', !!got && fs.statSync(got).size > 100000, got);
ok('fetch 오류 글이 보이지 않는다', !/fetch/i.test(await p.eval(`document.getElementById('notice').textContent`)));
await C.stop();
console.log(failed ? `실패 ${failed}건` : '모두 통과');
process.exit(failed ? 1 : 0);
