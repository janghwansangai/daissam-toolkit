@echo off
cd /d "%~dp0"
if not exist Presenter.exe (
  echo Run Build.cmd first.
  pause
  exit /b 1
)
Presenter.exe --install
