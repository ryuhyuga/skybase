@echo off
setlocal
title Skybase
rem Chay tu thu muc chua file nay (double-click la chay, khong can cd)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Skybase] Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai.
  pause
  exit /b 1
)

rem Cai / cap nhat thu vien (nhanh khi da du; tu cai khi package.json co thu vien moi)
echo [Skybase] Kiem tra thu vien...
call npm install --prefer-offline --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo [Skybase] npm install bi loi, xem thong bao phia tren.
  pause
  exit /b 1
)

echo [Skybase] Dang khoi dong... trinh duyet se tu mo. Dong cua so nay de tat.
call npx vite --open
pause
