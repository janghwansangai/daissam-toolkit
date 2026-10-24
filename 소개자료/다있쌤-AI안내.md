# 다있쌤 — AI를 위한 소개 및 안내

> 이 파일은 사람보다 **AI 어시스턴트**가 읽도록 쓴 요약입니다. 사용자(주로 초등 교사)를 돕거나 이 프로젝트를 고칠 때 먼저 읽으세요.
> 기준: v0.41.1 (2026-10). 사람용 소개는 같은 폴더의 `다있쌤-소개.html` / `.pdf`.

## 1. 한 줄 요약

**다있쌤**은 교사를 위한 **Chrome 사이드바 확장 프로그램**(Manifest V3)입니다. 메모 · 폴더 북마크 · 화면 캡처/녹화 · 발표 도구 · 수업 유틸리티 · 자동 백업을 사이드바 하나에 모았습니다. **무료, 회원가입 없음, 개발자 서버 없음.**

- 크롬 웹 스토어: `https://chromewebstore.google.com/detail/penklhfehmfoebmeolplklmjjcjhhnpi`
- 소개 · 내려받기 사이트: `https://hwansang.kr/s/daitssam` (Cloudflare Workers, 저장소의 `site/`)
- 저장소(공개): `https://github.com/janghwansangai/daissam-toolkit` — 릴리스에 확장 ZIP · 맥/윈도우 발표 도우미 ZIP

## 2. 구성 — 세 조각

| 조각 | 역할 | 위치 |
|---|---|---|
| **확장** (Chrome) | 사이드바 UI, 메모 · 북마크 저장, 캡처, 잠금, 백업 판단 | `extension/` |
| **발표 도우미 앱** (맥 Swift · 윈도우 C#) | 화면 확대 · 포인터 · 핀 · 화면 전체 캡처 · 클립보드 · **파일 쓰기**(캡처이미지 · 자동 백업). Chrome 네이티브 메시징 호스트이기도 하다 | `presenter/macos/Presenter.swift`, `presenter/windows/Presenter.cs` |
| **소개 사이트** | 소개 · 내려받기(GitHub 최신 릴리스로 연결) · 설명서 PDF | `site/`, `worker/`, `wrangler.jsonc` |

확장은 문서 폴더 · 바탕화면에 직접 쓸 수 없고 다른 앱 화면도 찍을 수 없습니다. 그래서 그 일은 **발표 도우미 앱**이 맡습니다. 앱이 없어도 메모 · 북마크 · 브라우저 안 캡처 · 유틸리티는 동작합니다.

## 3. 기능 지도 (사이드바 탭)

| 탭 | 기능 | 앱 필요 |
|---|---|---|
| 빠른 메모 | 여러 메모, 제목, 고정, Chrome 동기화(같은 Google 계정의 다른 컴퓨터), 클립보드 그림 자동 가져오기 | 자동 가져오기만 |
| 북마크 | 확장 전용 폴더 북마크(Chrome 기본 북마크와 별개), 동기화 | 아니요 |
| 캡처 | 보이는 부분 · 전체 페이지(스크롤, 최대 32,000px) · **선택 영역**(앱 있으면 화면 전체, 없으면 탭 안) · 잠시 뒤 · **화면 · 창 통째로**(Chrome 고르기 창) · 글자 뽑기 · 화면 녹화(카메라 합성) | 화면 전체 고르기 · 폴더 저장 |
| 발표 | 화면 확대 · 큰 포인터 · 집중 모드 · 화면 조각 핀 · 단축키 · 앱 내려받기 | 예 |
| 유틸리티 | 스톱워치/타이머 · 수업 시보 · 발표자 뽑기 · 팀 포인트 판 · 소음 측정기 · 녹음기 · 웹캠 · 유튜브 뮤직 조종기 | 아니요 |
| 설정(도크 ⚙) | 글꼴 · 잠금 옵션 · 잠금 PIN(만들기/바꾸기/없애기) · **자동 백업** · 전체 백업/복원(파일, 암호 선택) | 자동 백업만 |

**도크**: 탭 위의 진한 단추 줄(발표 · 집중 · 핀 · 선택 영역 캡처 · 스크롤 캡처 등). 따로 띄운 작은 창(`dock.html`)으로도 쓸 수 있습니다. 도크의 캡처는 늘 "폴더 저장 + 복사".

## 4. 프로필 · 잠금

- 첫 화면에서 **PIN(숫자 4~12자리)** 또는 **게스트(PIN 없음)**. 게스트는 `profile.proof === null`이며 잠금 기능이 모두 빠집니다.
- 잠금 원인 `lockWhy`: `start`(Chrome 다시 시작 · 설정) · `away`(화면 잠금/절전) · `idle`(n분) · `key`(단축키, 기본 조합 **없음**) · `button`. 잠금 화면에 원인과 판(개발자 모드/스토어)이 적힙니다.
- PIN 잠금은 **옆 사람의 실수 방지용**이지 강한 보안 장치가 아닙니다. 중요한 비밀은 메모에 쓰지 말라고 안내하세요.

## 5. 데이터는 어디에

| 무엇 | 어디 | 동기화 |
|---|---|---|
| 메모 | `chrome.storage.sync` `note_<기기>_<id>` (+ 대기 중 `local.pendingNotes`, 큰 글 `local.draftNotes`) | Chrome 동기화 |
| 북마크 | `sync` `marks_<기기>` — 기기별 스냅샷을 `rev`/`writer`로 병합, 지움은 표시(tombstone) | Chrome 동기화 |
| PIN | `local.profile.proof`(PBKDF2+AES-GCM 봉인, 원문 저장 안 함) | 안 함 |
| 설정 · 수업 도구 | `chrome.storage.local` | 안 함 |
| 캡처 · 녹화 파일 | 바탕화면 `캡처이미지` 폴더 / 내려받기 | 안 함 |
| **자동 백업** | **문서 → `다있쌤 백업`** 폴더의 JSON(암호 없음, PIN 없음) | 안 함(문서 폴더가 OneDrive/iCloud면 그쪽이 옮김) |

개발자 서버로 가는 데이터는 **없습니다**. 외부 요청은 앱 내려받기 때 GitHub 릴리스 조회뿐입니다.

## 6. 자동 백업 (v0.41)

- 언제: **하루 1번**(켜질 때 · 3시간마다 확인) · **바뀐 뒤**(1분 모아서, 5분에 한 번까지) · **직접**(지금 백업) · **복구 직전**(안전 사본).
- 같은 내용이면 자동 백업은 건너뜀, 빈 백업은 만들지 않음.
- 보관: 31일. 오늘 · 어제는 모두, 그 전은 하루 하나, **가장 최근 3개는 오래돼도 남김**, 이 기기 것만 정리(`lib/autobackup.js` `pruneList`).
- 이름: `daissam-backup_YYYY-MM-DD_HH-MM-SS_<daily|change|manual|before-restore>_<기기6>.json`
- 복구는 **더하기만**(지우지 않음). 새로 깐 다있쌤에 백업이 있으면 "가장 최근 백업으로 복구" 안내.
- 도우미 명령: `backup-save {name,text}` · `backup-list` · `backup-read {name,offset,length≤512KB}` · `backup-delete {names}` · `backup-open`. 답 `{kind:'backup', op, ok, …}`. 이름 규칙 밖은 거절. 시험용 `DAISSAM_BACKUP_DIR`.

## 7. 사용자 문제 해결 순서 (자주 나오는 것)

1. **"발표 · 핀 단추가 안 돼요"** → 발표 도우미 앱 설치 여부. 사이드바가 "발표 도우미 앱이 필요합니다"라고 안내한다. 윈도우는 `Install.cmd`, 맥은 앱을 응용 프로그램에 넣고 열기. 맥 "확인되지 않은 개발자" → 시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기. 윈도우 파란 화면 → 추가 정보 → 실행.
2. **"잠금을 껐는데 잠겨요"** → 잠금 화면 아래 "잠긴 까닭"을 물어본다. 스토어 판과 개발자 모드 판이 **둘 다** 깔려 있으면 설정이 따로라 다른 쪽이 잠근다 — 하나만 남기게 한다.
3. **"북마크가 사라졌어요"** → v0.41.0에서 고친 화면 문제(탭 이동 후 다시 읽지 않던 것). 업데이트 권장. 데이터는 sync에 있다. 필요하면 설정 → 자동 백업 → 날짜로 복구.
4. **"이 탭은 캡처할 수 없어요"** → Chrome이 막는 화면(about:blank · 새 탭 · 설정 · 웹 스토어). v0.40.4부터 "화면 고르기" 창 또는 발표 도우미로 자동으로 넘어간다.
5. **"자동 백업이 안 돼요"** → 앱 설치 · 버전(0.41 이상), 맥은 "Chrome이 문서 폴더에 접근" 허용, 윈도우는 '제어된 폴더 액세스'에 `Presenter.exe` 허용.
6. **스토어 판 vs 개발자 모드 판** → 다른 확장(ID 다름)이라 데이터가 저절로 옮겨지지 않는다. 설정 → 전체 백업 → 다른 판에서 복원.

## 8. 고치는 AI를 위한 규칙 (중요)

- 먼저 읽기: 저장소 `AGENTS.md` → `docs/ai/PROJECT.md` → `docs/ai/HANDOFF.md`. 검증 기록은 `docs/ai/VALIDATION.md`, 윈도우 요청은 `docs/ai/WINDOWS_HANDOFF.md`.
- **바꾸면 안 되는 계약**: 확장 ID(개발자 모드 `ehgodopakibamgeopmelemjmjdjhbdgm`, 게시된 스토어 `penklhfehmfoebmeolplklmjjcjhhnpi`, 예전 항목 `cgefngalkalghipmhijniclmlpimpmhf`), 네이티브 호스트 이름 `app.browsersheriff.presenter`, 맥 번들 ID 동일, URL 스킴 `browsersheriff`, 폴더 `캡처이미지` · `다있쌤 백업`, 백업 파일 이름 규칙.
- **담당 분리**: 맥 세션(Claude)이 확장 · 맥 앱 · 공용 문서 · 릴리스를 맡고 `main`에만 push. **윈도우 `presenter/windows/Presenter.cs`는 윈도우 세션 소유** — 직접 고치지 말고 `docs/ai/WINDOWS_HANDOFF.md`에 요청을 남긴다(윈도우 세션은 `windows` 브랜치 → PR).
- **버전은 네 곳 함께**: `package.json`, `extension/manifest.json`, `presenter/macos/build.sh`(ShortVersion · CFBundleVersion), `presenter/windows/Presenter.csproj`(Version · FileVersion).
- **서버 · 가입 · 분석 도구를 더하지 않는다.** 새 Chrome 권한은 스토어 검토를 길게 하므로 꼭 필요할 때만. 최소 Chrome 120 — 새 API는 그 판에 있는지 확인(없으면 `optional()`로 감싼다).
- 맥 앱은 **고정 인증서**로 서명된 것만 설치 · 배포(임시 서명 금지 — `package.mjs`가 막음). 스토어에는 `key`가 없는 `browser-sheriff-store-<버전>.zip`만 올린다.
- 안정성 우선: 고치기 전 코드에서 실패하는 시험을 먼저 만들고(음성 대조), 실제 Chrome으로 확인한다.

## 9. 명령

```bash
npm test                      # 단위 · 계약 시험(맥에서는 빌드된 도우미로 host-pipe · host-backup 포함)
npm run check                 # 문법 · 매니페스트 · 최소 권한
bash presenter/macos/build.sh && bash presenter/macos/install.sh   # 맥 도우미(고정 인증서)
bash presenter/windows/build.sh                                     # 윈도우 exe(맥에서 교차 빌드 가능, 실행 확인은 윈도우)
npm run package               # dist/release: 확장 · 스토어 · 맥 · 윈도우 ZIP + SHA256SUMS
node scripts/site.mjs         # 소개 사이트 site/ 와 설명서 PDF
node tests/e2e/<이름>.e2e.mjs  # 실제 Chrome(Chrome for Testing) 시험: lock-guard · backup · waste · guest · capture-blocked · autobackup · chaos 등
node scripts/intro-shots.mjs && node scripts/intro-build.mjs   # 이 소개자료 폴더 다시 만들기
```

## 10. 이 폴더(소개자료)

| 파일 | 내용 |
|---|---|
| `다있쌤-소개.html` | 사람용 소개 · 사용법(그림을 품은 파일 하나, 휴대폰 화면도 됨) |
| `다있쌤-소개.pdf` | 같은 내용 A4 인쇄용(7쪽) |
| `다있쌤-AI안내.md` | 이 파일 |
| `img/` | 실제 확장 화면(예시 데이터, `scripts/intro-shots.mjs`가 찍음) |
