// 실제 Chrome 에 확장을 올려 화면을 눌러 보는 작은 도구. 외부 패키지 없이 Node(22+)의 내장 WebSocket 으로 CDP 를 말한다.
// `npm test` 에는 들어가지 않는다(Chrome 이 있어야 한다). 손으로 돌린다: node tests/e2e/backup.e2e.mjs
// Chrome 은 CHROME_BIN 으로 알려 준다. 없으면 puppeteer 가 내려받아 둔 Chrome for Testing 중 가장 새 것을 찾는다.
// 주의: 확장의 ‘자리를 비우면 잠금’ 은 OS 의 입력 없는 시간을 본다. 자리를 오래 비운 컴퓨터에서 idleMinutes 를
// 켜 두고 돌리면 시험 도중 잠긴다 — 시험 쪽에서는 idleMinutes:0, lockOnAway:false 로 둔다.
import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const base = os.homedir() + '/.cache/puppeteer/chrome';
  if (!fs.existsSync(base)) throw new Error('Chrome 을 찾지 못했습니다. CHROME_BIN 에 Chrome for Testing 경로를 주세요.');
  const newest = fs.readdirSync(base).sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).at(-1);
  const found = execFileSync('find', [base + '/' + newest, '-maxdepth', '6', '-type', 'f', '-name', 'Google Chrome for Testing*'], {encoding: 'utf8'}).split('\n').filter(Boolean)[0];
  if (!found) throw new Error('puppeteer 의 Chrome for Testing 을 찾지 못했습니다. CHROME_BIN 을 주세요.');
  return found;
}
export const CHROME = findChrome();
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export class Chrome {
  constructor({ext, profile, port, downloads}) { Object.assign(this, {ext, profile, port, downloads}); this.n = 0; this.pending = new Map(); this.events = []; }
  async start() {
    fs.mkdirSync(this.profile, {recursive: true}); fs.mkdirSync(this.downloads, {recursive: true});
    this.proc = spawn(CHROME, [`--user-data-dir=${this.profile}`, `--remote-debugging-port=${this.port}`, `--load-extension=${this.ext}`, `--disable-extensions-except=${this.ext}`,
      '--no-first-run', '--no-default-browser-check', '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', 'about:blank'], {stdio: 'ignore'});
    for (let i = 0; i < 150; i++) {
      try { this.wsUrl = (await (await fetch(`http://127.0.0.1:${this.port}/json/version`)).json()).webSocketDebuggerUrl; break; } catch { await sleep(200); }
    }
    if (!this.wsUrl) throw new Error('Chrome 이 열리지 않았습니다');
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const {res, rej} = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else this.events.push(m);
    };
    await this.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: this.downloads, eventsEnabled: true});
  }
  send(method, params = {}, sessionId) {
    const id = ++this.n;
    return new Promise((res, rej) => { this.pending.set(id, {res, rej}); this.ws.send(JSON.stringify({id, method, params, sessionId})); });
  }
  async open(url, {width = 420, height = 900} = {}) {
    const {targetId} = await this.send('Target.createTarget', {url});
    const {sessionId} = await this.send('Target.attachToTarget', {targetId, flatten: true});
    const page = new Page(this, sessionId, targetId);
    await page.cmd('Runtime.enable'); await page.cmd('Page.enable'); await page.cmd('DOM.enable');
    await page.cmd('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    return page;
  }
  async stop() { try { this.ws.close(); } catch {} this.proc.kill('SIGKILL'); }
}
export class Page {
  constructor(chrome, sessionId, targetId) { Object.assign(this, {chrome, sessionId, targetId}); }
  cmd(method, params) { return this.chrome.send(method, params, this.sessionId); }
  async eval(expression) {
    const r = await this.cmd('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expression, timeout = 15000, what = expression) {
    const end = Date.now() + timeout; let last;
    while (Date.now() < end) { try { last = await this.eval(expression); if (last) return last; } catch (e) { last = e.message; } await sleep(150); }
    throw new Error('기다리다 시간 초과: ' + what + ' (마지막 값: ' + JSON.stringify(last) + ')');
  }
  async setFiles(selector, files) {
    const {root} = await this.cmd('DOM.getDocument', {depth: 0});
    const {nodeId} = await this.cmd('DOM.querySelector', {nodeId: root.nodeId, selector});
    if (!nodeId) throw new Error('없는 요소: ' + selector);
    await this.cmd('DOM.setFileInputFiles', {nodeId, files});
  }
  click(selector) { return this.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('없는 요소 ${selector}');e.click();return true})()`); }
  type(selector, value) { return this.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('없는 요소 ${selector}');e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); }
  visible(selector) { return `(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&!e.hidden&&e.offsetParent!==null})()`; }
  text(selector) { return this.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText||''`); }
  async shot(file) { const {data} = await this.cmd('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false}); fs.writeFileSync(file, Buffer.from(data, 'base64')); }
  reload() { return this.cmd('Page.reload'); }
}
export async function waitFile(dir, pattern, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const found = fs.readdirSync(dir).filter(f => pattern.test(f) && !f.endsWith('.crdownload')).sort();
    if (found.length) return dir + '/' + found.at(-1);
    await sleep(150);
  }
  throw new Error('파일이 내려받아지지 않았습니다: ' + pattern);
}
