// 전체 백업 · 복원을 실제 Chrome 에서 끝까지 돌려 본다: 컴퓨터 A 에서 만든 백업 → 새 컴퓨터 B(처음 화면)에서 복원.
// 40여 개를 확인한다(암호·틀린 암호·PIN 교체·같은 백업 두 번·망가진 파일·화면 문구). 사용법은 cdp.mjs 맨 위를 보세요.
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep, waitFile} from './cdp.mjs';
import {openBackup} from '../../extension/lib/backup.js';

const EXT = fileURLToPath(new URL('../../extension', import.meta.url));
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
const root = os.tmpdir() + '/e2e-backup-' + Date.now(); fs.mkdirSync(root, {recursive: true});
const shots = root + '/shots'; fs.mkdirSync(shots);
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail))); if (!cond) failed++; };
const send = (p, type, data = {}) => p.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
const store = (p, area = 'local') => p.eval(`chrome.storage.${area}.get(null)`);
const PASS = '우리반 비밀 2026';

// ═══ 컴퓨터 A: 쓰던 컴퓨터 ═══════════════════════════════════════════════
const A = new Chrome({ext: EXT, profile: root + '/A', port: 9431, downloads: root + '/dl-A'});
await A.start();
const a = await A.open(PANEL);
await a.waitFor(a.visible('#gate-form'), 15000, 'A 처음 화면');
ok('A 처음 화면에 ‘백업에서 복원’ 단추가 보인다', await a.eval(a.visible('#gate-restore-open')));
await a.type('#profile-name', '로디 쌤'); await a.type('#profile-pin', '246810'); await a.type('#profile-confirm', '246810');
await a.eval(`document.getElementById('gate-form').requestSubmit()`);
await a.waitFor(a.visible('#workspace'), 15000, 'A 작업 화면');
await a.eval(`chrome.storage.local.set({lockOnAway:false})`);
ok('A 프로필을 만들면 처음 화면의 복원 단추는 사라진다', await a.eval(`document.getElementById('gate-restore').hidden===true`));

await send(a, 'note-save', {id: 'n-0001', title: '1교시 준비', text: '과학 실험 준비물: 비커, 돋보기'});
await send(a, 'note-save', {id: 'n-0002', title: '학부모 상담', text: '3/14 오후 2시 — 김하늘 어머님'});
await send(a, 'note-save', {id: 'n-0003', title: '긴 글', text: '가'.repeat(2000)});
await send(a, 'note-flush');
await a.eval(`(async()=>{const {device}=await chrome.storage.local.get('device');
  await chrome.storage.sync.set({['marks_'+device]:{v:1,kind:'bookmarks',items:[
    {id:'f-1',rev:1,writer:device,type:'folder',title:'수업 자료'},
    {id:'b-1',rev:2,writer:device,title:'국립국어원',url:'https://www.korean.go.kr/',folder:'f-1'},
    {id:'b-2',rev:3,writer:device,title:'위키백과',url:'https://ko.wikipedia.org/',folder:''}]},
    hotkeys:{mac:{focus:'ctrl+shift+G'},win:{}}});
  await chrome.storage.local.set({uiFont:'gulim',uiSize:17,uiTrack:2,presentKnobs:{dim:65,blur:12,ringSize:60,ring:'#ffcc00'},
    captureOptions:{after:'save',format:'jpg',quality:77,delay:5,hideFixed:false,hideScrollbar:true,hideSide:true},
    recordOptions:{mode:'tab',camera:true,cameraId:'A-CAMERA-ID',micId:'A-MIC-ID',mic:true,res:'720',format:'webm',countdown:5,limit:10,sound:false,controlBar:true},
    dockSpot:{left:1234,top:56}});})()`);
await send(a, 'tool-bells', {times: ['08:50', '13:10'], on: true});
await send(a, 'tool-teams', {teams: [{name: '해님', score: 5}, {name: '달님', score: 2}]});
await send(a, 'settings', {name: '로디 쌤', idleMinutes: 0, startLocked: false, lockOnAway: false, wheelZoom: true});

await a.click('#dock-settings');
await a.waitFor(a.visible('#backup'), 8000, 'A 설정의 백업 카드');
await a.eval(`document.getElementById('backup').scrollIntoView({block:'start'})`);
await a.shot(shots + '/1-A-backup-card.png');
// 암호가 다르면 막힌다
await a.type('#bk-pass', PASS); await a.type('#bk-pass2', '다른암호 입니다 123');
await a.click('#bk-make'); await sleep(400);
ok('A 두 암호가 다르면 만들지 않고 알려 준다', (await a.text('#notice')).includes('두 암호가 같지 않습니다'), await a.text('#notice'));
await a.type('#bk-pass', '짧아요'); await a.type('#bk-pass2', '짧아요');
await a.click('#bk-make'); await sleep(400);
ok('A 8자 미만 암호는 거부한다', (await a.text('#notice')).includes('8자 이상'), await a.text('#notice'));
await a.type('#bk-pass', PASS); await a.type('#bk-pass2', PASS);
await a.click('#bk-make');
const fileA = await waitFile(root + '/dl-A', /다있쌤-백업-\d{4}-\d\d-\d\d\.json$/, 30000);
ok('A 백업 파일을 내려받았다', fs.statSync(fileA).size > 1000, fileA);
const rawA = fs.readFileSync(fileA, 'utf8');
const headA = JSON.parse(rawA);
ok('A 파일은 암호로 잠겨 있고 평문이 보이지 않는다', headA.encrypted === true && !rawA.includes('과학 실험') && !rawA.includes('국립국어원') && !rawA.includes('로디'));
const openedA = await openBackup(rawA, PASS);
ok('A 맞는 암호로 열면 내용이 모두 들어 있다', openedA.payload.notes.length === 3 && openedA.payload.bookmarks.length === 3 && openedA.payload.lock && openedA.payload.settings.uiFont === 'gulim'
  && openedA.payload.tools.teams.length === 2, JSON.stringify({n: openedA.payload.notes.length, b: openedA.payload.bookmarks.length}));
ok('A 이 컴퓨터에만 뜻이 있는 값(카메라·마이크 번호, 도크 자리)은 담지 않았다', !rawA.includes('A-CAMERA') && !JSON.stringify(openedA.payload).includes('A-CAMERA-ID') && !JSON.stringify(openedA.payload).includes('1234'));
ok('A 안내 문구에 개수가 나온다', /메모 3개 · 북마크 2개 · 잠금 PIN 포함/.test(await a.text('#notice')), await a.text('#notice'));
await a.shot(shots + '/2-A-after-make.png');

// 암호 없는 백업
await a.click('#bk-seal');                                   // 끄기
const sealState = await a.eval(`JSON.stringify({checked:document.getElementById('bk-seal').checked,boxHidden:document.getElementById('bk-seal-box').hidden,hintHidden:document.getElementById('bk-plain-hint').hidden,hintShown:${a.visible('#bk-plain-hint')},boxShown:${a.visible('#bk-seal-box')},chain:(()=>{const out=[];for(let e=document.getElementById('bk-plain-hint');e;e=e.parentElement)out.push(e.tagName+'#'+e.id+':'+getComputedStyle(e).display+':'+getComputedStyle(e).position+(e.hidden?':HIDDEN':''));return out})(),op:document.getElementById('bk-plain-hint').offsetParent&&document.getElementById('bk-plain-hint').offsetParent.tagName})`);
ok('A 암호 칸을 끄면 PIN 이 빠진다는 안내가 보인다', JSON.parse(sealState).hintShown && !JSON.parse(sealState).boxShown, sealState);
for (const f of fs.readdirSync(root + '/dl-A')) fs.renameSync(root + '/dl-A/' + f, root + '/dl-A/' + 'sealed-' + f);
await a.click('#bk-make');
const filePlain = await waitFile(root + '/dl-A', /^다있쌤-백업-/, 20000);
const plain = JSON.parse(fs.readFileSync(filePlain, 'utf8'));
ok('A 암호 없는 파일에는 잠금 PIN 이 없다', plain.encrypted === false && plain.payload.lock === null && plain.payload.notes.length === 3);
fs.renameSync(filePlain, root + '/plain.json');
for (const f of fs.readdirSync(root + '/dl-A')) if (f.startsWith('sealed-')) fs.renameSync(root + '/dl-A/' + f, root + '/sealed.json');

// ═══ 컴퓨터 B: 새 컴퓨터(다른 Google 계정이라고 가정) ═══════════════════
const B = new Chrome({ext: EXT, profile: root + '/B', port: 9432, downloads: root + '/dl-B'});
await B.start();
const b = await B.open(PANEL);
await b.waitFor(b.visible('#gate-restore-open'), 15000, 'B 처음 화면');
await b.eval(`chrome.storage.local.set({lockOnAway:false})`);
await b.click('#gate-restore-open');
await b.shot(shots + '/3-B-gate-open.png');
// 1) 암호 없는 백업으로는 시작할 수 없다(PIN 이 없으므로)
await b.setFiles('#gate-file', [root + '/plain.json']);
await b.waitFor(`document.getElementById('notice').textContent.includes('잠금 PIN이 들어 있지 않습니다')`, 8000, 'B 암호 없는 백업 거부');
ok('B 암호 없는 백업으로 처음 시작하려 하면 이유를 알려 준다', true);
ok('B 그때 아무것도 저장되지 않았다', Object.keys(await store(b)).filter(k => k === 'profile' || k === 'draftNotes').length === 0, Object.keys(await store(b)));
// 2) 암호 백업: 틀린 암호 → 거부, 맞는 암호 → 복원
await b.setFiles('#gate-file', [root + '/sealed.json']);
await b.waitFor(b.visible('#gate-restore-form'), 8000, 'B 암호 입력칸');
await b.shot(shots + '/4-B-gate-pass.png');
await b.type('#gate-restore-pass', '틀린 암호 입니다 12345');
await b.eval(`document.getElementById('gate-restore-form').requestSubmit()`);
await b.waitFor(`document.getElementById('notice').textContent.includes('백업 암호가 맞지 않거나')`, 15000, 'B 틀린 암호 안내');
ok('B 틀린 암호는 거부한다', true);
ok('B 틀린 암호 뒤에도 프로필은 만들어지지 않았다', !('profile' in await store(b)));
await b.type('#gate-restore-pass', PASS);
await b.eval(`document.getElementById('gate-restore-form').requestSubmit()`);
await b.waitFor(b.visible('#workspace'), 30000, 'B 복원 뒤 작업 화면');
await b.waitFor(`document.getElementById('notice').textContent.includes('메모 3개를 더했습니다')`, 15000, 'B 결과 안내');
const resultText = await b.text('#notice');
ok('B 복원 결과 안내가 다시 뜬 화면에서 나온다', /잠금 PIN을 백업의 것으로/.test(resultText) && /북마크 2개 · 폴더 1개를 더했습니다/.test(resultText), resultText);
await b.shot(shots + '/5-B-after-restore.png');
const lb = await store(b), sb = await store(b, 'sync');
ok('B PIN 을 새로 정하지 않았는데 바로 열려 있다', await b.eval(b.visible('#workspace')) && lb.profile?.name === '로디 쌤');
ok('B 메모 3개가 들어왔다', Object.keys(lb.draftNotes || {}).sort().join() === 'n-0001,n-0002,n-0003', Object.keys(lb.draftNotes || {}));
const bDevice = lb.device;
ok('B 이 컴퓨터의 기기 번호는 그대로이고 A 의 번호는 들어오지 않았다', bDevice && !JSON.stringify(lb).includes(await a.eval(`chrome.storage.local.get('device').then(x=>x.device)`)) || bDevice !== (await store(a)).device);
const marksB = sb['marks_' + bDevice];
ok('B 북마크(폴더 포함)가 이 컴퓨터 이름으로 저장됐다', marksB?.items?.filter(i => !i.deleted).map(i => i.id).sort().join() === 'b-1,b-2,f-1', marksB);
ok('B 설정이 옮겨졌다(글꼴·캡처·녹화·발표·단축키)', lb.uiFont === 'gulim' && lb.uiSize === 17 && lb.captureOptions?.format === 'jpg' && lb.recordOptions?.res === '720' && lb.presentKnobs?.dim === 65 && sb.hotkeys?.mac?.focus === 'ctrl+shift+G', {lb: lb.uiFont, rec: lb.recordOptions});
ok('B 카메라·마이크 번호와 도크 자리는 옮기지 않았다', !lb.recordOptions?.cameraId && !lb.recordOptions?.micId && !lb.dockSpot, {rec: lb.recordOptions, dock: lb.dockSpot});
ok('B 수업 도구(종 알람·모둠)가 옮겨졌고 알람이 예약됐다', lb.bellTimes?.join() === '08:50,13:10' && lb.teams?.[0]?.name === '해님'
  && (await b.eval(`chrome.alarms.getAll().then(a=>a.map(x=>x.name).filter(n=>n.startsWith('bell-')).join())`)) === 'bell-0,bell-1');
ok('B 이름·자동 잠금 설정도 들어왔다', lb.startLocked === false && lb.profile?.idleMinutes === 0);
await b.eval(`document.querySelector('#note-tabs')?.scrollIntoView()`);
const tabText = await b.text('#note-tabs');
ok('B 사이드바 메모 탭에 가져온 제목이 보인다', tabText.includes('1교시 준비') && tabText.includes('학부모 상담'), tabText);
// 3) 잠그고 A 의 PIN 으로 연다
await send(b, 'lock');
await b.waitFor(b.visible('#gate-form') + `&&document.getElementById('gate-submit').textContent.includes('내 프로필')`, 10000, 'B 잠금 화면');
await b.type('#profile-pin', '135790'); await b.eval(`document.getElementById('gate-form').requestSubmit()`); await sleep(1200);
ok('B 틀린 PIN 은 열리지 않는다', !(await b.eval(b.visible('#workspace'))));
await b.type('#profile-pin', '246810'); await b.eval(`document.getElementById('gate-form').requestSubmit()`);
await b.waitFor(b.visible('#workspace'), 15000, 'B 원래 PIN 으로 열림');
ok('B 원래(A 의) PIN 으로 열린다', true);

// ═══ B 의 설정 화면에서 같은 백업을 다시 불러오기 ═════════════════════════
await b.click('#dock-settings');
await b.waitFor(b.visible('#backup'), 8000, 'B 설정');
await b.setFiles('#bk-file', [root + '/sealed.json']);
await b.waitFor(b.visible('#bk-open'), 8000, 'B 암호 칸');
await b.type('#bk-open-pass', PASS);
await b.eval(`document.getElementById('bk-open').requestSubmit()`);
await b.waitFor(b.visible('#bk-plan'), 20000, 'B 미리보기');
await b.eval(`document.getElementById('bk-plan').scrollIntoView({block:'start'})`);
await b.shot(shots + '/6-B-plan.png');
const plan = await b.eval(`[...document.querySelectorAll('#bk-list li')].map(li=>({text:li.innerText.replace(/\\s+/g,' ').trim(),checked:li.querySelector('input')?.checked,disabled:li.querySelector('input')?.disabled}))`);
ok('B 미리보기에 다섯 항목이 있고 메모·북마크·설정·도구가 기본으로 켜져 있다', plan.length === 5 && plan.slice(0, 4).every(x => x.checked), plan);
ok('B 이미 PIN 이 있는 컴퓨터에서는 잠금 PIN 교체가 기본으로 꺼져 있다', plan[4].checked === false && plan[4].disabled === false && !(await b.eval(b.visible('#bk-lock-pin'))), plan[4]);
await b.click('#bk-go');
await b.waitFor(`document.getElementById('notice').textContent.includes('이미 있어서')`, 20000, 'B 두 번째 복원 안내');
const again = await b.text('#notice');
ok('B 같은 백업을 다시 풀면 모두 이미 있어서 더한 것이 없다', /메모는 모두 이미 있어서/.test(again) && /북마크는 모두 이미 있어서/.test(again), again);
ok('B 메모가 늘지 않았다', Object.keys((await store(b)).draftNotes).length === 3);

// 잠금 PIN 교체: 현재 PIN 이 필요
await b.click('#dock-settings'); await b.waitFor(b.visible('#backup'), 8000);
await b.setFiles('#bk-file', [root + '/sealed.json']);
await b.waitFor(b.visible('#bk-open'), 8000); await b.type('#bk-open-pass', PASS); await b.eval(`document.getElementById('bk-open').requestSubmit()`);
await b.waitFor(b.visible('#bk-plan'), 20000);
await b.eval(`(()=>{const box=document.querySelector('#bk-list input[data-part=lock]');box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));})()`);
ok('B 잠금 PIN 을 고르면 ‘지금 PIN’ 입력칸이 나온다', await b.eval(b.visible('#bk-lock-pin')));
await b.click('#bk-go'); await sleep(500);
ok('B 지금 PIN 없이는 진행하지 않는다', /PIN/.test(await b.text('#notice')) && (await b.eval(b.visible('#bk-plan'))), await b.text('#notice'));
await b.type('#bk-pin', '000000'); await b.click('#bk-go'); await sleep(900);
ok('B 틀린 지금 PIN 은 거부한다', (await b.text('#notice')).includes('PIN이 맞지 않습니다'), await b.text('#notice'));
await b.type('#bk-pin', '246810'); await b.click('#bk-go');
await b.waitFor(`document.getElementById('notice').textContent.includes('잠금 PIN을 백업의 것으로 바꿨습니다')`, 20000, 'B PIN 교체 안내');
ok('B 맞는 지금 PIN 이면 교체된다', true);

// 암호 없는 백업을 설정 화면에서
await b.click('#dock-settings'); await b.waitFor(b.visible('#backup'), 8000);
await b.setFiles('#bk-file', [root + '/plain.json']);
await b.waitFor(b.visible('#bk-plan'), 10000, 'B 암호 없는 백업 미리보기');
const plan2 = await b.eval(`[...document.querySelectorAll('#bk-list li')].map(li=>({text:li.innerText.replace(/\\s+/g,' ').trim(),disabled:li.querySelector('input')?.disabled}))`);
ok('B 암호 없는 백업은 잠금 PIN 항목이 선택할 수 없게 막혀 있다', plan2[4]?.disabled === true && /담기지 않습니다/.test(plan2[4].text), plan2[4]);
await b.click('#bk-cancel');
ok('B 취소하면 미리보기가 사라진다', !(await b.eval(b.visible('#bk-plan'))));

// 망가진 파일
fs.writeFileSync(root + '/broken.json', '{"format":"daissam-backup","v":1,"encrypted":false,"payload":{"kind":"daissam-backup","notes":"x"}}');
fs.writeFileSync(root + '/notbackup.json', '{"hello":"world"}');
for (const [file, expect] of [['broken.json', /백업 파일/], ['notbackup.json', /백업 파일/]]) {
  await b.setFiles('#bk-file', [root + '/' + file]); await sleep(500);
  ok('B 망가진 파일: ' + file, expect.test(await b.text('#notice')) && !(await b.eval(b.visible('#bk-plan'))), await b.text('#notice'));
}
const consoleErrors = A.events.concat(B.events).filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception?.description || ''));
ok('두 컴퓨터 모두 처리되지 않은 예외가 없다', consoleErrors.length === 0, consoleErrors);
await A.stop(); await B.stop();
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과'); console.log('결과물: ' + root);
process.exit(failed ? 1 : 0);
