// v0.43.0 기능을 실제 Chrome 에서 본다: 비밀 메모(게스트가 켜면 PIN 만들기 · 잠김 · 열기 · 다시 잠김 · 덮어쓰지 않기 · 풀기) ·
// 메모에 그림 붙여넣기(아래로 쌓임 · 이름 ‘이미지’ · 글이 있으면 글 · 빼기 · 12장 · 잠긴 메모 거절) · 연결 안 됨 까닭 ·
// 화면 고르기 창의 까닭. 사용: node tests/e2e/features043.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Chrome, sleep} from './cdp.mjs';

const EXT = process.env.EXT_DIR || fileURLToPath(new URL('../../extension', import.meta.url));
const ORIGIN = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm';
const PANEL = ORIGIN + '/panel.html';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-043-'));
let failed = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(detail).slice(0, 300))); if (!cond) failed++; };
const C = new Chrome({ext: EXT, profile: path.join(root, 'p'), port: 9631, downloads: path.join(root, 'dl')});
await C.start();
const p = await C.open(PANEL, {width: 400, height: 1000});
await p.waitFor(p.visible('#gate-guest'), 15000, '처음 화면');
await p.eval(`document.getElementById('gate-guest').click()`);
await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
const send = (type, data = {}) => p.eval(`chrome.runtime.sendMessage(${JSON.stringify({type, ...data})})`);
const local = key => p.eval(`chrome.storage.local.get(${JSON.stringify(key)}).then(r=>r[${JSON.stringify(key)}])`);
const tab = id => p.eval(`document.querySelector('#note-tabs [data-id="${id}"]').click()`);
const covered = () => p.eval(`(()=>({cover:!document.getElementById('secret-cover').hidden,area:!document.getElementById('note').hidden,value:document.getElementById('note').value,
  copy:document.getElementById('copy-note').disabled,del:document.getElementById('delete-note').disabled,leak:document.body.innerText.includes('비밀 내용 123')}))()`);
const dialog = () => p.eval(`document.getElementById('mark-pin').open`);
const submitPin = async (a, b) => { await p.type('#mark-pin-input', a); if (b !== undefined) await p.type('#mark-pin-input2', b); await p.eval(`document.getElementById('mark-pin-form').requestSubmit()`); await sleep(900); };
const savedText = id => p.eval(`chrome.storage.local.get(['pendingNotes','draftNotes']).then(r=>(r.pendingNotes?.['${id}']||r.draftNotes?.['${id}'])?.text)`);
const savedSecret = id => p.eval(`Promise.all([chrome.storage.local.get(['pendingNotes','draftNotes']),chrome.storage.sync.get(null)]).then(([l,s])=>{const all=[l.pendingNotes?.['${id}'],l.draftNotes?.['${id}'],...Object.entries(s).filter(([k])=>k.endsWith('_${id}')).map(([,v])=>v)].filter(Boolean).sort((a,b)=>b.time-a.time);return all[0]?.secret===true;})`);

// ── 비밀 메모 ──
await send('note-save', {id: 's1', title: '통장 메모', text: '비밀 내용 123'});
await send('note-save', {id: 's2', title: '보통 메모', text: '보통 내용'});
await p.eval(`location.reload()`); await p.waitFor(p.visible('#workspace'), 15000, '다시 연 작업 화면'); await sleep(1200);
await tab('s1'); await sleep(700);
ok('메모 칸 바로 위에 비밀 메모 체크가 있다', await p.eval(`(()=>{const row=document.getElementById('note-secret').closest('.secret-row');return row.nextElementSibling?.getAttribute('for')==='note'||row.nextElementSibling?.nextElementSibling?.id==='note';})()`));
await p.eval(`(()=>{const c=document.getElementById('note-secret');c.checked=true;c.dispatchEvent(new Event('change'));})()`); await sleep(600);
ok('게스트가 체크하면 PIN 만들기 창이 뜬다(한 번 더 칸 포함)', await dialog() && await p.eval(`!document.getElementById('mark-pin-input2').hidden`));
await submitPin('246810', '135790');
ok('두 PIN 이 다르면 만들지 않는다', await dialog() && (await send('state')).data.guest === true && /일치/.test(await p.eval(`document.getElementById('mark-pin-error').textContent`)));
await submitPin('246810', '246810'); await sleep(600);
let st = (await send('state')).data;
ok('PIN 을 만들고 비밀 메모가 된다 — 잠금은 꺼진 채', !(await dialog()) && await savedSecret('s1') && !st.guest && !st.locked && st.startLocked === false, st);
let c = await covered();
ok('방금 켠 사람에게는 그대로 열어 둔다', !c.cover && c.area && c.value === '비밀 내용 123', c);
ok('탭에 자물쇠 표시', await p.eval(`document.querySelector('#note-tabs [data-id="s1"]').classList.contains('secret')`));
await tab('s2'); await sleep(600); await tab('s1'); await sleep(900);
c = await covered();
ok('다른 메모로 갔다 오면 잠긴다 — 글을 화면에 넣지 않고 단추를 막는다', c.cover && !c.area && c.value === '' && !c.leak && c.copy && c.del, c);
ok('잠긴 비밀 메모 탭을 누르면 바로 PIN 을 묻는다', await dialog());
await submitPin('000000');
ok('틀린 PIN 이면 열지 않는다', await dialog() && (await covered()).cover);
await submitPin('246810');
c = await covered();
ok('맞는 PIN 이면 연다', !(await dialog()) && !c.cover && c.value === '비밀 내용 123', c);
await p.type('#note', '비밀 내용 123 고침'); await sleep(200);
await p.eval(`(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));})()`); await sleep(900);
c = await covered();
ok('사이드바가 가려지면 다시 잠근다', c.cover && c.value === '', c);
ok('가려지기 직전에 쓴 글은 저장된다(빈 칸으로 덮어쓰지 않는다)', (await savedText('s1')) === '비밀 내용 123 고침', await savedText('s1'));
await p.eval(`(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));})()`); await sleep(900);
await p.eval(`document.getElementById('note').dispatchEvent(new Event('blur'))`); await sleep(600);
ok('다시 보여도 잠긴 채이고, 저장된 글은 그대로다', (await covered()).cover && (await savedText('s1')) === '비밀 내용 123 고침');
await send('note-pin', {id: 's1', pinned: true}); await sleep(900);
ok('고정한 비밀 메모 카드에도 글을 보이지 않는다', await p.eval(`(()=>{const b=document.querySelector('#pin-deck .pin-body');return !!b&&b.textContent.includes('🔒')&&!b.textContent.includes('비밀 내용');})()`));
await send('note-pin', {id: 's1', pinned: false}); await sleep(600);
await p.eval(`document.getElementById('secret-open').click()`); await sleep(400);
await p.eval(`document.getElementById('mark-pin-cancel').click()`); await sleep(400);
ok('그만두면 잠긴 채로 남는다', !(await dialog()) && (await covered()).cover);
await p.eval(`(()=>{const c=document.getElementById('note-secret');c.checked=false;c.dispatchEvent(new Event('change'));})()`); await sleep(500);
ok('비밀을 풀 때도 PIN 을 묻는다', await dialog() && await p.eval(`document.getElementById('note-secret').checked`));
await submitPin('246810'); await sleep(600);
c = await covered();
ok('맞는 PIN 으로 풀면 보통 메모가 된다', !(await savedSecret('s1')) && !c.cover && c.value === '비밀 내용 123 고침', c);

// ── 그림 붙여넣기 ──
const paste = (w, h, color, text = '') => p.eval(`(async()=>{const c=new OffscreenCanvas(${w},${h});const g=c.getContext('2d');g.fillStyle='${color}';g.fillRect(0,0,${w},${h});
  const b=await c.convertToBlob({type:'image/png'});const dt=new DataTransfer();dt.items.add(new File([b],'x.png',{type:'image/png'}));${text ? `dt.setData('text/plain',${JSON.stringify(text)});` : ''}
  const ta=document.getElementById('note');ta.focus();const e=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});ta.dispatchEvent(e);return e.defaultPrevented;})()`);
const figures = () => p.eval(`[...document.querySelectorAll('#note-images figure img')].map(i=>({src:i.src.slice(0,5),w:i.naturalWidth}))`);
const stored = () => p.eval(`new Promise(r=>{const q=indexedDB.open('dais-note-images',1);q.onupgradeneeded=()=>q.result.createObjectStore('images');q.onsuccess=()=>{const t=q.result.transaction('images').objectStore('images').count();t.onsuccess=()=>{q.result.close();r(t.result);};};})`);
await p.eval(`document.getElementById('add-note').click()`); await sleep(500);
ok('붙여 넣으면 그림으로 받는다', await paste(300, 200, '#c33'));
await sleep(1800);
const imageNote = await p.eval(`document.querySelector('#note-tabs .note-tab.selected')?.dataset.id`);
ok('빈 새 메모에 그림을 붙이면 이름이 ‘이미지’ 가 된다', (await p.eval(`document.getElementById('note-title').value`)) === '이미지');
let figs = await figures();
ok('메모 아래에 원본 그림이 보인다', figs.length === 1 && figs[0].src === 'blob:' && figs[0].w === 300, figs);
await paste(500, 120, '#33c'); await sleep(1800);
figs = await figures();
ok('두 번째 그림은 아래로 쌓인다(오래된 것이 위)', figs.length === 2 && figs[0].w === 300 && figs[1].w === 500, figs);
ok('원본은 이 컴퓨터의 확장 저장소(IndexedDB)에 둔다', (await stored()) === 2);
ok('목록 · 미리보기는 그 메모에 붙는다', (await local('noteImages'))?.[imageNote]?.length === 2);
await C.send('Browser.grantPermissions', {origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']}).catch(() => {});
await p.cmd('Emulation.setFocusEmulationEnabled', {enabled: true}).catch(() => {});
await p.eval(`[...document.querySelectorAll('#note-images figure')][1].querySelector('button.secondary').click()`); await sleep(1500);
ok('복사 단추는 그림 원본을 클립보드에 올린다(도우미 없이)', (await p.eval(`navigator.clipboard.read().then(async items=>{for(const it of items)if(it.types.includes('image/png')){const bm=await createImageBitmap(await it.getType('image/png'));return bm.width;}return 0;}).catch(()=>-1)`)) === 500);
const before = (await C.send('Target.getTargets')).targetInfos.filter(t => t.url.includes('/capture.html')).length;
await p.eval(`[...document.querySelectorAll('#note-images figure')][1].querySelector('button.quiet').click()`); await sleep(1500);
ok('‘크게 · 편집’ 은 그 그림을 편집기로 연다', (await C.send('Target.getTargets')).targetInfos.filter(t => t.url.includes('/capture.html')).length === before + 1);
ok('글과 그림이 함께 있으면(엑셀 칸처럼) 글을 붙인다', !(await paste(100, 100, '#3c3', '가\t나')) && (await figures()).length === 2);
await p.eval(`[...document.querySelectorAll('#note-images figure')][0].querySelector('button.quiet:last-child').click()`); await sleep(1200);
figs = await figures();
ok('빼기로 한 장을 뺀다(원본도 치운다)', figs.length === 1 && figs[0].w === 500 && (await stored()) === 1, {figs, stored: await stored()});
for (let i = 0; i < 11; i++) await send('note-image-add', {note: imageNote, shot: {id: 'fill-' + i, thumb: 'iVBORw0KGgo=', width: 10, height: 10}});
await sleep(800);
await paste(80, 80, '#999'); await sleep(1500);
ok('한 메모에 12장이 차면 더 넣지 않고 알려 준다', /12장/.test(await p.text('#notice')) && (await local('noteImages'))[imageNote].length === 12, await p.text('#notice'));
await send('note-secret', {id: 's2', on: true}); await sleep(500);
await tab('s2'); await sleep(800);
if (await dialog()) await p.eval(`document.getElementById('mark-pin-cancel').click()`);
await sleep(300);
await p.eval(`document.body.focus()`);
await p.eval(`(async()=>{const dt=new DataTransfer();const c=new OffscreenCanvas(9,9);c.getContext('2d');dt.items.add(new File([await c.convertToBlob({type:'image/png'})],'y.png',{type:'image/png'}));document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`); await sleep(900);
ok('잠긴 비밀 메모에는 붙이지 않는다', /먼저 여세요/.test(await p.text('#notice')) && !(await local('noteImages'))?.s2, await p.text('#notice'));
await tab(imageNote); await sleep(800);
p.eval(`window.confirm=()=>true`);
await p.eval(`document.getElementById('delete-note').click()`); await sleep(1500);
ok('메모를 지우면 그 메모의 그림 목록도 빠진다', !(await local('noteImages'))?.[imageNote]);

// ── 연결 안 됨 · 화면 고르기 창의 까닭 ──
await p.eval(`chrome.storage.local.set({clipboardImport:false,clipError:'설치된 발표 도우미 앱이 이 확장(웹 스토어 판)을 아직 모릅니다. (Access to the specified native messaging host is forbidden.)'})`); await sleep(600);
ok('끊겼으면 ‘연결 안 됨’ 과 까닭 · 할 일을 토글 바로 아래에 적는다', (await p.text('#clip-state')) === '연결 안 됨' && /forbidden/.test(await p.text('#clip-why')));
await p.eval(`chrome.storage.local.set({clipboardImport:true,clipError:'바탕화면의 ‘캡처이미지’ 폴더에 저장하지 못했습니다.'})`); await sleep(600);
ok('켜진 채 도우미가 오류를 알리면 ‘오류’ 로(연결 안 됨이 아니다)', (await p.text('#clip-state')) === '오류');
await p.eval(`chrome.storage.local.set({clipboardImport:false,clipError:''})`); await sleep(400);
ok('까닭이 없으면 줄을 감춘다', !(await p.eval(p.visible('#clip-why'))));
const g = await C.open(ORIGIN + '/grab.html#mode=area&why=' + encodeURIComponent('발표 도우미 앱이 필요합니다 — 테스트 까닭'), {width: 440, height: 470});
await sleep(800);
ok('화면 고르기 창은 실패처럼 말하지 않고, 도우미로 못 고른 까닭을 보인다', /화면 고르기/.test(await g.text('h1')) && /테스트 까닭/.test(await g.text('#why')));

await C.stop();
console.log(failed ? `실패 ${failed}건` : '모두 통과');
process.exit(failed ? 1 : 0);
