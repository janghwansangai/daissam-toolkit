#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
APP="dist/Browser Sheriff Presenter.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" .build/swift-cache
SDK="$(xcrun --show-sdk-path)"
for ARCH in arm64 x86_64; do
  swiftc presenter/macos/Presenter.swift -swift-version 5 -O -sdk "$SDK" -target "$ARCH-apple-macos13.0" -module-cache-path .build/swift-cache -framework AppKit -framework Carbon -framework ScreenCaptureKit -framework CoreMedia -framework CoreImage -o ".build/presenter-$ARCH"
done
lipo -create .build/presenter-arm64 .build/presenter-x86_64 -output "$APP/Contents/MacOS/Presenter"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.browsersheriff.presenter</string><key>CFBundleName</key><string>다있쌤 발표 도우미</string><key>CFBundleDisplayName</key><string>다있쌤 발표 도우미</string><key>CFBundleExecutable</key><string>Presenter</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.40.2</string><key>CFBundleVersion</key><string>49</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSCameraUsageDescription</key><string>녹화 중 화면에 띄우는 동그란 카메라 창에 내 모습을 보여 주려고 카메라를 씁니다. 영상은 이 컴퓨터 밖으로 나가지 않습니다.</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>다있쌤</string><key>CFBundleURLSchemes</key><array><string>browsersheriff</string></array></dict></array>
</dict></plist>
PLIST
# 고정 인증서가 있으면 그것으로 서명한다. ad-hoc 서명은 빌드마다 값이 바뀌어
# macOS 가 매번 다른 앱으로 보고 화면 기록 권한을 다시 묻는다.
# 중단된 codesign 이 남긴 찌꺼기는 다음 서명을 막는다.
find "$APP" -name "*.cstemp" -delete 2>/dev/null || true
IDENTITY="Browser Sheriff Local Signing"
HOW=''
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then
  # 키체인이 개인 키 사용 승인을 기다리면 codesign 이 끝나지 않는다. 기다리다 임시 서명으로 넘어간다.
  codesign --force --sign "$IDENTITY" "$APP" 2>/dev/null &
  SIGNER=$!
  WAITED=0
  while kill -0 "$SIGNER" 2>/dev/null && [ "$WAITED" -lt 25 ]; do sleep 1; WAITED=$((WAITED+1)); done
  if kill -0 "$SIGNER" 2>/dev/null; then
    kill -9 "$SIGNER" 2>/dev/null || true
    find "$APP" -name "*.cstemp" -delete 2>/dev/null || true
    printf 'Signing key is waiting for keychain approval. Run presenter/macos/allow-signing-key.sh once.\n' >&2
  elif wait "$SIGNER"; then
    HOW="stable certificate: $IDENTITY"
  fi
fi
if [ -z "$HOW" ]; then
  codesign --force --sign - "$APP"
  HOW='ad-hoc — permissions must be granted again after each build'
fi
printf 'Built %s (arm64 + x86_64, %s)\n' "$APP" "$HOW"
