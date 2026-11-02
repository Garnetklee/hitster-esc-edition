# Hitster ESC Edition

Privates Musik-Zeitleistenspiel mit allen Eurovision-Beiträgen von 1956 bis 2026. Gespielt wird auf einem Gerät für alle.
Kein offizielles Produkt von Hitster oder dem Eurovision Song Contest. Die Musik kommt über eingebettete YouTube-Videos.

Spielen: https://garnetklee.github.io/hitster-esc-edition/

Lokal starten:

```
python -m http.server 8765 -d app
```

Tests der Spiellogik (mit den echten Liedern):

```
node --test
```

Für die Datenskripte: `python -m venv .venv`, dann `.venv\Scripts\python.exe -m pip install -r requirements.txt`.

- `app/`: die Web-App, wird bei jedem Push auf `main` veröffentlicht
- `data/`: Liederliste, Korrekturen in `overrides.csv`
- `tools/`: Skripte zum Neuaufbau der Daten, Details in `PLAN.md`
- `tests/`: Tests der Spiellogik
- `esc-verbesserungen.txt`, `erledigt.txt`: offene Ideen und Erledigtes

Bei Änderungen an App-Dateien `VERSION` in `app/sw.js` erhöhen.
