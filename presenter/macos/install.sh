#!/bin/bash
# 앱을 고정 경로에 설치한다. ad-hoc 서명은 빌드마다 바뀌어 macOS가 권한 기록을 무효로 보므로,
# 설치할 때마다 기존 권한 기록을 지우고 새로 허용받는다.
set -euo pipefail
cd "$(dirname "$0")/../.."
SOURCE="dist/Browser Sheriff Presenter.app"
if [ ! -d "$SOURCE" ]; then
  echo "먼저 bash presenter/macos/build.sh 를 실행하세요." >&2
  exit 1
fi
# 임시(ad-hoc) 서명은 빌드할 때마다 달라져, 설치하는 순간 macOS 가 화면 기록 권한을
# 버린다. 그래서 여기서 멈춘다 — 서명 열쇠를 한 번 허용해 주면 다시 묻지 않는다.
# (이 걸림돌이 없던 0.28.0·0.29.0 에서 실제로 두 번 권한을 날렸다.)
if ! codesign -d --requirements - "$SOURCE" 2>&1 | grep -q 'certificate leaf'; then
  echo "빌드가 임시(ad-hoc) 서명입니다. 설치하지 않았습니다." >&2
  echo "지금 설치하면 화면 기록·손쉬운 사용 권한을 다시 줘야 합니다." >&2
  echo "먼저 이것을 한 번 실행하세요:  bash presenter/macos/allow-signing-key.sh" >&2
  echo "그 뒤 build.sh 를 다시 돌리면 '고정 인증서'로 서명됩니다." >&2
  echo "그래도 임시 서명으로 설치하려면:  ADHOC_OK=1 bash presenter/macos/install.sh" >&2
  [ "${ADHOC_OK:-}" = "1" ] || exit 2
  echo "ADHOC_OK=1 이라 그대로 진행합니다." >&2
fi

TARGET="/Applications/Browser Sheriff Presenter.app"
if [ ! -w /Applications ]; then
  mkdir -p "$HOME/Applications"
  TARGET="$HOME/Applications/Browser Sheriff Presenter.app"
fi

osascript -e 'tell application id "app.browsersheriff.presenter" to quit' >/dev/null 2>&1 || true
sleep 1
pkill -f "Browser Sheriff Presenter.app/Contents/MacOS/Presenter" >/dev/null 2>&1 || true
sleep 1

rm -rf "$TARGET"
ditto "$SOURCE" "$TARGET"
STABLE=no
if codesign -d --requirements - "$TARGET" 2>&1 | grep -q 'certificate leaf'; then STABLE=yes; fi
# macOS 는 권한을 '이 서명'에 묶는다. 서명이 바뀌면 옛 기록이 맞지 않아 계속 다시 묻는다.
# 임시 서명은 빌드마다 바뀌고, 임시 → 고정으로 넘어갈 때도 한 번 바뀐다.
# 예전에는 임시일 때만 지웠기 때문에, 임시로 허용해 둔 기록이 고정 서명 뒤에도 남아
# "권한을 다 줬는데 계속 묻는" 상태가 됐다. 이제 서명이 달라질 때마다 지운다.
MARK="$HOME/Library/Application Support/BrowserSheriff/signed-as.txt"
mkdir -p "$(dirname "$MARK")"
NOW="$(codesign -d --requirements - "$TARGET" 2>&1 | tr -d '\n')"
WAS=""
[ -f "$MARK" ] && WAS="$(cat "$MARK")"
RESET=no
if [ "$STABLE" = no ] || [ "$NOW" != "$WAS" ]; then RESET=yes; fi
if [ "$RESET" = yes ]; then
  tccutil reset ScreenCapture app.browsersheriff.presenter >/dev/null 2>&1 || true
  tccutil reset Accessibility app.browsersheriff.presenter >/dev/null 2>&1 || true
fi
printf '%s' "$NOW" > "$MARK"

# 클립보드 도우미(네이티브 메시징 호스트)를 함께 등록한다. 메뉴에서 따로 누르지 않아도 되도록.
HOSTS="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$HOSTS"
cat > "$HOSTS/app.browsersheriff.presenter.json" <<JSON
{
  "name": "app.browsersheriff.presenter",
  "description": "다있쌤 클립보드 도우미",
  "path": "$TARGET/Contents/MacOS/Presenter",
  "type": "stdio",
  "allowed_origins": [ "chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/", "chrome-extension://cgefngalkalghipmhijniclmlpimpmhf/" ]
}
JSON

printf '설치 완료: %s\n' "$TARGET"
printf '클립보드 도우미 등록: %s/app.browsersheriff.presenter.json\n' "$HOSTS"
if [ "$STABLE" = yes ] && [ "$RESET" = no ]; then
  printf '고정 인증서로 서명되어 있어 이미 준 권한이 그대로 유지됩니다.\n'
elif [ "$STABLE" = yes ]; then
  printf '서명이 바뀌었습니다. 권한을 %s 다시 허용해 주세요.\n' '이번 한 번만'
  printf '  · 시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 녹음\n'
  printf '  · 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용\n'
  printf '목록에 남아 있는 옛 항목은 - 버튼으로 지우고, 새로 뜨는 항목만 켜세요.\n'
  printf '고정 인증서로 서명되어 있으므로 다음 설치부터는 다시 묻지 않습니다.\n'
else
  printf '이전 권한 기록을 지웠습니다. 앱을 실행하고 안내에 따라 두 가지를 다시 허용해 주세요.\n'
  printf '  · 시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 녹음\n'
  printf '  · 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용\n'
  printf '목록에 남아 있는 옛 항목은 - 버튼으로 지우고, 새로 뜨는 항목만 켜세요.\n'
  printf '이 반복을 없애려면 bash presenter/macos/make-signing-cert.sh 를 한 번 실행하세요.\n'
fi
open "$TARGET"
