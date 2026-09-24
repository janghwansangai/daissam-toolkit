# 윈도우 작업 명령서 — 새 컴퓨터에서 처음 시작하는 윈도우 Claude Code 에게

작성: 2026-09-24 · 기준 버전 **v0.36.3** · 작성자: 맥 쪽 Claude Code 세션
저장소: **https://github.com/janghwansangai/daissam-toolkit** (비공개)

이 문서는 **처음 한 번** 읽는 설치·시작 안내서다. 규칙과 계약(메시지 표·식별자·금지 사항)은
**[WINDOWS_HANDOFF.md](WINDOWS_HANDOFF.md)** 에 있고, 그쪽이 언제나 기준이다.

## 0. 지금 상황 한 장 요약

- 만드는 것: **다있쌤** — 교실에서 쓰는 **Chrome 확장** + **발표 도우미 앱**(맥 Swift / 윈도우 C#) 한 쌍.
  서버도 회원가입도 분석 수집도 없다. 자료는 쓰는 사람 컴퓨터를 벗어나지 않는다.
- 사용자는 한국 초등 교사다. 화면을 크게 보여 주고, 화면 조각을 붙여 두고, 캡처·녹화해 수업에 쓴다.
- **두 대의 컴퓨터에서 Claude Code 두 세션이 함께 만든다.** 맥 세션(확장·맥 앱·배포본)과 윈도우 세션(윈도우 앱).
  주고받는 곳은 **GitHub 저장소 하나**다. 서로의 화면을 볼 수 없으니 **커밋·PR 본문에 근거를 적는 것**이 유일한 대화 수단이다.
- 너는 **윈도우 세션**이고, 이 컴퓨터는 방금 준비된 새 컴퓨터다. 아래 1~4 장을 순서대로 한 뒤 5장 과제로 들어간다.
- 맥에는 윈도우 런타임이 없다. 그래서 **윈도우에서 실제로 돌려 본 사람은 아직 아무도 없다.**
  네가 하는 확인이 이 프로젝트의 윈도우 쪽 유일한 근거다. 추측으로 '됐다' 고 하지 말 것.

## 1. 준비물 확인 (없으면 사용자에게 알리고 허락받은 뒤 설치)

하나씩 확인하고 결과를 사용자에게 보여 준다. **시스템에 무언가를 설치하기 전에는 반드시 묻는다.**

| 준비물 | 확인 | 없을 때 (사용자에게 제안) |
|---|---|---|
| Git | `git --version` | `winget install Git.Git` |
| GitHub CLI | `gh --version` · `gh auth status` | `winget install GitHub.cli` → `gh auth login` |
| .NET 8 SDK | `dotnet --list-sdks` (8.x 필요) | `winget install Microsoft.DotNet.SDK.8` |
| Node.js LTS | `node --version` (18 이상) | `winget install OpenJS.NodeJS.LTS` |
| Chrome | 설치 여부 | 이미 있을 것 |
| 한국어 글자 인식 | OCR 시험 때만 필요 | 설정 → 시간 및 언어 → 언어 및 지역 → 한국어 → 언어 옵션 → **광학 문자 인식** 설치 |

- 셸이 PowerShell 이면 `%LOCALAPPDATA%` 대신 `$env:LOCALAPPDATA` 를 쓴다. 이 문서의 명령은 **cmd** 기준이다.
- `gh auth status` 가 로그인되어 있지 않으면 PR 을 열 수 없다. 사용자에게 `gh auth login` 을 부탁한다(계정은 **janghwansangai**).

## 2. 저장소 받기와 브랜치 잡기

```bat
git clone https://github.com/janghwansangai/daissam-toolkit.git
cd daissam-toolkit
git checkout windows
git pull origin main
```

- `main` = 맥 세션 것, `windows` = 네 것. **`main` 으로 직접 push 하지 않는다.**
- **작업을 시작할 때마다 `git pull origin main` 을 먼저 한다.** 맥 세션이 확장과 맥 앱을 계속 고치고 있다.
- 커밋에 담는 것은 `presenter/windows/**` 와 `*.cmd` 뿐이다. 다른 폴더가 `git status` 에 잡히면 커밋하지 말고 사용자에게 알린다.

읽는 순서: `AGENTS.md` → `docs/ai/PROJECT.md` → `docs/ai/HANDOFF.md` → **`docs/ai/WINDOWS_HANDOFF.md`** → (필요할 때) `docs/ai/VALIDATION.md`

## 3. 빌드 · 설치 · 점검

```bat
cd presenter\windows
dotnet publish Presenter.csproj -c Release -v q -nologo
copy /Y bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\Presenter.exe ..\..\dist\windows\Presenter.exe
cd ..\..\dist\windows
Install.cmd
Check.cmd
```

- `Install.cmd` 는 앱을 `%LOCALAPPDATA%\BrowserSheriff\` 로 복사하고 Chrome 네이티브 도우미로 등록한다.
- **`Check.cmd` 결과를 사용자에게 그대로 보여 주는 것이 첫 보고다.** 설치 위치·버전 일치·레지스트리·확장 번호·앱 실행 여부·`state.json` 이 한 번에 나온다.
- 대상 프레임워크(`net8.0-windows10.0.19041.0`)를 낮추지 말 것 — 글자 인식(`Windows.Media.Ocr`)과 카메라(`Windows.Media.Capture`) 때문이다.

## 4. 확장 올리기

1. Chrome → `chrome://extensions` → **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드** → 저장소의 **`extension`** 폴더 고르기
3. 확장 ID 가 `ehgodopakibamgeopmelemjmjdjhbdgm` 인지 확인한다(`manifest.json` 의 `key` 덕분에 어느 컴퓨터에서나 같다). 다르면 도우미가 메시지를 받지 못한다.
4. `Install.cmd` 를 돌린 뒤라면 **Chrome 을 완전히 껐다 켠다**(네이티브 도우미 등록을 다시 읽는다).
5. 확장 코드를 고친 뒤에는 `chrome://extensions` 에서 **새로고침**을 누른다. 그래도 옛 동작이면 Chrome 을 껐다 켠다(서비스 워커가 캐시된다).
6. 사이드바를 열려면 툴바의 확장 아이콘(✳)을 누른다. 처음에는 프로필 PIN 을 만들라고 한다 — 사용자가 정한다. **PIN 을 대신 만들지 말고 물어본다.**

## 5. 첫 과제 (이 순서로)

### ① 캡처가 왜 안 되는지 가려내기 — 가장 급한 일
사용자 보고: “윈도우에서 캡처 기능이 대부분 작동하지 않는다.” 확장 → 도우미 → 앱 중 어디서
끊기는지 **`WINDOWS_HANDOFF.md` 6장 순서**대로 가른다. 요지만 적으면:

1. `Check.cmd` 가 ✗ 를 내면 거기서 끝(설치·등록 문제). `Install.cmd` 후 Chrome 재시작.
2. 사이드바 캡처 탭에서 저장 방식을 **‘편집기로 열기’** 로 두고 찍는다.
   - 편집기 창이 뜨면 → 확장·Chrome 은 멀쩡하고 **도우미(저장·복사)** 가 문제다.
   - 편집기도 안 뜨면 → 확장 쪽이다. `chrome://extensions` → 서비스 워커 → 콘솔 오류를 **그대로** 적는다.
3. 저장 방식을 **‘폴더 저장 + 복사’** 로 바꿔 찍고, 바탕화면 `캡처이미지` 폴더와 클립보드를 확인한다.
   - 바탕화면이 **OneDrive** 로 옮겨져 있으면 경로가 달라진다. 실제 경로를 로그로 찍어 확인할 것.
4. OCR 이 안 되면 한국어 광학 문자 인식 언어팩을 확인한다.

### ② 윈도우에서 한 번도 돌아간 적 없는 코드 확인
`WINDOWS_HANDOFF.md` 7장의 표를 그대로 따른다. 지금 목록:
**CameraForm**(동그란 카메라 창) · **WheelHook**(클릭 통과 핀 위에서 휠로 투명도) ·
**BeginSnip(true)/SaveShot**(화면 조각 저장) · **가상 화면 스닙**(다중 모니터·DPI) ·
**DisplayChanged**(발표 중일 때만 트레이 알림) · **ScreenForCapture**(녹화 중인 모니터 고르기) ·
**12초 시계**(녹화 창이 사라지면 표시기·카메라 창 거두기).

### ③ 고칠 때의 자세
- **추측 금지.** 실제 오류 메시지·`Check.cmd` 출력·창 스타일 값 같은 **근거**로 말한다.
  (윈도우 세션이 예전에 `exStyle=0x00010028 → 0x00090008` 을 붙여 보낸 것이 좋은 예다.)
- 한 번에 한 가지만 고치고, 고칠 때마다 다시 돌려 본다.
- 큰 리팩터링 금지. 지금은 **안 되는 것을 되게** 만드는 일만 한다.
- `npm test` 는 윈도우에서도 돌아간다(`npm test` → 78개). 앱 코드를 고쳤으면 돌려 보고 깨진 것이 없는지 본다.

## 6. 절대 하지 말 것

- `extension/**` 고치기 → 맥 세션 소유다. 고쳐야 할 이유가 생기면 **파일·줄·까닭만 PR 본문에 적는다.**
- 버전 번호 올리기(`package.json`·`manifest.json`·`Presenter.csproj`·`build.sh`) → 맥 세션만.
- `npm run package`(배포본 만들기) → 맥 세션만. 서명된 맥 앱이 있어야 한다.
- `dist/` 안의 다른 파일 손대기(`dist/windows/Presenter.exe` 는 만들어도 된다).
- 식별자 바꾸기(확장 ID·도우미 이름·레지스트리 키·`%LOCALAPPDATA%\BrowserSheriff`·`캡처이미지`·`browsersheriff://`).
- 새 권한 추가, 바깥으로 나가는 통신 추가. **이 프로젝트에는 `fetch`·XHR·WebSocket 이 하나도 없다.**
- 비밀값·사용자 이름·메일 주소·컴퓨터 경로를 문서나 커밋에 적기.
- 사용자 대신 PIN 만들기, 사용자 허락 없이 시스템 설정·프로그램 설치.

## 7. 끝낼 때 (맥 세션에 넘기는 방법)

```bat
git add presenter/windows
git commit -m "윈도우: (무엇을 고쳤는지 한 줄)"
git push origin windows
gh pr create --base main --head windows --title "윈도우: ..." --body "(아래 형식)"
```

PR 본문 형식:

```
[무엇을 고쳤나]  파일 · 함수 · 줄 수준으로
[왜]            어떤 증상이 어떤 원인으로 났는지(실제 출력 근거)
[어떻게 확인]    실기기에서 무엇을 눌러 무엇이 나왔는지
[남은 문제]      아직 안 되는 것, 재현 조건
[확장에 필요한 것] 있으면: 파일·줄·이유 (직접 고치지 말 것)
```

- 커밋 메시지 끝에는 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` 를 붙인다.
- PR 을 올린 뒤 **사용자에게 “맥 세션에 알려 달라”고 말한다.** 합치는 것은 맥 세션이 한다.
- 작업 단위가 끝나면 `docs/ai/HANDOFF.md` 의 **윈도우 절**만 갱신해 함께 커밋한다(다른 절은 건드리지 않는다).
