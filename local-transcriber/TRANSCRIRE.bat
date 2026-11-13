@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title NotaBene - transcription
set PYTHONIOENCODING=utf-8

if not exist ".venv\Scripts\python.exe" (
  echo Le transcripteur n'est pas encore installe : double-clique d'abord sur INSTALLER.bat.
  if not defined NB_NOPAUSE pause
  exit /b 1
)
if "%~1"=="" (
  echo Pour transcrire : glisse-depose un ou plusieurs fichiers audio
  echo ^(m4a, mp3, wav, ogg, opus, webm, mp4 ou .zip exporte par NotaBene^)
  echo directement SUR l'icone de TRANSCRIRE.bat.
  echo.
  echo Les resultats arrivent dans le dossier "transcriptions".
  if not defined NB_NOPAUSE pause
  exit /b 0
)

".venv\Scripts\python.exe" transcrire.py %*
set "CODE=%ERRORLEVEL%"
echo.
if not defined NB_NOPAUSE pause
exit /b %CODE%
