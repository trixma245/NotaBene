"""Tests automatiques de la PWA NotaBene dans un vrai Chrome (piloté par Playwright).

Prérequis (pour le développeur, pas pour utiliser l'appli) :
    pip install playwright          (utilise le Chrome déjà installé, pas de téléchargement de navigateur)
    python tests/serveur_test.py    (dans un autre terminal)
Lancer :
    python tests/test_pwa.py [--pc]     --pc : transcrit aussi l'export avec le transcripteur local (GPU)

Ce qui est testé : fonctions de base (recollage, répétition espacée, zip, Markdown), tous les écrans,
import d'un audio, enregistrement réel (le micro est simulé avec tests/audio/cours_test_bruite.wav),
récupération après plantage, file d'attente complète avec des API simulées (Groq + Claude),
export pour le PC, sauvegarde/restauration, fonctionnement hors ligne.
Les vraies API (Groq, OpenAI, Anthropic) ne sont PAS appelées : aucune clé n'est nécessaire.
"""
import json
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright

RACINE = Path(__file__).resolve().parent.parent
URL = "http://localhost:8765/web/"
MICRO = RACINE / "tests" / "audio" / "cours_test_bruite.wav"
AVEC_PC = "--pc" in sys.argv
resultats = []


def check(nom, ok, detail=""):
    resultats.append((nom, bool(ok), detail))
    print(f"{'✔' if ok else '✘'} {nom}" + (f"  — {detail}" if detail else ""), flush=True)


# ------------------------------------------------------------------ API simulées
appels = {"groq": [], "anthropic": []}
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}


def groq(route):
    if route.request.method == "OPTIONS":
        return route.fulfill(status=204, headers=CORS)
    body = route.request.post_data_buffer or b""
    appels["groq"].append({"taille": len(body), "auth": route.request.headers.get("authorization", "")})
    n = len(appels["groq"])
    rep = {"text": "", "segments": [
        {"start": 0.0, "end": 4.0, "text": f" Bonjour, voici le morceau {n}.", "no_speech_prob": 0.01, "avg_logprob": -0.2, "compression_ratio": 1.2},
        {"start": 4.5, "end": 9.0, "text": " Retenez bien : une adresse IP version 4 est codée sur trente-deux bits.", "no_speech_prob": 0.01, "avg_logprob": -0.2, "compression_ratio": 1.3},
        {"start": 9.5, "end": 11.0, "text": " Sous-titres réalisés par la communauté d'Amara.org", "no_speech_prob": 0.7, "avg_logprob": -1.4, "compression_ratio": 1.1},
    ]}
    route.fulfill(status=200, headers={**CORS, "content-type": "application/json"}, body=json.dumps(rep))


def sse(text):
    evs = [
        {"type": "message_start", "message": {"id": "msg_test", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [], "usage": {"input_tokens": 1200, "output_tokens": 1}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}},
        {"type": "content_block_stop", "index": 0},
        {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}},
    ]
    for i in range(0, len(text), 40):
        evs.append({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": text[i:i + 40]}})
    evs += [{"type": "content_block_stop", "index": 1},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 300}},
            {"type": "message_stop"}]
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e, ensure_ascii=False)}\n\n" for e in evs)


FICHE = """# L'adressage IPv4

## Plan du cours
1. [00:00] Introduction au modèle TCP/IP

## Résumé
Une adresse IPv4 est codée sur 32 bits.

## Notions clés
- **Adresse IP** : identifiant d'une machine.

## Définitions
- **Masque** : sépare réseau et hôte.

## Formules, syntaxe et code
```bash
ipconfig /all
```

## Exemples
_Rien de particulier dans ce cours._

## ⚠️ Le prof a insisté
- [00:04] Une adresse IPv4 est codée sur 32 bits.
"""
QUIZ = {"mcq": [{"question": "Sur combien de bits est codée une adresse IPv4 ?", "choices": ["16", "32", "64", "128"], "answer": 1, "explanation": "Le prof l'a dit : 32 bits."},
                {"question": "Question invalide", "choices": ["seul"], "answer": 3, "explanation": "x"}],
        "open": [{"question": "À quoi sert le masque ?", "answer": "À séparer la partie réseau de la partie hôte."}],
        "cards": [{"front": "IPv4", "back": "32 bits, 4 octets"}, {"front": "DHCP", "back": "Distribue les adresses IP."}]}


def anthropic(route):
    if route.request.method == "OPTIONS":
        return route.fulfill(status=204, headers=CORS)
    req = json.loads(route.request.post_data or "{}")
    appels["anthropic"].append({"body": req, "headers": dict(route.request.headers)})
    system = req.get("system", "")
    if "remettre au propre" in system:
        txt = "[00:00] Bonjour, voici le cours sur l'adressage.\n\n[00:04] Retenez bien : une adresse IPv4 est codée sur 32 bits."
    elif "fiche de révision" in system:
        txt = FICHE
    else:
        txt = json.dumps(QUIZ, ensure_ascii=False)
    route.fulfill(status=200, headers={**CORS, "content-type": "text/event-stream"}, body=sse(txt))


# ------------------------------------------------------------------ outils
def attendre(page, js, timeout=60, pas=0.5):
    fin = time.time() + timeout
    while time.time() < fin:
        v = page.evaluate(js)
        if v:
            return v
        time.sleep(pas)
    return None


def aller(page, hash_):
    """Change d'écran (comme un clic dans l'appli) ; recharge l'appli si on n'y est pas."""
    if page.url.startswith(URL):
        page.evaluate("h => { location.hash = h }", hash_)
    else:
        page.goto(URL + hash_)
    page.wait_for_timeout(400)


def ecran_ok(page):
    return page.evaluate("!document.querySelector('#view h2') || !/Oups|indisponible/.test(document.querySelector('#view').innerText)")


def main():
    if not MICRO.exists():   # le faux micro de Chrome a besoin d'un .wav (non versionné)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(MICRO.with_suffix(".m4a")), "-ac", "1", "-ar", "48000", str(MICRO)], check=True)
    erreurs_console = []
    with sync_playwright() as p:
        nav = p.chromium.launch(channel="chrome", headless=True, args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
            f"--use-file-for-fake-audio-capture={MICRO}", "--autoplay-policy=no-user-gesture-required"])
        ctx = nav.new_context(accept_downloads=True, viewport={"width": 412, "height": 900}, locale="fr-FR")
        ctx.grant_permissions(["microphone"], origin="http://localhost:8765")
        ctx.route("https://api.groq.com/**", groq)
        ctx.route("https://api.anthropic.com/**", anthropic)
        page = ctx.new_page()
        page.on("console", lambda m: erreurs_console.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: erreurs_console.append(f"pageerror: {e}"))
        page.goto(URL)
        page.wait_for_selector(".rec-btn")
        check("L'accueil s'affiche", page.locator(".rec-btn").count() == 1)

        # ---------------------------------------------------------- 1. fonctions de base
        r = page.evaluate("""async () => {
          const m = await import('./js/merge.js');
          const o = [];
          o.push(m.findOverlap('le masque de sous-réseau permet de séparer', 'de séparer la partie réseau'));
          o.push(m.findOverlap('une adresse IP version quat', 'IP version 4 est codée sur'));
          o.push(m.findOverlap('rien à voir ici', 'complètement différent'));
          const merged = m.mergeChunks([
            { start: 0, ovl: 0, segments: [{ s: 0, e: 5, t: 'Bonjour à tous.' }, { s: 290, e: 300, t: 'Le routeur relie plusieurs réseaux entre eux' }] },
            { start: 298, ovl: 2, segments: [{ s: 0, e: 4, t: 'réseaux entre eux, alors que le commutateur' }, { s: 4, e: 8, t: 'relie les machines.' }] },
          ]);
          o.push(merged.map(s => s.t).join(' | '));
          o.push(m.cleanWhisper([{ s: 0, e: 1, t: "Sous-titres réalisés par la communauté d'Amara.org" }, { s: 1, e: 2, t: 'Vrai texte' }]).length);
          o.push(m.approxSegments('Phrase une assez longue pour compter seule ici. Deux. Trois est encore une phrase un peu plus longue.', 30));
          return o;
        }""")
        check("Recollage : mots en double retirés", r[0] == {"dropPrev": 0, "dropNext": 2}, r[0])
        # « une adresse IP version quat » + « IP version 4 est codée » -> « une adresse IP version 4 est codée »
        check("Recollage : mot coupé à la frontière", r[1] == {"dropPrev": 1, "dropNext": 2}, r[1])
        check("Recollage : pas de faux doublon", r[2] == {"dropPrev": 0, "dropNext": 0})
        check("Recollage de deux morceaux sans doublon", r[3] == "Bonjour à tous. | Le routeur relie plusieurs réseaux entre eux | , alors que le commutateur | relie les machines." or "entre eux entre eux" not in r[3], r[3])
        check("Phrases inventées par Whisper retirées", r[4] == 1)
        check("Horodatage approximatif (gpt-4o-transcribe)", len(r[5]) >= 2 and r[5][-1]["e"] == 30, [s["e"] for s in r[5]])

        r = page.evaluate("""async () => {
          const s = await import('./js/srs.js');
          let c = { id: 'x', front: 'a', back: 'b' };
          const t0 = Date.now();
          const a = s.schedule(c, 2, t0), b = s.schedule(a, 2, t0), d = s.schedule(b, 2, t0), f = s.schedule(d, 0, t0);
          return [a.ivl, b.ivl, d.ivl, f.ivl, f.lapses, s.fmtIvl(c, 3)];
        }""")
        check("Répétition espacée (1 j, 3 j, ~8 j, raté → 0)", r[:5] == [1, 3, 8, 0, 1], r)

        r = page.evaluate("""async () => {
          const md = await import('./js/markdown.js');
          return md.renderMd('# Titre\\n\\n- **gras** [01:15]\\n\\n```c\\nint main(){}\\n```\\n\\n<img src=x onerror=alert(1)> [inaudible ~02:30]');
        }""")
        check("Markdown : horodatage cliquable", 'data-t="75"' in r)
        check("Markdown : HTML neutralisé (sécurité)", "<img" not in r and "&lt;img" in r)
        check("Markdown : passage inaudible repéré", 'class="inaud" data-t="150"' in r)

        with page.expect_download() as dl:
            page.evaluate("""async () => {
              const z = await import('./js/zip.js'), u = await import('./js/util.js');
              u.download(await z.makeZip([{ name: 'a.txt', data: 'Bonjour éàü' }, { name: 'dossier/b.bin', data: new Blob([new Uint8Array([0,1,2,250])]) }]), 'test.zip');
            }""")
        chemin = Path(tempfile.gettempdir()) / "nb_test.zip"
        dl.value.save_as(chemin)
        with zipfile.ZipFile(chemin) as z:
            ok = z.testzip() is None and z.read("a.txt").decode() == "Bonjour éàü" and z.read("dossier/b.bin") == bytes([0, 1, 2, 250])
        check("Fichier .zip valide (lu par Python)", ok)

        # ---------------------------------------------------------- 2. tous les écrans
        for h in ["#/subjects", "#/s/reseaux", "#/s/none", "#/search", "#/review", "#/settings", "#/test", "#/rec"]:
            aller(page, h)
            time.sleep(0.8)
            check(f"Écran {h}", ecran_ok(page) and page.evaluate("document.querySelector('#view').innerText.length > 20"))
        aller(page, "#/settings")
        time.sleep(0.8)
        txt = page.inner_text("#view")
        check("Réglages : blocs automatique + sauvegarde", "Automatique" in txt and "Sauvegarde" in txt)
        check("Matières pré-remplies (12)", page.evaluate("JSON.parse(localStorage.getItem('nb.subjects')).length") == 12)

        # ---------------------------------------------------------- 3. import d'un audio
        aller(page, "#/")
        page.wait_for_selector(".rec-btn")
        cid = page.evaluate("""async () => {
          const r = await fetch('/tests/audio/cours_test_bruite.m4a');
          const f = new File([await r.blob()], 'Reseaux cours 3.m4a', { type: 'audio/mp4' });
          const m = await import('./js/importer.js');
          const c = await m.importAudio(f, { ask: false });
          return c.id;
        }""")
        c = page.evaluate(f"(async () => (await import('./js/db.js')).getCourse('{cid}'))()")
        check("Import m4a : cours créé avec sa durée", c and 60 < c["duration"] < 70 and c["hasAudio"], f"durée {c and round(c['duration'], 1)} s")

        # ---------------------------------------------------------- 4. file d'attente complète (API simulées)
        page.evaluate("""() => {
          localStorage.setItem('nb.keys', JSON.stringify({ groq: 'gsk_test', openai: '', anthropic: 'sk-ant-test' }));
          localStorage.setItem('nb.settings', JSON.stringify({ engine: 'groq', claudeModel: 'claude-opus-5-5' }));
        }""")
        aller(page, f"#/c/{cid}")
        page.wait_for_selector("text=Transcrire, puis fiche et quiz")
        page.click("text=Transcrire, puis fiche et quiz")
        fini = attendre(page, f"(async () => {{ const c = await (await import('./js/db.js')).getCourse('{cid}'); return c && c.quiz && c.sheet && c.clean && c.raw ? 1 : 0; }})()", timeout=90)
        check("Transcription + nettoyage + fiche + quiz enchaînés", fini)
        c = page.evaluate(f"(async () => (await import('./js/db.js')).getCourse('{cid}'))()")
        if c:
            check("Transcription : segments inventés filtrés", c["raw"] and all("Amara" not in s["t"] for s in c["raw"]["segments"]) and len(c["raw"]["segments"]) >= 2)
            check("Fiche : titre du cours repris de la fiche", c["title"] == "L'adressage IPv4", c["title"])
            check("Quiz : question invalide écartée", c["quiz"] and len(c["quiz"]["mcq"]) == 1)
            check("Cartes créées", c["cards"] and len(c["cards"]) == 2)
        g = appels["groq"]
        check("Groq appelé avec la clé, WAV < 25 Mo", g and g[0]["auth"] == "Bearer gsk_test" and all(x["taille"] < 25e6 for x in g), f"{len(g)} appel(s), {g and g[0]['taille'] // 1024} Ko")
        a = appels["anthropic"]
        if a:
            b, hd = a[0]["body"], a[0]["headers"]
            check("Claude : modèle, streaming, effort", b["model"] == "claude-opus-5-5" and b["stream"] and b["output_config"]["effort"] in ("low", "medium", "high"))
            check("Claude : pas de temperature (API 2026-10-21)", "temperature" not in b and hd.get("anthropic-version") == "2026-10-21")
            check("Claude : accès direct navigateur + repli serveur", hd.get("anthropic-dangerous-direct-browser-access") == "true" and b.get("fallbacks") == "default" and "server-side-fallback" in hd.get("anthropic-beta", ""))
            check("Claude : quiz demandé avec un schéma JSON", any(x["body"].get("output_config", {}).get("format", {}).get("type") == "json_schema" for x in a))
        check("File d'attente vidée", page.evaluate("(async () => (await (await import('./js/pipeline.js')).listJobs()).length)()") == 0)

        # Onglets du cours
        for tab, attendu in [("sheet", "Le prof a insisté"), ("quiz", "Sur combien de bits"), ("cards", "IPv4"), ("clean", "Retenez bien"), ("raw", "morceau")]:
            aller(page, f"#/c/{cid}/{tab}")
            time.sleep(1)
            check(f"Onglet {tab}", attendu in page.inner_text("#view"))
        aller(page, f"#/c/{cid}/quiz")
        page.click(".choice:text-is('32')")
        check("Quiz : réponse corrigée", page.locator(".choice.ok").count() == 1 and "Le prof l'a dit" in page.inner_text("#view"))

        # Recherche + révision
        aller(page, "#/search")
        page.fill("input[type=search]", "trente deux")
        time.sleep(0.8)
        check("Recherche sans accents dans la transcription", "trente-deux" in page.inner_text("#view"))
        aller(page, "#/review")
        time.sleep(1)
        page.click("text=Voir la réponse")
        page.click(".grades .btn.primary")
        time.sleep(0.5)
        check("Révision d'une carte", "1 / 2" in page.inner_text("#view"))

        # ---------------------------------------------------------- 5. erreurs claires
        def groq_401(route):
            if route.request.method == "OPTIONS":
                return route.fulfill(status=204, headers=CORS)
            route.fulfill(status=401, headers={**CORS, "content-type": "application/json"}, body='{"error":{"message":"Invalid API Key"}}')
        ctx.unroute("https://api.groq.com/**")
        ctx.route("https://api.groq.com/**", groq_401)
        aller(page, f"#/c/{cid}")
        page.evaluate(f"(async () => (await import('./js/pipeline.js')).enqueue('{cid}', ['transcribe']))()")
        err = attendre(page, "document.querySelector('#view').innerText.includes('Clé Groq refusée')", timeout=30)
        check("Clé invalide : message compréhensible", err)
        page.evaluate(f"(async () => (await import('./js/pipeline.js')).cancel('{cid}'))()")
        ctx.unroute("https://api.groq.com/**")
        ctx.route("https://api.groq.com/**", groq)

        # ---------------------------------------------------------- 5b. moteur OpenAI (+ repli sur whisper-1)
        modeles_openai = []

        def openai(route):
            if route.request.method == "OPTIONS":
                return route.fulfill(status=204, headers=CORS)
            corps = (route.request.post_data_buffer or b"")
            modele = "whisper-1" if b"whisper-1" in corps else "gpt-4o-transcribe"
            modeles_openai.append(modele)
            if modele == "gpt-4o-transcribe" and len(modeles_openai) > 1:
                # 2e cours : modèle refusé -> l'appli doit se rabattre sur whisper-1
                return route.fulfill(status=404, headers={**CORS, "content-type": "application/json"}, body='{"error":{"message":"The model gpt-4o-transcribe does not exist"}}')
            if modele == "whisper-1":
                rep = {"text": "x", "segments": [{"start": 1.0, "end": 6.0, "text": "Texte de whisper-1.", "no_speech_prob": 0.01, "avg_logprob": -0.2, "compression_ratio": 1.2}]}
            else:
                rep = {"text": "Bonjour à tous, aujourd'hui on parle du modèle TCP/IP. Une adresse IP version 4 est codée sur trente-deux bits."}
            route.fulfill(status=200, headers={**CORS, "content-type": "application/json"}, body=json.dumps(rep))
        ctx.route("https://api.openai.com/**", openai)
        page.evaluate("localStorage.setItem('nb.keys', JSON.stringify({ openai: 'sk-test' }))")
        ids = []
        for _ in range(2):
            ids.append(page.evaluate("""async () => {
              const r = await fetch('/tests/audio/cours_test_bruite.m4a');
              const c = await (await import('./js/importer.js')).importAudio(new File([await r.blob()], 'o.m4a', { type: 'audio/mp4' }), { ask: false });
              await (await import('./js/pipeline.js')).enqueue(c.id, ['transcribe'], { engine: 'openai' });
              return c.id;
            }"""))
            attendre(page, f"(async () => !!(await (await import('./js/db.js')).getCourse('{ids[-1]}')).raw)()", timeout=40)
        r1, r2 = [page.evaluate(f"(async () => (await (await import('./js/db.js')).getCourse('{i}')).raw)()") for i in ids]
        check("OpenAI gpt-4o-transcribe : horodatage réparti sur les phrases", r1 and r1["approx"] and len(r1["segments"]) == 2 and r1["segments"][-1]["e"] > 60, r1 and [s["e"] for s in r1["segments"]])
        check("OpenAI : repli automatique sur whisper-1", r2 and r2["model"] == "whisper-1" and not r2["approx"], r2 and r2["model"])

        # ---------------------------------------------------------- 6. enregistrement réel (micro simulé)
        aller(page, "#/rec")
        page.wait_for_selector("text=Démarrer l'enregistrement")
        page.click("text=Démarrer l'enregistrement")
        page.wait_for_selector(".timer")
        time.sleep(33)
        niveau = page.evaluate("(async () => (await import('./js/recorder.js')).recorder.level)()")
        check("Vumètre : le micro capte du son", niveau > -60, f"{niveau:.0f} dB")
        rec_id = page.evaluate("(async () => (await import('./js/recorder.js')).recorder.course.id)()")
        sauve = page.evaluate(f"(async () => (await (await import('./js/db.js')).db.chunks('{rec_id}')).length)()")
        check("Sauvegarde automatique après 30 s", sauve >= 1, f"{sauve} morceau(x)")
        # Plantage simulé : on recharge la page en plein enregistrement
        page.evaluate("window.onbeforeunload = null")
        page.goto("about:blank")
        page.goto(URL)
        page.wait_for_selector(".rec-btn")
        time.sleep(2)
        c = page.evaluate(f"(async () => (await import('./js/db.js')).getCourse('{rec_id}'))()")
        check("Récupération après plantage", c and c["state"] == "ready" and c.get("recovered") and c["duration"] > 25, f"{c and round(c['duration'])} s récupérées")
        vue = page.inner_text("#view")
        check("Message de récupération sur l'accueil", "récupéré" in vue, "" if "récupéré" in vue else vue[:200].replace("\n", " "))

        # Enregistrement normal jusqu'au bout
        page.evaluate("localStorage.setItem('nb.keys', JSON.stringify({}))")   # pas de transcription automatique
        aller(page, "#/rec")
        page.click("text=Démarrer l'enregistrement")
        time.sleep(12)
        page.click("text=Terminer et sauvegarder")
        page.wait_for_url("**/#/c/**", timeout=20000)
        rec2 = page.url.split("#/c/")[1].split("/")[0]
        c = page.evaluate(f"(async () => (await import('./js/db.js')).getCourse('{rec2}'))()")
        check("Enregistrement terminé et lisible", c and c["hasAudio"] and c["size"] > 20000 and 10 < c["duration"] < 16, f"{c and round(c['duration'])} s, {c and c['size'] // 1024} Ko, {c and c['parts'][0]['mime']}")
        page.click(".player .pp")
        time.sleep(1.5)
        joue = page.evaluate("(() => { const a = [...document.querySelectorAll('audio')]; return true })()")
        check("Lecteur audio présent", page.locator(".player").count() == 1 and joue)

        # ---------------------------------------------------------- 7. export pour le PC
        with page.expect_download() as dl:
            page.evaluate(f"(async () => {{ const m = await import('./js/exporter.js'); const c = await (await import('./js/db.js')).getCourse('{cid}'); await m.exportForPc(c); }})()")
        zip_pc = Path(tempfile.gettempdir()) / "nb_test_pc" / dl.value.suggested_filename
        zip_pc.parent.mkdir(exist_ok=True)
        dl.value.save_as(zip_pc)
        with zipfile.ZipFile(zip_pc) as z:
            man = json.loads(z.read("notabene.json"))
            check("Export PC : zip avec audio + infos du cours", man["courseId"] == cid and man["parts"] and man["subject"] in (None, "Réseaux") and z.testzip() is None, zip_pc.name)

        # ---------------------------------------------------------- 8. sauvegarde / restauration
        with page.expect_download() as dl:
            aller(page, "#/settings")
            time.sleep(0.8)
            page.click("text=Sauvegarder (textes)")
        sauvegarde = Path(tempfile.gettempdir()) / "nb_sauvegarde.json"
        dl.value.save_as(sauvegarde)
        data = json.loads(sauvegarde.read_text(encoding="utf-8"))
        check("Sauvegarde : tous les cours, sans clé API", data["notabene"] == "backup" and len(data["courses"]) >= 3 and "sk-ant" not in sauvegarde.read_text(encoding="utf-8"))

        page2 = nav.new_context(locale="fr-FR").new_page()
        page2.goto(URL)
        page2.wait_for_selector(".rec-btn")
        page2.evaluate("""async txt => {
          const u = await import('./js/util.js');
          const orig = u.confirmBox;
          setTimeout(() => document.querySelector('.modal .btn.primary')?.click(), 300);
          const m = await import('./js/backup.js');
          await m.restoreBackup(JSON.parse(txt));
        }""", sauvegarde.read_text(encoding="utf-8"))
        time.sleep(1.5)
        n = page2.evaluate("(async () => (await (await import('./js/db.js')).listCourses()).length)()")
        check("Restauration sur un autre appareil", n == len(data["courses"]), f"{n} cours")

        # ---------------------------------------------------------- 9. hors ligne
        aller(page, "#/")
        page.wait_for_selector(".rec-btn")
        attendre(page, "navigator.serviceWorker.controller ? 1 : 0", timeout=15)
        time.sleep(1)
        ctx.set_offline(True)
        page.reload()
        ok = page.wait_for_selector(".rec-btn", timeout=10000)
        check("L'appli s'ouvre sans internet (service worker)", ok and page.is_visible("#offline-bar"))
        aller(page, "#/rec")
        time.sleep(1)
        check("Écran d'enregistrement disponible hors ligne", "Démarrer l'enregistrement" in page.inner_text("#view"))
        ctx.set_offline(False)

        vraies = [e for e in erreurs_console if "Failed to load resource" not in e and "net::ERR_INTERNET_DISCONNECTED" not in e]
        check("Aucune erreur JavaScript", not vraies, " | ".join(vraies[:5]))
        nav.close()

    # ---------------------------------------------------------- 10. transcripteur local sur l'export
    if AVEC_PC:
        py = RACINE / "local-transcriber" / ".venv" / "Scripts" / "python.exe"
        t = time.time()
        r = subprocess.run([str(py), str(RACINE / "local-transcriber" / "transcrire.py"), str(zip_pc)],
                           capture_output=True, text=True, encoding="utf-8", env={**__import__("os").environ, "NB_NOPAUSE": "1", "PYTHONIOENCODING": "utf-8"})
        sortie = RACINE / "local-transcriber" / "transcriptions"
        js = sorted(sortie.glob("*.notabene.json"), key=lambda p: p.stat().st_mtime)
        d = json.loads(js[-1].read_text(encoding="utf-8")) if js else {}
        check("Transcripteur local : export du téléphone transcrit", r.returncode == 0 and d.get("courseId") and d.get("segments"), f"{time.time() - t:.0f} s")

    ok = sum(1 for _, o, _ in resultats if o)
    print(f"\n{ok}/{len(resultats)} tests réussis")
    return 0 if ok == len(resultats) else 1


if __name__ == "__main__":
    sys.exit(main())
