// 기능 소개 쇼츠(세로 1080x1920, 약 30초)를 만든다 → media/다있쌤-쇼츠.mp4
// 실제 확장 화면을 Chrome for Testing 으로 찍고, 같은 Chrome 안에서 캔버스 애니메이션 + 맥 음성(say, 유나)을
// MediaRecorder 로 녹화한다(ffmpeg 불필요). 사용: node scripts/shorts.mjs
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Chrome, sleep} from '../tests/e2e/cdp.mjs';

const EXT = fileURLToPath(new URL('../extension', import.meta.url));
const OUT = fileURLToPath(new URL('../media', import.meta.url));
const PANEL = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/panel.html';
const tmp = fs.mkdtempSync(os.tmpdir() + '/shorts-');
fs.mkdirSync(OUT, {recursive: true});

// 장면: [화면, 큰 글, 작은 글, 읽을 말]
const scenes = [
  [null, '수업에 필요한 것,\n다 있쌤.', '선생님을 위한 Chrome 사이드바', '수업에 필요한 것, 다 있쌤.'],
  ['notes', '떠오른 생각은\n빠른 메모로', '다른 컴퓨터에서도 이어서', '수업 중 떠오른 생각은 빠른 메모로. 다른 컴퓨터에서도 이어서 봐요.'],
  ['capture', '캡처 · 녹화도\n단추 하나로', '폴더 저장과 복사를 한 번에', '화면 캡처와 녹화도 단추 하나로. 폴더 저장과 복사를 한 번에.'],
  ['presenter', '발표는\n더 또렷하게', '화면 확대 · 큰 포인터 · 집중 모드', '발표할 땐 화면 확대와 큰 포인터로 또렷하게.'],
  ['tools', '교실 도구가\n사이드바 하나에', '타이머 · 수업 시보 · 뽑기 · PIN 잠금', '타이머, 수업 시보, 발표자 뽑기까지. 교실 도구가 사이드바 하나에.'],
  [null, '무료 · 회원가입 없음', 'hwansang.kr/s/daitssam', '무료이고, 회원가입도 없어요. 화면의 주소에서 내려받으세요.'],
];

// 1. 음성(장면마다 하나) — 길이를 재서 장면 길이로 쓴다
const voices = scenes.map(([, , , line], i) => {
  const wav = `${tmp}/v${i}.wav`;
  execFileSync('say', ['-v', 'Yuna', '-r', '185', '--file-format=WAVE', '--data-format=LEI16@24000', '-o', wav, line]);
  const bytes = fs.readFileSync(wav);
  return {data: bytes.toString('base64'), seconds: (bytes.length - 44) / 48000};
});

// 2. 실제 확장 화면
const C = new Chrome({ext: EXT, profile: tmp + '/p', port: 9481, downloads: tmp + '/dl', args: ['--autoplay-policy=no-user-gesture-required']});
await C.start();
const p = await C.open(PANEL, {width: 400, height: 760});
await p.cmd('Emulation.setDeviceMetricsOverride', {width: 400, height: 760, deviceScaleFactor: 2.5, mobile: false});
await p.waitFor(p.visible('#gate-form'), 15000, '처음 화면');
await p.type('#profile-name', '김선생'); await p.type('#profile-pin', '246810'); await p.type('#profile-confirm', '246810');
await p.eval(`document.getElementById('gate-form').requestSubmit()`);
await p.waitFor(p.visible('#workspace'), 15000, '작업 화면');
await p.eval(`chrome.storage.local.set({lockOnAway:false})`);
for (const [title, text] of [['3월 학급 운영', '· 1인 1역 정하기\n· 모둠 자리 바꾸기(금)\n· 학부모 상담 주간 안내장'], ['과학 4단원 준비물', '자석, 클립, 나침반 6모둠분'], ['오늘 할 일', '출석부 마감 · 급식 지도 · 방과후 명단 제출']])
  await p.eval(`chrome.runtime.sendMessage({type:'note-save',id:'v-'+Math.random().toString(36).slice(2),title:${JSON.stringify(title)},text:${JSON.stringify(text)}})`);
await p.eval(`location.reload()`); await sleep(2500);
console.log('화면 찍기');
const shots = {};
for (const page of ['notes', 'capture', 'presenter', 'tools']) {
  await p.eval(`document.querySelector('[data-page="${page}"]').click()`); await sleep(900);
  const {data} = await p.cmd('Page.captureScreenshot', {format: 'png'});
  shots[page] = 'data:image/png;base64,' + data;
}
const icon = 'data:image/png;base64,' + fs.readFileSync(EXT + '/icons/128.png').toString('base64');
const font = pathToFileURL(EXT + '/fonts/PretendardVariable.woff2').href;

// 3. 영상 페이지: 캔버스에 그리고, 음성과 함께 녹화
fs.writeFileSync(`${tmp}/video.html`, `<!doctype html><meta charset=utf-8><style>@font-face{font-family:P;src:url('${font}')}body{margin:0;background:#000}</style><canvas id=c width=1080 height=1920></canvas>
<script>
const scenes=${JSON.stringify(scenes.map(([page, big, small], i) => ({page, big, small, voice: voices[i].data, seconds: voices[i].seconds})))};
const shots=${JSON.stringify(shots)}; const iconSrc=${JSON.stringify(icon)};
const load=src=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=src;});
window.make=async()=>{
  window.stage='글꼴';await document.fonts.load('800 80px P');await document.fonts.load('500 40px P');
  const imgs={};for(const k in shots)imgs[k]=await load(shots[k]);const icon=await load(iconSrc);
  window.stage='소리 준비';const ac=new AudioContext({sampleRate:48000});await ac.resume();const dest=ac.createMediaStreamDestination();
  const bufs=[];for(const s of scenes){const b=Uint8Array.from(atob(s.voice),c=>c.charCodeAt(0)).buffer;bufs.push(await ac.decodeAudioData(b));}
  window.stage='녹화기';const cv=document.getElementById('c'),g=cv.getContext('2d');
  const stream=new MediaStream([...cv.captureStream(30).getVideoTracks(),...dest.stream.getAudioTracks()]);
  const type=['video/mp4;codecs=avc1.640028,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus'].find(t=>MediaRecorder.isTypeSupported(t));
  const rec=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:8e6});const parts=[];rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data);window.got=(window.got||0)+e.data.size;};
  const pad=0.55,lead=0.35;let t0=0;const plan=scenes.map(s=>{const st=t0;t0+=lead+s.seconds+pad;return{...s,start:st,end:t0};});const total=t0+0.6;
  const ease=x=>x<0?0:x>1?1:1-Math.pow(1-x,3);
  function text(str,x,y,size,weight,color,align='center'){g.font=weight+' '+size+'px P';g.fillStyle=color;g.textAlign=align;str.split('\\n').forEach((l,i)=>g.fillText(l,x,y+i*size*1.25));}
  function frame(t){
    const grd=g.createLinearGradient(0,0,1080,1920);grd.addColorStop(0,'#0f2921');grd.addColorStop(1,'#1d4a3a');g.fillStyle=grd;g.fillRect(0,0,1080,1920);
    const s=plan.find(p=>t>=p.start&&t<p.end)||plan[plan.length-1];const k=(t-s.start)/(s.end-s.start);const inA=ease((t-s.start)/0.45),outA=1-ease((t-(s.end-0.3))/0.3);
    g.globalAlpha=Math.max(0,Math.min(inA,outA));
    if(!s.page){
      const y=760-30*(1-inA);g.drawImage(icon,540-90,y-330,180,180);
      text(s.big,540,y,s.big.includes('\\n')?104:84,800,'#fff');const isUrl=s.small.includes('/');text(s.small,540,y+(s.big.includes('\\n')?300:170),isUrl?62:44,isUrl?800:500,isUrl?'#fff7c2':'#9fd8b8');
    }else{
      text(s.big,540,230-20*(1-inA),88,800,'#fff');text(s.small,540,480,40,500,'#9fd8b8');
      const img=imgs[s.page];const w=760,h=w*img.height/img.width;const z=1+0.06*k;const x=540-w*z/2,y=600-40*k;
      g.save();g.shadowColor='rgba(0,0,0,.45)';g.shadowBlur=60;g.shadowOffsetY=24;g.beginPath();g.roundRect(x,y,w*z,Math.min(h*z,1300),36);g.fillStyle='#fff';g.fill();g.restore();
      g.save();g.beginPath();g.roundRect(x,y,w*z,Math.min(h*z,1300),36);g.clip();g.drawImage(img,x,y,w*z,h*z);g.restore();
    }
    g.globalAlpha=1;g.fillStyle='rgba(255,255,255,.18)';g.fillRect(0,1910,1080,10);g.fillStyle='#9fd8b8';g.fillRect(0,1910,1080*Math.min(1,t/total),10);
  }
  window.stage='녹화 중';frame(0);rec.start(500);const start=ac.currentTime+0.15;
  plan.forEach((p,i)=>{const src=ac.createBufferSource();src.buffer=bufs[i];src.connect(dest);src.start(start+p.start+lead);});
  const t1=performance.now();
  await new Promise(res=>{(function tick(){const t=(performance.now()-t1)/1000;frame(t);if(t<total)setTimeout(tick,16);else res();})();});
  window.stage='마무리';const stopped=new Promise(r=>{rec.onstop=r;});rec.stop();await Promise.race([stopped,new Promise(r=>setTimeout(r,20000))]);window.stage='묶기 '+parts.length+'조각 '+rec.state;
  const blob=new Blob(parts,{type});
  // 큰 영상을 CDP 답으로 넘기면 멈춘다 — 다운로드로 내려 보낸다.
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='shorts.'+(type.includes('mp4')?'mp4':'webm');document.body.append(a);a.click();
  return {type,seconds:total,size:blob.size};
};
</script>`);
const v = await C.open(pathToFileURL(`${tmp}/video.html`).href, {width: 1080, height: 1920});
await v.cmd('Page.bringToFront');await sleep(800);
console.log('녹화 시작');
await v.eval(`window.result=null;window.stage='시작';make().then(r=>window.result=r,e=>window.result={error:String(e)});0`);
let made=null,last='';
for(let i=0;i<300&&!made;i++){await sleep(1000);const st=await v.eval('window.stage');if(st!==last){console.log('단계:',st);last=st;}
  if(await v.eval('!!window.result'))made=await v.eval('window.result');}
if(!made||made.error)throw new Error('녹화 실패: '+(made?.error||'시간 초과, 단계 '+last));
const ext = made.type.includes('mp4') ? 'mp4' : 'webm';
const got = `${tmp}/dl/shorts.${ext}`;
for (let i = 0; i < 60 && !(fs.existsSync(got) && fs.statSync(got).size === made.size); i++) await sleep(500);
if (!fs.existsSync(got)) throw new Error('영상 파일이 내려오지 않았습니다');
const file = `${OUT}/다있쌤-쇼츠.${ext}`;
fs.copyFileSync(got, file);
await C.stop();
fs.rmSync(tmp, {recursive: true, force: true});
console.log(`만든 영상: ${file} · ${made.type} · ${made.seconds.toFixed(1)}초 · ${(fs.statSync(file).size / 1048576).toFixed(1)}MB`);
