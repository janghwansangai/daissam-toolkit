@echo off
setlocal
cd /d "%~dp0"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo Windows 10/11 x64 and .NET Framework 4.x are required.
  pause
  exit /b 1
)
"%CSC%" /nologo /target:winexe /platform:x64 /optimize+ /out:Presenter.exe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll Presenter.cs
if errorlevel 1 (pause & exit /b 1)
echo Built Presenter.exe. Run it to start. Run Install.cmd to connect Chrome.
pause
