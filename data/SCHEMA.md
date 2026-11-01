# Schema esc_songs.csv / esc_songs.json

CSV: Semikolon, UTF-8 mit BOM (utf-8-sig), Spalten exakt in dieser Reihenfolge:

```
id;jahr;austragungsort;land;land_iso;interpret;titel;sprache;runde_ende;platz;teilnehmer;punkte;platz_finale;platz_hf;hf_nr;sieger;sonderfall;youtube_id;start_sek;video_typ;embed_ok;yt_views;lastfm_listener;spotify_pop;pop_score;pop_rang;quelle;status;notiz
```

- id: `<jahr>-<ISO2>` (z. B. `1974-SE`); zweiter Beitrag desselben Landes im selben Jahr (nur 1956) `-2`.
  Jugoslawien `YU`, Serbien und Montenegro `CS`, UK `GB`, Australien `AU`, Marokko `MA`, Monaco `MC`.
- land: deutscher Name; land_iso: ISO-3166-1 alpha-2 (Großbuchstaben).
- runde_ende: `Finale` | `HF` (1993 Kvalifikacija za Millstreet, 2004–2007 ein HF) | `HF1` | `HF2` |
  `Vorentscheid` (1996 Audio-Vorrunde) | leer (2020).
- platz/teilnehmer/punkte: Platzierung in der Runde `runde_ende` („Platz X von Y“); leer wenn unbekannt (1956 außer Sieger, 2020).
- platz_finale, platz_hf, hf_nr: getrennt (hf_nr = 1/2; bei nur einem HF `1`).
- sieger: `ja`/`nein`.
- sonderfall: leer | `ohne_wertung_1956` | `geteilt_1969` | `abgesagt_2020` | `disqualifiziert` | `zurueckgezogen` (mehrere mit `,`).
- youtube_id, start_sek (int), video_typ: `live` | `studio`; embed_ok: `ja`/`nein`/leer (ungeprüft).
- yt_views, lastfm_listener, spotify_pop (int), pop_score (0–1, float), pop_rang (1 = bekanntester).
- quelle: `W` Wikipedia, `W+WD` von Wikidata bestätigt, `M` manuell.
- status: `ok` | `prüfen`.

JSON (`esc_songs.json`): `{"generiert": "<ISO-Zeit>", "anzahl": N, "songs": [ {...} ]}`; gleiche Schlüssel,
Zahlen als Zahl oder `null`, `sieger`/`embed_ok` als `true`/`false`/`null`, leere Strings statt fehlender Texte.
`esc/data/sample.json` hat dasselbe Format (25 handverlesene Beiträge zum Testen der App).
