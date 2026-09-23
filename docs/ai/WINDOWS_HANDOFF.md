# 윈도우 작업 인수인계 — 맥 Claude Code → 윈도우 Claude Code

작성: 2026-09-23 · 기준 버전 **v0.34.0** · 작성자: 맥 쪽 세션
읽는 순서: `AGENTS.md` → `docs/ai/PROJECT.md` → `docs/ai/HANDOFF.md` → **이 문서** → (필요할 때) `docs/ai/VALIDATION.md`

## 0. 한 장 요약

- **다있쌤** = Chrome 확장(사이드바·캡처·녹화) + 네이티브 앱(맥 Swift / 윈도우 C#) 한 쌍이다. 서버도 계정도 없고 자료는 이 컴퓨터 밖으로 나가지 않는다.
- 확장 코드는 **맥·윈도우가 그대로 함께 쓴다.** 운영체제별로 다른 것은 네이티브 앱뿐이다.
- 윈도우 쪽에서 맡을 일: **`presenter/windows/Presenter.cs`** (앱 + 네이티브 도우미가 한 파일에 있다)와 `*.cmd`.
- 지금 문제: **윈도우에서 캡처 기능이 대부분 안 된다.** 무엇이 어디서 끊기는지 실기기에서 확인해야 한다(맥에는 윈도우 런타임이 없어 빌드만 된다).
- **Git 저장소가 없다.** 두 세션이 같은 파일을 동시에 고치면 서로 덮어쓴다. 아래 3장 규칙을 반드시 지킬 것.

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
| `recorder` | `action`(show·update·hide) · `time` · `paused` · `camera` · **`cameraView`** · **`cameraName`** | `{kind:"recorder", ok}` |
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

## 7. 요즘 판(v0.33.0~v0.34.0)에 윈도우에 **처음** 들어간 코드 — 모두 런타임 미검증

맥에서 컴파일만 확인했다. 실기기에서 다음을 먼저 확인해 주기 바란다.

| 기능 | 코드 | 볼 것 |
|---|---|---|
| 동그란 카메라 창 | `CameraForm` (MediaCapture + MediaFrameReader) | 녹화 시작 시 창이 뜨는지, 첫 그림이 2.2초 안에 오는지(늦으면 스스로 포기한다), 화면 녹화 영상에 **담기는지**(`SetWindowDisplayAffinity` 를 걸지 않았다), 끌어서 옮겨지는지. 카메라를 못 열면 **아무 창도 띄우지 말 것**(확장이 영상 안에 합쳐 넣는다) |
| 카메라 창 열고 닫기 | `TakeRecorder` 의 `cameraView` | `cameraView` 가 **없는** 알림(1초마다 오는 시간 갱신)에는 창을 건드리면 안 된다. 맥에서 이걸 빠뜨려 창이 1초 만에 사라졌다 |
| 통과 핀 휠 투명도 | `SyncWheelHook` · `WheelHook` (WH_MOUSE_LL) | 클릭 통과를 켠 핀 **위에서만** 휠이 투명도를 바꾸고, 그 휠이 아래 앱으로 내려가지 않아야 한다. 통과 핀이 없으면 훅을 걸지 않는다(걸린 채 두면 시스템 전체가 느려진다) |
| 화면 조각 저장 | `BeginSnip(true)` → `SaveShot` | 도크의 ‘선택 영역 캡처’ 가 보내는 `snip-save`. **가상 화면 전체**(`SystemInformation.VirtualScreen`)를 덮어 다른 모니터 위의 앱도 고를 수 있어야 한다. 모니터마다 배율(DPI)이 다르면 좌표가 어긋날 수 있다 — 이 부분이 이번에 가장 미덥지 않다 |
| 디스플레이 알림 | `DisplayChanged` | 발표 중일 때만 트레이 알림으로 알린다(예전에는 아무 때나 모달 대화상자가 떠서 일을 막았다 — 사용자 보고) |

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
