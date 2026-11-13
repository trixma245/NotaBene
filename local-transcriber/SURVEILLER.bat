@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title NotaBene - surveillance du dossier a_transcrire
set PYTHONIOENCODING=utf-8

if not exist ".venv\Scripts\python.exe" (
  echo Le transcripteur n'est pas encore installe : double-clique d'abord sur INSTALLER.bat.
  pause
  exit /b 1
)
if not exist "a_transcrire" mkdir "a_transcrire"
start "" explorer "%~dp0a_transcrire"
".venv\Scripts\python.exe" transcrire.py --surveiller
pause
