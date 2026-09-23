@echo off
cd /d "%~dp0"
if not exist Presenter.exe (
  echo Presenter.exe 가 없습니다. ZIP 을 모두 풀었는지 확인하세요.
  pause
  exit /b 1
)
Presenter.exe --check
