import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {stamp} from '../extension/lib/shots.js';

const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));

test('캡처에 필요한 권한이 있다', () => {
  // captureVisibleTab 은 <all_urls> 나 activeTab 이 있어야 한다. http/https 전체로는 거절된다
  // (실제 Chrome 에서 "Either the '<all_urls>' or 'activeTab' permission is required.").
  assert.ok(manifest.host_permissions.includes('<all_urls>'));
  for (const perm of ['desktopCapture', 'tabCapture', 'scripting', 'nativeMessaging'])
    assert.ok(manifest.permissions.includes(perm), perm);
  // 권한을 넓히더라도 페이지에 들어가는 스크립트는 여전히 웹페이지뿐이다.
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://*/*', 'https://*/*']);
});

test('캡처 단축키 명령이 있고, 기본 키를 억지로 잡지 않는다', () => {
  for (const name of ['capture-area', 'capture-full', 'capture-visible']) {
    assert.ok(manifest.commands[name], name);
    assert.equal(manifest.commands[name].suggested_key, undefined, name + ' 은 사용자가 정한다');
  }
});

// 남에게 건넬 폴더에는 설치 안내와 사용설명서가 함께 들어가야 한다.
test('건네줄 폴더에 안내문 두 개가 들어간다', () => {
  const pack = readFileSync('scripts/package.mjs', 'utf8');
  assert.match(pack, /0\. 먼저 읽어주세요\.html/);
  assert.match(pack, /1\. 사용설명서\.html/);
  for (const file of ['docs/install-guide.html', 'docs/user-guide.html']) {
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes('{{VERSION}}'), file + ' 은 버전을 틀에서 채운다');
    assert.ok(text.length > 4000, file + ' 이 너무 짧다');
  }
});

test('파일 이름의 날짜 모양', () => {
  assert.equal(stamp(new Date(2026, 8, 3, 7, 5, 9)), '2026-09-03 07.05.09');
});

test('편집기·녹화 창·캡처 엔진이 모두 확장에 들어 있다', () => {
  for (const file of ['capture.html', 'capture.css', 'capture.js', 'capture-core.js', 'record.html', 'record.js', 'lib/shots.js', 'dock.html', 'dock.js'])
    assert.ok(readFileSync('extension/' + file).length > 0, file);
  // 편집기의 hidden 이 display 규칙에 지지 않아야 한다(없으면 자르기 단추·글자 창이 늘 떠 있었다).
  assert.match(readFileSync('extension/capture.css', 'utf8'), /\[hidden\]\{display:none!important\}/);
});

// 사이드바가 닫히면 페이지가 넓어진다. 그때까지 기다렸다 찍어야 좁게 찍히지 않는다.
test('넓어질 때까지 기다렸다가 찍는다', async () => {
  const widths = [900, 900, 900, 1300, 1300];
  let asked = 0;
  globalThis.chrome = {scripting: {executeScript: async () => [{result: widths[Math.min(asked++, widths.length - 1)]}]}};
  const {waitWider} = await import('../extension/capture-core.js');
  const began = Date.now();
  assert.equal(await waitWider(1), true, '넓어지면 true');
  const spent = Date.now() - began;
  assert.ok(asked >= 4, '넓어질 때까지 다시 물어본다: ' + asked);
  assert.ok(spent >= 400 && spent < 1500, '넓어진 뒤 조금 더 기다렸다 찍는다 (' + spent + 'ms)');
});

test('끝내 넓어지지 않아도 멈추지 않는다', async () => {
  globalThis.chrome = {scripting: {executeScript: async () => [{result: 900}]}};
  const {waitWider} = await import('../extension/capture-core.js');
  const began = Date.now();
  assert.equal(await waitWider(1), false);
  const spent = Date.now() - began;
  assert.ok(spent >= 1000 && spent < 2500, '1.3초쯤 기다리고 그냥 찍는다 (' + spent + 'ms)');
});

// 캡처·녹화할 때 사이드바를 자동으로 닫는 것은 처음부터 켜져 있어야 한다(사용자 요청).
test('사이드바 자동 닫기는 기본으로 켜져 있다', () => {
  const panel = readFileSync('extension/panel.js', 'utf8');
  const caps = panel.match(/const CAP_DEFAULTS=\{[^}]*\}/)[0];
  assert.match(caps, /hideSide:true/);
});

// 닫은 사이드바는 캡처가 끝나면 되돌린다. 열지 못할 수도 있어(Chrome 은 '누른 직후' 에만
// 허락한다) 페이지 위 알림과 알림창으로도 결과를 알린다.
test('캡처가 끝나면 사이드바를 되살리고 결과를 알린다', () => {
  const back = readFileSync('extension/background.js', 'utf8');
  assert.match(back, /chrome\.sidePanel\.open\(\{windowId/);
  assert.match(back, /async function captureDone\(/);
  assert.match(back, /lastCapture:\{text,at:Date\.now\(\)\}/);
  assert.match(back, /async function toast\(tabId,text\)/);
  // 사이드바가 다시 열리면 방금 끝난 캡처 결과를 사이드바에서도 보여 준다.
  assert.match(readFileSync('extension/panel.js', 'utf8'), /lastCapture\?\.text/);
});

// 발표 오버레이·핀·카메라 창은 사용자의 화면 녹화에 **담겨야** 한다. 예전에는 창마다
// sharingType=.none 을 걸어(확대 화면이 스스로를 찍는 되먹임을 막으려고) 녹화 영상에
// 하나도 남지 않았다(사용자 보고). 되먹임은 확대용 SCContentFilter 가 막는다.
test('앱이 그리는 창은 화면 녹화에 담기고, 표시기만 빠진다', () => {
  const swift = readFileSync('presenter/macos/Presenter.swift', 'utf8');
  // 주석은 걷어 내고 본다 — 설명에 적힌 'sharingType' 까지 걸리면 안 된다.
  const chunk = (from, to) => swift.slice(swift.indexOf(from), swift.indexOf(to, swift.indexOf(from)))
    .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  // 담겨야 하는 것들
  const pin = chunk('init(image: NSImage, host: Presenter, centre: NSPoint)', 'level=Pin.level');
  assert.doesNotMatch(pin, /sharingType/, '핀은 녹화에 담긴다');
  const overlay = chunk('let panel=NSPanel(contentRect:selected.frame', 'let canvas=LiveView');
  assert.doesNotMatch(overlay, /sharingType/, '발표 오버레이는 녹화에 담긴다');
  const camera = chunk('final class CameraPanel: NSPanel', 'final class Presenter: NSObject');
  assert.doesNotMatch(camera, /sharingType/, '카메라 창은 녹화에 담긴다');
  // 빠져야 하는 것: 녹화 표시기
  const badge = chunk('final class BadgePanel: NSPanel', '@objc private func tap');
  assert.match(badge, /sharingType = \.none/, '표시기는 녹화에서 빠진다');
  // 되먹임 막기: 확대용 캡처에서만 이 앱을 뺀다(두 겹)
  assert.match(swift, /excludingApplications:own,exceptingWindows:\[\]/);
  assert.match(swift, /let mine=content\.windows\.filter\{\$0\.owningApplication\?\.processID==ProcessInfo\.processInfo\.processIdentifier\}/);
  assert.match(swift, /own\.isEmpty \? SCContentFilter\(display:display,excludingWindows:mine\)/);
});

// 윈도우도 같은 규칙: 화면 녹화에서 빼는 것은 표시기 하나뿐이다.
test('윈도우에서 녹화 제외는 표시기에만 걸린다', () => {
  const cs = readFileSync('presenter/windows/Presenter.cs', 'utf8');
  // 선언(DllImport)과 주석은 빼고, 실제로 부르는 곳만 센다.
  const calls = cs.split('\n')
    .filter(line => !line.trim().startsWith('//') && !line.includes('DllImport'))
    .join('\n').match(/Native\.SetWindowDisplayAffinity\([^)]*\)/g) || [];
  assert.equal(calls.length, 1, '한 곳(표시기)에서만 부른다: ' + calls.join(' / '));
  const badge = cs.slice(cs.indexOf('sealed class BadgeForm:Form'), cs.indexOf('sealed class Presenter', cs.indexOf('sealed class BadgeForm:Form')) + 1);
  assert.match(badge, /SetWindowDisplayAffinity\(Handle,Native\.ExcludeFromCapture\)/, '그 한 곳은 표시기다');
});

// 창은 화면에서 확실히 내려가야 한다(orderOut 만으로 남는 경우가 있었다).
test('창을 내릴 때는 close 까지 부른다', () => {
  const swift = readFileSync('presenter/macos/Presenter.swift', 'utf8');
  assert.match(swift, /extension NSWindow \{[\s\S]{0,240}func vanish\(\)[\s\S]{0,160}close\(\)/);
  for (const site of [/blink=nil; vanish\(\)/, /preview=nil\r?\n\s*vanish\(\)/, /window\?\.vanish\(\);window=nil/, /notice\?\.vanish\(\); notice=nil/, /snip\?\.vanish\(\); snip=nil/])
    assert.match(swift, site, String(site));
  // 모니터가 빠지면 표시기·카메라 창을 남은 화면으로 데려온다.
  assert.match(swift, /func displayChanged\(\)\{[\s\S]{0,600}place\(on:screenInUse\(\)\)/);
});

// '화면 전체' 를 담을 때 그 모니터를 가리지 못하면 카메라 창을 띄우지 않는다(확장이 영상
// 안에 합친다). 탭·창을 담을 때는 모니터가 상관없으니 그냥 띄운다 — 찍는 동안 보여야 한다.
test('화면 전체에서 모니터를 못 가리면 카메라 창을 띄우지 않는다', () => {
  assert.match(readFileSync('presenter/macos/Presenter.swift', 'utf8'),
    /if !recordDisplay\.isEmpty && NSScreen\.screens\.count > 1 && onScreen == nil \{[\s\S]{0,200}return/);
  assert.match(readFileSync('presenter/windows/Presenter.cs', 'utf8'),
    /if\(!string\.IsNullOrEmpty\(recordDisplay\)&&Screen\.AllScreens\.Length>1&&onScreen==null\)\{[\s\S]{0,200}return;/);
});

// 카메라 동그라미: 전체 화면 녹화는 앱이 띄운 동그란 창이 화면에 보이고 녹화에도 담긴다.
// 앱이 못 띄우면(권한 없음·앱 없음) 확장이 영상 안에 합쳐 넣는다 — 둘 다 나오면 안 된다.
test('카메라 동그라미는 앱이 띄우고, 못 띄우면 영상 안에 합쳐 넣는다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  assert.equal(existsSync('extension/bubble.html'), false, '제목 표시줄 달린 네모 창은 없앴다');
  assert.doesNotMatch(rec, /bubbleMode|openBubble/);
  assert.match(rec, /async function appCameraUp\(\)/);
  // 앱 창은 '화면 전체' 를 담을 때만 영상에 들어간다. 창·탭을 고르면 영상 안에 합쳐야 한다.
  // 찍는 동안 내 모습은 어느 방식이든 보여 준다(사용자 요청). 영상에 합치는 것만 갈린다.
  assert.match(rec, /cameraOnScreen = want\.camera;/);
  assert.match(rec, /cameraInVideo = want\.camera && !\(appCam && wholeScreen\)/);
  assert.match(rec, /const wholeScreen = want\.mode === 'desktop' && surface === 'monitor'/);
  assert.match(rec, /getSettings\(\)\.displaySurface/);
  // 모니터 이름은 '화면 전체' 를 담을 때만 보낸다(그때만 어느 모니터인지가 영상에 영향을 준다).
  assert.match(rec, /display: wholeScreen \? capturedDisplay : ''/);
  // 앱은 모니터를 지정받았을 때만(= 화면 전체) 자리를 못 가리면 물러난다.
  assert.match(readFileSync('presenter/macos/Presenter.swift', 'utf8'),
    /if !recordDisplay\.isEmpty && NSScreen\.screens\.count > 1 && onScreen == nil/);
  assert.match(readFileSync('presenter/windows/Presenter.cs', 'utf8'),
    /if\(!string\.IsNullOrEmpty\(recordDisplay\)&&Screen\.AllScreens\.Length>1&&onScreen==null\)/);
  // 윈도우: 확장도 같은 카메라를 열 때가 있다(탭·창 녹화). 혼자 쓰기가 막히면 같이 읽기로 다시.
  assert.match(readFileSync('presenter/windows/Presenter.cs', 'utf8'),
    /MediaCaptureSharingMode\.SharedReadOnly/);
  assert.match(rec, /const video = \(cam \|\| \(want\.mode === 'area' && want\.rect\)\)/);
  // 영상 안 동그라미는 그대로 남아 있어야 한다(물러날 자리다). 어느 캔버스에 그릴지는
  // 받아서 쓴다 — 옛 Chrome 경로에서 엉뚱한 캔버스에 그려 영상에 안 담겼다(윈도우 세션 지적).
  assert.match(rec, /const paintFace = \(into = c\) =>/);
  assert.match(rec, /into\.arc\(x \+ d \/ 2, y \+ d \/ 2, d \/ 2, 0, Math\.PI \* 2\); into\.clip\(\)/);
  assert.match(rec, /paintFace\(sc\);/, '내보내는 캔버스에 그린다');
  // 앱까지 가는 길: 이름 목록이 세 곳에 따로 있다. 하나라도 빠지면 앱은 못 듣는다(v0.29.0 교훈).
  assert.match(readFileSync('extension/background.js', 'utf8'), /cameraView:m\.cameraView\?'1':'0',cameraName:String\(m\.cameraName\|\|''\)/);
  assert.match(readFileSync('presenter/windows/Presenter.cs', 'utf8'), /"action","time","paused","camera","cameraView","cameraName"/);
  const swift = readFileSync('presenter/macos/Presenter.swift', 'utf8');
  assert.match(swift, /if wanted=="1" \{ openCamera/);
  // 카메라 창은 표시기와 반대로 화면 녹화에 담겨야 한다(sharingType 을 건드리지 않는다).
  const panel = swift.slice(swift.indexOf('final class CameraPanel'), swift.indexOf('final class Presenter'));
  assert.doesNotMatch(panel, /sharingType/);
  assert.match(panel, /cornerRadius=side\/2/);
  // 카메라를 쓰려면 Info.plist 에 쓰는 까닭이 있어야 한다(없으면 앱이 그 자리에서 죽는다).
  assert.match(readFileSync('presenter/macos/build.sh', 'utf8'), /NSCameraUsageDescription/);
});

// 표시기에 보내는 모든 알림이 cameraView 를 달고 가야 한다. 빠뜨리면 앱이 '카메라 꺼짐'
// 으로 읽고 띄운 동그란 창을 1초 만에 닫는다(v0.33.0 에서 실제로 그랬다).
test('카메라 창 표시는 모든 표시기 알림에 함께 간다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  const calls = rec.match(/badge\('(show|update)'[^;]*\)/g) || [];
  assert.ok(calls.length >= 2, '알림을 보내는 자리가 둘 이상');
  for (const call of calls) assert.match(call, /cameraView:/, call);
  // 앱 쪽은 값이 없는 알림에 창을 건드리지 않는다.
  assert.match(readFileSync('presenter/macos/Presenter.swift', 'utf8'), /if let wanted=info\["cameraView"\]/);
  assert.match(readFileSync('presenter/windows/Presenter.cs', 'utf8'), /if\(cameraView=="1"\)OpenCamera\(cameraName\);else if\(cameraView!=null\)CloseCamera\(\)/);
});

// 따로 띄운 도크 창에서 부르면 '마지막 초점 창' 이 그 팝업이라 탭을 못 찾았다(사용자 보고).
test('도크 창에서 불러도 찍을 탭을 찾는다', () => {
  const core = readFileSync('extension/capture-core.js', 'utf8');
  assert.match(core, /chrome\.tabs\.query\(\{active: true, windowType: 'normal'\}\)/);
  assert.match(core, /lastNormalWindow/);
  assert.match(readFileSync('extension/background.js', 'utf8'), /chrome\.windows\.onFocusChanged\.addListener/);
});

// 도크의 ☰ 는 사이드바를 다시 여는 단추다. 팝업이라 '마지막 초점 창' 이 도크 자신이어서
// 늘 실패하고 안내만 띄웠다(사용자 보고).
test('도크의 ☰ 는 보통 창을 찾아 사이드바를 연다', () => {
  const dock = readFileSync('extension/dock.js', 'utf8');
  assert.match(dock, /async function browserWindow\(\)/);
  assert.match(dock, /chrome\.windows\.getAll\(\{windowTypes: \['normal'\]\}\)/);
  assert.match(dock, /await chrome\.sidePanel\.open\(\{windowId\}\)/);
  assert.doesNotMatch(dock, /lastFocusedWindow: true/, '도크에서는 쓸 수 없는 조건이다');
});

// 선택 영역은 브라우저 안에 갇히지 않아야 한다(다른 앱·다른 모니터).
test('도크와 캡처 탭에서 화면 전체를 끌어 고를 수 있다', () => {
  const panel = readFileSync('extension/panel.js', 'utf8');
  const html = readFileSync('extension/panel.html', 'utf8');
  assert.match(html, /id="cap-screen-area"/);
  assert.equal((panel.match(/action:'snip-save'/g) || []).length, 2, '캡처 탭과 도크 둘 다');
  assert.match(readFileSync('extension/dock.js', 'utf8'), /present\('snip-save'\)/);
});

// 잠시 뒤 찍을 때 화면 위에서도 세어 준다. 찍기 전에는 반드시 지운다.
test('잠시 뒤 캡처는 페이지 위에서 세고 찍기 전에 지운다', () => {
  const core = readFileSync('extension/capture-core.js', 'utf8');
  assert.match(core, /function countInPage\(left\)/);
  assert.match(core, /await inPage\(tab\.id, countInPage, left\)/);
  assert.match(core, /await inPage\(tab\.id, countInPage, 0\)/);
  assert.match(core, /await sleep\(240\);/);
});

// 3-2-1 의 '1' 과 초록 창이 첫 장면에 담기던 문제: 내리고 가라앉은 뒤에 녹화를 시작한다.
test('센 숫자와 녹화 창이 첫 장면에 담기지 않는다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  const order = rec.indexOf('await countdown();');
  const hide = rec.indexOf("state: 'minimized'", order);
  const begin = rec.indexOf('recorder.start(1000)', order);
  assert.ok(order > 0 && hide > order && begin > hide, '세기 → 내리기 → 시작 차례');
  assert.match(rec.slice(order, begin), /setTimeout\(resolve, away \? 420 : 280\)/);
});

// 녹화 창이 사라지면 표시기와 카메라 창도 사라져야 한다(화면에 그대로 남던 문제).
test('녹화 창이 닫히면 표시기·카메라 창을 내린다', () => {
  const back = readFileSync('extension/background.js', 'utf8');
  assert.match(back, /chrome\.windows\.onRemoved\.addListener/);
  assert.match(back, /recordWindow=made\.id\|\|0;/);
  assert.match(back, /port\.postMessage\(\{type:'recorder',action:'hide'\}\)/);
  assert.match(readFileSync('extension/record.js', 'utf8'), /addEventListener\('pagehide'[\s\S]{0,120}action: 'hide'/);
  // 확장이 말을 못 하고 죽어도 앱이 스스로 거둔다(12초 시계).
  assert.match(readFileSync('presenter/macos/Presenter.swift', 'utf8'), /Timer\(timeInterval:12,repeats:false\)/);
  // 윈도우는 뜻으로 본다: 녹화가 도는 동안의 기준은 12초, 'show' 뒤 첫 소식까지는 그보다 길게.
  // 그 공백은 윈도우 실측으로 appCameraUp() 최악 12.4초 + 카운트다운 최대 10초 + 0.42초(≈22.8초)다.
  // 12초로 두면 녹화가 막 시작되는 순간 표시기·카메라 창을 거둬 녹화본에 카메라가 안 담긴다(v0.36.6).
  const win = readFileSync('presenter/windows/Presenter.cs', 'utf8');
  const start = win.indexOf('badgeWatch.Start();');
  const watch = win.slice(win.lastIndexOf('badgeWatch=new', start), start);
  const intervals = [...watch.matchAll(/Interval\s*=\s*(\d+)/g)].map(match => Number(match[1]));
  assert.ok(intervals.includes(12000), `녹화 중 기준이 12초가 아니다: ${intervals}`);
  const first = Math.max(...intervals);
  assert.ok(first >= 23000 && first <= 60000, `첫 소식까지의 시계가 실측 공백(≈22.8초)을 덮지 못하거나 너무 길다: ${first}ms`);
  assert.match(watch, /"show"[^;]*Interval\s*=\s*\d+/, "긴 시계는 'show' 에만 쓴다");
  assert.match(watch, /Tick[\s\S]*badge\.Close\(\)[\s\S]*CloseCamera\(\)/, '시계가 울리면 표시기와 카메라 창을 거둔다');
});

// 카메라·표시기는 '녹화 중인 그 모니터' 에 뜬다. 확장이 화면 이름과 픽셀 크기를 알려 준다.
test('녹화 중인 모니터를 찾아 카메라·표시기를 띄운다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  // 줄이기(applyConstraints) 전에 원래 크기를 적어야 모니터를 알아볼 수 있다.
  const mark = rec.indexOf('capturedDisplay = ');
  const shrink = rec.indexOf('applyConstraints', mark);
  assert.ok(mark > 0 && shrink > mark, '크기를 먼저 적고 나서 줄인다');
  assert.match(rec, /display: capturedDisplay/);
  // 앱까지 가는 길 세 곳
  assert.match(readFileSync('extension/background.js', 'utf8'), /display:String\(m\.display\|\|''\)/);
  assert.match(readFileSync('presenter/windows/Presenter.cs', 'utf8'), /"cameraView","cameraName","display"/);
  const swift = readFileSync('presenter/macos/Presenter.swift', 'utf8');
  assert.match(swift, /func screenForCapture\(_ text: String\) -> NSScreen\?/);
  assert.match(swift, /place\(on:screenForCapture\(recordDisplay\)\)/);
  assert.match(readFileSync('presenter/windows/Presenter.cs', 'utf8'), /public static Screen ScreenForCapture\(string text\)/);
});

// 표시기와 카메라 창은 지금 쓰는(녹화하는) 모니터에 뜬다.
test('표시기와 카메라 창은 쓰고 있는 모니터에 뜬다', () => {
  const swift = readFileSync('presenter/macos/Presenter.swift', 'utf8');
  const cs = readFileSync('presenter/windows/Presenter.cs', 'utf8');
  assert.match(swift, /func screenInUse\(\) -> NSScreen\?/);
  assert.doesNotMatch(swift, /guard let screen=NSScreen\.main else \{ return \}\n\s*let saved=UserDefaults/);
  assert.equal((cs.match(/\(wanted\?\?Screen\.FromPoint\(Cursor\.Position\)\)\.WorkingArea/g) || []).length, 2,
    '표시기와 카메라 창 둘 다: 녹화 중인 모니터 → 없으면 마우스가 있는 모니터');
});

// 고르기 창이 뜨지도 않고 곧바로 돌아오면 다른 길로 한 번 더 띄운다. 창은 미리 앞으로.
test('첫 고르기가 헛돌면 확장 고르기 창으로 한 번 더 띄운다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  assert.match(rec, /if \(Date\.now\(\) - began > 2500\) throw error;/);
  assert.match(rec, /const picked = await choose\(want\.sound \? \['screen', 'window', 'tab', 'audio'\]/);
  assert.match(rec, /focusMe\(\)\.then\(\(\) => \$\('retry'\)\.focus\(\)\)/);
  // 고르기 창은 이 창 안쪽에 그려진다. 작으면 고를 것이 하나도 안 보인다(사용자 보고).
  assert.match(rec, /async function roomForPicker\(\)/);
  assert.match(rec, /async function backToBar\(\)/);
  assert.match(rec, /if \(want\.mode === 'desktop'\) await roomForPicker\(\);/);
  assert.match(readFileSync('extension/background.js', 'utf8'), /width:big\?860:400,height:big\?660/);
});

// 윈도우 앱이 자기 버전을 옳게 말해야 한다. InformationalVersion 이 0.31.0 에 박혀 있어
// 0.34.0 을 깔고도 트레이·state.json·점검표가 모두 0.31.0 이라고 했다(윈도우 세션이 찾음).
test('윈도우 버전 표시는 <Version> 을 따라가고, 클릭 통과는 투명도 변경에 살아남는다', () => {
  const proj = readFileSync('presenter/windows/Presenter.csproj', 'utf8');
  const version = proj.match(/<Version>([^<]+)<\/Version>/)[1];
  assert.doesNotMatch(proj, /<InformationalVersion>/, '고정값을 두면 또 멈춘다');
  assert.match(proj, new RegExp('<FileVersion>' + version.replace(/\./g, '\\.') + '\\.0</FileVersion>'));
  const cs = readFileSync('presenter/windows/Presenter.cs', 'utf8');
  assert.match(cs, /public static string Ver \{get\{return VerOf\(SelfInfo\);\}\}/);
  assert.doesNotMatch(cs, /version=Application\.ProductVersion/, 'state.json 은 FileVersion 을 쓴다');
  // WinForms 는 Opacity 를 바꿀 때 ExStyle 을 CreateParams 값으로 다시 쓴다.
  assert.match(cs, /protected override CreateParams CreateParams \{[\s\S]{0,140}if\(through\)p\.ExStyle\|=0x20;/);
});

// 디스플레이가 바뀌었다는 모달 알림이 발표 중이 아닐 때도 떠서 일을 막았다(윈도우).
test('윈도우 디스플레이 알림은 발표 중일 때만, 막지 않는 알림으로', () => {
  const cs = readFileSync('presenter/windows/Presenter.cs', 'utf8');
  const body = cs.slice(cs.indexOf('void DisplayChanged('), cs.indexOf('void DisplayChanged(') + 400);
  assert.doesNotMatch(body, /MessageBox\.Show/);
  assert.match(body, /if\(!active\)return;/);
  assert.match(body, /Tell\("디스플레이가 바뀌어/);
});

// 합쳐 담는 화면 크기는 '첫 장' 을 보고 정한다. 트랙에 물어보면(getSettings) 탭 캡처처럼
// 크기를 모른다고 답하는 경우가 있고, 그때 예전 코드는 OffscreenCanvas 를 만들다 죽어
// 녹화가 시작조차 되지 않았다(사용자 보고: '이 탭' + 카메라).
test('합쳐 담을 크기는 첫 장을 보고 정한다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  const body = rec.slice(rec.indexOf('async function composed('), rec.indexOf('// ── 소리 섞기'));
  assert.match(body, /sourceW = first\.displayWidth \|\| sourceW/);
  assert.match(body, /if \(!sourceW \|\| !sourceH\) \{ const \[w, h\] = SIZES/);
  // 크기를 정한 뒤에 캔버스를 만든다(그 전에 만들면 죽는다).
  assert.ok(body.indexOf('const canvas = new OffscreenCanvas(width, height)') > body.indexOf('if (!sourceW || !sourceH)'));
  // 첫 장을 버리지 않고 그려 넣는다.
  assert.match(body, /let frame = first;/);
});

// Chrome 이 보호하는 페이지(새 탭·설정·확장 프로그램·웹 스토어)에서는 '이 탭'·'선택 영역'
// 녹화가 될 수 없다. 예전에는 사이드바가 그냥 닫히고 아무 일도 안 일어났다(사용자 보고).
test('보호된 페이지에서는 이 탭·선택 영역 녹화를 막고 까닭을 알린다', () => {
  const core = readFileSync('extension/capture-core.js', 'utf8');
  assert.match(core, /export async function targetTab\(\{strict = false\} = \{\}\)/);
  assert.match(core, /throw new Error\('CHROME_PAGE'\)/);
  // 앞에 있는 것이 우리 확장 페이지면 같은 창의 최근 웹페이지를 쓴다(그건 '이 탭' 이 아니다).
  assert.match(core, /chrome\.tabs\.query\(\{windowId: tab\.windowId, url: \['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]\}\)/);
  const back = readFileSync('extension/background.js', 'utf8');
  assert.match(back, /function recordWhy\(error\)/);
  assert.match(back, /if\(m\.type==='record-check'\)/);
  assert.match(back, /tell\('녹화하지 못했습니다',why\)/);
  assert.match(back, /targetTab\(\{strict:true\}\)/);
  // 사이드바는 닫기 전에 미리 물어본다 — 닫아 버리면 까닭을 보여 줄 곳이 없다.
  const panel = readFileSync('extension/panel.js', 'utf8');
  assert.match(panel, /api\('record-check',\{mode:recOptions\.mode\}\)/);
  assert.ok(panel.indexOf("'record-check'") < panel.indexOf("type:'record-open'"), '묻고 나서 연다');
});

// 선택 영역 녹화는 카메라를 쓰지 않는다(사용자 요청). 세 곳에서 막는다.
test('선택 영역에서는 카메라를 쓰지 않는다', () => {
  assert.match(readFileSync('extension/record.js', 'utf8'),
    /camera: ask\.get\('camera'\) === 'true' && ask\.get\('mode'\) !== 'area'/);
  const panel = readFileSync('extension/panel.js', 'utf8');
  assert.match(panel, /noCam=recOptions\.mode==='area'/);
  assert.match(panel, /\$\('rec-cam'\)\.disabled=camOnly\|\|noCam/);
  assert.match(panel, /if\(mode==='area'\)options\.camera=false/);
});

// 전체 화면 고르기는 사용자가 누른 그 손길에서만 열린다(빈 목록·취소로 돌아오던 문제).
test('전체 화면은 단추를 누른 손길로 getDisplayMedia 를 부른다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  assert.match(rec, /navigator\.mediaDevices\.getDisplayMedia/);
  assert.match(rec, /selfBrowserSurface: 'exclude'/);
  assert.match(rec, /if \(want\.mode === 'desktop'\) \{[\s\S]*\$\('fix'\)\.hidden = false;/);
  assert.match(rec, /\$\('retry'\)\?\.addEventListener\('click', \(\) => start\(true\)\)/);
  assert.match(rec, /if \(!fromClick\) await focusMe\(\)/);
});

// 클릭 통과 핀 위에서 휠 = 투명도. 통과 핀은 마우스를 받지 않으니 앱이 가로채야 한다.
test('클릭 통과 핀 위에서는 앱이 휠을 가로채 투명도를 바꾼다', () => {
  const swift = readFileSync('presenter/macos/Presenter.swift', 'utf8');
  const cs = readFileSync('presenter/windows/Presenter.cs', 'utf8');
  assert.match(swift, /func syncWheelTap\(\)/);
  assert.match(swift, /\$0\.through && \$0\.isVisible && \$0\.frame\.contains\(point\)/);
  assert.match(swift, /pin\.setShade\(pin\.shade\+\(raw>0 \? 0\.06 : -0\.06\)\)/);
  assert.match(cs, /public void SyncWheelHook\(\)/);
  assert.match(cs, /target\.NudgeShade\(by\)/);
  // 굴린 휠을 아래 앱으로 흘려보내면 페이지까지 함께 스크롤된다. 삼켜야 한다.
  assert.match(swift, /\/\/ 아래 앱으로는 넘기지 않는다[\s\S]{0,80}return nil/);
  assert.match(cs, /return new IntPtr\(1\);    \/\/ 아래 앱으로 내려보내지 않는다/);
});

// 고르기 창이 초점 때문에 취소되던 문제: 창이 초점을 잡은 뒤에 띄운다.
test('녹화 창은 초점을 잡은 뒤에 화면 고르기를 띄운다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  assert.match(rec, /async function focusMe\(\)/);
  assert.match(rec, /if \(!fromClick\) await focusMe\(\);\r?\n\s*if \(want\.mode === 'desktop'\) await roomForPicker\(\);\r?\n\s*screen = await getScreen\(\)/);
  assert.match(readFileSync('extension/background.js', 'utf8'), /away=await sidePanelAway\(\); await new Promise/);
});

// 녹화가 시작되면 이 창은 내린다(표시기가 떴을 때). 숨은 창은 타이머가 느려지므로
// 시계는 녹화기가 1초마다 주는 조각 이벤트로도 민다.
test('녹화가 시작되면 녹화 창을 내리고 시계는 조각 이벤트로도 돈다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  assert.match(rec, /const onBadge = await badge\('show'/);
  assert.match(rec, /\(onBadge \|\| !want\.controlBar\) && !drawing\?\.visibleOnly/);
  assert.match(rec, /chunks\.push\(e\.data\); if \(started\) tick\(\)/);
});

// 도크가 두 줄로 내려가며 가운데가 비던 문제: 단추를 하나 빼고 밀어내기를 없앴다.
test('사이드바 도크는 한 줄에 들어간다', () => {
  const html = readFileSync('extension/panel.html', 'utf8');
  const css = readFileSync('extension/panel.css', 'utf8');
  assert.doesNotMatch(html, /id="dock-clip"/);
  assert.doesNotMatch(css, /\.dock-cap\{[^}]*margin-left:auto/);
  assert.doesNotMatch(css, /\.dock-side\{margin-left:auto\}/);
  const buttons = (html.match(/class="dockbtn"/g) || []).length;
  assert.ok(buttons * 26 + 30 <= 330, '사이드바 최소 너비에 들어간다: ' + buttons + '개');
});

// 따로 띄운 도크는 단추 줄 하나뿐이다(알림줄·자리 고르는 줄 없음). 자리는 사용자가 옮긴다.
test('따로 띄운 도크는 단추 줄 하나이고 처음에는 위쪽 가운데에 뜬다', () => {
  const dock = readFileSync('extension/dock.js', 'utf8');
  const html = readFileSync('extension/dock.html', 'utf8');
  assert.doesNotMatch(html, /class="where"/, '자리 고르는 줄은 없앴다');
  assert.equal((html.match(/class="btn"/g) || []).length, 11);
  // 창 안쪽을 재서 바깥 크기를 맞춘다(제목 표시줄 두께가 Chrome 마다 달라 단추 줄이 잘렸다).
  assert.match(dock, /const INSIDE = \{width: 404, height: 40\}/);
  assert.match(dock, /async function fit\(\)/);
  assert.match(dock, /screen\.availWidth - DOCK_SIZE\.width\) \/ 2/);
  assert.match(dock, /dockSpot: \{left: me\.left, top: me\.top\}/);
});

// 도크의 ‘선택 영역’ 은 화면 전체에서 고른다(다른 앱·다른 모니터). 앱이 없으면 탭에서 고른다.
test('도크의 선택 영역은 앱의 화면 조각 저장으로 가고, 앱이 없으면 탭 캡처로 물러난다', () => {
  const dock = readFileSync('extension/dock.js', 'utf8');
  assert.match(dock, /present\('snip-save'\)/);
  assert.match(dock, /catch \{ await api\('capture', \{mode: 'area', after: 'both', notify: true\}\); \}/);
  assert.match(dock, /mode: 'full', after: 'both', notify: true/);
  for (const file of ['presenter/macos/Presenter.swift', 'presenter/windows/Presenter.cs'])
    assert.match(readFileSync(file, 'utf8'), /"snip-save"/, file + ' 도 그 명령을 알아야 한다');
});

test('녹화 표시기는 발표 도우미가 그리고, 화면 녹화에서 빠진다', () => {
  const swift = readFileSync('presenter/macos/Presenter.swift', 'utf8');
  const cs = readFileSync('presenter/windows/Presenter.cs', 'utf8');
  assert.match(swift, /sharingType = \.none/);          // macOS: 화면 공유에서 제외
  assert.match(cs, /WDA_EXCLUDEFROMCAPTURE|ExcludeFromCapture=0x00000011/);  // Windows: 같은 뜻
  assert.match(swift, /isMovableByWindowBackground=true/);  // 끌어서 옮기기
  assert.match(cs, /WM_NCLBUTTONDOWN|0xA1/);
});
