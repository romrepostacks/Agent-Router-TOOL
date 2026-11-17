@echo off
rem Builds the Windows installer and copies it to this folder as LocalAgentRouter-Setup.exe.
cd /d "%~dp0"
for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "VER=%%V"
if not defined VER goto :fail
set "BUILT=release\LocalAgentRouter-Setup-%VER%.exe"
rem Every release gets its own version, so users can tell which build they have.
if exist "%BUILT%" (
  echo Version %VER% was already built. Bump "version" in package.json, then run this again.
  goto :fail
)
if not exist "node_modules\.bin\electron-builder.cmd" (
  call npm install || goto :fail
)
rem The Ruflo backend runtime ships inside the installer (electron-builder.config.cjs extraResources).
if not exist ".tools\ruflo\node_modules\ruflo\bin\ruflo.js" (
  call npm install --prefix .tools/ruflo --no-save ruflo@3.77.1 || goto :fail
)
call npm run make || goto :fail
copy /y "%BUILT%" "LocalAgentRouter-Setup.exe" >nul || goto :fail
echo Installer ready for version %VER%: %~dp0LocalAgentRouter-Setup.exe
pause
exit /b 0
:fail
echo Build failed. See the messages above.
pause
exit /b 1
