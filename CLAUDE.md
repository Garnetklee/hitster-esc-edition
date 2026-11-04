# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Überblick

Privates Musik-Zeitleistenspiel im Stil von Hitster mit allen ESC-Beiträgen 1956–2026. Gespielt wird auf einem Gerät für alle (auch solo). Das Projekt besteht aus zwei getrennten Teilen, die nur über `esc_songs.json` verbunden sind:

- `app/`: statische Web-App (PWA) aus reinem HTML und ES-Modulen, ohne Build-Schritt, Backend und npm-Abhängigkeiten
- `tools/` und `data/`: Python-Pipeline, die die Liederliste erzeugt

Code, Kommentare, UI-Texte und Commit-Nachrichten sind auf Deutsch.

## Befehle

```bash
python -m http.server 8765 -d app          # App lokal starten (Preview-Name in Claude Code: esc-app)
node --test                                # alle Tests, im Projektordner starten
node --test --test-name-pattern="Migration"  # einzelne Tests nach Name
```

Es gibt keinen Linter und keinen Build. `?dev=1` an der URL spielt auch Lieder ohne Video. Über `window.ESC` lassen sich Spielstand und Spielablauf im Browser prüfen und steuern (`state`, `setGap`, `reveal`, `next` usw.).

Datenskripte laufen mit dem venv:

```bash
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe tools\07_export_json.py
```

## Deployment

**Jeder Push auf `main` geht sofort live** (`.github/workflows/pages.yml` veröffentlicht `app/` auf https://garnetklee.github.io/hitster-esc-edition/). Also erst pushen, wenn Tests und Browserprüfung bestanden sind. `gh` ist nicht installiert, der Git-Login liegt im Credential Manager. Handy, Touch, Autoplay und YouTube-Werbung kann nur Finn selbst testen.

## Pflichten bei Änderungen

- **App-Dateien geändert:** `VERSION` in `app/sw.js` erhöhen, sonst sehen Geräte eine Ladung lang den alten Stand. Neue JS-Dateien in `SHELL` eintragen.
- **Regeln oder Spielstand-Felder geändert:** Gespeicherte Stände in `localStorage` müssen weiter laden. Dafür `SETTINGS_VERSION` erhöhen, `migrateSettings`/`migrateState` in `app/js/settings.js` ergänzen und einen Test schreiben.
- **Daten korrigieren:** nur über `data/overrides.csv` (`id;feld;wert;grund`), danach `tools\07_export_json.py`. Neue Video-IDs vorher mit `tools\05_check_links.py` prüfen.
- **Spiellogik:** gehört ohne DOM in `app/js/data.js` oder `app/js/settings.js`, damit sie testbar bleibt.

## Architektur der App

- `app/js/app.js` enthält UI und Spielablauf und ist bewusst ein großes Modul. Arbeit daran läuft deshalb nacheinander, nicht parallel.
- Der Zustand steckt in einem einzigen serialisierbaren Objekt `state`. Es enthält die Spieler (Zeitleisten nur als Lied-IDs), die gezogenen Lieder und `state.cur`, den aktuellen Zug mit `phase`, gewählter Lücke und Tipps. Nach Änderungen folgt `save()` (`localStorage`) und `render()`, das die Spielansicht aus dem Zustand neu zeichnet. Flüchtiges gehört in Modulvariablen, nicht in `state`.
- Ablauf eines Zugs: `startTurn` → `draw` → Hören und Lücke wählen → `tryReveal`/`reveal` → `nextTurn`, am Ende `endGame`.
- `app/js/settings.js` definiert die Regeln (`DEFAULT_RULES`), die fertigen Modi (`PRESETS`) und die Migrationen. Spielmodi sind nur Kombinationen dieser Regeln.
- `app/js/data.js` lädt und normalisiert die Lieder (`loadSongs`, Fallback auf `data/sample.json`) und enthält die reine Logik: Pool-Filter, Token-Berechnung, Text-Abgleich, Statistik.
- Die Statistikseite (`screen-stats`, Umschalter in der Kopfzeile) liegt in `app.js`, ihre Auswertungen in `data.js`. Der Spielverlauf steht getrennt vom Spielstand unter `esc_hitster_history` in `localStorage`.
- `app/js/ikonen.js` enthält die handverlesenen Lied-IDs für den Pool „ESC-Ikonen“.
- Der Modus „Nur Musik hören“ (`screen-music`) liegt ebenfalls in `app.js`. Sein Zustand steckt in der Modulvariable `music`, nicht in `state`.
- `app/audio/te-deum.mp3` läuft bei der Siegerehrung (Creative Commons Attribution, Quelle im Info-Dialog). Das Repo ist öffentlich, also nur frei lizenzierte Aufnahmen einbinden. `sw.js` lässt `.mp3` am Cache vorbei, weil Safari für Audio Range-Antworten verlangt.
- `app/js/player.js` kapselt den YouTube-IFrame-Player samt Wiederholungen bei Hängern. Das Video bleibt verdeckt und wird nur bei Werbung eingeblendet.
- `app/sw.js`: Das JSON kommt network-first, die App-Shell cache-first. Daten-Updates brauchen also keine neue `VERSION`.
- Die Tests in `tests/logik.test.mjs` laufen gegen die echten Lieder aus `app/data/esc_songs.json`. Sie bauen die Normalisierung nach, weil `normalize` nicht exportiert ist. Neue Felder dort mit ergänzen, wenn die Logik sie braucht.

## Datenpipeline

Die nummerierten Skripte in `tools/` bauen aufeinander auf: Wikipedia → Wikidata-Gegenprobe → Merge zu `data/esc_songs.csv` → YouTube-Suche → Link-Prüfung → Popularität → Export → Bericht (`data/BERICHT.md`).

- `data/raw/` (Rohdaten und Caches) ist git-ignoriert und fehlt daher in Worktrees. Arbeit an den Rohdaten und jeder Export, der die Caches braucht, gehört nicht in einen Worktree.
- `07_export_json.py` wendet zuerst die Caches und zuletzt `overrides.csv` an, schreibt `data/esc_songs.json` und kopiert die Datei nach `app/data/`. Die App liest nur die Kopie, `app/data/esc_songs.json` nie von Hand ändern.
- `04_find_youtube.py` und `05_check_links.py` nicht gleichzeitig laufen lassen, beide schreiben `youtube_cache.json`.
- Startpunkte bis 1979 kommen aus `10_find_speech.py` (lokales Whisper mit eigenem venv `C:\Users\Finns\esc-intro-venv`, schreibt `data/raw/speech_cache.json`) und `11_whisper_starts.py` (Regel, schreibt `data/intro_whisper.csv` und den Bericht `data/raw/intro_whisper_bericht.txt`). Ziel ist, Spoiler zu vermeiden: Ohne sicheren Treffer bleibt der bisherige Start. Der Export wendet die Datei vor `overrides.csv` an.
- `09_check_intro.py` (Musikeinsatz) ist überholt. `--schreibe-overrides` dort nicht mehr nutzen, die frühere Auswahl liegt nur als Archiv in `data/intro_musik_archiv.csv`.
- Feldformate und Sonderfälle (1956, 1969, 2020, Halbfinal-Aus) stehen in `data/SCHEMA.md`.
- `PLAN.md`, `SCHEMA.md` und die Docstrings der Skripte nennen teils noch den alten Pfad `esc/`. Das Projekt liegt inzwischen direkt im Repo-Wurzelordner.

## Ideenliste

Offene Punkte stehen in `esc-verbesserungen.txt`, Erledigtes in `erledigt.txt`. Beide liegen im öffentlichen Repo. Abgearbeitet wird mit dem Skill `verbesserungen-abarbeiten`, die Projektregeln dafür stehen in `.claude/verbesserungen-profil.md`.
