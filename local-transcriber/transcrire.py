"""NotaBene - transcripteur local (faster-whisper large-v3 sur la carte graphique).

Utilisation (sans terminal) :
  - glisser-déposer des fichiers audio (ou un .zip exporté par NotaBene) sur TRANSCRIRE.bat
  - ou lancer SURVEILLER.bat et déposer les fichiers dans le dossier a_transcrire/

En ligne de commande :
  python transcrire.py fichier1.m4a fichier2.zip [--matiere Réseaux] [--cpu]
  python transcrire.py --surveiller
  python transcrire.py --verifier [--telecharger]
"""
from __future__ import annotations

import argparse
import inspect
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import unicodedata
import wave
import zipfile
from datetime import datetime
from pathlib import Path

ICI = Path(__file__).resolve().parent
MODELES = ICI / "modeles"
A_TRANSCRIRE = ICI / "a_transcrire"
SORTIE = ICI / "transcriptions"
TMP = ICI / "_tmp"
JOURNAL = ICI / "journal.log"
MATIERES = ICI / "matieres.json"
NOM_MODELE = "large-v3"
EXT_AUDIO = {".m4a", ".mp3", ".wav", ".ogg", ".opus", ".webm", ".mp4", ".aac", ".flac",
             ".wma", ".amr", ".3gp", ".mkv", ".mov", ".oga", ".weba"}
SR = 16000

# Phrases que Whisper « invente » sur du silence ou du bruit (sous-titres de vidéos en ligne)
HALLUCINATIONS = re.compile(
    r"amara\.org|sous-titr|merci d'avoir regard|abonnez-vous|n'oubliez pas de vous abonner|"
    r"like et abonne|à la prochaine vidéo|soustitreur|transcription par|www\.|\.com\b",
    re.I)

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_VERBOSITY", "error")


# --------------------------------------------------------------------------- affichage
def log(msg: str = "", fichier_seul: bool = False) -> None:
    if not fichier_seul:
        print(msg, flush=True)
    try:
        with open(JOURNAL, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")
    except OSError:
        pass


def hms(sec: float) -> str:
    sec = max(0, int(sec))
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()


def nom_sur(s: str) -> str:
    s = re.sub(r'[\\/:*?"<>|]+', "-", s or "cours")
    return re.sub(r"\s+", " ", s).strip()[:80] or "cours"


# --------------------------------------------------------------------------- environnement
def ajouter_dll_nvidia() -> None:
    """Les bibliothèques CUDA installées par pip (nvidia-cublas-cu12, nvidia-cudnn-cu12)
    sont rangées dans site-packages/nvidia/... : on les rend visibles pour ctranslate2."""
    if os.name != "nt":
        return
    import site
    bases = list(site.getsitepackages())
    try:
        bases.append(site.getusersitepackages())
    except Exception:
        pass
    vus = set()
    for base in bases:
        nv = Path(base) / "nvidia"
        if not nv.is_dir():
            continue
        for dll in nv.rglob("*.dll"):
            d = str(dll.parent)
            if d in vus:
                continue
            vus.add(d)
            try:
                os.add_dll_directory(d)
            except OSError:
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


def trouver_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:  # ffmpeg fourni avec le paquet imageio-ffmpeg (installé par INSTALLER.bat)
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    raise SystemExit("ffmpeg introuvable. Relance INSTALLER.bat.")


def vram_go() -> float | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout
        return int(out.strip().splitlines()[0]) / 1024
    except Exception:
        return None


def nb_gpu() -> int:
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count()
    except Exception:
        return 0


# --------------------------------------------------------------------------- modèle
class Moteur:
    """Charge large-v3 sur la carte graphique si possible. Si la mémoire de la carte ne suffit
    pas (ta RTX 3050 a 4 Go), passe en int8_float16, puis en dernier recours sur le processeur."""

    def __init__(self, force_cpu: bool = False):
        self.force_cpu = force_cpu
        self.modele = None
        self.config = None
        self.essais = self._ordre()

    def _ordre(self):
        if self.force_cpu or nb_gpu() == 0:
            return [("cpu", "int8")]
        v = vram_go()
        if v is not None and v < 5.5:
            return [("cuda", "int8_float16"), ("cuda", "float16"), ("cpu", "int8")]
        return [("cuda", "float16"), ("cuda", "int8_float16"), ("cpu", "int8")]

    def charger(self):
        from faster_whisper import WhisperModel
        while self.essais:
            device, compute = self.essais[0]
            try:
                log(f"Chargement du modèle {NOM_MODELE} ({'carte graphique' if device == 'cuda' else 'processeur'}, {compute})…")
                t = time.time()
                threads = max(1, (os.cpu_count() or 4) - 1) if device == "cpu" else 0
                self.modele = WhisperModel(NOM_MODELE, device=device, compute_type=compute,
                                           download_root=str(MODELES), cpu_threads=threads)
                self.config = (device, compute)
                log(f"Modèle prêt en {time.time() - t:.0f} s.")
                if device == "cpu":
                    log("⚠ Transcription sur le processeur : ce sera lent (compte ~1 h pour 1 h de cours).")
                return self.modele
            except Exception as e:  # mémoire insuffisante, bibliothèques CUDA absentes...
                log(f"  → impossible ({court(e)}). Essai suivant.")
                self.essais.pop(0)
                self.modele = None
        raise SystemExit("Aucune configuration n'a fonctionné. Relance INSTALLER.bat.")

    def suivant(self):
        """Après une erreur de mémoire pendant la transcription : configuration plus légère."""
        if self.essais:
            self.essais.pop(0)
        self.modele = None
        return self.charger()


def court(e: Exception) -> str:
    m = str(e).strip().splitlines()
    return (m[0] if m else type(e).__name__)[:160]


def erreur_memoire(e: Exception) -> bool:
    m = str(e).lower()
    return any(k in m for k in ("out of memory", "cuda", "cublas", "cudnn", "memory"))


# --------------------------------------------------------------------------- audio
# Chaîne de nettoyage « classique » (passe-haut, débruitage, normalisation du volume).
# Mesuré sur tests/audio/cours_test_bruite.m4a (voix lointaine + bruit) : elle DÉGRADE Whisper
# (24,8 % de mots faux contre 17,4 % sans filtre). Whisper a appris sur des sons bruités et réagit
# mal aux artefacts du débruitage. Elle n'est donc utilisée qu'avec l'option --filtres.
FILTRES = "highpass=f=80,afftdn=nr=12:nf=-30,loudnorm=I=-18:TP=-2:LRA=11"
AVEC_FILTRES = False


def pretraiter(ffmpeg: str, src: Path, dst: Path) -> float:
    """Convertit en mono 16 kHz (ce qu'attend Whisper), avec la chaîne de filtres si demandée."""
    cmd = [ffmpeg, "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
           "-vn", "-ac", "1", "-ar", str(SR)] + (["-af", FILTRES] if AVEC_FILTRES else []) + \
          ["-c:a", "pcm_s16le", str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0 or not dst.exists():
        raise RuntimeError(f"ffmpeg n'a pas pu lire « {src.name} » : {r.stderr.strip()[:300]}")
    with wave.open(str(dst), "rb") as w:
        return w.getnframes() / w.getframerate()


def lire_wav(p: Path):
    """WAV 16 kHz mono 16 bits -> tableau numpy float32. On donne directement les échantillons
    à Whisper (évite le décodeur PyAV, dont les nouvelles versions cassent faster-whisper)."""
    import numpy as np
    with wave.open(str(p), "rb") as w:
        brut = w.readframes(w.getnframes())
    return np.frombuffer(brut, dtype=np.int16).astype(np.float32) / 32768.0


def concatener(wavs: list[Path], dst: Path) -> None:
    with wave.open(str(dst), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SR)
        for p in wavs:
            with wave.open(str(p), "rb") as w:
                while True:
                    buf = w.readframes(SR * 30)
                    if not buf:
                        break
                    out.writeframes(buf)


# --------------------------------------------------------------------------- matières
def charger_matieres() -> dict[str, str]:
    try:
        return json.loads(MATIERES.read_text(encoding="utf-8"))
    except Exception:
        return {}


def matiere_depuis_chemin(p: Path) -> str | None:
    """a_transcrire/Reseaux/cours.m4a -> « Réseaux » (sans tenir compte des accents)."""
    try:
        rel = p.resolve().relative_to(A_TRANSCRIRE.resolve())
    except ValueError:
        return None
    if len(rel.parts) < 2:
        return None
    dossier = rel.parts[0]
    for nom in charger_matieres():
        if norm(nom) == norm(dossier) or norm(nom).replace("/", "-") == norm(dossier):
            return nom
    return dossier


def nom_matiere(matiere: str | None) -> str | None:
    """« reseaux » -> « Réseaux » (nom officiel de la matière s'il est connu)."""
    if not matiere:
        return None
    for nom in charger_matieres():
        if norm(nom) == norm(matiere):
            return nom
    return matiere


def construire_prompt(matiere: str | None, vocab: str | None) -> tuple[str, str]:
    if not vocab and matiere:
        m = {norm(k): v for k, v in charger_matieres().items()}
        vocab = m.get(norm(matiere), "")
    vocab = (vocab or "").strip()[:450]
    prompt = f"Cours de {matiere}, en français." if matiere else "Cours en français."
    if vocab:
        prompt += f" Vocabulaire : {vocab}."
    return prompt, vocab


# --------------------------------------------------------------------------- transcription
def transcrire_audio(moteur: Moteur, wav: Path, duree: float, prompt: str, hotwords: str) -> list[dict]:
    audio = lire_wav(wav)
    for tentative in range(3):
        modele = moteur.modele or moteur.charger()
        kw = dict(language="fr", task="transcribe", beam_size=5, vad_filter=True,
                  vad_parameters=dict(threshold=0.35, min_silence_duration_ms=600, speech_pad_ms=400),
                  initial_prompt=prompt, condition_on_previous_text=True,
                  compression_ratio_threshold=2.4, log_prob_threshold=-1.0, no_speech_threshold=0.6)
        if hotwords and "hotwords" in inspect.signature(modele.transcribe).parameters:
            kw["hotwords"] = hotwords
        try:
            segments, _info = modele.transcribe(audio, **kw)
            out, t0, dernier = [], time.time(), 0.0
            for s in segments:
                txt = (s.text or "").strip()
                if not txt:
                    continue
                if HALLUCINATIONS.search(txt) or (s.no_speech_prob > 0.6 and s.avg_logprob < -1.0):
                    log(f"  (ignoré, probablement inventé : « {txt[:60]} »)", fichier_seul=True)
                    continue
                out.append({"s": round(s.start, 2), "e": round(s.end, 2), "t": txt})
                if s.end - dernier >= 30 or s.end >= duree - 1:
                    dernier = s.end
                    pct = min(100, s.end / max(duree, 1) * 100)
                    ecoule = time.time() - t0
                    reste = ecoule / max(s.end, 1) * max(0, duree - s.end)
                    print(f"\r  {pct:5.1f} %  [{hms(s.end)} / {hms(duree)}]  reste ~{hms(reste)}   ", end="", flush=True)
            print()
            return out
        except Exception as e:
            print()
            if moteur.config and moteur.config[0] == "cuda" and erreur_memoire(e) and tentative < 2:
                log(f"  Problème avec la carte graphique ({court(e)}). On réessaie avec un réglage plus léger…")
                moteur.suivant()
                continue
            raise
    raise RuntimeError("La transcription a échoué plusieurs fois.")


def lire_source(src: Path, travail: Path) -> dict:
    """Renvoie {titre, matiere, vocab, courseId, morceaux:[(fichier, debut_dans_le_cours)]}."""
    info = {"titre": src.stem, "matiere": None, "vocab": None, "courseId": None, "morceaux": []}
    if src.suffix.lower() == ".zip":
        with zipfile.ZipFile(src) as z:
            noms = z.namelist()
            man = next((n for n in noms if n.endswith("notabene.json")), None)
            meta = json.loads(z.read(man).decode("utf-8")) if man else {}
            parts = meta.get("parts") or [{"file": n} for n in sorted(noms) if Path(n).suffix.lower() in EXT_AUDIO]
            for p in parts:
                dest = travail / Path(p["file"]).name
                with z.open(p["file"]) as f, open(dest, "wb") as o:
                    shutil.copyfileobj(f, o)
                info["morceaux"].append((dest, p.get("start")))
        info.update(titre=meta.get("title") or src.stem, matiere=meta.get("subject"),
                    vocab=meta.get("vocab"), courseId=meta.get("courseId"))
        if not info["morceaux"]:
            raise RuntimeError("Ce .zip ne contient aucun audio.")
    else:
        info["morceaux"].append((src, 0.0))
    return info


def traiter(moteur: Moteur, src: Path, matiere_forcee: str | None = None) -> Path:
    ffmpeg = trouver_ffmpeg()
    TMP.mkdir(exist_ok=True)
    SORTIE.mkdir(exist_ok=True)
    debut = time.time()
    log("")
    log(f"=== {src.name} ===")
    with tempfile.TemporaryDirectory(dir=TMP) as d:
        travail = Path(d)
        info = lire_source(src, travail)
        matiere = nom_matiere(matiere_forcee or info["matiere"] or matiere_depuis_chemin(src))
        prompt, vocab = construire_prompt(matiere, info["vocab"])
        if matiere:
            log(f"Matière : {matiere}" + (" (vocabulaire utilisé)" if vocab else ""))

        # 1) Prétraitement de chaque morceau, puis un seul fichier continu
        log("Préparation du son (mono 16 kHz" + (", filtres" if AVEC_FILTRES else "") + ")…")
        wavs, carte, cumul = [], [], 0.0
        for i, (f, start) in enumerate(info["morceaux"]):
            w = travail / f"p{i:03d}.wav"
            dur = pretraiter(ffmpeg, f, w)
            wavs.append(w)
            carte.append((cumul, dur, start if start is not None else cumul))
            cumul += dur
        if len(wavs) == 1:
            complet = wavs[0]
        else:
            complet = travail / "complet.wav"
            concatener(wavs, complet)
        log(f"Durée : {hms(cumul)}")

        # 2) Transcription
        log("Transcription en cours (la première fois, le modèle se télécharge : ~3 Go)…")
        segs = transcrire_audio(moteur, complet, cumul, prompt, vocab)

    # 3) Les temps sont recalés sur ceux de l'appli (utile pour les cours en plusieurs parties)
    def recaler(t: float) -> float:
        for c0, dur, st in reversed(carte):
            if t >= c0:
                return round(st + min(t - c0, dur), 2)
        return t
    for s in segs:
        s["s"], s["e"] = recaler(s["s"]), recaler(s["e"])

    base = SORTIE / nom_sur(info["titre"])
    ecrire_sorties(base, segs, info, matiere, cumul, moteur)
    log(f"✔ Terminé en {hms(time.time() - debut)} : {base.name}.txt / .srt / .notabene.json")
    if not segs:
        log("⚠ Aucun texte reconnu : le son est peut-être trop faible ou silencieux.")
    return base


def ecrire_sorties(base: Path, segs: list[dict], info: dict, matiere: str | None, duree: float, moteur: Moteur) -> None:
    # .txt : paragraphes (nouveau paragraphe après une pause de 2 s ou toutes les ~60 s)
    lignes, para, t_para, fin_prec = [], [], None, None
    for s in segs:
        if para and ((s["s"] - fin_prec) > 2.0 or (s["s"] - t_para) > 60):
            lignes.append(f"[{hms(t_para)}] " + " ".join(para))
            para = []
        if not para:
            t_para = s["s"]
        para.append(s["t"])
        fin_prec = s["e"]
    if para:
        lignes.append(f"[{hms(t_para)}] " + " ".join(para))
    base.with_suffix(".txt").write_text(f"{info['titre']}\n\n" + "\n\n".join(lignes) + "\n", encoding="utf-8")

    # .srt : sous-titres
    def ts(x: float) -> str:
        ms = int(round(x * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
    srt = [f"{i}\n{ts(s['s'])} --> {ts(s['e'])}\n{s['t']}\n" for i, s in enumerate(segs, 1)]
    base.with_suffix(".srt").write_text("\n".join(srt), encoding="utf-8")

    # .notabene.json : à importer dans l'appli (bouton « Importer » de l'accueil)
    device, compute = moteur.config or ("?", "?")
    data = {
        "notabene": "transcription", "version": 1,
        "courseId": info["courseId"], "title": info["titre"], "subject": matiere,
        "engine": "local", "model": f"{NOM_MODELE} ({device}, {compute})",
        "duration": round(duree, 2), "createdAt": int(time.time() * 1000),
        "segments": segs,
    }
    Path(str(base) + ".notabene.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


# --------------------------------------------------------------------------- modes
def mode_fichiers(chemins: list[str], matiere: str | None, cpu: bool) -> int:
    fichiers = []
    for c in chemins:
        p = Path(c.strip('"'))
        if p.is_dir():
            fichiers += sorted(x for x in p.rglob("*") if x.suffix.lower() in EXT_AUDIO | {".zip"})
        elif p.exists():
            fichiers.append(p)
        else:
            log(f"Fichier introuvable : {p}")
    if not fichiers:
        log("Aucun fichier audio à transcrire.")
        return 1
    moteur, erreurs = Moteur(cpu), 0
    for f in fichiers:
        try:
            traiter(moteur, f, matiere)
        except SystemExit:
            raise
        except Exception as e:
            erreurs += 1
            log(f"✘ Échec pour {f.name} : {court(e)}")
            log(traceback.format_exc(), fichier_seul=True)
    log("")
    log(f"Résultats dans : {SORTIE}")
    log("Dans NotaBene : Accueil → « Importer » → choisis le fichier .notabene.json.")
    if os.name == "nt" and not os.environ.get("NB_NOPAUSE"):
        try:
            os.startfile(SORTIE)  # ouvre le dossier des résultats
        except OSError:
            pass
    return 1 if erreurs else 0


def mode_surveiller(cpu: bool) -> int:
    A_TRANSCRIRE.mkdir(exist_ok=True)
    faits, ratés = A_TRANSCRIRE / "_faits", A_TRANSCRIRE / "_erreurs"
    log(f"Surveillance de : {A_TRANSCRIRE}")
    log("Dépose des fichiers audio (ou des sous-dossiers par matière). Ferme la fenêtre pour arrêter.")
    moteur, vus = Moteur(cpu), {}
    while True:
        for f in sorted(A_TRANSCRIRE.rglob("*")):
            if not f.is_file() or f.suffix.lower() not in EXT_AUDIO | {".zip"}:
                continue
            if any(p in ("_faits", "_erreurs") for p in f.relative_to(A_TRANSCRIRE).parts):
                continue
            st = f.stat()
            sig = (st.st_size, st.st_mtime)
            if vus.get(f) != sig or time.time() - st.st_mtime < 3:  # fichier encore en cours de copie
                vus[f] = sig
                continue
            dest_dir = faits
            try:
                traiter(moteur, f)
            except SystemExit:
                raise
            except Exception as e:
                dest_dir = ratés
                log(f"✘ Échec pour {f.name} : {court(e)} (fichier déplacé dans a_transcrire/_erreurs)")
                log(traceback.format_exc(), fichier_seul=True)
            dest_dir.mkdir(exist_ok=True)
            cible = dest_dir / f.name
            if cible.exists():
                cible = dest_dir / f"{f.stem}-{int(time.time())}{f.suffix}"
            try:
                shutil.move(str(f), str(cible))
            except OSError:
                pass
            vus.pop(f, None)
            log("En attente de nouveaux fichiers…")
        time.sleep(5)


def mode_verifier(telecharger: bool, cpu: bool) -> int:
    ok = True
    log(f"Python {sys.version.split()[0]}")
    try:
        log(f"ffmpeg : {trouver_ffmpeg()}")
    except SystemExit as e:
        log(f"✘ {e}")
        ok = False
    try:
        import faster_whisper
        import ctranslate2
        log(f"faster-whisper {faster_whisper.__version__}, ctranslate2 {ctranslate2.__version__}")
    except Exception as e:
        log(f"✘ faster-whisper n'est pas installé : {court(e)}")
        return 1
    n, v = nb_gpu(), vram_go()
    if n:
        log(f"Carte graphique NVIDIA détectée ({v:.1f} Go)" if v else "Carte graphique NVIDIA détectée")
    else:
        log("Pas de carte graphique NVIDIA utilisable : la transcription se fera sur le processeur (lent).")
    if telecharger or n:
        moteur = Moteur(cpu)
        moteur.charger()   # télécharge le modèle la première fois (~3 Go) et vérifie la carte graphique
        if moteur.config[0] == "cuda":
            # mini-test réel sur la carte graphique : 3 s d'un son de 440 Hz
            import numpy as np
            t = np.arange(SR * 3, dtype=np.float32) / SR
            try:
                list(moteur.modele.transcribe(0.1 * np.sin(2 * np.pi * 440 * t).astype(np.float32), language="fr")[0])
                log(f"✔ La carte graphique fonctionne ({moteur.config[1]}).")
            except Exception as e:
                ok = False
                log(f"✘ La carte graphique ne fonctionne pas pour la transcription : {court(e)}")
    return 0 if ok else 1


def main() -> int:
    ajouter_dll_nvidia()
    ap = argparse.ArgumentParser(description="Transcripteur local NotaBene")
    ap.add_argument("fichiers", nargs="*", help="fichiers audio ou .zip exportés par NotaBene")
    ap.add_argument("--matiere", help="matière (pour le vocabulaire), ex. « Réseaux »")
    ap.add_argument("--surveiller", action="store_true", help="surveille le dossier a_transcrire/")
    ap.add_argument("--verifier", action="store_true", help="vérifie l'installation")
    ap.add_argument("--telecharger", action="store_true", help="télécharge le modèle (avec --verifier)")
    ap.add_argument("--cpu", action="store_true", help="n'utilise pas la carte graphique")
    ap.add_argument("--filtres", action="store_true", help="passe-haut + débruitage + normalisation (déconseillé, voir FILTRES)")
    a = ap.parse_args()
    global AVEC_FILTRES
    AVEC_FILTRES = a.filtres
    if a.verifier:
        return mode_verifier(a.telecharger, a.cpu)
    if a.surveiller:
        return mode_surveiller(a.cpu)
    if not a.fichiers:
        print("Glisse-dépose un ou plusieurs fichiers audio sur TRANSCRIRE.bat.")
        return 0
    return mode_fichiers(a.fichiers, a.matiere, a.cpu)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nArrêté.")
        sys.exit(130)
