// 영상 촬영 도구: 깨끗한 프로필의 Chrome(창이 있는 판)을 띄워 실제 창을 찍고, 누를 곳의 자리를 함께 기록한다.
// 사용자의 Chrome · 자료는 건드리지 않는다. 자동 백업은 임시 폴더(DAISSAM_BACKUP_DIR)로만 간다.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.env.CHROME_HEADFUL = '1';
const {Chrome, Page, sleep} = await import('../../tests/e2e/cdp.mjs');
export {sleep};
export const ID = 'ehgodopakibamgeopmelemjmjdjhbdgm', PANEL = `chrome-extension://${ID}/panel.html`;
export const OUT = process.env.OUT, WINS = process.env.WINS, LEFT = Number(process.env.WIN_LEFT || 0);
const EXT = fileURLToPath(new URL('../../extension', import.meta.url));
export class Rig {
  constructor(profile, port = 9750) { this.profile = profile; this.port = port; this.rects = {}; this.off = {}; fs.mkdirSync(OUT + '/shots', {recursive: true}); }
  async start(size = '1280,720') {
    const p = this.profile, fresh = !fs.existsSync(p + '/Default/Preferences');
    fs.mkdirSync(p + '/Default', {recursive: true}); fs.mkdirSync(p + '/NativeMessagingHosts', {recursive: true});
    if (fresh) fs.writeFileSync(p + '/Default/Preferences', JSON.stringify({extensions: {pinned_extensions: [ID]}, browser: {has_seen_welcome_page: true}, signin: {allowed: false, allowed_on_next_startup: false}, intl: {accept_languages: 'ko-KR,ko'}}));
    fs.writeFileSync(p + '/NativeMessagingHosts/app.browsersheriff.presenter.json', JSON.stringify({name: 'app.browsersheriff.presenter', description: '다있쌤 클립보드 도우미', path: '/Applications/Browser Sheriff Presenter.app/Contents/MacOS/Presenter', type: 'stdio', allowed_origins: [`chrome-extension://${ID}/`]}));
    process.env.DAISSAM_BACKUP_DIR = path.dirname(p) + '/backup-folder'; fs.mkdirSync(process.env.DAISSAM_BACKUP_DIR, {recursive: true});
    this.C = new Chrome({ext: EXT, profile: p, port: this.port, downloads: path.dirname(p) + '/dl', args: ['--test-type', '--disable-infobars', '--hide-crash-restore-bubble', '--disable-sync', '--lang=ko', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion,ChromeWhatsNewUI', ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split('|') : [])]});
    await this.C.start(); await sleep(1500);
    const t = (await this.C.send('Target.getTargets')).targetInfos.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension'));
    this.web = await this.attach(t.targetId);
    // 크기는 켠 뒤에 맞춘다 — 켤 때 정하면 작은 창(도크 · 녹화 · 화면 고르기)까지 같은 크기로 뜬다.
    const tmp = await this.newTab(PANEL, 700);
    await tmp.eval(`chrome.windows.getCurrent().then(w=>chrome.windows.update(w.id,{state:'normal',left:${LEFT},top:262,width:1280,height:720}))`); await sleep(500);
    await this.closeTab(tmp); await this.front(); await sleep(400);
    return this;
  }
  async attach(targetId) {
    const {sessionId} = await this.C.send('Target.attachToTarget', {targetId, flatten: true});
    const page = new Page(this.C, sessionId, targetId); await page.cmd('Runtime.enable'); await page.cmd('Page.enable').catch(() => {}); await page.cmd('DOM.enable').catch(() => {});
    return page;
  }
  async go(url, wait = 2500) {
    // 페이지가 스스로 옮겨 가게 하면 주소창에 파란 선택이 남지 않는다.
    const here = await this.web.eval('location.protocol').catch(() => '');
    if (/^https?:$/.test(here) && /^https?:/.test(url)) await this.web.eval(`location.href=${JSON.stringify(url)}`); else await this.web.cmd('Page.navigate', {url});
    await sleep(wait); await this.blur(this.web);
  }
  // 주소창의 파란 선택을 지운다(페이지 빈 곳을 한 번 누름)
  async blur(page) { for (const type of ['mousePressed', 'mouseReleased']) await this.C.send('Input.dispatchMouseEvent', {type, x: 3, y: 500, button: 'left', clickCount: 1}, page.sessionId).catch(() => {}); await sleep(150); }
  front() { return this.C.send('Target.activateTarget', {targetId: this.web.targetId}); }
  async newTab(url, wait = 2000) {
    const {targetId} = await this.C.send('Target.createTarget', {url: 'about:blank'});
    const page = await this.attach(targetId); await page.cmd('Page.navigate', {url}); await sleep(wait); await this.C.send('Target.activateTarget', {targetId}); await sleep(250); return page;
  }
  closeTab(page) { return this.C.send('Target.closeTarget', {targetId: page.targetId}); }
  async sideTarget() { return (await this.C.send('Target.getTargets')).targetInfos.find(t => t.url.startsWith(PANEL) && t.type === 'page' && !this.tabs?.has(t.targetId)); }
  async openSide() {
    const tmp = await this.newTab(PANEL, 900); this.tabs = new Set([tmp.targetId]);
    await this.front(); await sleep(300);
    const wid = await tmp.eval(`chrome.tabs.query({url:'*://*/*'}).then(()=>chrome.windows.getCurrent()).then(w=>w.id)`);
    await this.C.send('Runtime.evaluate', {expression: `chrome.sidePanel.open({windowId:${wid}}).then(()=>1,e=>e.message)`, awaitPromise: true, userGesture: true, returnByValue: true}, tmp.sessionId);
    await sleep(1200); const t = await this.sideTarget();
    this.sp = await this.attach(t.targetId); await this.closeTab(tmp); this.tabs = new Set(); await sleep(500);
    await this.calib('panel', this.sp); return this.sp;
  }
  msg(type, data = {}) { return this.sp.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`); }
  async tabPage(name) { await this.sp.eval(`document.querySelector('nav [data-page="${name}"]').click()`); await sleep(500); }
  win() {
    const rows = execFileSync(WINS, ['Chrome for Testing']).toString().split('\n').map(l => l.split('\t')).filter(a => a.length > 5 && a[3] === '0');
    const pick = rows.filter(a => {const [, , w, h] = a[4].split(',').map(Number); return w >= 1000 && h >= 400 && a[5] === 'true';});
    if (!pick.length) throw new Error('창을 찾지 못했습니다');
    if (!this.mainWin || !pick.some(a => a[0] === this.mainWin)) this.mainWin = (pick.find(a => a[4].startsWith(LEFT + ',262,1280,720')) || pick[0])[0];
    return this.mainWin;
  }
  grab(file) { execFileSync('screencapture', ['-x', '-o', '-l' + this.win(), file]); }
  // 화면 전체를 칠해 보고 이 문서가 창 안 어디에 있는지 잰다
  async calib(name, page) {
    await page.eval(`(()=>{const d=document.createElement('div');d.id='__cal';d.style.cssText='position:fixed;inset:0;background:#ff00ff;z-index:2147483647';(document.body||document.documentElement).append(d);})()`); await sleep(450);
    const f = OUT + '/cal.png'; this.grab(f);
    await page.eval(`document.getElementById('__cal').remove()`);
    const b64 = fs.readFileSync(f).toString('base64');
    const box = await this.scan(page, b64); this.off[name] = box; return box;
  }
  async scan(page, b64) {
    const tmp = await this.newTab('about:blank', 100);
    const box = await tmp.eval(`(async()=>{const r=await fetch('data:image/png;base64,${b64}');const bm=await createImageBitmap(await r.blob());const c=new OffscreenCanvas(bm.width,bm.height),g=c.getContext('2d');g.drawImage(bm,0,0);const d=g.getImageData(0,0,bm.width,bm.height).data;const is=(x,y)=>{const i=(y*bm.width+x)*4;return d[i]>200&&d[i+1]<70&&d[i+2]>200};let x0=1e9,x1=-1,y0=1e9,y1=-1;for(let y=0;y<bm.height;y+=4)for(let x=0;x<bm.width;x+=4)if(is(x,y)){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return {x:x0,y:y0,w:x1-x0+4,h:y1-y0+4};})()`);
    await this.closeTab(tmp); await this.front(); return box;
  }
  async rectsOf(page, base, map) {
    const out = {}, s = 2;
    for (const [key, sel] of Object.entries(map || {})) {
      const r = await page.eval(`(()=>{const e=${sel.startsWith('js:') ? sel.slice(3) : `document.querySelector(${JSON.stringify(sel)})`};if(!e)return null;const b=e.getBoundingClientRect();return b.width?[b.left,b.top,b.width,b.height]:null})()`).catch(() => null);
      if (r) out[key] = [Math.round(base.x + r[0] * s), Math.round(base.y + r[1] * s), Math.round(r[2] * s), Math.round(r[3] * s)];
      else console.log('  (자리 못 찾음)', key, sel.slice(0, 50));
    }
    return out;
  }
  async shot(name, {panel, page, tab, box, wait = 500} = {}) {
    await this.blur(tab || this.web); await sleep(wait);
    const rects = {...(box || {})};
    if (panel) Object.assign(rects, await this.rectsOf(this.sp, this.off.panel, panel));
    if (page) Object.assign(rects, await this.rectsOf(tab || this.web, this.off.page, page));
    this.grab(`${OUT}/shots/${name}.png`);
    this.rects[name] = rects; this.save(); console.log('찍음', name, Object.keys(rects).length);
  }
  save() {
    const f = OUT + '/rects.json', old = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    fs.writeFileSync(f, JSON.stringify({...old, ...this.rects}, null, 0));
  }
  // 작은 창(도크 · 녹화 · 화면 고르기)을 큰 창 위에 얹은 그림을 만든다. 창마다 따로 찍으므로 다른 앱이 끼어들지 않는다.
  pops() { return execFileSync(WINS, ['Chrome for Testing']).toString().split('\n').map(l => l.split('\t')).filter(a => a.length > 5 && a[3] === '0' && a[5] === 'true').map(a => ({id: a[0], name: a[2], box: a[4].split(',').map(Number)})).filter(w => w.box[2] > 150 && w.box[2] < 1000 && w.box[3] > 30); }
  async shotPop(name, pop, rects = {}) {
    const base = `${OUT}/${name}-base.png`, top = `${OUT}/${name}-top.png`; this.grab(base);
    execFileSync('screencapture', ['-x', '-l' + pop.id, top]);
    const [mx, my] = [LEFT, 262], s = 2, [wx, wy, ww] = pop.box;
    const size = execFileSync('sips', ['-g', 'pixelWidth', top]).toString().match(/pixelWidth: (\d+)/)[1], m = (Number(size) - ww * s) / 2;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', base, '-i', top, '-filter_complex', `overlay=${(wx - mx) * s - m}:${(wy - my) * s - m}`, '-frames:v', '1', `${OUT}/shots/${name}.png`]);
    this.rects[name] = {pop: [(wx - mx) * s, (wy - my) * s, ww * s, pop.box[3] * s], ...rects}; this.save(); console.log('찍음', name);
  }
  // 화면에서 그 자리를 그대로 찍는다(발표 오버레이 · 핀처럼 다른 앱 창이 함께 나와야 하는 장면). 앞에 다른 창이 없게 먼저 올린다.
  raise() { if (LEFT) return sleep(50); execFileSync('open', ['-a', process.env.CHROME_BIN.replace(/\/Contents\/MacOS.*/, '')]); return sleep(350); }
  region(name, rects = {}) { execFileSync('screencapture', ['-x', `-R${LEFT},262,1280,720`, `${OUT}/shots/${name}.png`]); this.rects[name] = rects; this.save(); console.log('찍음', name); }
  async stop() { this.save(); await this.C.stop(); }
}
