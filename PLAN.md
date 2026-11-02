# Hitster ESC Edition – digitale Version

## Context
Zweite eigene Hitster-Variante nach „Kinderserien-Intros“ (siehe `KONZEPT.md`, `songs.csv`, `tools/`, SongSeeker-Fork).
Diesmal **keine Karten**, sondern eine rein digitale Web-App mit wählbaren Spielmodi. Datenbasis: **alle ESC-Beiträge
1956–2026 inkl. Halbfinal-Ausgeschiedener** (~1.800), mit Platzierung „Platz X von Y“. Abgespielt wird **immer der
Live-Auftritt beim ESC** (Fallback Studiofassung nur, wenn kein Live-Video existiert, v. a. 1956–1970).
Gespielt wird **auf einem Gerät für alle** (Pass-and-Play), kein Backend, Hosting auf GitHub Pages.
Ausführung: **geplante lokale Aufgabe, 01.11.2026, 06:00 (heute)**.

## Teil A – Datenbank

### Ordnerstruktur (neu, neben der Kinderserien-Edition)
```
esc/
  data/raw/            # Rohdaten je Quelle (wiki_<jahr>.json, wikidata.json) – nie von Hand ändern
  data/esc_songs.csv   # Masterliste (Semikolon, Excel-tauglich) – hier wird manuell korrigiert
  data/overrides.csv   # manuelle Korrekturen (id;feld;wert;grund), werden beim Build zuletzt angewendet
  data/esc_songs.json  # Build-Ergebnis für die App
  tools/01_fetch_wikipedia.py   # MediaWiki-API: Jahresartikel parsen (Teilnehmer, Final/HF-Tabellen)
  tools/02_fetch_wikidata.py    # SPARQL-Abgleich (Interpret, Titel, Land, Platz) als Gegenprobe
  tools/03_merge.py             # zusammenführen, Konflikte -> status=prüfen
  tools/04_find_youtube.py      # Live-Video suchen (yt-dlp "ytsearch", kein API-Kontingent)
  tools/05_check_links.py       # Wiederverwendung von tools/check_links.py (Verfügbarkeit + Einbettbarkeit)
  tools/06_popularity.py        # Aufrufzahlen/Hörerzahlen sammeln, Score + Rang berechnen
  tools/07_export_json.py       # CSV + overrides -> esc_songs.json
  app/                          # Web-App (Teil B)
```

### Datensatz-Felder (`esc_songs.csv`)
| Feld | Beispiel | Hinweis |
|---|---|---|
| id | `1974-SE` | Jahr + ISO-Ländercode, eindeutig |
| jahr | 1974 | Wettbewerbsjahr = „Jahr auf der Karte“ |
| austragungsort | Brighton | Stadt |
| land | Schweden | dt. Name, dazu `land_iso` |
| interpret / titel | ABBA / Waterloo | |
| sprache | Englisch | |
| runde_ende | Finale / HF1 / HF2 / HF | wo der Beitrag zuletzt angetreten ist |
| platz / teilnehmer | 1 / 17 | **„Platz 1 von 17“**; bei HF-Aus die HF-Platzierung + Anzahl im HF |
| punkte | 24 | im Finale bzw. im HF |
| platz_finale, platz_hf, hf_nr | | beide getrennt speichern (seit 2004 relevant) |
| sieger | ja/nein | |
| sonderfall | `abgesagt_2020`, `disqualifiziert`, `geteilt_1969`, `ohne_wertung_1956` | |
| youtube_id, start_sek, video_typ | `Dp3DNXlB0zw`, 12, live/studio | Startzeit überspringt Ansage/Postcard |
| embed_ok | ja/nein | nötig für den unsichtbaren Player |
| yt_views, lastfm_listener, spotify_pop | | Popularität |
| pop_score, pop_rang | | normalisierter Mix, Rang 1 = bekanntester |
| quelle, status, notiz | W, ok | wie bei `songs.csv` |

**Sonderfälle:** 1956 sind nur die Sieger bekannt (Platz leer, sonderfall gesetzt). 1969 gab es vier Sieger.
2020 wurde abgesagt: die Lieder werden aufgenommen, aber ohne Platz und standardmäßig ausgefiltert.
Beiträge, die zurückgezogen oder disqualifiziert wurden, werden markiert.

### Quellen (Priorität)
1. **Wikipedia (en)**, Jahresartikel „Eurovision Song Contest YYYY“: Teilnehmer-, Finale- und Halbfinaltabellen über
   die MediaWiki-API (`action=parse`). Diese Tabellen sind am vollständigsten.
2. **Wikidata (SPARQL)** zur Gegenprobe: Beiträge mit `P1344` (nimmt teil an) am jeweiligen ESC und Platzierung `P1352`.
   Weichen die Werte von Wikipedia ab, bekommt der Beitrag `status=prüfen`.
3. **eurovision.tv** (offiziell) und **eurovisionworld.com** zum manuellen Nachprüfen der Konflikte.
4. **YouTube**: Live-Auftritte stehen auf dem offiziellen Kanal „Eurovision Song Contest“. Suche über
   `yt-dlp ytsearch5:"<Interpret> <Titel> Eurovision <Jahr> live"`. Treffer vom offiziellen Kanal werden bevorzugt.
5. **Popularität**: YouTube-Aufrufe des offiziellen Videos (YouTube Data API `videos.list`, 1 Einheit pro 50 IDs; der
   API-Key kommt vom User in `.env` – alternativ yt-dlp-Metadaten), dazu **Last.fm** `track.getInfo` (Hörerzahl, kostenloser
   Key). Spotify nur optional. Score = Mittel der log-normalisierten Werte, damit alte Klassiker nicht untergehen.

### Pipeline-Reihenfolge
1. Wikipedia 1956–2026 holen → `raw/` (mit Pause zwischen den Requests, User-Agent setzen).
2. Wikidata-Abgleich → Konfliktliste.
3. Merge → `esc_songs.csv` (Konflikte als `status=prüfen`, Zählung je Jahr gegen Teilnehmerzahl prüfen).
4. YouTube-IDs suchen (ca. 1.800 Suchen, im Hintergrund, fortsetzbar über Cache) → Einbettbarkeit prüfen.
5. Popularität sammeln → `pop_rang`.
6. Export JSON + Bericht (`esc/data/BERICHT.md`: Anzahl je Jahr, Lücken, Konflikte, nicht einbettbare Videos).

## Teil B – Web-App (`esc/app/`, reines HTML/JS, kein Build-Schritt)

- **Setup-Bildschirm**: Spieler (Namen, 2–8), Ziel-Anzahl Karten (Standard 10), Spielmodus und Filter:
  - Pool: alle / nur Finale / **Top 10** / Top 3 / nur Sieger / **Top-N bekannteste (Popularitätsrang, z. B. 100)** /
    Zeitraum (von–bis) / Länder (z. B. nur DACH) / „Nul points“-Spezial.
  - Anzeige, wie viele Lieder der aktuelle Filter ergibt.
- **Spielablauf** wie Hitster: Jeder startet mit einer offenen Startkarte. Das Lied läuft über einen versteckten
  YouTube-IFrame-Player ab `start_sek` und zeigt kein Bild (Prinzip wie im SongSeeker). Der aktive Spieler zieht die Karte
  per Drag & Drop an eine Stelle seiner Zeitleiste. Danach „Auflösen“: Es erscheinen Jahr, Land mit Flagge, Interpret,
  Titel und **Platz X von Y**.
- **Zusatzmodi** (nur digital möglich): Platzierung schätzen (besser/schlechter als die Nachbarkarte) und Land raten als
  Bonus-Token. Dazu Hitster-Tokens (Überspringen, Klauen) als Zähler.
- **Robustheit**: Ist ein Video nicht abspielbar, wird automatisch das nächste Lied gezogen und ein Fehler-Log in
  `localStorage` geschrieben. Der Spielstand wird ebenfalls in `localStorage` gespeichert (Neuladen bricht das Spiel nicht ab).
- **Design**: dunkel und neon wie Hitster, mit ESC-Herz-Motiv. Für Handy und Tablet, als PWA installierbar.
- **Hosting**: neues Repo (z. B. `Garnetklee/hitster-esc`) auf GitHub Pages. Der bestehende SongSeeker-Fork bleibt
  unverändert. Pushen erst nach Rückfrage.

## Teil C – Ausführung um 6 Uhr
Nach Freigabe lege ich eine **geplante Aufgabe** (`scheduled-tasks`) für **01.11.2026, 06:00 (heute)** an. Der Prompt der
Aufgabe enthält diesen Plan vollständig, damit sie ohne den heutigen Chat auskommt. Inhalt des Laufs:
Teil A, Schritte 1–6, danach eine lauffähige App in `esc/app/` mit den Daten. Kein Push, kein Veröffentlichen.
Damit es klappt, muss Folgendes erfüllt sein:
- PC an, nicht im Ruhezustand (Energieoptionen), Claude-Desktop-App geöffnet.
- Der Lauf ist unbeaufsichtigt. In der geplanten Aufgabe muss deshalb **„Automatisch genehmigen“** aktiv sein, sonst
  bleibt der Lauf bei der ersten Berechtigungsabfrage stehen. Die Rechte dieses Chats gelten dort nicht.
- Keine API-Keys nötig: Aufrufzahlen kommen über yt-dlp. Last.fm wird nur genutzt, wenn `esc/.env` einen
  `LASTFM_API_KEY` enthält.

## Teil D – Parallel mit mehreren Agenten, Ziel ca. 60 min (kein hartes Limit)
Der Hauptagent koordiniert, schreibt das Schema und baut am Ende alles zusammen. Die Arbeit läuft parallel über das
Agent-Tool (Subagenten im Hintergrund). Die langen Netzwerkjobs laufen zusätzlich parallel in Python-Threads oder Prozessen.

| Zeit | Hauptagent | Agent „Daten“ | Agent „App“ | Agent „YouTube/Popularität“ |
|---|---|---|---|---|
| 0–5 | Ordner anlegen, Schema festlegen, `sample.json` (20 echte Beiträge) | – | – | – |
| 5–30 | koordinieren, Stichproben prüfen | Skripte 01–03 schreiben und ausführen → `esc_songs.csv` | komplette App gegen `sample.json` bauen | Skripte 04–06 schreiben und an 20 Beiträgen testen (8 parallele Worker) |
| 30–50 | Daten in die App übernehmen | Konflikte prüfen, `overrides.csv` | Feinschliff, Filter-Zähler | Suche über alle ~1.800 Beiträge im Hintergrund, danach Links prüfen und Popularität |
| 50–60 | Export, Test im Browser-Pane, `BERICHT.md` | – | – | – |

- **Zeitziel 60 min ist kein Limit:** Was länger dauert (v. a. YouTube-Suche), läuft einfach weiter, bis alles fertig ist. Reihenfolge der Prioritäten: (1) Daten mit Platzierung, (2) spielbare App, (3) YouTube-IDs, (4) Popularität.
- Alle Skripte cachen ihre Zwischenstände und können später weiterlaufen.
- Die App nimmt nur Lieder mit gültiger `youtube_id` in den Pool. So ist sie auch spielbar, wenn die Suche noch nicht fertig ist.

## Verification
- `BERICHT.md`: Für jedes Jahr stimmt die Anzahl der Beiträge mit der Teilnehmerzahl laut Wikipedia überein.
  Stichproben: 1974 Waterloo „Platz 1 von 17“, 2010 Lena „Platz 1 von 25“, 2015 DE „Platz 27 von 27“ (0 Punkte),
  ein HF-Aus seit 2008.
- `05_check_links.py`: Mindestens 95 % der Beiträge sind einbettbar und abspielbar.
- App lokal starten (`py -m http.server` in `esc/app`), im Browser-Pane eine Runde mit 2 Spielern spielen und dabei jeden
  Filter einmal ausprobieren. Prüfen, ob der Player unsichtbar bleibt und ab der Startzeit spielt.

## Stand (01.11.2026, automatischer Lauf)

**Erledigt**
- Datenbasis `data/esc_songs.csv` / `data/esc_songs.json`: **1.841 Beiträge** 1956–2026 (Finale 1.475, HF 58, HF1 124,
  HF2 132, Vorrunde 1993/1996 11, 2020 abgesagt 41). Anzahl je Jahr stimmt in allen 71 Jahrgängen mit der
  Wikipedia-Teilnehmertabelle überein. Sonderfälle 1956, 1969, 2020 und 2024-NL (disqualifiziert) markiert.
- Wikidata-Gegenprobe: 545 bestätigt, 11 Konflikte geprüft → Wikipedia korrekt, per `overrides.csv` auf ok.
- Stichproben stimmen: 1974-SE Platz 1 von 17, 2010-DE Platz 1 von 25, 2015-DE Platz 27 von 27 (0 Pkt.),
  2013-AT HF1 Platz 14 von 16, 2018-CH HF1 Platz 13 von 19.
- YouTube: alle 1.841 mit Video (1.792 live, 49 Studio: 2020, 1996-Vorrunde, 1985-LU), 994 vom offiziellen Kanal,
  100 % einbettbar laut oEmbed + yt-dlp. Popularität (YouTube-Aufrufe) → `pop_rang` für alle.
- Web-App `app/` fertig und im Browser getestet (2 Spieler, alle Filter, Drag & Drop, Auflösen, Fortsetzen,
  unsichtbarer Player ab `start_sek`). Details: `data/BERICHT.md`.

**Offen**
- `start_sek` ist nur Heuristik – beim Spielen auffällige Lieder in `overrides.csv` korrigieren (`id;start_sek;<sek>;grund`).
- Fan-Uploads (v. a. vor 2004, Liste `data/raw/youtube_probleme.txt`) stichprobenartig prüfen; vereinzelt kein ESC-Auftritt
  (z. B. 2000-RU). Korrektur per `overrides.csv` (Feld `youtube_id`).
- Service Worker/PWA-Installation in echtem Chrome bzw. auf GitHub Pages prüfen (im Test-Browser nicht registrierbar).
- Last.fm-Hörerzahlen: `LASTFM_API_KEY=...` in `esc/.env` eintragen, dann `06_popularity.py` erneut.
- GitHub-Pages-Repo anlegen und pushen – erst nach Rückfrage (Inhalt von `esc/app/` ist die Seite).
- Hinweis: 1993/1996-Vorrunde hat `runde_ende=Vorentscheid` (so in `data/SCHEMA.md` festgelegt).

**Befehle** (PowerShell, im Projektordner)
```
.venv\Scripts\python.exe -m http.server 8765 -d app        # App starten → http://localhost:8765
.venv\Scripts\python.exe tools\01_fetch_wikipedia.py        # Daten neu holen (Cache, --force)
.venv\Scripts\python.exe tools\02_fetch_wikidata.py
.venv\Scripts\python.exe tools\03_merge.py                  # -> data\esc_songs.csv
.venv\Scripts\python.exe tools\04_find_youtube.py           # nur neue/geänderte Beiträge
.venv\Scripts\python.exe tools\05_check_links.py --input data\esc_songs.csv --repair
.venv\Scripts\python.exe tools\06_popularity.py --input data\esc_songs.csv
.venv\Scripts\python.exe tools\03_merge.py                  # Caches in die CSV übernehmen
.venv\Scripts\python.exe tools\07_export_json.py            # + overrides -> data\ und app\data\esc_songs.json
.venv\Scripts\python.exe tools\08_bericht.py                # -> data\BERICHT.md
```
Bei Änderungen an App-Dateien `VERSION` in `app/sw.js` erhöhen.

## Stand Runde 2 (01.11.2026)

Startseite mit Banner, fertigen Modi (Entspannt, Klassisch, Party, ESC-Profi, Custom) und erweiterten Einstellungen. Neu: Klauen als Option, Bonus-Wertung (Tokens, zählen, umwandeln), Land raten ohne Vorschläge, freie Platzierung, Punktlandung, Zeitlimit, Darstellung für Smartphone und Tablet. Regeln und Modi stehen in `app/js/settings.js`. Lautstärke bleibt unverändert.

## Stand Runde 3 (02.11.2026)

Die Edition ist jetzt ein eigenes Projekt: Der Ordner `Hitster ESC` ist das Repo, mit eigener `.venv` und `requirements.txt`. Pfade weiter oben, die mit `esc/` beginnen, beziehen sich auf den alten Ordner.

Neu: Ein-Spieler-Modus, Modi Entspannt, Klassisch, ESC Edition, ESC Modus und Custom, einheitliche Tokens ohne Obergrenze statt Bonuspunkten, Gratis-Skip, Warnung beim Auflösen, Autovervollständigung, Podium mit Feuerwerk, Zeitleiste und falsche Karten in der Auswertung, Länder-Statistik, Tests mit `node --test`. Regeln und Modi stehen in `app/js/settings.js`, die Token-Werte in `app/js/data.js`. Offene Ideen stehen in `esc-verbesserungen.txt`, Erledigtes in `erledigt.txt`.
