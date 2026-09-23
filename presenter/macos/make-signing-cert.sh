#!/bin/bash
# 이 Mac에서만 쓰는 자체 서명 코드서명 인증서를 만든다.
#
# 왜 필요한가: 임시(ad-hoc) 서명은 빌드할 때마다 서명값이 바뀌어 macOS가 매번 다른 앱으로 본다.
# 그래서 화면 기록·손쉬운 사용 권한을 다시 줘야 한다. 고정된 인증서로 서명하면 그 반복이 없어진다.
#
# 무엇을 바꾸는가: 로그인 키체인에 인증서 하나를 넣고, 그 인증서를 '코드 서명' 용도로만 신뢰하도록
# 사용자 신뢰 설정에 추가한다. 시스템 전체 설정은 건드리지 않는다. Apple 개발자 계정과는 무관하며
# 이 인증서로 서명한 앱은 이 Mac 밖에서는 여전히 미확인 개발자 앱이다.
#
# 되돌리기:
#   security delete-certificate -c "Browser Sheriff Local Signing" ~/Library/Keychains/login.keychain-db
set -euo pipefail
NAME="Browser Sheriff Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning | grep -q "$NAME"; then
  printf '이미 있습니다: %s\n' "$NAME"
  security find-identity -v -p codesigning | grep "$NAME"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1
# macOS security(1) 는 OpenSSL 3 기본 PKCS12 를 읽지 못하므로 예전 알고리즘으로 묶는다.
openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -out "$WORK/bundle.p12" \
  -name "$NAME" -passout pass:sheriff \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg SHA1 >/dev/null 2>&1

security import "$WORK/bundle.p12" -k "$KEYCHAIN" -P sheriff -T /usr/bin/codesign -A >/dev/null
# 키 사용 승인 창 없이 codesign 이 쓰게 하려면 암호가 필요하다. 여기서는 묻지 않고
# 별도 스크립트로 넘긴다: presenter/macos/allow-signing-key.sh

printf '인증서를 코드 서명 용도로 신뢰 목록에 추가합니다. 암호를 물으면 Mac 로그인 암호를 넣어 주세요.\n'
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$WORK/cert.pem"

if security find-identity -v -p codesigning | grep -q "$NAME"; then
  printf '\n준비되었습니다.\n'
  security find-identity -v -p codesigning | grep "$NAME"
  printf '이제 bash presenter/macos/build.sh 가 이 인증서로 서명합니다.\n'
else
  printf '\n신뢰 설정이 적용되지 않았습니다. 키체인 접근 앱에서 "%s" 인증서를 열어\n' "$NAME"
  printf '신뢰 > 코드 서명을 "항상 신뢰"로 바꾼 뒤 다시 실행해 주세요.\n'
  exit 1
fi
