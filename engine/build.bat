@echo off
setlocal EnableDelayedExpansion
title VSTHost Engine Builder

echo.
echo ============================================================
echo   VSTHostEngine Build Script
echo ============================================================
echo.

:: ── Check winget ──────────────────────────────────────────────────────────────
where winget >nul 2>&1
if errorlevel 1 (
    echo [ERROR] winget not found. Please install it from the Microsoft Store.
    pause & exit /b 1
)

:: ── Check / install CMake ─────────────────────────────────────────────────────
where cmake >nul 2>&1
if errorlevel 1 (
    echo [INFO] CMake not found. Installing via winget...
    winget install --id Kitware.CMake -e --silent
    if errorlevel 1 (
        echo [ERROR] CMake install failed. Please install from https://cmake.org
        pause & exit /b 1
    )
    :: Refresh PATH
    for /f "tokens=*" %%i in ('where cmake 2^>nul') do set CMAKE=%%i
    if "!CMAKE!"=="" (
        echo [INFO] CMake installed. Please RESTART this script to continue.
        pause & exit /b 0
    )
)
echo [OK] CMake found.

:: ── Check / install Visual Studio Build Tools ─────────────────────────────────
set VSWHERE="%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist %VSWHERE% (
    echo [INFO] Visual Studio Build Tools not found. Installing...
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --silent ^
        --override "--add Microsoft.VisualStudio.Workload.VCTools ^
                   --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ^
                   --includeRecommended --quiet --wait"
    if errorlevel 1 (
        echo [ERROR] VS Build Tools install failed.
        echo         Please install manually from:
        echo         https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
        pause & exit /b 1
    )
    echo [INFO] Build Tools installed. Please RESTART this script.
    pause & exit /b 0
)
echo [OK] Visual Studio Build Tools found.

:: ── Find vcvarsall (requires the C++ "VCTools" workload) ──────────────────────
:: First try: vswhere filtered to the C++ component (most reliable when catalog is fresh)
set VS_PATH=
for /f "usebackq tokens=*" %%i in (
    `%VSWHERE% -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ^
     -property installationPath 2^>nul`
) do set VS_PATH=%%i

:: Fallback: any latest VS install, then verify vcvarsall physically exists.
:: (vswhere's -requires catalog can lag right after installing the workload.)
if "%VS_PATH%"=="" (
    for /f "usebackq tokens=*" %%i in (
        `%VSWHERE% -latest -property installationPath 2^>nul`
    ) do set VS_PATH=%%i
)

:: Last-resort fallback: well-known Build Tools location
if "%VS_PATH%"=="" set VS_PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools

:: If we found a path but it has no C++ compiler, treat as missing workload
if not exist "%VS_PATH%\VC\Auxiliary\Build\vcvarsall.bat" set VS_PATH=

if "%VS_PATH%"=="" (
    echo.
    echo [ERROR] Visual Studio Build Tools is installed, but the C++ workload
    echo         ^(MSVC compiler^) is MISSING. This is the most common cause.
    echo.
    echo   Fix it one of these ways:
    echo.
    echo   A^) Run this command in an ADMIN PowerShell, accept the UAC prompt,
    echo      and wait for it to finish ^(~2-3 GB download^):
    echo.
    echo      ^& "%%ProgramFiles(x86)%%\Microsoft Visual Studio\Installer\setup.exe" modify ^
    echo         --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" ^
    echo         --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive
    echo.
    echo   B^) Open "Visual Studio Installer" from the Start menu, click Modify on
    echo      "Build Tools 2022", check "Desktop development with C++", then Install.
    echo.
    pause & exit /b 1
)
echo [OK] C++ workload found at: %VS_PATH%

set VCVARS="%VS_PATH%\VC\Auxiliary\Build\vcvarsall.bat"
if not exist %VCVARS% (
    echo [ERROR] vcvarsall.bat not found at: %VCVARS%
    echo         The C++ workload may be partially installed. Re-run the VS Installer.
    pause & exit /b 1
)

:: ── Configure ─────────────────────────────────────────────────────────────────
set ENGINE_DIR=%~dp0
set BUILD_DIR=%ENGINE_DIR%build

echo.
echo [INFO] Configuring CMake build...
echo [INFO] Engine dir : %ENGINE_DIR%
echo [INFO] Build dir  : %BUILD_DIR%
echo.

:: Check for optional ASIO SDK
set ASIO_FLAG=OFF

if exist "%ENGINE_DIR%libs\asiosdk\common\asio.h" (
    set ASIO_FLAG=ON
    echo [INFO] ASIO SDK detected - ASIO support will be compiled in.
)

call %VCVARS% x64 >nul 2>&1

cmake -S "%ENGINE_DIR%" -B "%BUILD_DIR%" ^
    -G "Visual Studio 17 2022" -A x64 ^
    -DCMAKE_BUILD_TYPE=Release ^
    -DVSTHOST_ASIO=%ASIO_FLAG%

if errorlevel 1 (
    echo.
    echo [ERROR] CMake configuration failed.
    echo         JUCE will be downloaded automatically on first run (~200 MB).
    echo         Make sure you have an internet connection.
    pause & exit /b 1
)

:: ── Build ─────────────────────────────────────────────────────────────────────
echo.
echo [INFO] Building (this takes 5-15 minutes on first build while JUCE compiles)...
echo.

cmake --build "%BUILD_DIR%" --config Release --parallel

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. Check the output above for errors.
    pause & exit /b 1
)

:: ── Done ──────────────────────────────────────────────────────────────────────
echo.
echo ============================================================
echo   Build successful!
echo   Binary: %BUILD_DIR%\Release\VSTHostEngine.exe
echo ============================================================
echo.
echo   Optional: ASIO low-latency audio (place in engine\libs\ and rebuild):
echo     Download: https://www.steinberg.net/asiosdk
echo     Extract to: engine\libs\asiosdk\
echo     (needs asiosdk\common\asio.h)
echo.
echo   Now run:  npm run dev   (from the VSTHost root)
echo ============================================================
echo.
pause
