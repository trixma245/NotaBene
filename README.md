# NotaBene

NotaBene enregistre tes cours, les transcrit (le texte de ce que dit le prof) et en fait des **fiches de révision**, des **quiz** et des **cartes** à réviser.

Il a été pensé pour une situation précise : le téléphone ou le PC n'est **pas près du prof** (dans le sac, dans un casier, au fond de la salle). Le son est lointain et bruité. NotaBene enregistre donc d'abord un audio fiable, puis le fait transcrire par un modèle puissant (Whisper large-v3), et enfin Claude corrige le texte grâce au vocabulaire de la matière.

```
Enregistrer (ou importer)  →  Transcrire (Groq, OpenAI ou ton PC)  →  Nettoyer + Fiche + Quiz (Claude)  →  Réviser
```

Il y a deux parties :

| Dossier | Ce que c'est |
|---|---|
| `web/` | L'appli (téléphone et PC). Elle s'installe comme une vraie appli, marche sans internet pour enregistrer, et garde tout **sur ton appareil**. |
| `local-transcriber/` | Le transcripteur pour ton PC Windows. Il utilise ta carte graphique NVIDIA : **gratuit**, sans internet, très bonne qualité. |

---

## Sommaire

1. [Tester l'appli sur ton PC](#1-tester-lappli-sur-ton-pc)
2. [Publier l'appli sur GitHub Pages](#2-publier-lappli-sur-github-pages)
3. [Installer l'appli sur ton téléphone Android](#3-installer-lappli-sur-ton-téléphone-android)
4. [Créer tes clés API et combien ça coûte](#4-créer-tes-clés-api-et-combien-ça-coûte)
5. [Installer et utiliser le transcripteur local (PC)](#5-installer-et-utiliser-le-transcripteur-local-pc)
6. [Conseils pour bien capter le son](#6-conseils-pour-bien-capter-le-son)
7. [Utiliser NotaBene au quotidien](#7-utiliser-notabene-au-quotidien)
8. [Problèmes fréquents](#8-problèmes-fréquents)
9. [Pour aller plus loin (tests, modifications)](#9-pour-aller-plus-loin)

---

## 1. Tester l'appli sur ton PC

L'appli doit être ouverte depuis une petite « adresse locale » (pas en double-cliquant sur le fichier), sinon le navigateur refuse le micro.

**Avec VS Code et l'extension Live Server :**

1. Ouvre VS Code → menu **Fichier → Ouvrir le dossier…** → choisis le dossier `NotaBene`.
2. À gauche, clique sur l'icône des **Extensions** (4 petits carrés) → cherche **Live Server** (auteur : Ritwick Dey) → **Installer**.
3. Dans l'explorateur de fichiers de VS Code, ouvre `web` → **clic droit sur `index.html` → Open with Live Server**.
4. Le navigateur s'ouvre sur une adresse du type `http://127.0.0.1:5500/web/index.html`. C'est l'appli.
5. La première fois que tu enregistres, le navigateur demande l'accès au micro : clique **Autoriser**.

**Sans VS Code** (si Python est installé) : ouvre un terminal dans le dossier `NotaBene` et tape `python tests/serveur_test.py`, puis ouvre <http://localhost:8765/web/>.

> 💡 Sur PC, tu peux **glisser-déposer** un fichier audio n'importe où sur la fenêtre de l'appli pour l'importer.

---

## 2. Publier l'appli sur GitHub Pages

Publier sur GitHub Pages te donne une adresse `https://…` que tu peux ouvrir sur ton téléphone. C'est gratuit.

> 🔐 **Tes clés API ne seront jamais publiées** : elles restent uniquement dans le navigateur de chaque appareil. Le fichier `.gitignore` empêche aussi d'envoyer tes audios, tes transcriptions, tes sauvegardes et `PROMPT_CLAUDE_CODE.md`.

### a) Créer le dépôt sur GitHub

1. Va sur <https://github.com> → **Sign up** si tu n'as pas de compte (retiens ton **pseudo**, par exemple `koffi-irt`).
2. Une fois connecté : en haut à droite, clique sur **+** → **New repository**.
3. **Repository name** : `NotaBene`.
4. Choisis **Public** (GitHub Pages est gratuit pour les dépôts publics ; ton code est visible, mais pas tes cours ni tes clés, qui restent sur ton téléphone).
5. **Ne coche rien** d'autre (pas de README, pas de .gitignore : ils existent déjà).
6. Clique **Create repository**. Laisse la page ouverte.

### b) Envoyer le code

Le dossier `NotaBene` est déjà un dépôt git avec tout l'historique. Dans un terminal ouvert dans le dossier `NotaBene` (dans VS Code : menu **Terminal → Nouveau terminal**), tape ces lignes en remplaçant `TON-PSEUDO` :

```
git remote add origin https://github.com/TON-PSEUDO/NotaBene.git
git push -u origin main
```

Une fenêtre GitHub s'ouvre pour te connecter la première fois : connecte-toi et autorise.

### c) Activer GitHub Pages

1. Sur la page de ton dépôt GitHub, clique sur **Settings** (l'onglet avec un engrenage, en haut).
2. Dans le menu de gauche, clique sur **Pages**.
3. Sous **Build and deployment** → **Source**, choisis **Deploy from a branch**.
4. Sous **Branch**, choisis **main** et le dossier **/ (root)**, puis clique **Save**.
5. Attends 1 à 2 minutes et recharge la page : l'adresse s'affiche en haut, du type `https://TON-PSEUDO.github.io/NotaBene/`.
6. Ouvre-la : tu arrives sur l'appli (la racine renvoie automatiquement vers `web/`).

### d) Publier une modification plus tard

```
git add -A
git commit -m "Ce que j'ai changé"
git push
```

⚠️ Si tu modifies le code de l'appli, change aussi la ligne `const VERSION = 'notabene-v1';` dans `web/sw.js` (par exemple en `notabene-v2`). Sinon les téléphones garderont l'ancienne version en mémoire. L'appli proposera alors « Nouvelle version disponible → Mettre à jour ».

---

## 3. Installer l'appli sur ton téléphone Android

1. Sur ton téléphone, ouvre **Chrome** et va sur ton adresse `https://TON-PSEUDO.github.io/NotaBene/`.
2. Touche le menu **⋮** (en haut à droite) → **Installer l'application** (ou **Ajouter à l'écran d'accueil** → **Installer**).
3. L'icône NotaBene apparaît sur l'écran d'accueil. Ouvre l'appli depuis cette icône (plein écran, sans barre d'adresse).
4. Au premier enregistrement, **autorise le micro**.
5. Va dans **Réglages → 4. Stockage** et touche **Protéger mes données** : le navigateur n'effacera pas tes cours s'il manque de place.
6. Colle tes clés API dans **Réglages** (voir partie 4). Elles restent sur ce téléphone uniquement.

**Bonus : partager depuis le Dictaphone.** Une fois l'appli installée, dans l'appli Dictaphone (ou Fichiers, WhatsApp…), touche **Partager** sur un enregistrement → choisis **NotaBene**. Le fichier est importé directement.

> 📴 L'appli s'ouvre et **enregistre sans internet**. La transcription démarrera toute seule quand le réseau reviendra.

---

## 4. Créer tes clés API et combien ça coûte

Une « clé API » est un mot de passe qui permet à l'appli d'utiliser un service. Tu la colles dans **Réglages** et tu touches **Tester la clé**.

Tu n'as pas besoin des trois :
- **Pour transcrire** : Groq (gratuit) **ou** OpenAI **ou** ton PC (gratuit, partie 5).
- **Pour le texte propre, la fiche et le quiz** : Anthropic (Claude).

### Groq — transcription (offre gratuite)

1. Va sur <https://console.groq.com> → connecte-toi (avec un compte Google, par exemple).
2. Menu **API Keys** → **Create API Key** → donne un nom (`NotaBene`) → **Submit**.
3. Copie la clé (elle commence par `gsk_`) : elle n'est affichée qu'une fois.
4. Dans NotaBene : **Réglages → 1. Transcription** → moteur **Groq** → colle la clé → **Tester la clé**.

**Coût** : l'offre gratuite suffit pour un étudiant. Elle permet plusieurs heures d'audio par jour, mais limite le débit (environ 2 h d'audio par heure). Les limites exactes sont sur <https://console.groq.com/settings/limits>. Si une limite est atteinte, NotaBene attend et reprend tout seul. En payant, c'est environ **0,11 $ par heure de cours**.

### OpenAI — transcription (payant)

1. Va sur <https://platform.openai.com> → crée un compte.
2. **Settings → Billing** → ajoute du crédit (5 $ minimum).
3. Va sur <https://platform.openai.com/api-keys> → **Create new secret key** → copie la clé (`sk-…`).
4. Dans NotaBene : moteur **OpenAI** → colle la clé.

**Coût** : environ **0,36 $ par heure de cours** (gpt-4o-transcribe). Ce modèle ne donne pas l'heure exacte de chaque phrase : NotaBene la répartit sur le morceau, donc à quelques secondes près. Si ton compte n'a pas accès à gpt-4o-transcribe, l'appli passe toute seule sur whisper-1 (heures précises, même prix).

### Anthropic (Claude) — texte propre, fiche, quiz, cartes

1. Va sur <https://console.anthropic.com> → crée un compte.
2. **Settings → Billing** → ajoute du crédit (5 $ minimum). Conseil : règle aussi une **limite de dépense mensuelle** dans **Settings → Limits**.
3. **Settings → API Keys** → **Create Key** → nom `NotaBene` → copie la clé (`sk-ant-…`).
4. Dans NotaBene : **Réglages → 2. Nettoyage, fiches et quiz** → colle la clé → **Tester la clé**.
5. Choisis le **modèle Claude** :

| Modèle | Qualité | Coût approximatif **par heure de cours** (nettoyage + fiche + quiz) |
|---|---|---|
| Claude Opus 5.5 *(recommandé, par défaut)* | Excellente | ~0,80 $ (≈ 450–500 FCFA) |
| Claude Sonnet 5.5 | Très bonne | ~0,40 $ (≈ 250 FCFA) |
| Claude Haiku 5.5 | Correcte, plus simple | ~0,02 $ (≈ 15 FCFA) |
| Claude Fable 5.2 | La meilleure | ~1,60 $ (≈ 950 FCFA) |

Ce sont des ordres de grandeur : une heure de cours fait environ 9 000 mots. Le coût réel dépend du débit du prof, et la conversion en FCFA varie avec le taux du dollar.

**Exemple de budget** : 15 h de cours par semaine avec Groq (gratuit) + Claude Sonnet 5.5 ≈ 6 $ par semaine. Avec Haiku 5.5 : moins de 0,50 $ par semaine.

> 🔐 Les clés sont gardées dans le navigateur de l'appareil, jamais dans le code, jamais dans les sauvegardes, et elles ne sont envoyées qu'au service concerné. Ne prête pas ton téléphone déverrouillé : quelqu'un pourrait lire la clé dans les Réglages. Si une clé fuit, supprime-la sur le site du service et crées-en une autre.

---

## 5. Installer et utiliser le transcripteur local (PC)

Le transcripteur local utilise ta carte graphique NVIDIA pour transcrire **gratuitement, sans internet**, avec le meilleur modèle (Whisper large-v3).

### Installation (une seule fois)

1. Ouvre le dossier `NotaBene\local-transcriber` dans l'explorateur Windows.
2. **Double-clique sur `INSTALLER.bat`**.
3. Laisse faire. Il :
   - vérifie Python (et l'installe s'il manque),
   - détecte ta carte graphique,
   - installe faster-whisper, ffmpeg et les bibliothèques NVIDIA (~2,3 Go),
   - télécharge le modèle large-v3 (~3 Go),
   - fait un petit test sur la carte graphique.
4. Compte **10 à 30 minutes** selon ta connexion, et **~5,5 Go** d'espace disque. À la fin : « Installation terminée ! ».

Tu peux relancer `INSTALLER.bat` sans risque : il ne réinstalle que ce qui manque.

> ℹ️ Ta **RTX 3050 Laptop a 4 Go de mémoire** (et non 6). Le transcripteur le détecte et charge le modèle en mode `int8_float16`, qui prend deux fois moins de mémoire avec une qualité quasi identique. S'il y avait un souci avec la carte graphique, il passerait tout seul sur le processeur (beaucoup plus lent).

### Utilisation

**Méthode 1 — glisser-déposer :** prends un fichier audio (m4a, mp3, wav, ogg, opus, webm, mp4…) et **lâche-le sur `TRANSCRIRE.bat`**. Une fenêtre montre l'avancement. Le dossier des résultats s'ouvre à la fin.

**Méthode 2 — dossier surveillé :** double-clique sur **`SURVEILLER.bat`**, puis dépose tes fichiers dans le dossier `a_transcrire`. Chaque fichier est transcrit automatiquement, puis rangé dans `a_transcrire\_faits`.
- Astuce : crée un sous-dossier au nom de la matière (`a_transcrire\Reseaux\`, `a_transcrire\Langage C\`…) : son vocabulaire sera utilisé.

**Les résultats** arrivent dans `local-transcriber\transcriptions` :
- `.txt` : le texte, par paragraphes, avec l'heure de chaque paragraphe ;
- `.srt` : sous-titres (lisibles avec VLC à côté de l'audio) ;
- `.notabene.json` : **à importer dans l'appli** (Accueil → **📥 Importer un audio** → choisis ce fichier). Ensuite Claude fait le texte propre, la fiche et le quiz.

**Depuis le téléphone :** dans un cours, choisis le moteur « Local PC » → **💻 Exporter pour le PC**. Tu obtiens un `.zip` avec l'audio et les infos du cours (matière, vocabulaire). Envoie-le sur le PC (câble, Drive, WhatsApp…) et lâche-le sur `TRANSCRIRE.bat`. Le `.notabene.json` obtenu se range **dans le même cours** quand tu l'importes.

**Vitesse mesurée sur ton PC** : environ 1 minute pour charger le modèle, puis ~6 fois plus vite que le temps réel. **Un cours d'1 h prend donc ~10 minutes.**

---

## 6. Conseils pour bien capter le son

Avant tout : fais un **🎚️ Test de captation** (accueil). Il enregistre 15 s, te les fait réécouter, mesure le niveau et peut même transcrire l'extrait. Fais-le **à l'endroit exact** où sera l'appareil pendant le cours.

**Position**
- Le micro du téléphone est **en bas** : tourne-le vers le prof.
- Dans un sac : **poche extérieure**, fermeture entrouverte, rien qui frotte dessus (les frottements couvrent la voix).
- Sur la table : pose le téléphone sur un cahier ou un pull (moins de vibrations), loin du stylo qui tapote.
- Évite les ventilateurs, la clim et les bavards. Devant > fond de la salle.

**Réglages**
- Micro **Brut** (par défaut) : c'est ce qui donne la meilleure transcription.
- **Renforcer la voix** : seulement si le test montre un son vraiment très faible.
- Remplis le **vocabulaire de chaque matière** (Matières → une matière → ⋯ → Modifier le vocabulaire) : sigles, noms de commandes, termes du prof. Whisper et Claude les écriront correctement.

**Pendant le cours, sur téléphone**
- ⚠️ **Ne verrouille pas l'écran** : le navigateur couperait le micro. NotaBene garde l'écran allumé. Utilise le bouton **🌑 Écran noir** pour économiser la batterie (touche deux fois l'écran pour revenir), et baisse la luminosité.
- Branche le téléphone si possible, ou vérifie la batterie affichée.
- Le **mode avion** évite les appels et les bruits parasites. L'enregistrement marche sans réseau.
- Tout est **sauvegardé toutes les 30 secondes** : si l'appli plante ou si la batterie meurt, tu ne perds que les dernières secondes. Rouvre l'appli : l'enregistrement est récupéré.

**Solution de secours (écran éteint, sac fermé)** : utilise l'appli **Dictaphone** de ton téléphone, qui continue même écran verrouillé. Après le cours : **Partager → NotaBene**, ou **📥 Importer un audio**.

---

## 7. Utiliser NotaBene au quotidien

1. **Avant le cours** : gros bouton rouge → choisis la matière → **Démarrer**.
2. **Après** : **Terminer et sauvegarder**. Si tes clés sont enregistrées, tout s'enchaîne automatiquement : transcription → texte propre → fiche → quiz et cartes. Tu peux fermer l'appli : ça reprendra où ça en était.
3. **Le cours** contient plusieurs onglets :
   - **Fiche** : plan, résumé, notions clés, définitions, code, exemples, et **⚠️ Le prof a insisté**. Bouton **🖨️ Imprimer / PDF**.
   - **Quiz** : QCM corrigés tout de suite et questions ouvertes.
   - **Cartes** : les cartes du cours. Tu peux aussi en ajouter.
   - **Texte propre** : la transcription corrigée par Claude ([inaudible ~mm:ss] là où ce n'était vraiment pas compréhensible : rien n'est inventé).
   - **Transcription** : le texte brut. **Touche une phrase → l'audio saute à ce moment.**
4. **🧠 Réviser** : chaque jour, les cartes à revoir (Raté / Difficile / Bien / Facile). Elles reviennent au bon moment pour être retenues.
5. **🔎 Recherche** : un mot dans tous tes cours (les accents ne comptent pas).
6. **Menu ⋯ d'un cours** : renommer, refaire une étape, exporter (.md, .txt, audio), supprimer.

**Passer du téléphone au PC (ou l'inverse)** : Réglages → **5. Sauvegarde** → **💾 Sauvegarder** → envoie le fichier `.json` sur l'autre appareil → **📂 Restaurer**. Les clés API n'y sont jamais.

**Libérer de la place** : Réglages → 4. Stockage → supprime les audios des cours déjà transcrits (fiche, texte et quiz sont gardés).

---

## 8. Problèmes fréquents

| Problème | Solution |
|---|---|
| « Micro refusé » | Touche le cadenas à gauche de l'adresse → Autorisations → Micro → Autoriser. Sur Android : Paramètres → Applications → Chrome → Autorisations → Micro. |
| L'enregistrement s'est arrêté écran verrouillé | Normal sur téléphone : utilise l'écran noir au lieu de verrouiller, ou le Dictaphone en secours. Les coupures sont signalées dans le cours. |
| « Clé … refusée » | Recopie la clé en entier, sans espace, puis **Tester la clé**. Si elle ne marche toujours pas, crée-en une nouvelle sur le site du service. |
| « Crédit Anthropic épuisé » | Recharge sur console.anthropic.com → Billing, ou passe à un modèle moins cher. |
| « Limite d'utilisation Groq atteinte » | Rien à faire : NotaBene attend et reprend tout seul. |
| La transcription est mauvaise | Fais un test de captation, rapproche l'appareil, complète le vocabulaire de la matière, puis menu ⋯ → **Refaire la transcription**. Le transcripteur local donne souvent le meilleur résultat. |
| Le transcripteur PC dit « impossible » pour la carte graphique | Mets à jour le pilote NVIDIA (GeForce Experience ou nvidia.com), puis relance `INSTALLER.bat`. Le détail des erreurs est dans `local-transcriber\journal.log`. |
| L'appli ne se met pas à jour | Ferme-la complètement et rouvre-la, puis touche **Mettre à jour** quand c'est proposé. |

---

## 9. Pour aller plus loin

### Organisation du code

```
index.html                 renvoie vers web/ (pour GitHub Pages)
web/
  index.html, manifest.webmanifest, sw.js (hors ligne), css/, icons/
  js/app.js                navigation entre les écrans
  js/recorder.js           enregistrement robuste (morceaux de 30 s dans IndexedDB, parties de 5 min)
  js/db.js                 stockage local (IndexedDB)
  js/audio.js              décodage, mono 16 kHz, normalisation, WAV
  js/transcribe.js         transcription Groq / OpenAI (morceaux de 5 min, 2 s de chevauchement)
  js/merge.js              recollage sans doublons, filtres anti-« hallucinations »
  js/claude.js, js/ai.js   API Claude : nettoyage, fiche, quiz et cartes
  js/pipeline.js           file d'attente persistante (reprise, réseau, limites)
  js/importer.js, exporter.js, backup.js, zip.js, srs.js, markdown.js, settings.js, keys.js, util.js
  js/views/                les écrans (accueil, enregistrement, cours, matières, recherche, réviser, réglages)
  js/course/               les onglets d'un cours (fiche, quiz, cartes, texte propre, transcription)
local-transcriber/
  INSTALLER.bat, TRANSCRIRE.bat, SURVEILLER.bat, transcrire.py, matieres.json
tests/
  test_pwa.py              57 tests automatiques dans un vrai Chrome
  mesurer_wer.py           mesure de la qualité de transcription
  audio/cours_test_bruite.m4a   « cours » lointain et bruité (fabriqué par generer_audio_test.ps1)
```

### Lancer les tests (facultatif)

```
pip install playwright
python tests/serveur_test.py            (dans un premier terminal)
python tests/test_pwa.py                (dans un second terminal)
python tests/test_pwa.py --pc           (+ transcription réelle avec le transcripteur local)
```

Les tests utilisent le Chrome déjà installé, simulent le micro avec l'audio de test et simulent les API (aucune clé, aucun coût). Ils couvrent : enregistrement et récupération après plantage, import, transcription → nettoyage → fiche → quiz, messages d'erreur, OpenAI et son repli, export vers le PC, sauvegarde et restauration, fonctionnement hors ligne.

### Qualité de transcription mesurée

Sur `tests/audio/cours_test_bruite.m4a` (voix étouffée et lointaine, écho, souffle, ventilateur, volume faible), avec le transcripteur local :

| Préparation du son | Mots faux |
|---|---|
| Passe-haut + débruitage + normalisation (afftdn, loudnorm) | 24,8 % |
| Passe-haut seul | 20,5 % |
| **Son brut converti en mono 16 kHz (réglage retenu)** | **17,4 %** |

Whisper a été entraîné sur des sons bruités : le débruitage crée des artefacts qui le gênent plus que le bruit lui-même. Le transcripteur n'applique donc aucun filtre par défaut (option `--filtres` pour essayer), et l'appli se contente de normaliser le volume. Les erreurs restantes (« objets » au lieu de « octets »…) sont justement celles que l'étape **Texte propre** corrige avec le vocabulaire de la matière.

Pour mesurer toi-même : `python tests/mesurer_wer.py local-transcriber/transcriptions/<fichier>.notabene.json`.
