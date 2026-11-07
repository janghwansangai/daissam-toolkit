// 찍은 화면 + 내레이션 → 영상. 사용: OUT=… VOICE=… node tools/video/render.mjs <결과.mp4> [처음 몇 초만]
import fs from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CHAPTERS} from './script.mjs';
import {Chrome, sleep} from '../../tests/e2e/cdp.mjs';
const OUT = process.env.OUT, VOICE = process.env.VOICE, dest = process.argv[2], only = Number(process.argv[3] || 0);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const rects = JSON.parse(fs.readFileSync(OUT + '/rects.json', 'utf8'));
Object.assign(rects['pres-on'] ||= {}, {hud: [40, 1345, 680, 58], ring: [570, 748, 180, 180]});
rects['app-menu'] = {menu: [1396, 156, 360, 440]}; rects['app-menu-sub'] = {sub: [1400, 156, 150, 100]};
rects['snip-drag'] = {box: [940, 660, 760, 600]}; rects['pin-hover'] = {bar: [510, 112, 345, 60]};
rects['pin-draw'] = {draw: [80, 610, 780, 118]}; rects['pin-crop'] = {pinbox: [80, 108, 772, 612]};
rects['pin-through'] = {pinbox: [80, 108, 772, 612]}; rects['pin-menu'] = {menu: [596, 586, 350, 690]};
(rects['cap-count'] ||= {}).delay = [1540, 1178, 200, 200];
Object.assign(rects.toolbar ||= {}, {pin: [2222, 88, 72, 72], puzzle: [2298, 88, 72, 72]});
(rects['rec-pick'] ||= {}).stopbtn = [1245, 1205, 410, 70];
// 자막은 읽는 말이 아니라 화면에 나오는 이름으로 적는다
const NAMES = [[/인스톨 시엠디/g, 'Install.cmd'], [/체크 시엠디/g, 'Check.cmd'], [/브라우저 셰리프 프리젠터/g, 'Browser Sheriff Presenter'], [/확장 집 파일/g, '확장 ZIP 파일'], [/집 파일/g, 'ZIP 파일'], [/윈도우의 피시 보호/g, '‘Windows의 PC 보호’'], [/컨트롤 브이/g, 'Ctrl+V'], [/커맨드 브이/g, 'Command+V'], [/컨트롤 알트 에프/g, 'Ctrl+Alt+F'], [/컨트롤 알트 시프트/g, 'Ctrl+Alt+Shift'], [/컨트롤과 알트/g, 'Ctrl과 Alt'], [/컨트롤과 옵션/g, 'Control과 Option'], [/컨트롤이나 커맨드/g, 'Ctrl이나 Command'], [/컨트롤 알트/g, 'Ctrl+Alt'], [/에스케이프/g, 'Esc'], [/리턴 키/g, 'Return 키'], [/삼, 이, 일/g, '3, 2, 1'], [/일 배에서 사 배/g, '1배에서 4배'], [/삼 초, 오 초, 십 초/g, '3초, 5초, 10초'], [/오 분/g, '5분'], [/일 분에서 삼십 분/g, '1분에서 30분'], [/열두 장/g, '12장'], [/천팔백 자/g, '1,800자'], [/발표 피, 집중 에프, 화면 조각 에스, 붙이기 브이, 닫기 디, 클릭 통과 티/g, '발표 P, 집중 F, 화면 조각 S, 붙이기 V, 닫기 D, 클릭 통과 T'], [/칠이공피부터 사케이까지/g, '720p부터 4K까지'], [/엠피포나 웹엠/g, 'MP4나 WebM'], [/크롬 확장 프로그램 주소를/g, 'chrome://extensions 를']];
const subt = s => NAMES.reduce((t, [a, b]) => t.replace(a, b), s);
const dur = f => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const LEAD = .3, TAIL = .3, CHAPTER_GAP = .5;
const clipFrames = {};
for (const c of ['zoom', 'focus']) { const d = `${OUT}/clips/${c}`; if (!fs.existsSync(d + '/00001.jpg')) { fs.mkdirSync(d, {recursive: true}); execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${OUT}/${c}.mov`, '-vf', 'fps=30', '-q:v', '2', `${d}/%05d.jpg`]); } clipFrames[c] = fs.readdirSync(d).length; }
const beats = []; let t = 0, last = null; const chapters = [];
for (const [ci, c] of CHAPTERS.entries()) {
  chapters.push({title: c.title, start: t});
  for (const [bi, b] of c.beats.entries()) {
    const id = String(ci).padStart(2, '0') + '-' + String(bi).padStart(2, '0'), wav = `${VOICE}/${id}.wav`, a = dur(wav);
    let box = b.hl && b.shot ? rects[b.shot]?.[b.hl] : null;
    if (box && box[1] + box[3] > 1432) box = [box[0], box[1], box[2], 1432 - box[1]];    // 화면 아래로 넘치는 칸은 보이는 데까지만
    if (b.hl && b.shot && !box) console.log('자리 없음', b.shot, b.hl);
    const z = b.z ?? (box ? 1.5 : 1), d = LEAD + a + TAIL + (bi === c.beats.length - 1 ? CHAPTER_GAP : 0);
    const card = b.card ? {...b.card, mark: b.mark} : null;
    const beat = {id, sub: subt(b.s), shot: b.shot || null, hl: b.hl || null, box, z: box ? z : 1, tag: b.tag || '', click: !!b.click, card, clip: b.clip || null, clipFrom: b.clipFrom || 0, clipLast: b.clip ? clipFrames[b.clip] : 0, start: t, end: t + d, voiceAt: t + LEAD, from: last};
    if (box) last = [box[0] + box[2] / 2, box[1] + box[3] / 2]; else if (b.card) last = null;
    beats.push(beat); t += d;
  }
}
const total = t; console.log('총 길이', Math.floor(total / 60) + '분 ' + Math.round(total % 60) + '초', '장면', beats.length);
fs.writeFileSync(OUT + '/timeline.json', JSON.stringify({beats, chapters, total}));
if (process.env.PLAN_ONLY) process.exit(0);
fs.copyFileSync(HERE + '/stage.html', OUT + '/stage.html'); fs.copyFileSync(HERE + '/../../site/img/Pretendard.woff2', OUT + '/font.woff2');
const C = new Chrome({ext: HERE + '/../../extension', profile: OUT + '/stage-profile-' + Date.now(), port: 9790, downloads: OUT + '/dl', args: ['--allow-file-access-from-files', '--disable-gpu-vsync']});
await C.start();
const p = await C.open('file://' + OUT + '/stage.html', {width: 2560, height: 1440}); await p.cmd('Emulation.setDeviceMetricsOverride', {width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false});
await sleep(800); await p.eval(`document.fonts.ready.then(()=>1)`);
await p.eval(`setup(${JSON.stringify({beats, total})})`);
const FPS = 30, end = only || total, N = Math.ceil(end * FPS);
const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', process.env.PRESET || 'medium', '-crf', process.env.CRF || '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest], {stdio: ['pipe', 'inherit', 'inherit']});
const put = buf => new Promise(res => ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res));
let buf = null, drawn = 0; const began = Date.now();
for (let f = 0; f < N; f++) {
  const tt = f / FPS, b = beats.find(x => tt < x.end) || beats.at(-1), u = tt - b.start;
  const moving = !buf || b.clip || u < 2.1;
  if (moving) { await p.eval(`frame(${tt})`); const {data} = await p.cmd('Page.captureScreenshot', {format: 'jpeg', quality: 96, optimizeForSpeed: true}); buf = Buffer.from(data, 'base64'); drawn++; }
  await put(buf);
  if (f % 900 === 0) console.log(`${Math.round(tt)}초 / ${Math.round(end)}초 · ${Math.round((Date.now() - began) / 1000)}초 걸림 · 그린 장 ${drawn}`);
}
ff.stdin.end(); await new Promise(res => ff.on('close', res)); await C.stop(); console.log('영상 끝', dest); process.exit(0);
