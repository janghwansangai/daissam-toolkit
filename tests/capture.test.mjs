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

// 카메라 동그라미: 전체 화면 녹화는 앱이 띄운 동그란 창이 화면에 보이고 녹화에도 담긴다.
// 앱이 못 띄우면(권한 없음·앱 없음) 확장이 영상 안에 합쳐 넣는다 — 둘 다 나오면 안 된다.
test('카메라 동그라미는 앱이 띄우고, 못 띄우면 영상 안에 합쳐 넣는다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  assert.equal(existsSync('extension/bubble.html'), false, '제목 표시줄 달린 네모 창은 없앴다');
  assert.doesNotMatch(rec, /bubbleMode|openBubble/);
  assert.match(rec, /async function appCameraUp\(\)/);
  assert.match(rec, /const wantsCameraView = \(\) => want\.camera && want\.mode === 'desktop'/);
  assert.match(rec, /const video = \(cam \|\| \(want\.mode === 'area' && want\.rect\)\)/);
  // 영상 안 동그라미는 그대로 남아 있어야 한다(물러날 자리다).
  assert.match(rec, /c\.arc\(x \+ d \/ 2, y \+ d \/ 2, d \/ 2, 0, Math\.PI \* 2\); c\.clip\(\)/);
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

// 고르기 창이 뜨지도 않고 곧바로 돌아오면 다른 길로 한 번 더 띄운다. 창은 미리 앞으로.
test('첫 고르기가 헛돌면 확장 고르기 창으로 한 번 더 띄운다', () => {
  const rec = readFileSync('extension/record.js', 'utf8');
  assert.match(rec, /if \(Date\.now\(\) - began > 2500\) throw error;/);
  assert.match(rec, /const picked = await choose\(want\.sound \? \['screen', 'window', 'tab', 'audio'\]/);
  assert.match(rec, /focusMe\(\)\.then\(\(\) => \$\('retry'\)\.focus\(\)\)/);
});

// 디스플레이가 바뀌었다는 모달 알림이 발표 중이 아닐 때도 떠서 일을 막았다(윈도우).
test('윈도우 디스플레이 알림은 발표 중일 때만, 막지 않는 알림으로', () => {
  const cs = readFileSync('presenter/windows/Presenter.cs', 'utf8');
  const body = cs.slice(cs.indexOf('void DisplayChanged('), cs.indexOf('void DisplayChanged(') + 400);
  assert.doesNotMatch(body, /MessageBox\.Show/);
  assert.match(body, /if\(!active\)return;/);
  assert.match(body, /Tell\("디스플레이가 바뀌어/);
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
  assert.match(rec, /await focusMe\(\);\n\s*screen = await getScreen\(\)/);
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
