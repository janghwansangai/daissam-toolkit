// 아주 긴 페이지를 ‘전체 페이지’ 로 찍을 때(레티나 2배율) 끝까지 되는가 · 메모리가 얼마나 드는가 · 끝난 뒤 되돌아오는가.
//   node tests/e2e/capture-tall.e2e.mjs [페이지 높이 px=30000]
import http from 'node:http';
import os from 'node:os';
import net from 'node:net';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const ID = 'ehgodopakibamgeopmelemjmjdjhbdgm';
const HEIGHT = Number(process.argv[2] || 30000);
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail).slice(0, 300))); if (!cond) failed++; };
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><body style="margin:0"><div style="height:${HEIGHT}px;background:repeating-linear-gradient(#fff 0 400px,#dfe 400px 800px)">긴 페이지</div></body>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const freePort = () => new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });
const chrome = new Chrome({ext: EXT, profile: os.tmpdir() + '/e2e-tall-' + Date.now() + '/p', port: await freePort(), downloads: os.tmpdir() + '/e2e-tall-dl'});
await chrome.start();
const send = (page, type, data = {}) => page.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
const rssOf = pid => Number(execSync(`ps -o rss= -p ${pid}`, {encoding: 'utf8'}).trim() || 0);
const tree = () => {
  const rows = execSync('ps -axo pid=,ppid=,rss=,command=', {encoding: 'utf8'}).trim().split('\n').map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m && {pid: +m[1], ppid: +m[2], rss: +m[3], cmd: m[4]}; }).filter(Boolean);
  const kids = new Map(); for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  const out = []; const walk = p => { for (const k of kids.get(p) || []) { out.push(k); walk(k.pid); } }; walk(chrome.proc.pid); return out;
};
const peak = {mb: 0};
const watch = setInterval(() => { try { const total = tree().reduce((a, r) => a + r.rss, 0) / 1024; if (total > peak.mb) peak.mb = total; } catch {} }, 400);

const panel = await chrome.open(`chrome-extension://${ID}/panel.html`);
await panel.waitFor(panel.visible('#gate-form'), 15000);
await send(panel, 'setup', {pin: '246810', name: '긴 페이지'});
await send(panel, 'settings', {name: '긴 페이지', idleMinutes: 0, startLocked: false, lockOnAway: false, wheelZoom: true});
const tab = await chrome.open(origin + '/tall');
await tab.cmd('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 2, mobile: false});
await tab.waitFor(`document.readyState==='complete'`, 10000);
await chrome.send('Page.bringToFront', {}, tab.sessionId).catch(() => {});
await sleep(800);
const before = peak.mb;
const started = Date.now();
const result = await send(panel, 'capture', {mode: 'full', after: 'editor'});
const seconds = (Date.now() - started) / 1000;
console.log(`전체 페이지 캡처: ${HEIGHT}px 페이지, ${seconds.toFixed(1)}초, 전체 브라우저 메모리 최고 ${Math.round(peak.mb)}MB (시작 전 ${Math.round(before)}MB)`);
console.log('결과:', JSON.stringify(result).slice(0, 300));
ok('전체 페이지 캡처가 끝까지 끝난다', result.ok === true, result);
if (result.ok) {
  ok('결과에 바이트 수가 있고 0 이 아니다', result.data.bytes > 1000, result.data);
  // 헤드리스에서는 캡처가 2배율이 아니라 1배율이므로 CSS 높이를 그대로 한도(32,000px)와 견준다
  ok(HEIGHT > 32000 ? '한도(32,000px)를 넘으면 잘렸다고 알린다' : '한도 안이면 잘리지 않는다', HEIGHT > 32000 ? result.data.truncated === true : !result.data.truncated, result.data);
}
// 끝난 뒤 페이지가 원래 자리와 모습으로 돌아왔는가(스크롤바 숨김·떠 있는 요소 숨김이 남지 않는다)
await sleep(800);
const after = JSON.parse(await tab.eval(`JSON.stringify({y: scrollY, 숨김스타일: document.querySelectorAll('style[data-dais],[data-dais-hidden]').length, 스크롤바: getComputedStyle(document.documentElement).scrollbarWidth})`));
ok('끝난 뒤 스크롤 위치가 처음으로 돌아왔다', after.y === 0, after);
// 서비스 워커가 살아 있고 다음 명령에 답한다(메모리 부족으로 죽지 않았다)
const state = await send(panel, 'state');
ok('캡처 뒤에도 서비스 워커가 정상이다', state.ok === true && state.data.configured === true);
// 첫 캡처 뒤에는 편집기 탭이 앞에 나와 있다(보이는 탭만 찍을 수 있어서 ‘일반 웹페이지에서 해 주세요’ 라고 안내한다 — 설계된 동작).
// 웹 탭으로 돌아간 뒤 한 번 더 찍는다.
await chrome.send('Target.activateTarget', {targetId: tab.targetId}); await sleep(700);
const second = await send(panel, 'capture', {mode: 'visible', after: 'editor'});
console.log('두 번째 캡처 응답:', JSON.stringify(second).slice(0, 300));
ok('두 번째 캡처(보이는 부분)도 된다', second.ok === true, second);
clearInterval(watch);
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
await chrome.stop(); server.close();
process.exit(failed ? 1 : 0);
