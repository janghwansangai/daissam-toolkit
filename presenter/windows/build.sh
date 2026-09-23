#!/usr/bin/env bash
# Windows 실행 파일을 만들어 dist/windows 에 놓는다.
# 이 단계를 건너뛰면 scripts/package.mjs 가 dist/windows 에 남아 있던 예전 Presenter.exe 를
# 그대로 담아, 고친 적 없는 버전이 배포된다. (0.20.0 에서 실제로 그렇게 나갔다.)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"

dotnet="$(command -v dotnet || true)"
[ -z "$dotnet" ] && [ -x "$HOME/.dotnet/dotnet" ] && dotnet="$HOME/.dotnet/dotnet"
if [ -z "$dotnet" ]; then
  echo "dotnet 을 찾지 못했습니다. .NET 8 SDK 를 설치하세요." >&2
  exit 1
fi

"$dotnet" publish "$here/Presenter.csproj" -c Release -v q -nologo
# 글자 인식(Windows.Media.Ocr)을 쓰려고 대상이 net8.0-windows10.0.19041.0 이 되었다. 폴더 이름을 따라간다.
tfm="$(sed -n 's/.*<TargetFramework>\([^<]*\)<\/TargetFramework>.*/\1/p' "$here/Presenter.csproj")"
out="$here/bin/Release/$tfm/win-x64/publish/Presenter.exe"
[ -f "$out" ] || { echo "빌드 결과를 찾지 못했습니다: $out" >&2; exit 1; }

mkdir -p "$root/dist/windows"
cp "$out" "$root/dist/windows/Presenter.exe"
version="$(sed -n 's/.*<Version>\([^<]*\)<\/Version>.*/\1/p' "$here/Presenter.csproj")"
echo "Built dist/windows/Presenter.exe (v$version, $(du -h "$root/dist/windows/Presenter.exe" | cut -f1))"
