"""Erzeugt esc/data/BERICHT.md aus esc_songs.json, merge_report.json und den YouTube-Caches.

    py tools/08_bericht.py      (nach 07_export_json.py)
"""
import json
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
songs = json.loads((DATA / "esc_songs.json").read_text(encoding="utf-8"))["songs"]
rep = json.loads((DATA / "merge_report.json").read_text(encoding="utf-8"))
by_id = {s["id"]: s for s in songs}
L = []
w = L.append


def platz(s):
    if s["platz"] is None:
        return s["sonderfall"] or "ohne Platz"
    r = "" if s["runde_ende"] == "Finale" else f"{s['runde_ende']}: "
    return f"{r}Platz {s['platz']} von {s['teilnehmer']} ({s['punkte'] if s['punkte'] is not None else '–'} Pkt.)"


n = len(songs)
mit_id = [s for s in songs if s["youtube_id"]]
spielbar = [s for s in mit_id if s["embed_ok"] is True]
nicht_embed = [s for s in mit_id if s["embed_ok"] is False]
ungeprueft = [s for s in mit_id if s["embed_ok"] is None]
typ = Counter(s["video_typ"] or "–" for s in mit_id)
pop = sum(1 for s in songs if s["pop_rang"])

w("# Bericht Hitster ESC Edition – Datenbasis\n")
w(f"Stand: {json.loads((DATA / 'esc_songs.json').read_text(encoding='utf-8'))['generiert']}\n")
w("## Überblick\n")
w(f"- Beiträge gesamt: **{n}** (1956–2026, inkl. Halbfinal-/Vorrunden-Ausgeschiedener und 2020)")
w(f"- Runde zuletzt: " + ", ".join(f"{k or 'keine (2020)'} {v}" for k, v in Counter(s['runde_ende'] for s in songs).most_common()))
w(f"- Mit YouTube-ID: **{len(mit_id)}** ({len(mit_id) / n:.1%}); Typ: " + ", ".join(f"{k} {v}" for k, v in typ.items()))
q = len(spielbar) / len(mit_id) if mit_id else 0
w(f"- Einbettbar und verfügbar (geprüft): **{len(spielbar)}** = {q:.1%} der gefundenen Videos, {len(spielbar) / n:.1%} aller Beiträge; "
  f"nicht einbettbar: {len(nicht_embed)}; ungeprüft: {len(ungeprueft)}")
w(f"- Popularitätsrang vorhanden: {pop} (Quelle: YouTube-Aufrufe via yt-dlp; kein Last.fm-Key)")
w(f"- Quelle: " + ", ".join(f"{k} {v}" for k, v in rep["quelle"].items()) + f"; status=prüfen nach Overrides: {sum(1 for s in songs if s['status'] == 'prüfen')}\n")

w("## Stichproben\n")
for sid, soll in [("1974-SE", "Platz 1 von 17"), ("2010-DE", "Platz 1 von 25"), ("2015-DE", "Platz 27 von 27 (0 Pkt.)"),
                  ("2013-AT", "HF1: Platz 14 von 16"), ("2018-CH", "HF1: Platz 13 von 19"), ("2024-NL", "disqualifiziert")]:
    s = by_id.get(sid)
    if s:
        w(f"- `{sid}` {s['interpret']} – „{s['titel']}“: {platz(s)} {s['sonderfall']} | Soll: {soll} | Video: {s['youtube_id'] or '–'} ({s['video_typ'] or '–'}, ab {s['start_sek']} s, einbettbar: {s['embed_ok']})")
w("")

w("## Anzahl je Jahr vs. Teilnehmerzahl (Wikipedia-Teilnehmertabelle)\n")
w("| Jahr | Ort | Beiträge | Teilnehmer lt. Tabelle | ok | mit Video | einbettbar |")
w("|---|---|---|---|---|---|---|")
per = defaultdict(list)
for s in songs:
    per[s["jahr"]].append(s)
for j, info in sorted(rep["jahre"].items()):
    ss = per[int(j)]
    ok = "✓" if info["beitraege"] == info["teilnehmer_tabelle"] == len(ss) else "✗"
    w(f"| {j} | {info.get('ort', '')} | {len(ss)} | {info['teilnehmer_tabelle']} | {ok} | "
      f"{sum(1 for s in ss if s['youtube_id'])} | {sum(1 for s in ss if s['embed_ok'] is True)} |")
w("")
w("## Lücken und Zählabweichungen\n")
w(f"- Lücken laut Merge: {rep['luecken'] or 'keine'}")
w(f"- Zählabweichungen: {rep['zaehlabweichungen'] or 'keine'}")
ohne = [s for s in songs if not s["youtube_id"]]
w(f"- Beiträge ohne Video: {len(ohne)}" + (" – " + ", ".join(s["id"] for s in ohne[:150]) + (" …" if len(ohne) > 150 else "") if ohne else ""))
w("")
w("## Konflikte Wikipedia ↔ Wikidata\n")
for k in rep["konflikte"]:
    s = by_id.get(k["id"], {})
    w(f"- `{k['id']}` ({k['art']}): Wikipedia „{k['wikipedia']}“ vs. Wikidata „{k['wikidata']}“ → Status jetzt: {s.get('status')}")
w("\nAlle Konflikte wurden geprüft; Wikipedia war jeweils korrekt (Begründungen in `overrides.csv`).\n")
w("## Nicht einbettbare / nicht verfügbare Videos\n")
for s in nicht_embed:
    w(f"- `{s['id']}` {s['interpret']} – „{s['titel']}“: {s['youtube_id']}")
if not nicht_embed:
    w("- keine")
w("\n## Hinweise zur Videoauswahl\n")
w("- Problemfälle der Suche (Finalist mit HF-Video, Fan-Uploads ab 2000 usw.): `data/raw/youtube_probleme.txt`. "
  "Fan-Uploads sind meist korrekte ESC-Mitschnitte, vereinzelt aber andere Live-Auftritte (z. B. 2000-RU „Solo“ bei Avtoradio) – "
  "Korrektur über `overrides.csv` (Feld `youtube_id`).")
w("- `start_sek` ist eine Heuristik (offizielle Live-Videos 3–8 s, andere Mitschnitte bis 30 s, Studio 0 s), nicht je Video geprüft.")
w("- Popularität nur aus YouTube-Aufrufen (Maximum über passende Kandidaten-Videos); Last.fm ungenutzt (kein Key).\n")
w("## App-Test (Browser, 01.11.2026)\n")
w("- Echte Daten geladen: 1.841 Beiträge, Pool „alle“ ohne 2020 = 1.800.")
w("- Filterzähler: Finale 1.475 · Top 10 703 · Top 3 210 · Sieger 73 · Nul points 41 · Top-100 bekannteste 97 (3 davon 2020) · "
  "1970–1979 176 · DACH 196 · mit 2020 1.841.")
w("- Runde mit 2 Spielern: Drag & Drop (Maus) und Tippen auf Lücke, Land raten, Platzierung schätzen, Auflösen mit Flagge und "
  "„HF1: Platz 12 von 17“; Neuladen → „Spiel fortsetzen“ funktioniert.")
w("- Player: iframe 1×1 px außerhalb des Bildes, Deckkraft 0; spielte ab Sekunde 5 = `start_sek` des Liedes.")
w("- Service Worker im eingebauten Browser nicht registrierbar (Einschränkung des Test-Browsers); in Chrome/GitHub Pages noch prüfen.")
(DATA / "BERICHT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print(f"BERICHT.md: {n} Beiträge, {len(mit_id)} mit Video, {len(spielbar)} einbettbar ({q:.1%} der gefundenen)")
