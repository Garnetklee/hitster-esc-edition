# Hitster ESC Edition

Privates Musik-Zeitleistenspiel mit allen Eurovision-Beiträgen von 1956 bis 2026. Gespielt wird auf einem Gerät für alle.
Kein offizielles Produkt von Hitster oder dem Eurovision Song Contest. Die Musik kommt über eingebettete YouTube-Videos.

Spielen: https://garnetklee.github.io/hitster-esc-edition/

Lokal starten:

```
python -m http.server 8765 -d app
```

- `app/`: die Web-App, wird bei jedem Push auf `main` veröffentlicht
- `data/`: Liederliste, Korrekturen in `overrides.csv`
- `tools/`: Skripte zum Neuaufbau der Daten, Details in `PLAN.md`

Bei Änderungen an App-Dateien `VERSION` in `app/sw.js` erhöhen.
