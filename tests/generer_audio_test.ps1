# Fabrique un audio de test "cours lointain et bruité" à partir du texte de référence.
# 1) voix de synthèse française de Windows  2) son étouffé + écho de salle + souffle/ventilateur + volume faible.
# Utilisation : clic droit > Exécuter avec PowerShell (ffmpeg doit être installé).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'audio'
New-Item -ItemType Directory -Force $out | Out-Null
$text = Get-Content (Join-Path $here 'texte_reference.txt') -Raw -Encoding UTF8

Add-Type -AssemblyName System.Speech
$tts = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fr = $tts.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'fr-*' } | Select-Object -First 1
if (-not $fr) { throw "Aucune voix française installée dans Windows." }
$tts.SelectVoice($fr.VoiceInfo.Name)
$tts.Rate = 0
$clean = Join-Path $out 'cours_test_propre.wav'
$tts.SetOutputToWaveFile($clean)
$tts.Speak($text)
$tts.Dispose()

# Voix : étouffée (passe-bas 2,8 kHz), écho de salle, 14 dB plus faible. Bruit : souffle rose + ronflement de ventilateur.
$noisy = Join-Path $out 'cours_test_bruite.m4a'
$filter = "[0:a]aresample=44100,lowpass=f=2800,aecho=0.8:0.6:45|90:0.35|0.2,volume=-14dB[v];" +
          "[1:a]volume=-27dB[n];[2:a]volume=-32dB[h];" +
          "[v][n][h]amix=inputs=3:duration=first:normalize=0,volume=-8dB[o]"
& ffmpeg -y -hide_banner -loglevel error -i $clean `
  -f lavfi -i "anoisesrc=color=pink:sample_rate=44100:amplitude=1" `
  -f lavfi -i "sine=frequency=100:sample_rate=44100" `
  -filter_complex $filter -map "[o]" -ac 1 -c:a aac -b:a 64k $noisy
if ($LASTEXITCODE -ne 0) { throw "ffmpeg a échoué" }
Write-Host "OK : $noisy"
