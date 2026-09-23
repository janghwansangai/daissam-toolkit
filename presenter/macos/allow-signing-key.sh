#!/bin/bash
# 서명용 개인 키를 codesign 이 승인 창 없이 쓸 수 있게 한다.
#
# 왜 필요한가: 키체인에 들어간 개인 키는 기본적으로 쓸 때마다 사용자 승인을 요구한다.
# 터미널에서 돌리는 codesign 은 그 창을 띄우지 못하고 멈춰 버린다.
#
# 무엇을 바꾸는가: 이 키 하나에 대해 codesign 계열 도구의 접근을 허용 목록에 넣는다.
# 다른 키나 시스템 설정은 건드리지 않는다. Mac 로그인 암호를 묻는다.
set -euo pipefail
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
printf 'Mac 로그인 암호를 입력하세요(화면에 보이지 않습니다): '
read -r -s PASSWORD
printf '\n'
if security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASSWORD" "$KEYCHAIN" >/dev/null 2>&1; then
  printf '완료했습니다. 이제 bash presenter/macos/build.sh 가 멈추지 않고 인증서로 서명합니다.\n'
else
  printf '적용하지 못했습니다. 암호가 맞는지 확인하거나, 키체인 접근 앱에서\n'
  printf '"Browser Sheriff Local Signing" 키 > 접근 제어 > 모든 응용 프로그램 허용으로 바꿔 주세요.\n'
  exit 1
fi
