# Projektprofil Hitster ESC für den Skill verbesserungen-abarbeiten

## Dateien
- Ideendatei: `esc-verbesserungen.txt`, enthält nur offene Punkte.
- Erledigt-Datei: `erledigt.txt`.
- Beide liegen im öffentlichen Repo, also keine Geheimnisse hineinschreiben.

## Git
- Repo ist der Projektordner, Remote `Garnetklee/hitster-esc-edition`.
- `data/raw/` ist ignoriert und fehlt in Worktrees. Für Arbeit an den Rohdaten keinen Worktree nehmen.

## Tests
- Im Projektordner: `node --test`. Node 24 ist vorhanden, keine Installation nötig.
- Testdaten: echte Lieder aus `app/data/esc_songs.json`.
- Spiellogik gehört ohne DOM in `app/js/data.js` und `app/js/settings.js`, damit sie testbar bleibt.

## Prüfung im Browser
- Testserver: Preview `esc-app` auf Port 8765. Zugriff auf den Spielstand über `window.ESC`, `?dev=1` spielt auch ohne Video.
- Finn muss selbst testen: Handy, Touch, Autoplay und Werbung im YouTube-Player.

## Geschützt
- Gespeicherte Stände der Spieler in `localStorage` müssen weiter laden, siehe Pflichten.

## Pflichten bei Änderungen
- App-Dateien geändert: `VERSION` in `app/sw.js` erhöhen, neue JS-Dateien in `SHELL` eintragen.
- Regeln geändert: `SETTINGS_VERSION` erhöhen und `migrateSettings`/`migrateState` in `app/js/settings.js` ergänzen, mit Test.
- Daten korrigieren: nur über `data/overrides.csv` (`id;feld;wert;grund`), danach `.venv\Scripts\python.exe tools\07_export_json.py`. Neue Video-IDs vorher mit `tools\05_check_links.py` prüfen.

## Parallelarbeit
- Fast alles liegt in `app/js/app.js`, die App-Arbeit läuft deshalb meist direkt und nacheinander. Daten und App lassen sich parallel bearbeiten.

## Abschluss und Deployment
- **Jeder Push auf `main` geht sofort live** auf https://garnetklee.github.io/hitster-esc-edition/. Deshalb erst pushen, wenn Tests und Browserprüfung bestanden sind, danach die Seite kurz prüfen.
- GitHub-Login liegt im Git Credential Manager, `gh` ist nicht installiert.
- Finn sieht den neuen Stand nach dem Neuladen der Seite.
