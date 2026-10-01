# 윈도우 작업 인수인계 — 맥 Claude Code → 윈도우 Claude Code

갱신: 2026-09-24 · 기준 버전 **v0.37.0** · 작성자: 맥 쪽 세션
읽는 순서: `AGENTS.md` → `docs/ai/PROJECT.md` → `docs/ai/HANDOFF.md` → **이 문서** → (필요할 때) `docs/ai/VALIDATION.md`
새 컴퓨터에서 처음 시작한다면 먼저 **[WINDOWS_START.md](WINDOWS_START.md)**(설치·시작 명령서)를 읽는다. 규칙과 계약은 이 문서가 기준이다.

## 0. 한 장 요약

- **다있쌤** = Chrome 확장(사이드바·캡처·녹화) + 네이티브 앱(맥 Swift / 윈도우 C#) 한 쌍이다. 서버도 계정도 없고 자료는 이 컴퓨터 밖으로 나가지 않는다.
- 확장 코드는 **맥·윈도우가 그대로 함께 쓴다.** 운영체제별로 다른 것은 네이티브 앱뿐이다.
- 윈도우 쪽에서 맡을 일: **`presenter/windows/Presenter.cs`** (앱 + 네이티브 도우미가 한 파일에 있다)와 `*.cmd`.
- 지금 문제: **윈도우에서 캡처 기능이 대부분 안 된다.** 무엇이 어디서 끊기는지 실기기에서 확인해야 한다(맥에는 윈도우 런타임이 없어 빌드만 된다).
- 주고받는 곳은 **GitHub 저장소 하나**다(3장). 같은 파일을 양쪽이 고치면 충돌하니 소유 규칙을 반드시 지킬 것.

## 1. 폴더와 소유권

| 경로 | 무엇 | 누가 고치나 |
|---|---|---|
| `extension/**` | Chrome 확장(공용) | **맥 세션이 소유.** 윈도우 세션은 고치기 전에 먼저 알리고, 고쳤으면 바뀐 파일 전체를 돌려준다 |
| `presenter/windows/Presenter.cs` | 윈도우 앱 + 네이티브 도우미(한 파일, 약 2,300줄) | **윈도우 세션이 소유** |
| `presenter/windows/*.cmd`, `Presenter.csproj` | 설치·점검·빌드 | 윈도우 세션 |
| `presenter/macos/**` | 맥 앱 | 맥 세션 |
| `tests/**`, `scripts/**` | 노드 시험·검사·포장 | 맥 세션(윈도우에서 `npm test`는 돌려도 된다) |
| `docs/ai/**` | 인수인계·검증 기록 | 각자 자기 절만. **이 문서는 맥 세션이 갱신한다** |
| `dist/**` | 빌드 결과·배포본 | **맥 세션만.** 윈도우 세션은 `dist/windows/Presenter.exe` 까지만 만든다 |

## 2. 무엇이 어떻게 이어져 있나

```
Chrome 확장(사이드바·녹화 창·도크)
   │  chrome.runtime.sendNativeMessage / connectNative   (4바이트 길이 + UTF-8 JSON)
   ▼
네이티브 도우미  = Presenter.exe 를 Chrome 이 띄운 프로세스   ← Presenter.cs 의 NativeHost 부분
   │  파일 + 이벤트(EventWaitHandle)로 신호                    (맥은 DistributedNotification)
   ▼
발표 도우미 앱  = 트레이에 떠 있는 Presenter.exe              ← Presenter.cs 의 Presenter 부분
```

- 도우미와 앱은 **같은 exe 의 다른 프로세스**다. 도우미는 명령을 `%LOCALAPPDATA%\BrowserSheriff\command.json`(녹화는 `recorder.json`)에 적고 이벤트를 켠다. 앱은 깨어나 그 파일을 읽고 지운다.
- 앱은 자기 상태를 `%LOCALAPPDATA%\BrowserSheriff\state.json` 에 쓴다. 도우미가 그것을 읽어 확장에 돌려준다.
- 이벤트 이름: `Local\BrowserSheriffPresenterCommand`, `Local\BrowserSheriffRecorder`, (활성화용 하나 더).

## 3. 협업 규칙 — 브랜치로 주고받는다

저장소: **https://github.com/janghwansangai/daissam-toolkit** (비공개)

| 브랜치 | 누구 것 | 무엇 |
|---|---|---|
| `main` | 맥 세션 | 기준. 확장·맥 앱·버전·배포본이 여기서 정해진다 |
| `windows` | **윈도우 세션** | 윈도우 작업은 전부 여기서. `main` 에 직접 올리지 않는다 |

```bat
git clone https://github.com/janghwansangai/daissam-toolkit.git
cd daissam-toolkit
git checkout windows
git pull origin main        :: 맥 쪽 최신을 먼저 받아 온다(작업 시작 때마다)
```

작업이 끝나면:

```bat
git add presenter/windows
git commit -m "윈도우: (무엇을 고쳤는지 한 줄)"
git push origin windows
gh pr create --base main --head windows --title "윈도우: ..." --body "(9장 형식으로)"
```

1. **`presenter/windows/**` 와 `*.cmd` 만 커밋한다.** 다른 폴더가 `git status` 에 잡히면 커밋하지 말고 그대로 두거나 알린다.
2. 공용 파일(`extension/**`)을 꼭 고쳐야 하면 **고치지 말고 PR 본문에 적는다**: 어느 파일 몇 줄을 왜 어떻게. 맥 세션이 `main` 에서 반영한다.
3. **`main` 으로 직접 push 하지 않는다.** 합치는 것은 맥 세션이 PR 을 보고 한다.
4. 충돌이 나면 혼자 풀지 말고 어떤 파일이 겹쳤는지 알린다(같은 파일을 양쪽이 고친 것이므로 규칙이 깨진 것이다).
5. 버전 번호(`package.json`·`manifest.json`·`Presenter.csproj`·`build.sh` 의 plist)는 **맥 세션만** 올린다.
   v0.35.1 부터 `Presenter.csproj` 에 `<InformationalVersion>` 을 두지 않는다 — 0.31.0 에 박힌 채 남아 `Application.ProductVersion` 이 계속 0.31.0 을 돌려주고 있었다(윈도우 세션이 찾아냈다). 이제 `<Version>` 을 따라간다.
6. 작업 단위가 끝나면 `docs/ai/HANDOFF.md` 의 **윈도우 절**만 갱신해 함께 커밋한다.

## 4. 절대 바꾸면 안 되는 것 (계약)

### 식별자
| 이름 | 값 |
|---|---|
| 확장 ID | `ehgodopakibamgeopmelemjmjdjhbdgm` |
| 네이티브 도우미 이름 | `app.browsersheriff.presenter` |
| 레지스트리 | `HKCU\Software\Google\Chrome\NativeMessagingHosts\app.browsersheriff.presenter` |
| 설치 폴더 | `%LOCALAPPDATA%\BrowserSheriff\` (Presenter.exe · native-host.json · state.json · command.json) |
| 캡처 저장 폴더 | 바탕화면 아래 **`캡처이미지`** |
| URL 스킴 | `browsersheriff://` |

하나라도 바꾸면 이미 깔린 확장이 앱을 찾지 못한다.

### 네이티브 메시지 (확장 → 도우미 → 앱)

| 보내는 것 | 필드 | 도우미가 돌려주는 것 |
|---|---|---|
| `presenter` | `action`(start·stop·focus-on·focus-off·snip·**snip-save**·pin-clip·pins-clear·pins-unlock·pins-through·state) · `dim` `blur` `ring` `ringSize` `keys` | `{kind:"presenter", ok, launched, running, keys, presenting, focus, pins, through, **camera**}` |
| `recorder` | `action`(show·update·hide) · `time` · `paused` · `camera` · **`cameraView`** · **`cameraName`** · **`display`**(`"<크롬이 부르는 이름>\|<가로>x<세로>"` — 녹화 중인 모니터를 가리는 데 쓴다) | `{kind:"recorder", ok}` |
| `recorder-watch` | — | `{kind:"recorder", watching:true}` 그 뒤 단추마다 `{kind:"recorder", button:"pause"|"stop"|"cancel"}` |
| `shot` | `image`(base64) · `save` · `copy` · `ext`(png·jpg) | `{kind:"shot", ok, path, copied}` |
| `ocr` | `image`(base64) | `{kind:"ocr", ok, text}` |
| `screen-settings` | — | `{kind:"screen-settings", ok, message}` (윈도우는 할 일 없음) |
| `guest` | — | `{kind:"guest", ok}` |
| 모르는 것 | — | `{kind:"unknown", ok:false, message}` |

**규칙 두 가지.**
- **어떤 명령에도 반드시 답한다.** 답이 없으면 확장이 그 자리에서 영원히 기다린다(예전에 실제로 멈췄다).
- **이름 목록이 세 곳에 따로 있다.** ① 확장 `background.js` 의 `for(const key of ['action','dim','blur','ring','ringSize','keys'])` ② 같은 파일 `recorder-badge` 의 `port.postMessage({...})` ③ 윈도우 `Presenter.cs` 의 `Recorder()` 안 `foreach(string key in new[]{...})` 와 `Forward()`. **새 값을 앱까지 보낼 때 셋 다 고쳐야 한다.** v0.29.0 에서 `keys` 를 ③에서 빠뜨려 “바꾼 단축키가 윈도우에서만 안 듣는” 버그가 났다.

### state.json 이 담아야 하는 키
`presenting` `focus` `pins` `through` `hotkeys` `keys` `badge` **`camera`** `version` `started`
→ 확장 사이드바와 녹화 창이 이 값을 읽는다. 특히 **`camera`** 는 “동그란 카메라 창을 정말 띄웠는가” 이고, 확장은 이 값이 2.6초 안에 `true` 가 되지 않으면 **영상 안에 카메라를 합쳐 넣는 쪽으로 물러난다.** (둘 다 나오면 카메라가 두 개로 보인다.)

## 5. 윈도우에서 빌드·설치·점검

```bat
cd presenter\windows
dotnet publish Presenter.csproj -c Release -v q -nologo
copy /Y bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\Presenter.exe ..\..\dist\windows\Presenter.exe
```
- .NET 8 SDK 필요. 대상이 `net8.0-windows10.0.19041.0` 인 까닭은 **Windows.Media.Ocr**(글자 인식)과 **Windows.Media.Capture**(카메라) 때문이다. 이 대상을 낮추지 말 것.
- 설치: `dist\windows` 로 복사한 뒤 그 폴더에서 **`Install.cmd`** (앱을 `%LOCALAPPDATA%\BrowserSheriff\` 로 복사하고 레지스트리에 등록한다).
- 점검: **`Check.cmd`** (= `Presenter.exe --check`). 설치 위치·버전 일치·레지스트리·확장 번호·앱 실행 여부·state.json 을 한 번에 보여 준다. **문제 보고 전에 이것부터 돌리고 결과를 붙일 것.**
- 확장은 `extension/` 폴더를 Chrome 의 `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램을 로드**로 올린다. `manifest.json` 에 `key` 가 박혀 있어 **어느 컴퓨터에서 올려도 ID 가 같다**(그래서 도우미가 받는다). `key` 를 지우지 말 것.
- **서비스 워커는 캐시된다.** 확장 코드를 고쳤으면 `chrome://extensions` 에서 **새로고침**을 누르고, 그래도 옛 동작이면 Chrome 을 껐다 켠다.

## 6. 지금 고장 난 것 — 캡처 진단 순서

증상: “윈도우에서 캡처 기능이 대부분 작동하지 않는다.” 확장 → 도우미 → 앱 중 어디서 끊기는지부터 가른다.

1. **`Check.cmd` 결과**를 먼저 본다. ‘Chrome 등록’·‘확장 번호 일치’·‘설치된 앱이 최신인지’ 가 ✗ 면 거기서 끝. `Install.cmd` 후 Chrome 재시작.
2. **확장만으로 되는 캡처**인지 가른다. 사이드바 캡처 탭에서 **저장 방식을 ‘편집기로 열기’** 로 두고 찍어 본다.
   - 편집기(capture.html)가 뜨면 → 확장·Chrome 쪽은 멀쩡하고 **도우미(저장·복사)가 문제**다. 3으로.
   - 편집기도 안 뜨면 → 확장 쪽이다. `chrome://extensions` → 서비스 워커 → 콘솔의 오류를 그대로 적는다. (선언된 권한: `storage` `alarms` `idle` `declarativeNetRequest` `scripting` `clipboardWrite` `sidePanel` `nativeMessaging` `offscreen` `notifications` `desktopCapture` `tabCapture` + `host_permissions: <all_urls>`. 새 권한을 더하지 말 것.)
3. **도우미 저장·복사**(`shot`)를 본다. 저장 방식을 ‘폴더 저장 + 복사’ 로 바꾸고 찍은 뒤:
   - 바탕화면 `캡처이미지` 폴더가 생겼는지, 파일이 들어왔는지.
   - **바탕화면이 OneDrive 로 옮겨져 있으면** `Environment.SpecialFolder.DesktopDirectory` 가 OneDrive 경로를 준다. 쓰기가 막히거나 동기화가 지연될 수 있다 — 실제 경로를 로그로 찍어 확인할 것.
   - 그림이 크면(전체 페이지 캡처) 메시지가 커진다. 도우미 읽기 한도는 96MB 로 올려 뒀다(`Presenter.cs` 의 읽기 부분). Chrome 쪽 한 통의 한도는 별개이니 큰 그림에서만 실패하는지 확인한다.
   - 클립보드: `Clipboard.SetDataObject(data,true)` 는 STA 스레드에서만 된다. 도우미 프로세스에서 이 조건이 깨지지 않았는지 본다.
4. **글자 뽑기(OCR)**가 안 되면 한국어 광학 문자 인식 언어팩이 필요하다(설정 → 시간 및 언어 → 언어 → 한국어 → 언어 옵션 → 광학 문자 인식). 없으면 도우미가 그 뜻을 답으로 돌려준다.
5. **영역 고르기(area)** 가 안 되면 페이지에 넣는 고르기 판(확장 쪽)이 문제다 — 브라우저 콘솔을 본다.

문제를 찾으면 **어느 단계에서 어떤 메시지와 함께 끊겼는지** 를 그대로 적어 돌려준다(추측 말고 실제 출력).

## 7. 윈도우에서 **한 번도 돌아간 적 없는 코드** (v0.33.0~v0.36.3) — 실기기 확인 필요

맥에서 컴파일만 확인했다. 이 표가 윈도우 세션의 확인 목록이다.

| 기능 | 코드 | 볼 것 |
|---|---|---|
| 동그란 카메라 창 | `CameraForm` (MediaCapture + MediaFrameReader) | 녹화 시작에 창이 뜨는지 · 첫 그림이 2.2초 안에 오는지(늦으면 스스로 포기한다) · 화면 녹화 영상에 **담기는지**(`SetWindowDisplayAffinity` 를 걸지 않았다) · 끌어서 옮겨지는지. 카메라를 못 열면 **아무 창도 띄우지 말 것**(확장이 영상 안에 합친다) |
| 카메라 창 열고 닫기 | `TakeRecorder` 의 `cameraView` | `cameraView` 가 **없는** 알림(1초마다 오는 시간 갱신)에는 창을 건드리면 안 된다. 맥에서 이걸 빠뜨려 창이 1초 만에 사라졌다 |
| 녹화 중인 모니터 고르기 | `ScreenForCapture` | 확장이 준 `display` 로 그 모니터를 찾는다(픽셀 크기 → 같은 크기가 여럿이면 마우스 쪽 → 이름 속 번호). 표시기·카메라 창이 **녹화 중인 모니터**에 떠야 한다 |
| 못 가렸을 때 | `OpenCamera` 앞머리 | 모니터가 여럿인데 못 가리면 **카메라 창을 띄우지 않는다** → 확장이 영상 안에 합친다(어느 경우든 녹화본에 카메라가 남게) |
| 12초 시계 | `badgeWatch` · `StopBadgeWatch` | 녹화 창이 말없이 사라지면(창 닫기·크래시) 12초 안에 표시기·카메라 창이 스스로 사라져야 한다. 녹화가 도는 동안에는 절대 사라지지 않아야 한다 |
| 통과 핀 휠 투명도 | `SyncWheelHook` · `WheelHook` (WH_MOUSE_LL) | 통과 핀 **위에서만** 휠이 투명도를 바꾸고, 그 휠이 아래 앱으로 내려가지 않아야 한다. 통과 핀이 없으면 훅을 걸지 않는다 |
| 화면 조각 저장 | `BeginSnip(true)` → `SaveShot` | 도크의 ‘선택 영역 캡처’ 가 보내는 `snip-save`. **가상 화면 전체**(`SystemInformation.VirtualScreen`)를 덮어 다른 모니터 위의 앱도 고를 수 있어야 한다. 모니터마다 배율(DPI)이 다르면 좌표가 어긋날 수 있다 — 가장 미덥지 않은 부분 |
| 디스플레이 알림 | `DisplayChanged` | 발표 중일 때만 트레이 알림으로 알린다(예전에는 아무 때나 모달 대화상자가 떠서 일을 막았다) |

### 맥 세션이 v0.37.0 에서 처리한 것 (윈도우 세션 요청에 대한 답)

| 요청 | 어떻게 했나 |
|---|---|
| 조절값 디바운스 + 오래 여는 포트 | **둘 다 했다.** 사이드바는 120ms 모아 마지막 값만 보내고(`panel.js` `knobChanged`), 배경은 `presenterSay()` 로 **오래 여는 통로** 하나를 쓴다(`connectNative`, 20초 쉬면 닫음, 막히면 예전 방식으로 물러남). 맥에서 실측: 조절값 12건 **5,659ms → 11ms**, 도우미 프로세스 **1개**, 20초 뒤 0개 |
| `composed()` 옛 경로의 카메라 누락 | 고쳤다. `paintFace(into)` 가 **내보내는 캔버스**에 그리고, 헛되던 복사를 없앴다 |
| CRLF 때문에 실패하던 시험 2개 | 저장소에 `.gitattributes`(`* text=auto eol=lf`)를 두고, 그 정규식들도 `\r?\n` 으로 고쳤다(두 겹) |
| `appCameraUp()` 이 윈도우에서 12초 넘게 걸리는 문제 | 횟수가 아니라 **시계로** 잰다(2.6초). 윈도우에서 녹화 시작이 12초 늦던 것이 사라진다 |

### 윈도우 세션에 남기는 것 (다음 차례)

1. **조절값 즉시 응답**: `Forward()` 의 `StateStamp()` 기다림은 좋았지만, **조절값만 온 메시지(`action` 없음)는 앱이 상태 파일을 다시 쓰지 않는다** — 그래서 매번 400ms 한도를 다 쓴다. 맥에서는 그 경우 **곧바로 답하게** 고쳤다(`forward` 안 `if message["action"] == nil { reply(...); return }`). 윈도우도 같은 한 줄을 넣으면 조절값 지연이 사라진다.
2. **GDI 개체 누수**: `Region.FromHrgn(Native.CreateRoundRectRgn(...))` 3곳이 원본 HRGN 을 지우지 않는다(윈도우 세션이 PR 에서 지적). `Native` 에 `DeleteObject` 를 더해 정리할 것.
3. 7장 표에서 아직 미확인: **WheelHook · BeginSnip(true)/SaveShot · 가상 화면 스닙 · DisplayChanged · ScreenForCapture 의 다중 모니터**.
4. **캡처가 안 되는 문제**(6장)는 여전히 원인 미확정 — 저장 모드로 한 번 찍어 `바탕화면\캡처이미지` 가 만들어지는지부터.
5. **녹화가 파일로 끝난 적이 없다**는 보고: v0.37.0 에서 카메라 창 순환(윈도우 세션 수정) + `appCameraUp` 시간 제한(맥 세션 수정)이 함께 들어갔으니 **다시 시험**해 볼 것.

### 소유 규칙 — 맥 세션의 잘못

- v0.36.4·v0.36.5 에서 맥 세션이 `presenter/windows/Presenter.cs` 를 고쳤다(윈도우 세션 소유). 규칙 위반이 맞다. 앞으로 윈도우 파일은 요청으로만 넘긴다.
- v0.36.6 을 `windows` 브랜치에 직접 push 한 것도 잘못이다. 이제 맥 세션은 **`main` 에만 올린다.** 윈도우 세션은 `git pull origin main` 으로 받으면 된다.

### 맥에서 배운 것 — 윈도우에도 해당될 수 있는 함정
- **창을 화면에서 내리는 일은 확인해야 한다.** 맥은 `orderOut` 만으로는 남는 경우가 있어 `close()` 까지 부른다(v0.36.3). 윈도우에서도 `Hide()` 만으로 남지 않는지 실제 창 목록으로 확인할 것.
- **화면 녹화에서 창을 빼는 설정은 표시기에만.** 맥에서 오버레이·핀에 `sharingType=.none` 을 걸어 두어 **발표·집중·핀이 녹화 영상에 하나도 안 담겼다**(v0.36.3에서 고침). 윈도우의 `WDA_EXCLUDEFROMCAPTURE` 도 **표시기(BadgeForm)에만** 걸려 있어야 한다. 핀·카메라 창·발표 표시에는 걸지 말 것.

## 8. 하지 말 것

- `npm run package` 실행(배포본 만들기). **맥 세션만** 한다 — 서명된 맥 앱이 있어야 한다.
- 버전 번호 올리기, `dist/` 안의 파일 손대기, `docs/ai/VALIDATION.md` 의 남의 절 고치기.
- 확장에 새 권한 추가, 바깥으로 나가는 통신 추가(이 프로젝트에는 `fetch`·XHR·WebSocket 이 **하나도 없다**. 추가하지 말 것).
- 비밀값·사용자 이름·경로를 문서나 로그에 남기기.
- 큰 리팩터링. 지금은 **작동하지 않는 것을 작동하게** 만드는 일만 한다.

## 9. 보고 형식 (맥 세션에 돌려줄 때)

```
[무엇을 고쳤나]  파일 · 함수 · 줄 수 준으로
[왜]            어떤 증상이 어떤 원인으로 났는지(실제 출력 근거)
[어떻게 확인]    실기기에서 무엇을 눌러 무엇이 나왔는지
[남은 문제]      아직 안 되는 것, 재현 조건
[돌려줄 파일]    presenter/windows/Presenter.cs (전체)
[확장에 필요한 것] 있으면: 파일·줄·이유 (직접 고치지 말 것)
```

## v0.38.0 — 윈도우 세션에 요청: 확장 ID 두 개 허용

크롬 웹 스토어(비공개) 판의 확장 ID 는 `cgefngalkalghipmhijniclmlpimpmhf` 이다. 개발자 모드 판의 `ehgodopakibamgeopmelemjmjdjhbdgm` 도 계속 쓴다. 맥은 둘 다 받게 고쳤다(`NativeHost.extensionIDs`).
`presenter/windows/Presenter.cs` 에서 같은 일을 해 주세요(소유 규칙상 맥 세션이 직접 고치지 않는다):
1. `ExtensionID` 상수(약 2208행)를 두 ID 의 배열로.
2. 2504행 신뢰 확인: 인자가 둘 중 하나로 시작하면 통과.
3. 2607행 Check: 레지스트리 JSON 에 두 ID 가 모두 들어 있는지.
4. 2670행 `allowed_origins` 에 두 ID 를 모두 넣기.
시험: 두 ID 로 호스트가 뜨고, 다른 ID 는 거부되는지. 그 뒤 `Install.cmd` → `Check.cmd`.

## v0.39.3 — 윈도우 세션에 알림: 맥에서 실제로 난 충돌과, 윈도우에서 확인해 줄 것

**맥에서 실제로 4번 충돌했다(2026-09-24, v0.36.3~0.37.0).** Chrome 이 띄운 호스트(`NativeHost.run`)가 **이미 닫힌 stdout 통로에 쓰다가**
`NSFileHandle.write` 의 Objective-C 예외로 SIGABRT 했다. 녹화가 끝나 확장이 포트를 닫는 순간(`recorder-badge` 의 `hide` 뒤)
늦게 도착한 소식에 답하다가 났다. 맥은 `write(contentsOf:)` + `signal(SIGPIPE,SIG_IGN)` 로 고쳤고 `tests/host-pipe.test.mjs` 가 지킨다.

**윈도우 코드를 읽어 본 결과(맥 세션, 실행은 못 했다):** 같은 모양이다. `NativeHost.Send` 는 `output.Write(...)` 를 감싸지 않아 통로가 닫히면 `IOException`
을 던진다. 다행히 부르는 곳은 이미 막혀 있다 — `Handle()` 은 통째로 `try{...}catch{}`, `Poll()`·`PollRecorder()` 도 `Send` 를 `try` 안에서 부른다.
그래서 **지금 알려진 충돌은 없다.** 다만 아래 두 가지는 방어로 두는 편이 안전하다(소유 규칙상 맥 세션이 직접 고치지 않는다):

1. `Send` 자체를 `try/catch(IOException/ObjectDisposedException)` 로 감싸고, 한 번 실패하면 `closed=true` 로 더 쓰지 않게. 새 호출부가 생겨도 안전해진다.
2. 전역 예외 처리기가 하나도 없다(`Application.ThreadException`·`AppDomain.CurrentDomain.UnhandledException` 검색 결과 0건).
   WinForms 의 기본 동작은 처리되지 않은 예외에 **‘처리되지 않은 예외’ 대화상자**를 띄우는 것이다. 발표·집중·핀 중에 뜨면 크다.
   `Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException)` + 두 처리기에서 **대화상자 없이** 배율·커서·표시기·카메라 창을 되돌리고 로그만 남기기.

**윈도우에서 확인해 줄 것(재현):** `Presenter.exe chrome-extension://<확장ID>/` 를 stdin/stdout 파이프와 함께 띄우고, stdout 읽는 쪽을 먼저 닫은 뒤
stdin 에 `{"type":"recorder","action":"hide"}` 프레임(4바이트 길이 + JSON)을 보내 **종료 코드 0** 인지. 맥 시험(`tests/host-pipe.test.mjs`)과 같은 방법이다.

## v0.39.4 — 맥 세션이 PR #2 를 합친 결과와 다음 차례

PR #2 를 `main` 에 합쳤다(병합 커밋 `1fc098b`). 위의 **v0.38.0 요청(확장 ID 두 개)과 v0.39.3 요청(`Send` 방어 · 전역 예외 처리기)은 처리됨.** 근거와 실측이 정확해서 그대로 받았다.

맥 세션이 코드를 읽고 본 것: `RoundRegion` 의 `DeleteObject` 는 맞다(`Region.FromHrgn` 은 영역을 복사해 간다). `Run()` 의 `AutoResetEvent` 는 읽기 실이 끝날 때도 `Set` 하므로 끝내기 길이 막히지 않는다. 조절값 즉시 응답은 맥 v0.37.0 과 같은 규칙이다.

윈도우 세션이 맥에 남긴 세 가지:

| 요청 | 결과 |
|---|---|
| 버전 표기 | `Presenter.csproj` 를 `0.39.4` / `0.39.4.0` 으로. 앞으로 맥 세션이 네 곳을 함께 올린다(HANDOFF v0.39.4 규칙 ①). |
| `host-pipe` 시험을 윈도우에서도 | win32 이면 `dist/windows/Presenter.exe`(또는 `HOST_BIN`)로 돈다. 윈도우에는 SIGPIPE 가 없어 닫힌 통로 시험은 한 갈래다. **두 확장 ID 는 답하고 모르는 ID 에는 0바이트** 시험을 더했다(맥 설치본으로 4/4). |
| `capture.test.mjs` 의 12초 | 뜻으로 다시 썼다: 녹화 중 기준 `12000` 이 있고, `"show"` 에만 쓰는 긴 시계가 23~60초(실측 공백 ≈22.8초를 덮게), `Tick` 이 표시기 · 카메라 창을 거둔다. `30000` 을 `12000` 으로 되돌리면 실패하는 것을 확인했다. |

맥에서 한 확인: `presenter/windows/build.sh` 교차 빌드 성공, 새 `Presenter.exe` 안에 이번 코드가 들어 있음(스토어 ID · `error.log` · `0.39.4` 문자열, 새 `Presenter.dll` 이 그대로 포함). `npm test` 143/143. **윈도우에서 실행은 못 했다.**

윈도우 세션에 부탁(다음 차례):
1. 릴리스 v0.39.4 의 윈도우 ZIP(또는 `build.sh` 결과)으로 `npm test` — 이제 `host-pipe` 3건이 윈도우에서 돈다. 그 뒤 `Install.cmd` → `Check.cmd` 에 `0.39.4` 가 보이는지.
2. (작은 방어) `Guard` 의 `error.log` 에 크기 한도가 없다. `CatchException` 이라 앱이 계속 돌므로, 타이머 `Tick` 처럼 되풀이되는 자리에서 같은 예외가 나면 매번 스택을 덧붙여 파일이 끝없이 커질 수 있다. 예: 1MB 를 넘으면 `error.old.log` 로 돌리기, 또는 바로 앞과 같은 예외면 적지 않기.
