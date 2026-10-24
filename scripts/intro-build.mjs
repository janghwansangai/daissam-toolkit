// 소개자료/다있쌤-소개.html(그림을 품은 파일 하나)과 다있쌤-소개.pdf(A4)를 만든다.
// 화면은 scripts/intro-shots.mjs 가 찍은 소개자료/img/*.png. 사용: node scripts/intro-build.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Chrome, sleep} from '../tests/e2e/cdp.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, '소개자료');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version;
const img = name => 'data:image/png;base64,' + fs.readFileSync(path.join(DIR, 'img', name)).toString('base64');
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'extension/icons/128.png')).toString('base64');
const SITE = 'https://hwansang.kr/s/daitssam';
const STORE = 'https://chromewebstore.google.com/detail/penklhfehmfoebmeolplklmjjcjhhnpi';

const features = [
  ['1-notes.png', '빠른 메모', '수업 중 떠오른 것을 바로', ['메모를 여러 개 쓰고 제목으로 골라 씁니다', '같은 Google 계정이면 교실 · 집 컴퓨터에서 이어서', '자주 보는 메모는 📌 고정']],
  ['2-bookmarks.png', '폴더 북마크', '자주 가는 곳을 한곳에', ['<b>지금 보는 페이지 추가 +</b> 한 번이면 저장', '‘과학’ · ‘학급 운영’ 처럼 폴더로 정리', 'Chrome 기본 북마크와 섞이지 않습니다']],
  ['3-capture.png', '캡처 · 녹화', '보이는 그대로, 한 번에', ['보이는 부분 · 전체 페이지(스크롤) · 선택 영역', '찍으면 바탕화면 <b>캡처이미지</b> 폴더 저장 + 복사', '화면 녹화 · 카메라 함께 녹화 · 글자 뽑기']],
  ['4-presenter.png', '발표 도구', '작게 보이는 것을, 크게', ['화면 확대 · 큰 포인터 · 집중 모드', '화면 조각을 떼어 붙여 두는 <b>핀</b>', '<b>발표 도우미 앱</b>을 함께 설치하면 쓸 수 있어요']],
  ['5-tools.png', '수업 유틸리티', '교실 도구를 사이드바 하나에', ['스톱워치 · 타이머 · 수업 시보', '발표자 뽑기 · 팀 포인트 판 · 소음 측정기', '녹음기 · 웹캠 · 유튜브 뮤직 조종기']],
  ['6-backup.png', '자동 백업', '잃어버릴 걱정 없이', ['<b>문서 → 다있쌤 백업</b> 폴더에 저절로 저장', '하루 1번 · 바뀐 뒤 · 직접 — 한 달 보관', '날짜를 골라 복구, 다시 깔아도 살릴 수 있어요']],
];
const steps = [
  ['설치', `Chrome 웹 스토어에서 <b>다있쌤</b>을 찾아 <b>Chrome에 추가</b>를 누릅니다.`],
  ['고정', `주소창 오른쪽 퍼즐 🧩 → 다있쌤 옆 <b>압정</b>을 눌러 고정하고, 아이콘을 누르면 오른쪽에 사이드바가 열립니다.`],
  ['시작', `이름을 적고 <b>PIN 없이 바로 쓰기 · 게스트</b>를 누르면 끝. 함께 쓰는 컴퓨터라면 PIN(숫자 4~12자리)을 정하세요.`],
  ['발표 도우미', `화면 확대 · 핀 · 화면 전체 캡처 · 자동 백업은 <b>발표 도우미 앱</b>이 맡습니다. 첫 화면이나 <b>발표</b> 탭에서 받아 설치하세요(맥 · 윈도우).`],
];
const faq = [
  ['정말 무료인가요?', '네. 광고도, 회원가입도, 결제도 없습니다.'],
  ['내 메모가 어딘가로 보내지나요?', '아니요. 다있쌤에는 서버가 없습니다. 메모 · 북마크는 내 Chrome(과 내 Google 계정 동기화)에, 캡처와 백업은 내 컴퓨터에만 남습니다. 만든 사람도 볼 수 없습니다.'],
  ['발표 도우미 앱은 꼭 깔아야 하나요?', '메모 · 북마크 · 브라우저 캡처 · 타이머는 확장만으로 됩니다. 화면 확대 · 핀 · 다른 앱까지 고르는 캡처 · 자동 백업을 쓸 때만 필요합니다.'],
  ['맥에서 앱이 “확인되지 않은 개발자” 라며 안 열려요.', '시스템 설정 → 개인정보 보호 및 보안 → 아래쪽 <b>그래도 열기</b>. 윈도우의 파란 PC 보호 화면은 <b>추가 정보 → 실행</b>. 개인이 만든 무료 앱이라 유료 인증서가 없어서 뜨는 안내입니다.'],
  ['PIN을 잊어버렸어요.', '확장을 지우고 다시 설치한 뒤, 첫 화면에 뜨는 <b>가장 최근 백업으로 복구</b>로 메모 · 북마크를 살리세요(자동 백업이 켜져 있었다면).'],
  ['잠금을 껐는데 잠겼어요.', '잠금 화면 아래에 <b>왜 잠겼는지</b>가 적혀 있습니다. 그 설정을 끄면 됩니다.'],
];
const esc = s => s;  // 내용은 위에서 직접 쓴 글뿐이다(바깥 입력 없음)
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>다있쌤 — 소개와 사용법</title>
<style>
:root{--ink:#16302a;--sub:#5a6b62;--line:#e1e7df;--paper:#ffffff;--bg:#f5f8f2;--green:#1d4a3a;--deep:#0f2921;--mint:#c8ecd6;--lime:#e4f5a9}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 'Pretendard','Apple SD Gothic Neo','Malgun Gothic',-apple-system,sans-serif;word-break:keep-all}
.wrap{max-width:960px;margin:0 auto;padding:0 24px}
b{font-weight:700;color:var(--deep)}
.hero{background:var(--deep);color:#fff;padding:64px 0 72px}
.hero .wrap{display:flex;gap:28px;align-items:center}
.hero img.logo{width:84px;height:84px;border-radius:20px}
.hero h1{font-size:44px;line-height:1.25;margin:0 0 10px;letter-spacing:-.02em}
.hero p{margin:0;color:#cfe3d6;font-size:18px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.chip{background:#ffffff1a;border:1px solid #ffffff33;border-radius:999px;padding:4px 14px;font-size:14px;color:#e8f4ec}
section{padding:56px 0}
h2{font-size:28px;margin:0 0 8px;letter-spacing:-.01em}.lead{color:var(--sub);margin:0 0 28px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.tile{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:18px 18px 16px}
.tile .n{display:inline-block;font-size:12px;font-weight:700;color:var(--green);background:var(--mint);border-radius:999px;padding:1px 10px;margin-bottom:8px}
.tile h3{margin:0 0 4px;font-size:18px}.tile p{margin:0;color:var(--sub);font-size:14px}
.feature{display:grid;grid-template-columns:260px 1fr;gap:40px;align-items:center;background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:28px 34px;margin-bottom:18px;break-inside:avoid}
.feature:nth-child(even){grid-template-columns:1fr 260px}.feature:nth-child(even) .shot{order:2}
.shot{width:260px;height:420px;border-radius:18px;overflow:hidden;border:1px solid var(--line);box-shadow:0 10px 30px #0f292114;background:#f8faf5}
.shot img{width:100%;display:block}
.feature .k{font-size:13px;font-weight:700;color:var(--green);letter-spacing:.04em}
.feature h3{font-size:26px;margin:4px 0 4px}.feature .t{color:var(--sub);margin:0 0 16px;font-size:17px}
.feature ul{margin:0;padding:0;list-style:none}.feature li{position:relative;padding:7px 0 7px 26px;border-top:1px solid var(--line)}
.feature li:first-child{border-top:0}.feature li:before{content:'';position:absolute;left:4px;top:15px;width:9px;height:9px;border-radius:50%;background:var(--green)}
.steps{counter-reset:s;display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.step{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:20px;break-inside:avoid}
.step .no{width:34px;height:34px;border-radius:50%;background:var(--green);color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;margin-bottom:10px}
.step h3{margin:0 0 6px;font-size:18px}.step p{margin:0;font-size:14.5px;color:var(--sub)}
.start{display:grid;grid-template-columns:240px 1fr;gap:34px;align-items:center;margin-top:22px}
.note{background:var(--lime);border-radius:16px;padding:16px 20px;font-size:15px}
.privacy{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.privacy div{break-inside:avoid;background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:18px}.privacy h3{margin:0 0 4px;font-size:17px}.privacy p{margin:0;color:var(--sub);font-size:14px}
details,.qa{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin-bottom:10px;break-inside:avoid}
.qa h3{margin:0 0 4px;font-size:16px}.qa p{margin:0;color:var(--sub);font-size:15px}
.cta{background:var(--deep);color:#fff;border-radius:22px;padding:30px 34px;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.cta h2{color:#fff}.cta p{margin:0;color:#cfe3d6}.cta a{display:inline-block;background:var(--mint);color:var(--deep);font-weight:700;border-radius:12px;padding:12px 18px;text-decoration:none;margin:4px 0}
footer{color:var(--sub);font-size:13px;text-align:center;padding:30px 0 44px}
@media screen and (max-width:760px){.grid,.steps,.privacy{grid-template-columns:1fr}.feature,.feature:nth-child(even),.start{grid-template-columns:1fr}.feature:nth-child(even) .shot{order:0}.shot{margin:0 auto}.hero .wrap{flex-direction:column;align-items:flex-start}.hero h1{font-size:34px}}
@page{size:A4;margin:12mm}
@media print{body{background:#fff;font-size:13px}.hero{padding:34px 0 38px}.hero h1{font-size:34px}section{padding:22px 0}h2{font-size:22px}.lead{margin-bottom:16px}
  .feature{padding:18px 22px;gap:26px;grid-template-columns:200px 1fr}.feature:nth-child(even){grid-template-columns:1fr 200px}.shot{width:200px;height:330px;box-shadow:none}.feature h3{font-size:21px}
  .p-break{break-before:page}.steps{grid-template-columns:repeat(2,1fr)}.wrap{max-width:none;padding:0 4mm}.grid{grid-template-columns:repeat(3,1fr)}
  .start{grid-template-columns:200px 1fr;gap:24px}.start .shot{width:200px!important;height:320px!important}.feature:nth-of-type(3){break-before:page}.feature:nth-of-type(5){break-before:page}footer{padding:14px 0 0}}
</style></head><body>
<header class="hero"><div class="wrap"><img class="logo" src="${icon}" alt="">
<div><h1>수업에 필요한 것,<br>다 있쌤.</h1><p>메모 · 북마크 · 캡처 · 녹화 · 발표 도구 · 수업 유틸리티를 Chrome 사이드바 하나에.</p>
<div class="chips"><span class="chip">무료</span><span class="chip">회원가입 없음</span><span class="chip">서버 없음 · 내 자료는 내 컴퓨터에</span><span class="chip">맥 · 윈도우</span></div></div></div></header>
<main>
<section><div class="wrap"><h2>한눈에 보기</h2><p class="lead">Chrome 오른쪽에 열리는 사이드바 하나에 수업 도구가 모여 있습니다.</p>
<div class="grid">${features.map(([, t, s], i) => `<div class="tile"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${t}</h3><p>${s}</p></div>`).join('')}</div></div></section>
<section class="p-break"><div class="wrap"><h2>이렇게 써요</h2><p class="lead">사이드바 위쪽의 탭(빠른 메모 · 북마크 · 캡처 · 발표 · 유틸리티)을 눌러 오갑니다. 탭 위 진한 막대는 자주 쓰는 단추를 모은 <b>도크</b>입니다.</p>
${features.map(([file, t, s, list], i) => `<div class="feature"><div class="shot"><img src="${img(file)}" alt="${t} 화면"></div><div><div class="k">${String(i + 1).padStart(2, '0')}</div><h3>${t}</h3><p class="t">${s}</p><ul>${list.map(x => `<li>${x}</li>`).join('')}</ul></div></div>`).join('')}
</div></section>
<section class="p-break"><div class="wrap"><h2>3분 시작하기</h2><p class="lead">설치부터 첫 메모까지 네 단계면 됩니다.</p>
<div class="steps">${steps.map(([t, d], i) => `<div class="step"><div class="no">${i + 1}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
<div class="start"><div class="shot" style="width:240px;height:380px"><img src="${img('0-start.png')}" alt="처음 화면"></div>
<div><h3 style="margin:0 0 8px;font-size:20px">처음 화면</h3><p style="margin:0 0 14px;color:var(--sub)">혼자 쓰는 컴퓨터라면 <b>PIN 없이 바로 쓰기</b>, 여러 사람이 쓰는 교실 컴퓨터라면 <b>PIN</b>을 정하세요. 아래 칸에서 발표 도우미 앱도 바로 받을 수 있습니다.</p>
<div class="note">💡 직접 설치(개발자 모드)도 됩니다 — 소개 사이트에서 확장 ZIP 을 받아 <b>chrome://extensions → 개발자 모드 → 압축해제된 확장 프로그램을 로드</b>.</div></div></div>
</div></section>
<section class="p-break"><div class="wrap"><h2>안심하고 쓰도록</h2><p class="lead">만든 사람도 볼 수 없는 구조입니다.</p>
<div class="privacy"><div><h3>서버가 없습니다</h3><p>회원가입 · 로그인 · 사용 기록 수집이 없습니다. 어디로도 내 자료를 보내지 않습니다.</p></div>
<div><h3>내 자료는 내 곳에</h3><p>메모 · 북마크는 내 Chrome(과 내 Google 계정 동기화), 캡처 · 백업은 이 컴퓨터에만 남습니다.</p></div>
<div><h3>날짜로 되돌리기</h3><p>자동 백업이 한 달 동안 남아 있어, 실수로 지워도 날짜를 골라 되살릴 수 있습니다.</p></div></div></div></section>
<section><div class="wrap"><h2>자주 묻는 질문</h2><p class="lead">막히는 곳이 있으면 먼저 여기를 보세요.</p>
${faq.map(([q, a]) => `<div class="qa"><h3>${q}</h3><p>${a}</p></div>`).join('')}
<div class="cta" style="margin-top:26px"><div><h2 style="margin:0 0 4px">지금 시작하기</h2><p>설치 안내 · 내려받기 · 사용설명서가 모두 소개 사이트에 있습니다.</p></div>
<div><a href="${STORE}">Chrome 웹 스토어</a><br><a href="${SITE}">${SITE.replace('https://', '')}</a></div></div>
</div><footer>다있쌤 v${version} · 만든이 다있쌤 로디 · 무료 · 서버 없음</footer></section></main>
</body></html>`;
fs.writeFileSync(path.join(DIR, '다있쌤-소개.html'), html);
// PDF(A4)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-pdf-'));
const C = new Chrome({ext: path.join(ROOT, 'extension'), profile: path.join(tmp, 'p'), port: 9612, downloads: path.join(tmp, 'dl')});
await C.start();
const page = await C.open(pathToFileURL(path.join(DIR, '다있쌤-소개.html')).href, {width: 1000, height: 1400});
await sleep(1500);
const {data} = await page.cmd('Page.printToPDF', {printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false});
fs.writeFileSync(path.join(DIR, '다있쌤-소개.pdf'), Buffer.from(data, 'base64'));
await C.stop();
try { fs.rmSync(tmp, {recursive: true, force: true, maxRetries: 5, retryDelay: 300}); } catch {}
console.log('만든 파일:', ['다있쌤-소개.html', '다있쌤-소개.pdf'].map(f => f + ' ' + Math.round(fs.statSync(path.join(DIR, f)).size / 1024) + 'KB').join(' · '));
