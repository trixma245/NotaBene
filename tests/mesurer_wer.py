"""Mesure la qualité d'une transcription : taux d'erreur sur les mots (WER) par rapport au texte de référence.
Utilisation :  python tests/mesurer_wer.py local-transcriber/transcriptions/cours_test_bruite.notabene.json
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ICI = Path(__file__).resolve().parent

# Les nombres écrits en chiffres par Whisper sont comparés à leur forme en lettres
NOMBRES = {"0": "zéro", "4": "quatre", "7": "sept", "32": "trente-deux", "255": "deux cent cinquante-cinq"}


def mots(texte: str) -> list[str]:
    t = texte.lower().replace("’", "'")
    t = re.sub(r"\b(ipv)\s?4\b", r"ip version 4", t)
    t = re.sub(r"\d+", lambda m: NOMBRES.get(m.group(), m.group()), t)
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.findall(r"[a-z0-9]+", t.replace("-", " "))


def wer(ref: list[str], hyp: list[str]) -> tuple[float, int, int]:
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
    return d[-1] / max(1, len(ref)), d[-1], len(ref)


def main() -> None:
    src = Path(sys.argv[1])
    data = json.loads(src.read_text(encoding="utf-8"))
    hyp_txt = " ".join(s["t"] for s in data["segments"])
    ref_txt = (ICI / "texte_reference.txt").read_text(encoding="utf-8")
    taux, err, n = wer(mots(ref_txt), mots(hyp_txt))
    print(f"Modèle : {data.get('model')}")
    print(f"WER : {taux:.1%}  ({err} erreurs sur {n} mots)")
    print("\nTexte obtenu :\n" + hyp_txt)


if __name__ == "__main__":
    main()
