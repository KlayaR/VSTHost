@echo off
title VSTHost
cd /d "%~dp0"

:: Put Node and Rust/Cargo on PATH for this session
set "PATH=C:\Program Files\nodejs;%USERPROFILE%\.cargo\bin;%PATH%"

:: Launch the app (Tauri dev: compiles Rust if needed, starts Vite, opens window)
echo Starting VSTHost...
call npm run tauri dev
