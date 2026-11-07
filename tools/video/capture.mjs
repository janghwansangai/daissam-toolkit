// 실제 프로그램을 눌러 가며 장면을 찍는다. 사용: OUT=… WINS=… CHROME_BIN=… node tools/video/capture.mjs <프로필> <a,b,c…>
import {Rig, sleep, OUT, PANEL} from './rig.mjs';
import fs from 'node:fs';
import {execFileSync, spawn} from 'node:child_process';
const profile = process.argv[2], want = new Set((process.argv[3] || 'a').split(','));
const r = await new Rig(profile).start();
const WIKI = 'https://ko.wikipedia.org/wiki/물의_순환', SITE = 'https://daissam-toolkit.janhan97.workers.dev/';
const safe = async (name, job) => { try { await job(); } catch (e) { console.log('실패', name, String(e.message).slice(0, 160)); } };
const PIN = '246810';
const mouse = (page, x, y, type = 'mouseMoved', extra = {}) => r.C.send('Input.dispatchMouseEvent', {type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1, ...extra}, page.sessionId);
const scrollTo = (sel, block = 'start') => r.sp.eval(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'${block}'})`);
const setv = (sel, v) => r.sp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const check = (sel, on = true) => r.sp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(e.checked!==${on}){e.click();}})()`);
const click = sel => r.sp.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const openD = text => r.sp.eval(`[...document.querySelectorAll('summary')].find(s=>s.textContent.includes(${JSON.stringify(text)})).parentElement.open=true`);

if (want.has('a2')) await safe('a2', async () => {
  await r.web.cmd('Emulation.setUserAgentOverride', {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', platform: 'MacIntel', userAgentMetadata: {brands: [{brand: 'Google Chrome', version: '156'}, {brand: 'Chromium', version: '156'}, {brand: 'Not_A Brand', version: '24'}], fullVersionList: [{brand: 'Google Chrome', version: '156.0.8078.74'}, {brand: 'Chromium', version: '156.0.8078.74'}], platform: 'macOS', platformVersion: '15.0.0', architecture: 'arm', model: '', mobile: false}});
  await r.go('https://chromewebstore.google.com/detail/penklhfehmfoebmeolplklmjjcjhhnpi', 5500); await r.calib('page', r.web);
  await r.web.eval(`(()=>{[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()==='거부')?.click();const t=[...document.querySelectorAll('*')].filter(e=>e.children.length<4&&/Chrome으로 전환하여/.test(e.textContent)).pop();let b=t;for(let i=0;i<4&&b?.parentElement;i++){if(b.getBoundingClientRect().width>500)break;b=b.parentElement;}if(b)b.style.display='none';})()`); await sleep(600);
  await r.shot('store', {page: {add: 'js:[...document.querySelectorAll("button")].find(b=>/Chrome에 추가/.test(b.textContent))'}});
  await r.web.cmd('Emulation.setUserAgentOverride', {userAgent: ''}).catch(() => {});
  await r.go('https://ko.wikipedia.org/wiki/물의_순환', 2500);
  const ext = await r.newTab('chrome://extensions/', 1800);
  const q = "document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar').shadowRoot";
  await ext.eval(`(()=>{const d=${q}.querySelector('#devMode');if(!d.checked)d.click();})()`); await sleep(900);
  await r.calib('ext', ext);
  r.rects['ext-page'] = await r.rectsOf(ext, r.off.ext, {dev: `js:${q}.querySelector('#devMode')`, load: `js:${q}.querySelector('#loadUnpacked')`});
  await r.C.send('Target.activateTarget', {targetId: ext.targetId}); await sleep(500); r.grab(`${OUT}/shots/ext-page.png`); r.save(); await r.closeTab(ext); await r.front();
});
if (want.has('a')) await safe('a', async () => {
  await r.go(SITE, 3500); await r.web.eval(`document.documentElement.style.scrollBehavior='auto'`);
  await r.calib('page', r.web);
  await r.shot('site', {page: {store: 'js:[...document.querySelectorAll("a.btn")].find(a=>/웹 스토어|스토어/.test(a.textContent))', down: 'a.btn'}});
  await r.web.eval(`document.querySelector('#download').scrollIntoView()`);
  await r.shot('site-down', {page: {boxes: '#download'}});
  await r.web.cmd('Emulation.setUserAgentOverride', {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', platform: 'MacIntel', userAgentMetadata: {brands: [{brand: 'Google Chrome', version: '156'}, {brand: 'Chromium', version: '156'}, {brand: 'Not_A Brand', version: '24'}], fullVersionList: [{brand: 'Google Chrome', version: '156.0.8078.74'}, {brand: 'Chromium', version: '156.0.8078.74'}], platform: 'macOS', platformVersion: '15.0.0', architecture: 'arm', model: '', mobile: false}});
  await r.go('https://chromewebstore.google.com/detail/penklhfehmfoebmeolplklmjjcjhhnpi', 5500);
  await r.web.eval(`(()=>{[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()==='거부')?.click();const t=[...document.querySelectorAll('*')].filter(e=>e.children.length<4&&/Chrome으로 전환하여/.test(e.textContent)).pop();let b=t;for(let i=0;i<4&&b?.parentElement;i++){if(b.getBoundingClientRect().width>500)break;b=b.parentElement;}if(b)b.style.display='none';})()`); await sleep(500);
  await r.shot('store', {page: {add: 'js:[...document.querySelectorAll("button")].find(b=>/Chrome에 추가|Add to Chrome/.test(b.textContent))'}});
  await r.web.cmd('Emulation.setUserAgentOverride', {userAgent: ''}).catch(() => {});
  await r.go(WIKI, 3000);
  await r.calib('page', r.web);
  await r.shot('toolbar', {box: {pin: [2146, 96, 80, 72], puzzle: [2224, 96, 80, 72]}});
  const ext = await r.newTab('chrome://extensions/', 1800);
  await ext.eval(`document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar').shadowRoot.querySelector('#devMode').click()`); await sleep(700);
  await r.calib('ext', ext);
  const q = "document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar').shadowRoot";
  r.rects['ext-page'] = await r.rectsOf(ext, r.off.ext, {dev: `js:${q}.querySelector('#devMode')`, load: `js:${q}.querySelector('#loadUnpacked')`});
  await r.C.send('Target.activateTarget', {targetId: ext.targetId}); await sleep(500); r.grab(`${OUT}/shots/ext-page.png`); r.save(); await r.closeTab(ext); await r.front();
  await r.openSide();
  await r.shot('gate', {panel: {name: '#profile-name', pin: '#profile-pin', confirm: '#profile-confirm', submit: '#gate-submit', guest: '#gate-guest', restore: '#gate-restore-open', app: '#gate-get-app'}});
  await scrollTo('#gate-restore-open', 'center'); await click('#gate-restore-open');
  await r.shot('gate-restore', {panel: {restore: '#gate-restore-open', file: '#gate-file'}});
  await click('#gate-restore-open'); await scrollTo('#gate-title');
  await setv('#profile-name', '김다있'); await setv('#profile-pin', PIN); await setv('#profile-confirm', PIN);
  await r.sp.eval(`document.getElementById('gate-form').requestSubmit()`); await r.sp.waitFor(r.sp.visible('#workspace'), 15000);
  await r.msg('settings', {name: '김다있', idleMinutes: 0, startLocked: false, lockOnAway: false, wheelZoom: true});
  await r.shot('first-work', {panel: {auto: '.auto-hide', dock: '.dock', nav: 'nav'}});
});
if (!r.sp && [...want].some(k => !k.startsWith('a'))) { await r.go(WIKI, 2500); await r.calib('page', r.web); await r.openSide(); }
const seen = await r.sp?.eval(`document.getElementById('workspace').hidden`);
if (seen) { await setv('#profile-pin', PIN); await r.sp.eval(`document.getElementById('gate-form').requestSubmit()`); await sleep(1200); }

if (want.has('b')) await safe('b', async () => {
  const ids = {n1: ['3학년 1반 수업 준비', '과학 3단원 · 물의 순환\n- 그림 자료 먼저 보여 주기\n- 모둠별로 순서 카드 맞히기\n- 정리 활동지 나눠 주기'], n2: ['학부모 상담 일정', '화요일 4시 · 민지 어머니\n목요일 3시 · 도윤 아버지'], n3: ['이번 주 할 일', '체험학습 안내장 보내기\n과학실 예약 확인\n생활기록부 입력'], n4: ['동학년 회의', '운동회 역할 나누기']};
  for (const id of Object.keys(ids).reverse()) { await r.msg('note-save', {id, title: ids[id][0], text: ids[id][1]}); await sleep(150); }
  await r.sp.eval(`location.reload()`); await sleep(1500); await r.sp.waitFor(r.sp.visible('#workspace'), 15000); await sleep(600);
  await r.sp.eval(`document.querySelector('#note-tabs [data-id="n1"]').click()`); await sleep(500);
  const memo = {tabs: '#note-tabs', add: '#add-note', title: '#note-title', pin: '#pin-note', del: '#delete-note', secret: 'js:document.getElementById("note-secret").closest(".opt")', clip: 'js:document.getElementById("clip-toggle").closest(".opt")', note: '#note', status: '#note-status', sync: '#sync-check', count: '#note-count'};
  const head = {auto: '.auto-hide', dock: '.dock', dockbar: '.dockbar', nav: 'nav', present: '#dock-present', stop: '#dock-stop', focus: '#dock-focus', snip: '#dock-snip', through: '#dock-through', pins: '#dock-pins', area: '#dock-cap-area', full: '#dock-cap-full', pop: '#dock-pop', settings: '#dock-settings', lock: '#lock', owner: '#owner'};
  for (const [key, label] of [['notes', 'memo'], ['vault', 'marks'], ['capture', 'cap'], ['presenter', 'pres']]) head['tab-' + key] = `[data-page="${key}"]`;
  await r.shot('overview', {panel: {...head, ...memo}, page: {page: 'h1'}});
  await r.sp.eval(`window.scrollTo(0,99999)`); await r.shot('overview-bottom', {panel: {report: '#report-bug', version: '#version', save: '#save-note', copy: '#copy-note', print: '#print-note', export: '#export-note', status: '#note-status', sync: '#sync-check', count: '#note-count'}});
  await r.sp.eval(`window.scrollTo(0,0)`);
  // 메모
  await click('#add-note'); await sleep(300);
  await r.sp.eval(`(()=>{const b=document.getElementById('note');b.focus();b.value='다음 주 현장학습 준비물\\n도시락, 물, 돗자리';b.dispatchEvent(new Event('input',{bubbles:true}));const t=document.getElementById('note-title');t.value='현장학습 준비물';t.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(900);
  await r.shot('memo-new', {panel: memo});
  await r.sp.eval(`document.getElementById('note').blur()`); await sleep(300);
  await click('#pin-note'); await sleep(600);
  await r.shot('memo-pin', {panel: {...memo, deck: '#pin-deck'}});
  await click('#pin-note'); await sleep(400);
  await r.sp.eval(`window.scrollTo(0,99999)`); await click('#sync-check'); await sleep(1400);
  await r.shot('memo-sync', {panel: {sync: '#sync-check', box: '#sync-box', status: '#note-status'}});
  await r.sp.eval(`window.scrollTo(0,0)`);
  // 다른 기기 사본
  const dev = await r.sp.eval(`chrome.storage.local.get('device').then(x=>x.device)`);
  await r.sp.eval(`document.querySelector('#note-tabs [data-id="n1"]').click()`); await sleep(400);
  await r.sp.eval(`chrome.storage.sync.set({note_otherpc0_n1:{v:2,id:'n1',title:'3학년 1반 수업 준비',text:'과학 3단원 · 물의 순환\\n- 교무실 컴퓨터에서 고친 내용',time:Date.now()-3600000,created:1,device:'otherpc0',revision:'x'}})`); await sleep(700);
  await openD('다른 기기 사본'); await scrollTo('#note-versions', 'center');
  await r.shot('memo-versions', {panel: {versions: '#note-versions', count: '#version-count'}});
  await r.sp.eval(`chrome.storage.sync.remove('note_otherpc0_n1')`); await r.sp.eval(`window.scrollTo(0,0)`); await sleep(400);
  // 비밀 메모
  await r.sp.eval(`document.querySelector('#note-tabs [data-id="n2"]').click()`); await sleep(400);
  await r.shot('memo-secret-off', {panel: memo});
  await r.sp.eval(`document.getElementById('note-secret').click()`); await sleep(900);
  await r.shot('memo-secret-on', {panel: memo});
  await r.sp.eval(`document.querySelector('#note-tabs [data-id="n1"]').click()`); await sleep(400);
  await r.sp.eval(`document.querySelector('#note-tabs [data-id="n2"]').click()`); await sleep(800);
  await r.shot('memo-secret-ask', {panel: {dialog: '#mark-pin', input: '#mark-pin-input', go: '#mark-pin-go'}});
  await r.sp.eval(`document.getElementById('mark-pin-cancel').click()`); await sleep(500);
  await r.shot('memo-secret-cover', {panel: {cover: '#secret-cover', open: '#secret-open', secret: 'js:document.getElementById("note-secret").closest(".opt")'}});
  await r.sp.eval(`document.querySelector('#note-tabs [data-id="n3"]').click()`); await sleep(400);
  // 자동 붙여넣기 (도우미 연결)
  await r.sp.eval(`document.getElementById('clip-toggle').click()`); await sleep(1500);
  await r.shot('memo-clip', {panel: {clip: 'js:document.getElementById("clip-toggle").closest(".opt")', state: '#clip-state'}});
  await r.sp.eval(`document.getElementById('clip-toggle').click()`); await sleep(800);
  // 그림 붙여넣기
  const png = fs.readFileSync(OUT + '/paste.png').toString('base64');
  await click('#add-note'); await sleep(300);
  for (let i = 0; i < 2; i++) { await r.sp.eval(`(async()=>{const b=await (await fetch('data:image/png;base64,${png}')).blob();const f=new File([b],'p.png',{type:'image/png'});const dt=new DataTransfer();dt.items.add(f);document.getElementById('note').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`); await sleep(1300); }
  await scrollTo('#shots', 'start'); await sleep(500);
  await r.shot('memo-images', {panel: {shots: '#shots', images: '#note-images', first: '#note-images > *', title: '#note-title'}});
  await r.sp.eval(`window.scrollTo(0,0)`);
  // 북마크
  await r.tabPage('vault'); await sleep(500);
  for (const name of ['수업 자료', '학교 업무']) { await r.sp.eval(`window.prompt=()=>${JSON.stringify(name)};document.getElementById('add-folder').click()`); await sleep(600); }
  await r.sp.eval(`[...document.querySelectorAll('#folder-tabs button')].find(b=>b.textContent.includes('수업 자료'))?.click()`); await sleep(500);
  await click('#bookmark-current'); await sleep(800);
  await openD('주소를 직접 입력');
  for (const [t, u] of [['에듀넷 티-클리어', 'https://www.edunet.net/'], ['국립중앙과학관', 'https://www.science.go.kr/']]) { await setv('#bookmark-title', t); await setv('#bookmark-url', u); await r.sp.eval(`document.getElementById('bookmark-form').requestSubmit()`); await sleep(700); }
  await r.shot('marks', {panel: {folders: '#folder-tabs', addf: '#add-folder', renf: '#rename-folder', remf: '#remove-folder', cur: '#bookmark-current', list: '#bookmarks', title: '#bookmark-title', url: '#bookmark-url', count: '#bookmark-count'}});
  await scrollTo('#vault-export', 'center');
  await r.shot('marks-bottom', {panel: {exp: '#vault-export', imp: '#vault-import', form: '#bookmark-form', list: '#bookmarks'}});
  await r.sp.eval(`window.scrollTo(0,0)`);
  // 자동 숨김
  await r.tabPage('notes'); await sleep(400);
  await r.sp.eval(`document.getElementById('auto-hide').click()`); await sleep(900);
  await r.shot('auto-on', {panel: {auto: '.auto-hide', notice: '#notice'}});
  await mouse(r.sp, 120, 300); await sleep(200); await mouse(r.sp, -30, 300); await sleep(2200);
  await r.calib('pagewide', r.web);
  await r.shot('auto-hidden', {page: {tab: '[data-dais-sidetab]'}});
  r.off.page = r.off.pagewide;
  const b = await r.web.eval(`(()=>{const x=document.querySelector('[data-dais-sidetab]').getBoundingClientRect();return [document.documentElement.clientWidth-6,x.top+x.height/2]})()`);
  await mouse(r.web, b[0], b[1]); await sleep(500);
  await r.shot('auto-hover', {page: {tab: '[data-dais-sidetab]'}});
  await mouse(r.web, b[0], b[1], 'mousePressed', {buttons: 1});
  for (let i = 1; i <= 8; i++) { await r.C.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: b[0], y: b[1] - i * 22, button: 'left', buttons: 1}, r.web.sessionId); await sleep(25); }
  await mouse(r.web, b[0], b[1] - 176, 'mouseReleased'); await sleep(600);
  await r.shot('auto-moved', {page: {tab: '[data-dais-sidetab]'}});
  await mouse(r.web, b[0], b[1] - 176); await sleep(250); await mouse(r.web, b[0], b[1] - 176, 'mousePressed', {buttons: 1}); await mouse(r.web, b[0], b[1] - 176, 'mouseReleased'); await sleep(1800);
  const t = await r.sideTarget(); r.sp = await r.attach(t.targetId); await r.sp.waitFor(r.sp.visible('#workspace'), 15000); await sleep(500);
  await r.calib('page', r.web);
  await r.sp.eval(`document.getElementById('auto-hide').click()`); await sleep(500);
  await r.sp.eval(`document.getElementById('notice').hidden=true`).catch(() => {});
});
const popWait = async (match, tries = 25) => { for (let i = 0; i < tries; i++) { const w = r.pops().find(match); if (w) return w; await sleep(200); } return null; };
const extTab = async () => (await r.C.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page');
if (want.has('c')) await safe('c', async () => {
  await r.tabPage('capture'); await r.sp.eval(`(()=>{const e=document.getElementById('cap-hide-side');if(e.checked)e.click();})()`); await sleep(300);
  await r.sp.eval(`window.scrollTo(0,0)`);
  const cap = {visible: '#cap-visible', full: '#cap-full', area: '#cap-area', mode: '#cap-area-mode', delay: '#cap-delay', sec: '#cap-delay-sec', screen: '#cap-screen', local: '#cap-local', ocr: '#cap-ocr', after: '#cap-after'};
  await r.shot('cap-main', {panel: cap});
  await scrollTo('#cap-screen', 'start'); await r.shot('cap-main2', {panel: cap});
  await scrollTo('#cap-video-title', 'start');
  const rec = {title: '#cap-video-title', desktop: '[data-rec="desktop"]', camera: '[data-rec="camera"]', tab: '[data-rec="tab"]', region: '[data-rec="region"]', cam: '#rec-cam', mic: '#rec-mic', control: '#rec-control', res: '#rec-res', format: '#rec-format', more: '#rec-more', start: '#rec-start'};
  await r.sp.eval(`document.querySelector('[data-rec="tab"]').click()`); await sleep(400);
  await r.shot('rec-main', {panel: rec});
  await click('#rec-more'); await sleep(300); await scrollTo('#rec-more', 'center');
  await r.shot('rec-more', {panel: {more: '#rec-more', box: '#rec-more-box', count: '#rec-count', limit: '#rec-limit', sound: '#rec-sound', start: '#rec-start'}});
  await openD('캡처 세부 설정'); await scrollTo('#cap-format', 'center');
  await r.shot('cap-detail', {panel: {format: '#cap-format', fixed: '#cap-hide-fixed', bar: '#cap-hide-bar', side: '#cap-hide-side', keys: '#cap-keys'}});
  await r.sp.eval(`window.scrollTo(0,0)`);
  // 잠시 뒤 캡처의 3-2-1
  await r.sp.eval(`document.getElementById('cap-delay-sec').value='3'`); await click('#cap-delay'); await sleep(900);
  await r.shot('cap-count', {wait: 0}); await sleep(3600);
  // 편집기
  for (const t of await extTab()) if (t.url.includes('capture.html')) await r.C.send('Target.closeTarget', {targetId: t.targetId});
  await sleep(300); await r.sp.eval(`window.close()`).catch(() => {}); await sleep(1200); await r.front(); await sleep(400);
  const tmp = await r.newTab(PANEL, 800); r.tabs = new Set([tmp.targetId]); await r.front(); await sleep(500);
  await tmp.eval(`chrome.runtime.sendMessage({type:'capture',mode:'visible',after:'editor'})`).catch(e => console.log(e.message)); await sleep(2500);
  await r.closeTab(tmp);
  const ed = (await extTab()).find(t => t.url.includes('capture.html')); const page = await r.attach(ed.targetId);
  await r.C.send('Target.activateTarget', {targetId: ed.targetId}); await sleep(900);
  await r.calib('editor', page); await r.C.send('Target.activateTarget', {targetId: ed.targetId}); await sleep(400);
  const tools = {}; for (const t of ['select', 'crop', 'rect', 'ellipse', 'arrow', 'line', 'pen', 'mark', 'text', 'blur', 'step']) tools[t] = `[data-tool="${t}"]`;
  const ctl = {tools: '#tools', inks: '#inks', undo: '#undo', redo: '#redo', resize: '#resize', ocr: '#ocr', print: '#print', download: '#download', copy: '#copy', save: '#save'};
  r.off.page = r.off.editor;
  await r.shot('editor', {page: {...tools, ...ctl}, tab: page});
  const m = (x, y, type, b = 0) => r.C.send('Input.dispatchMouseEvent', {type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: b, clickCount: 1}, page.sessionId);
  const cr = await page.eval(`(()=>{const b=document.getElementById('canvas').getBoundingClientRect();return [b.left,b.top,b.width,b.height]})()`);
  const P = (u, v) => [cr[0] + cr[2] * u, cr[1] + cr[3] * v];
  const drag = async (tool, a, b) => { await page.eval(`document.querySelector('[data-tool="${tool}"]').click()`); await sleep(150); const [x0, y0] = P(...a), [x1, y1] = P(...b); await m(x0, y0, 'mouseMoved'); await m(x0, y0, 'mousePressed', 1); for (let i = 1; i <= 6; i++) { await m(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, 'mouseMoved', 1); } await m(x1, y1, 'mouseReleased'); await sleep(250); };
  await drag('rect', [.33, .42], [.62, .62]); await drag('arrow', [.1, .3], [.3, .45]); await drag('blur', [.05, .68], [.3, .78]);
  await page.eval(`document.querySelector('[data-tool="step"]').click()`); { const [x, y] = P(.7, .3); await m(x, y, 'mouseMoved'); await m(x, y, 'mousePressed', 1); await m(x, y, 'mouseReleased'); } await sleep(300);
  await r.shot('editor-marked', {page: {...tools, ...ctl}, tab: page});
  await r.closeTab(page); await r.front(); await sleep(400);
  await r.openSide();
  // 막힌 화면: 화면 고르기 작은 창
  await r.go('chrome://settings/', 1500); await r.tabPage('capture');
  await r.msg('capture', {mode: 'visible'}).catch(() => {}); const g = await popWait(w => w.box[2] > 380 && w.box[2] < 520);
  if (g) { await r.shotPop('grab', g); await r.C.send('Target.closeTarget', {targetId: (await extTab()).find(t => t.url.includes('grab.html'))?.targetId}).catch(() => {}); }
  await r.go(WIKI, 2500);
  // 탭 녹화
  await r.tabPage('capture'); await r.sp.eval(`document.querySelector('[data-rec="tab"]').click()`); await sleep(300); await r.sp.eval(`(()=>{for(const id of ['rec-cam','rec-mic'])if(document.getElementById(id).checked)document.getElementById(id).click();})()`);
  await r.C.send('Runtime.evaluate', {expression: `document.getElementById('rec-start').click()`, userGesture: true}, r.sp.sessionId); await sleep(1800);
  const w = await popWait(x => x.box[2] > 300 && x.box[2] < 900);
  if (w) { await r.shotPop('rec-count', w); await sleep(4500); const w2 = await popWait(x => x.box[2] > 300 && x.box[2] < 900); if (w2) await r.shotPop('rec-run', w2); }
  const t = (await extTab()).find(x => x.url.includes('record.html'));
  if (t) { const rp = await r.attach(t.targetId); await rp.eval(`document.getElementById('stop').click()`).catch(() => {}); await sleep(2500); const w3 = await popWait(x => x.box[2] > 300 && x.box[2] < 900); if (w3) await r.shotPop('rec-done', w3); await r.closeTab(rp).catch(() => {}); }
  await sleep(500);
});
if (want.has('d')) await safe('d', async () => {
  await click('#dock-settings'); await sleep(700); await r.sp.eval(`window.scrollTo(0,0)`);
  const set = {name: '#settings-name', start: 'js:document.getElementById("start-locked").closest("label")', away: 'js:document.getElementById("lock-away").closest("label")', wheel: 'js:document.getElementById("wheel-zoom").closest("label")', fit: 'js:document.getElementById("fit-page").closest("label")', secure: 'js:document.getElementById("secure-marks").closest("label")', font: '#ui-font', size: '#ui-size', track: '#ui-track', idle: '#idle', save: 'js:document.querySelector("#settings-form button[type=submit]")'};
  await r.shot('set-1', {panel: set});
  await scrollTo('#ui-font', 'start'); await r.shot('set-2', {panel: set});
  await scrollTo('#pin-box', 'start'); await r.shot('set-pin', {panel: {box: '#pin-box', current: '#pin-current', fresh: '#pin-new', confirm: '#pin-confirm', save: '#pin-save', remove: '#pin-remove'}});
  await r.sp.eval(`document.getElementById('ab-now').click()`); await sleep(1800);
  await scrollTo('#auto-backup', 'start'); await r.shot('set-ab', {panel: {box: '#auto-backup', on: 'js:document.getElementById("ab-on").closest("label")', status: '#ab-status', now: '#ab-now', open: '#ab-open', list: '#ab-list', more: '#ab-more'}});
  await scrollTo('#backup', 'start'); await r.shot('set-bk', {panel: {box: '#backup', seal: 'js:document.getElementById("bk-seal").closest("label")', pass: '#bk-pass', pass2: '#bk-pass2', make: '#bk-make', file: '#bk-file'}});
  await setv('#bk-pass', 'daissam-backup'); await setv('#bk-pass2', 'daissam-backup'); await click('#bk-make'); await sleep(2200);
  const dl = fs.readdirSync(profile + '/../dl').filter(f => f.endsWith('.json')).sort().at(-1);
  if (dl) { await r.sp.setFiles('#bk-file', [fs.realpathSync(profile + '/../dl/' + dl)]); await sleep(700); await setv('#bk-open-pass', 'daissam-backup'); await click('#bk-open-go'); await sleep(1800); await scrollTo('#bk-plan', 'start'); await r.shot('set-plan', {panel: {plan: '#bk-plan', list: '#bk-list', go: '#bk-go', cancel: '#bk-cancel'}}); await click('#bk-cancel'); }
  await scrollTo('#report-settings', 'center'); await r.shot('set-report', {panel: {report: '#report-settings', foot: '#report-bug'}});
  // 보안 북마크
  await scrollTo('#secure-marks', 'center'); await r.sp.eval(`document.getElementById('secure-marks').click()`); await sleep(800);
  await r.shot('set-secure', {panel: {secure: 'js:document.getElementById("secure-marks").closest("label")', box: '#secure-box', go: '#secure-go', notice: '#notice'}});
  await click('#settings-close'); await sleep(500); await r.tabPage('vault'); await sleep(600);
  await r.sp.eval(`document.querySelector('#bookmarks a, #bookmarks button')?.click()`); await sleep(900);
  await r.shot('marks-secure', {panel: {dialog: '#mark-pin', input: '#mark-pin-input'}});
  await r.sp.eval(`document.getElementById('mark-pin-cancel').click()`); await sleep(300);
  // 잠금
  await r.tabPage('notes'); await click('#lock'); await sleep(1500);
  await r.calib('page', r.web);
  await r.shot('locked', {panel: {pin: '#profile-pin', submit: '#gate-submit', close: '#close-window'}, box: {}});
  await setv('#profile-pin', PIN); await r.sp.eval(`document.getElementById('gate-form').requestSubmit()`); await sleep(1500);
  // 오류 신고
  await r.sp.eval(`window.scrollTo(0,99999)`); await r.shot('report-foot', {panel: {report: '#report-bug', version: '#version'}});
  const rep = await r.newTab('https://script.google.com/macros/s/AKfycbxsRD7vRlEP9oKlvlDDPww8cYaDadTTIp1KrqYWSVU5qE5_gUh3bNUskBhHDlXH6FskvA/exec?app=daissam-toolkit&v=0.45.3&where=' + encodeURIComponent('사이드바 · 빠른 메모'), 4500);
  await sleep(500); await r.C.send('Target.activateTarget', {targetId: rep.targetId}); await sleep(300);
  await r.shot('report-page', {tab: rep, wait: 300}); await r.closeTab(rep); await r.front(); await r.sp.eval(`window.scrollTo(0,0)`);
});
const movePops = (l, t) => r.sp.eval(`chrome.windows.getAll({windowTypes:['popup']}).then(ws=>Promise.all(ws.map(w=>chrome.windows.update(w.id,{left:${l},top:${t}}))))`);
if (want.has('r1')) await safe('r1', async () => {
  // 도크만 띄우기
  await click('#dock-pop'); await sleep(1400); await movePops(330, 300); await sleep(700);
  const d = await popWait(w => w.box[2] > 300 && w.box[3] < 200); if (d) await r.shotPop('dock-pop', d);
  for (const t of await extTab()) if (t.url.includes('dock.html')) await r.C.send('Target.closeTarget', {targetId: t.targetId}); await sleep(500);
  // 막힌 화면: 화면 고르기 작은 창
  await r.go('chrome://settings/', 1500); await r.msg('capture', {mode: 'visible'}).catch(() => {}); await sleep(900); await movePops(260, 300); await sleep(700);
  const g = await popWait(w => w.box[2] > 380 && w.box[2] < 520); if (g) await r.shotPop('grab', g);
  for (const t of await extTab()) if (t.url.includes('grab.html')) await r.C.send('Target.closeTarget', {targetId: t.targetId}); await sleep(400);
  await r.go(WIKI, 2500);
  // 녹화 고르기 창
  await r.tabPage('capture'); await r.sp.eval(`document.querySelector('[data-rec="desktop"]').click()`); await sleep(300); await r.sp.eval(`(()=>{for(const id of ['rec-cam','rec-mic'])if(document.getElementById(id).checked)document.getElementById(id).click();})()`);
  await r.C.send('Runtime.evaluate', {expression: `document.getElementById('rec-start').click()`, userGesture: true}, r.sp.sessionId); await sleep(2200); await movePops(190, 275); await sleep(1100);
  const w = await popWait(x => x.box[2] > 300 && x.box[2] < 1000); if (w) await r.shotPop('rec-pick', w); else console.log('고르기 창 없음', JSON.stringify(r.pops()));
  for (const t of await extTab()) if (t.url.includes('record.html')) await r.C.send('Target.closeTarget', {targetId: t.targetId}); await sleep(500);
});
if (want.has('e')) await safe('e', async () => {
  const vcmd = o => execFileSync(process.env.S + '/v/vcmd', [JSON.stringify(o)]);
  const hook = () => { try { return fs.readFileSync('/tmp/claude-501/video-hook.txt', 'utf8'); } catch { return ''; } };
  await r.tabPage('presenter'); await r.sp.eval(`window.scrollTo(0,0)`);
  const pres = {start: '#present-start', stop: '#present-stop', focus: '#present-focus', snip: '#pin-snip', clip: '#pin-clip', clear: '#pin-clear', through: '#pin-through', lockk: '#lock-now'};
  await openD('단축키 안내');
  await r.shot('pres-keys', {panel: {...pres, mac: '#os-mac', win: '#os-win', edit: '#edit-shortcut', wheel: '#key-wheel', ring: '#key-wheel-ring', keyp: '#key-present', keyf: '#key-focus', reset: '#key-reset', note: '#key-note'}});
  await scrollTo('#key-wheel', 'center'); await r.shot('pres-keys2', {panel: {wheel: '#key-wheel', ring: '#key-wheel-ring', reset: '#key-reset', note: '#key-note', edit: '#edit-shortcut', lockk: '#lock-key'}});
  await r.sp.eval(`window.scrollTo(0,0)`); await openD('포인터 크기'); await sleep(300);
  await r.shot('pres-knobs', {panel: {dim: '#dim', blur: '#blur', size: '#ring-size', color: '#ring-color'}});
  await r.sp.eval(`[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('포인터 크기')).parentElement.open=false;[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('단축키 안내')).parentElement.open=false`);
  await openD('발표 프로그램 다운로드'); await scrollTo('#get-mac', 'center');
  await r.shot('pres-down', {panel: {summary: 'js:[...document.querySelectorAll("summary")].find(s=>s.textContent.includes("발표 프로그램 다운로드"))', mac: '#get-mac', win: '#get-win', note: '#get-note', tab: '[data-page="presenter"]'}});
  await openD('화면 조각 핀 안내'); await sleep(200); await r.sp.eval(`window.scrollTo(0,0)`);
  await r.sp.eval(`[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('발표 프로그램 다운로드')).parentElement.open=false;[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('화면 조각 핀 안내')).parentElement.open=false`);
  await r.go(WIKI + '#' , 800);
  vcmd({op: 'point', x: 330, y: 300}); await r.raise();
  await r.sp.eval(`document.getElementById('present-start').click()`); await sleep(3200);
  await r.raise(); await r.region('pres-on'); 
  const clip = (name, sec) => spawn('screencapture', ['-x', '-v', '-V' + sec, '-R0,262,1280,720', `${OUT}/${name}.mov`]);
  let rec = clip('zoom', 9); await sleep(1200);
  vcmd({op: 'glide', x: 420, y: 360, ms: 2200, scale: 2.2}); await sleep(2700);
  r.region('pres-zoom');
  vcmd({op: 'glide', x: 640, y: 250, ms: 1800}); await sleep(2200);
  vcmd({op: 'glide', x: 420, y: 360, ms: 1200, scale: 1}); await sleep(2600); rec.kill('SIGINT'); await sleep(900);
  await r.sp.eval(`document.getElementById('present-focus').click()`); await sleep(1600);
  r.region('pres-focus');
  rec = clip('focus', 8); await sleep(900);
  vcmd({op: 'glide', x: 620, y: 480, ms: 1800}); await sleep(2200);
  vcmd({op: 'glide', x: 300, y: 200, ms: 2000, radius: 250}); await sleep(2400);
  r.region('pres-focus2');
  vcmd({op: 'glide', x: 420, y: 330, ms: 1000, radius: 170}); await sleep(1600); rec.kill('SIGINT'); await sleep(900);
  await r.sp.eval(`document.getElementById('present-focus').click()`); await sleep(1000);
  await r.sp.eval(`document.getElementById('present-stop').click()`); await sleep(1500);
  // 화면 조각
  await r.raise(); await r.sp.eval(`document.getElementById('pin-snip').click()`); await sleep(1800);
  vcmd({op: 'snipbox', x: 470, y: 90, w: 380, h: 300}); await sleep(600); r.region('snip-drag');
  vcmd({op: 'snipdone'}); await sleep(1200); await r.raise(); r.region('pin');
  vcmd({op: 'pinmove', x: 40, y: 360}); await sleep(500); vcmd({op: 'pinhover', on: true}); await sleep(500); r.region('pin-hover'); 
  console.log(hook());
  vcmd({op: 'pindraw'}); await sleep(800); r.region('pin-draw'); vcmd({op: 'pinenddraw'}); await sleep(400);
  vcmd({op: 'pincrop'}); await sleep(700); r.region('pin-crop'); vcmd({op: 'pincropoff'}); await sleep(300);
  vcmd({op: 'pinmenu', x: 300, y: 420, s: 2.2}); await sleep(1100); r.region('pin-menu'); await sleep(1600);
  vcmd({op: 'pinzoom', v: 1.5}); await sleep(400); vcmd({op: 'pinshade', v: .6}); await sleep(500); r.region('pin-big'); vcmd({op: 'pinshade', v: 1}); vcmd({op: 'pinzoom', v: 1}); await sleep(300);
  vcmd({op: 'pinfold'}); await sleep(500); r.region('pin-fold'); vcmd({op: 'pinfold'}); await sleep(300);
  vcmd({op: 'pinhover', on: false}); vcmd({op: 'pinthrough', on: true}); await sleep(700); r.region('pin-through'); vcmd({op: 'pinthrough', on: false}); await sleep(300);
  await r.sp.eval(`document.getElementById('pin-clear').click()`); await sleep(800);
  // 앱 메뉴
  await r.raise(); vcmd({op: 'menu', x: 700, y: 640, s: 2.2}); await sleep(1100); r.region('app-menu'); await sleep(1700);
  vcmd({op: 'menu', sub: '클립보드 도우미', x: 700, y: 640, s: 2}); await sleep(1100); r.region('app-menu-sub'); await sleep(1500);
  vcmd({op: 'statusframe'}); await sleep(300); console.log(hook());
  // 녹화: 고르기는 자동으로 넘기고 도중 · 끝 화면을 찍는다
  await r.tabPage('capture'); await r.sp.eval(`document.querySelector('[data-rec="tab"]').click()`); await sleep(300);
  await r.C.send('Runtime.evaluate', {expression: `document.getElementById('rec-start').click()`, userGesture: true}, r.sp.sessionId); await sleep(1800); await movePops(760, 290); await sleep(500);
  await r.raise(); r.region('rec-count'); await sleep(4200); await movePops(760, 290); await sleep(800); r.region('rec-run');
  const t = (await extTab()).find(x => x.url.includes('record.html'));
  if (t) { const rp = await r.attach(t.targetId); await rp.eval(`document.getElementById('stop').click()`).catch(() => {}); await sleep(3000); await r.raise(); r.region('rec-done'); await r.closeTab(rp).catch(() => {}); }
  // 자동 백업 경로가 시험용 폴더로 찍히지 않게
  await click('#dock-settings'); await sleep(600); await scrollTo('#auto-backup', 'start');
  await r.sp.eval(`(()=>{const e=document.getElementById('ab-status');e.textContent=e.textContent.replace(/폴더: .*/,'폴더: 문서 › 다있쌤 백업');})()`);
  await r.shot('set-ab', {panel: {box: '#auto-backup', on: 'js:document.getElementById("ab-on").closest("label")', status: '#ab-status', now: '#ab-now', open: '#ab-open', list: '#ab-list'}});
  await click('#settings-close');
});
if (want.has('e2')) await safe('e2', async () => {
  const L = Number(process.env.WIN_LEFT || 0);
  const vcmd = o => execFileSync(process.env.S + '/v/vcmd', [JSON.stringify(o)]);
  const clip = (name, sec) => new Promise(res => spawn('screencapture', ['-x', '-v', '-V' + sec, `-R${L},262,1280,720`, `${OUT}/${name}.mov`]).on('exit', res));
  await r.tabPage('presenter'); await r.sp.eval(`window.scrollTo(0,0)`);
  vcmd({op: 'point', x: L + 330, y: 300});
  await r.sp.eval(`document.getElementById('present-start').click()`); await sleep(3500);
  r.region('pres-on');
  const z = clip('zoom', 11); await sleep(800);
  vcmd({op: 'glide', x: L + 420, y: 360, ms: 2400, scale: 2.2}); await sleep(3000);
  r.region('pres-zoom');
  vcmd({op: 'glide', x: L + 640, y: 250, ms: 2000}); await sleep(2400);
  vcmd({op: 'glide', x: L + 420, y: 360, ms: 1500, scale: 1}); await z; await sleep(600);
  await r.sp.eval(`document.getElementById('present-focus').click()`); await sleep(1800);
  r.region('pres-focus');
  const f = clip('focus', 9); await sleep(700);
  vcmd({op: 'glide', x: L + 620, y: 480, ms: 2000}); await sleep(2400);
  vcmd({op: 'glide', x: L + 300, y: 200, ms: 2200, radius: 250}); await sleep(2600);
  r.region('pres-focus2');
  vcmd({op: 'glide', x: L + 420, y: 330, ms: 1200, radius: 170}); await f; await sleep(400);
  await r.sp.eval(`document.getElementById('present-focus').click()`); await sleep(900);
  await r.sp.eval(`document.getElementById('present-stop').click()`); await sleep(1300);
  await r.tabPage('capture'); await r.sp.eval(`document.querySelector('[data-rec="tab"]').click()`); await sleep(300);
  await r.C.send('Runtime.evaluate', {expression: `document.getElementById('rec-start').click()`, userGesture: true}, r.sp.sessionId); await sleep(2000); await movePops(L + 760, 290); await sleep(600);
  r.region('rec-count'); await sleep(4200); await movePops(L + 760, 290); await sleep(800); r.region('rec-run');
  const t = (await extTab()).find(x => x.url.includes('record.html'));
  if (t) { const rp = await r.attach(t.targetId); await sleep(1500); await rp.eval(`document.getElementById('stop').click()`).catch(e => console.log(e.message)); await sleep(3500); r.region('rec-done'); await r.closeTab(rp).catch(() => {}); }
});
if (want.has('r3')) await safe('r3', async () => {
  const L = Number(process.env.WIN_LEFT || 0);
  await r.tabPage('capture'); await r.sp.eval(`document.querySelector('[data-rec="camera"]').click()`); await sleep(400);
  await r.C.send('Runtime.evaluate', {expression: `document.getElementById('rec-start').click()`, userGesture: true}, r.sp.sessionId); await sleep(1500); await movePops(L + 760, 300); await sleep(1800);
  const t = (await extTab()).find(x => x.url.includes('record.html')); console.log(t?.url.slice(0, 120));
  let w = await popWait(x => x.box[2] > 300 && x.box[2] < 1000); if (w) await r.shotPop('rec-count', w);
  await sleep(4500); w = await popWait(x => x.box[2] > 300 && x.box[2] < 1000); if (w) await r.shotPop('rec-run', w);
  const rp = await r.attach(t.targetId); console.log(await rp.eval(`document.getElementById('clock')?.textContent+' / '+document.getElementById('what')?.textContent`));
  await rp.eval(`document.getElementById('stop').click()`).catch(e => console.log(e.message)); await sleep(3500); await movePops(L + 500, 280); await sleep(900);
  w = await popWait(x => x.box[2] > 300 && x.box[2] < 1000); if (w) await r.shotPop('rec-done', w); await r.closeTab(rp).catch(() => {});
});
if (want.has('r4')) await safe('r4', async () => {
  const L = Number(process.env.WIN_LEFT || 0);
  await r.tabPage('capture'); await r.sp.eval(`document.querySelector('[data-rec="camera"]').click()`); await sleep(300);
  await r.C.send('Runtime.evaluate', {expression: `document.getElementById('rec-start').click()`, userGesture: true}, r.sp.sessionId); await sleep(1500); await movePops(L + 200, 290); await sleep(1500);
  let w = await popWait(x => x.box[2] > 300 && x.box[2] < 1000); if (w) await r.shotPop('rec-camera', w);
  for (const t of await extTab()) if (/camera\.html|record\.html/.test(t.url)) await r.C.send('Target.closeTarget', {targetId: t.targetId}); await sleep(600);
  await r.sp.eval(`document.querySelector('[data-rec="tab"]').click()`); await sleep(300);
  await r.C.send('Runtime.evaluate', {expression: `document.getElementById('rec-start').click()`, userGesture: true}, r.sp.sessionId); await sleep(5200); await movePops(L + 300, 300); await sleep(900);
  const t = (await extTab()).find(x => x.url.includes('record.html')); console.log(t?.url.slice(-80));
  if (t) { const rp = await r.attach(t.targetId); console.log('clock', await rp.eval(`document.getElementById('clock')?.textContent+' | '+document.getElementById('say')?.textContent`));
    w = await popWait(x => x.box[2] > 300 && x.box[2] < 1000); if (w) await r.shotPop('rec-run', w);
    await sleep(3000); await rp.eval(`document.getElementById('stop').click()`).catch(e => console.log(e.message)); await sleep(3500); await movePops(L + 250, 275); await sleep(900);
    console.log('done', await rp.eval(`!document.getElementById('done')?.hidden`)); w = await popWait(x => x.box[2] > 300 && x.box[2] < 1000); if (w) await r.shotPop('rec-done', w); await r.closeTab(rp).catch(() => {}); }
});
if (want.has('f')) await safe('f', async () => {
  // 사이드바 위쪽 고정 줄에 가리지 않게 내려서 찍는다
  const under = async sel => { await r.sp.eval(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'start'});window.scrollBy(0,-225)`); await sleep(350); };
  await r.web.cmd('Emulation.setUserAgentOverride', {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', platform: 'MacIntel', userAgentMetadata: {brands: [{brand: 'Google Chrome', version: '156'}, {brand: 'Chromium', version: '156'}, {brand: 'Not_A Brand', version: '24'}], fullVersionList: [{brand: 'Google Chrome', version: '156.0.8078.74'}, {brand: 'Chromium', version: '156.0.8078.74'}], platform: 'macOS', platformVersion: '15.0.0', architecture: 'arm', model: '', mobile: false}});
  await r.sp.eval(`window.close()`).catch(() => {}); await sleep(900);
  await r.go('https://chromewebstore.google.com/detail/penklhfehmfoebmeolplklmjjcjhhnpi', 5500); await r.calib('page', r.web);
  await r.web.eval(`(()=>{[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()==='거부')?.click();const t=[...document.querySelectorAll('*')].filter(e=>e.children.length<4&&/Chrome으로 전환하여/.test(e.textContent)).pop();let b=t;for(let i=0;i<4&&b?.parentElement;i++){if(b.getBoundingClientRect().width>500)break;b=b.parentElement;}if(b)b.style.display='none';})()`); await sleep(600);
  await r.shot('store', {page: {add: 'js:[...document.querySelectorAll("button")].find(b=>/Chrome에 추가/.test(b.textContent))'}});
  await r.web.cmd('Emulation.setUserAgentOverride', {userAgent: ''}).catch(() => {});
  await r.go(WIKI, 2500); await r.openSide();
  await r.tabPage('capture');
  const cap = {screen: '#cap-screen', local: '#cap-local', ocr: '#cap-ocr', after: '#cap-after'};
  await under('#cap-screen'); await r.shot('cap-main2', {panel: cap});
  const rec = {desktop: '[data-rec="desktop"]', camera: '[data-rec="camera"]', tab: '[data-rec="tab"]', cam: '#rec-cam', mic: '#rec-mic', control: '#rec-control', res: '#rec-res', format: '#rec-format', more: '#rec-more', start: '#rec-start'};
  await r.sp.eval(`document.querySelector('[data-rec="tab"]').click()`); await sleep(300); await r.sp.eval(`(()=>{const b=document.getElementById('rec-more-box');if(b&&!b.hidden)document.getElementById('rec-more').click();})()`);
  await under('#cap-video-title'); await r.shot('rec-main', {panel: rec});
  await openD('캡처 세부 설정'); await scrollTo('#cap-keys', 'center'); await r.shot('cap-keys', {panel: {keys: '#cap-keys', side: '#cap-hide-side'}});
  await click('#dock-settings'); await sleep(700);
  const set = {font: '#ui-font', size: '#ui-size', track: '#ui-track', idle: '#idle'};
  await under('#ui-font'); await r.shot('set-2', {panel: set});
  await under('#pin-box'); await r.shot('set-pin', {panel: {box: '#pin-box', current: '#pin-current', fresh: '#pin-new', save: '#pin-save', remove: '#pin-remove'}});
  await under('#auto-backup'); await sleep(900);
  await r.sp.eval(`(()=>{const e=document.getElementById('ab-status');e.textContent=e.textContent.replace(/폴더: .*/,'폴더: 문서 › 다있쌤 백업');})()`);
  await r.shot('set-ab', {panel: {box: '#auto-backup', status: '#ab-status', now: '#ab-now', open: '#ab-open', list: '#ab-list'}});
  await r.sp.eval(`document.getElementById('notice').hidden=true`).catch(() => {});
  await under('#backup'); await r.shot('set-bk', {panel: {box: '#backup', seal: 'js:document.getElementById("bk-seal").closest("label")', pass: '#bk-pass', pass2: '#bk-pass2', make: '#bk-make', file: '#bk-file'}});
  const dl = fs.readdirSync(profile + '/../dl').filter(f => f.endsWith('.json')).sort().at(-1);
  if (dl) { await r.sp.setFiles('#bk-file', [fs.realpathSync(profile + '/../dl/' + dl)]); await sleep(700); await setv('#bk-open-pass', 'daissam-backup'); await click('#bk-open-go'); await sleep(1800); await under('#bk-plan'); await r.shot('set-plan', {panel: {plan: '#bk-plan', list: '#bk-list', go: '#bk-go', cancel: '#bk-cancel'}}); await click('#bk-cancel'); }
  await click('#settings-close'); await sleep(300);
});
if (want.has('g')) await safe('g', async () => {
  const mid = async sel => { await r.sp.eval(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); await sleep(350); };
  await r.tabPage('presenter'); await openD('단축키 안내'); await mid('#pin-clear'); await r.shot('pres-keys-c', {panel: {clear: '#pin-clear', clip: '#pin-clip'}});
  await click('#dock-settings'); await sleep(700);
  await mid('#idle'); await r.shot('set-2b', {panel: {idle: '#idle'}});
  await mid('#ab-list'); await sleep(700); await r.shot('set-ab2', {panel: {list: '#ab-list'}});
  await r.sp.eval(`document.getElementById('notice').hidden=true`).catch(() => {});
  await mid('#bk-make'); await r.shot('set-bk2', {panel: {make: '#bk-make', pass: '#bk-pass'}});
  await mid('#bk-file'); await r.shot('set-bk3', {panel: {file: '#bk-file'}});
  const dl = fs.readdirSync(profile + '/../dl').filter(f => f.endsWith('.json')).sort().at(-1);
  if (dl) { await r.sp.setFiles('#bk-file', [fs.realpathSync(profile + '/../dl/' + dl)]); await sleep(700); await setv('#bk-open-pass', 'daissam-backup'); await click('#bk-open-go'); await sleep(1800); await mid('#bk-go'); await r.shot('set-plan2', {panel: {go: '#bk-go', list: '#bk-list'}}); await click('#bk-cancel'); }
  await click('#settings-close'); await sleep(300);
});
await r.stop(); process.exit(0);
