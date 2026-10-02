@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo ==^> Installing dependencies ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. If node-pty failed to build, install the
    echo "Desktop development with C++" workload via Visual Studio Build Tools,
    echo then run this script again. See README.md for details.
    pause
    exit /b 1
  )
) else (
  echo ==^> Dependencies already installed, skipping npm install.
)

if not exist .env (
  echo ==^> No .env found, creating one from .env.example...
  copy .env.example .env >nul
  echo ==^> Edit .env now if you want to change the port, file root, etc.
  timeout /t 3 >nul
)

if not exist data\users.json (
  echo ==^> No admin account found - let's create one.
  call npm run setup
)

echo ==^> Starting the server...
call npm start
