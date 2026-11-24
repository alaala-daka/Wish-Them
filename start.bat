@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "BACKEND_URL=http://127.0.0.1:8787/api/health"
set "FRONTEND_URL=http://127.0.0.1:5173/"

echo ==========================================
echo   愿TA · 暖木愿望邮局 - 一键启动
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js。请安装 Node.js 22.18 或更新版本后重试。
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)"
if errorlevel 1 (
  echo [错误] Node.js 版本过低，本项目的后端需要 22.18 或更新版本。
  node --version
  pause
  exit /b 1
)
echo Node.js 版本检查通过：
node --version
echo.

if not exist "node_modules\" (
  echo 正在安装前端依赖，第一次启动需要一点时间...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [1/3] 正在启动后端 http://127.0.0.1:8787 ...
start "愿TA 后端 8787（关闭此窗口即停止后端）" cmd /k "chcp 65001 >nul && node tools/local/serve.ts"
call :wait_url "%BACKEND_URL%" 30
if errorlevel 1 (
  echo.
  echo [错误] 后端 30 秒内没有就绪。请查看“愿TA 后端 8787”窗口里的报错。
  echo 常见原因：8787 端口被占用，或 Node.js 版本低于 22.18。
  pause
  exit /b 1
)
echo       后端已就绪。

echo [2/3] 正在启动前端 http://127.0.0.1:5173 ...
start "愿TA 前端 5173（关闭此窗口即停止前端）" cmd /k "chcp 65001 >nul && npm run dev"
call :wait_url "%FRONTEND_URL%" 30
if errorlevel 1 (
  echo.
  echo [错误] 前端 30 秒内没有就绪。请查看“愿TA 前端 5173”窗口里的报错。
  pause
  exit /b 1
)
echo       前端已就绪。

echo [3/3] 正在打开浏览器...
start "" "%FRONTEND_URL%"
echo.
echo 启动完成：%FRONTEND_URL%
echo 后端窗口和前端窗口请不要关闭；关闭本窗口不会停止它们。
echo.
pause
exit /b 0

:wait_url
rem %1 = URL, %2 = 最大等待秒数
set "WAIT_URL=%~1"
set "WAIT_MAX=%~2"
set /a WAIT_COUNT=0
:wait_loop
curl.exe -sf -o nul --max-time 2 "%WAIT_URL%" >nul 2>nul
if not errorlevel 1 exit /b 0
set /a WAIT_COUNT+=1
if !WAIT_COUNT! geq %WAIT_MAX% exit /b 1
timeout /t 1 >nul
goto wait_loop
