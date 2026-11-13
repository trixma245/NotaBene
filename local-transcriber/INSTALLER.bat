@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title NotaBene - installation du transcripteur local
set PYTHONIOENCODING=utf-8
set PIP_DISABLE_PIP_VERSION_CHECK=1

echo ==========================================================
echo    NotaBene - installation du transcripteur local
echo    (a faire une seule fois - compte 10 a 30 min selon internet)
echo ==========================================================
echo.

rem ---------------------------------------------------------------- 1. Python
set "PY="
for %%V in (3.12 3.11 3.13 3.10) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>&1 && set "PY=py -%%V"
  )
)
if not defined PY (
  python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)" >nul 2>&1 && set "PY=python"
)
if not defined PY (
  if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
)
if not defined PY (
  echo [1/4] Python n'est pas installe : installation de Python 3.12...
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
)
if not defined PY (
  echo.
  echo  ERREUR : impossible d'installer Python automatiquement.
  echo  Installe-le depuis https://www.python.org/downloads/ ^(coche "Add python.exe to PATH"^),
  echo  puis relance INSTALLER.bat.
  goto :fin_erreur
)
echo [1/4] Python trouve : %PY%

rem ---------------------------------------------------------------- 2. Carte graphique
set "GPU=0"
nvidia-smi >nul 2>&1 && set "GPU=1"
if "%GPU%"=="1" (
  echo [2/4] Carte graphique NVIDIA detectee : la transcription utilisera le GPU.
) else (
  echo [2/4] Pas de carte graphique NVIDIA : la transcription se fera sur le processeur ^(plus lent^).
)

rem ---------------------------------------------------------------- 3. Environnement Python
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import faster_whisper, imageio_ffmpeg" >nul 2>&1 && (
    echo [3/4] Les bibliotheques sont deja installees.
    goto :cuda
  )
) else (
  echo [3/4] Creation de l'environnement Python ^(dossier .venv^)...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo  ERREUR : creation de l'environnement impossible.
    goto :fin_erreur
  )
)
echo [3/4] Installation de faster-whisper et ffmpeg...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv\Scripts\python.exe" -m pip install "faster-whisper>=1.1,<2" imageio-ffmpeg
if errorlevel 1 (
  echo  ERREUR pendant l'installation. Verifie ta connexion internet et relance.
  goto :fin_erreur
)

:cuda
if "%GPU%"=="1" (
  ".venv\Scripts\python.exe" -c "import nvidia.cublas, nvidia.cudnn" >nul 2>&1 && (
    echo      Bibliotheques CUDA deja installees.
  ) || (
    echo      Installation des bibliotheques CUDA pour la carte graphique ^(~1,2 Go^)...
    ".venv\Scripts\python.exe" -m pip install "nvidia-cublas-cu12>=12.4,<13" "nvidia-cudnn-cu12>=9,<10"
    if errorlevel 1 echo  ATTENTION : echec, la transcription se fera sur le processeur.
  )
)

rem ---------------------------------------------------------------- 4. Modele + verification
echo.
echo [4/4] Telechargement du modele large-v3 ^(~3 Go, une seule fois^) et verification...
".venv\Scripts\python.exe" transcrire.py --verifier --telecharger
if errorlevel 1 (
  echo.
  echo  ATTENTION : la verification a signale un probleme ^(voir ci-dessus et journal.log^).
  goto :fin_erreur
)

if not exist "a_transcrire" mkdir "a_transcrire"
if not exist "transcriptions" mkdir "transcriptions"
echo.
echo ==========================================================
echo    Installation terminee !
echo    - Glisse-depose un fichier audio sur TRANSCRIRE.bat
echo    - ou lance SURVEILLER.bat et depose tes fichiers dans a_transcrire
echo ==========================================================
if not defined NB_NOPAUSE pause
exit /b 0

:fin_erreur
echo.
if not defined NB_NOPAUSE pause
exit /b 1
