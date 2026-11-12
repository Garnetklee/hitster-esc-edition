"""13 – SongFormer-Ergebnisse auswerten: sichere Refrains und Prüfliste für die Online-Recherche.

Eingabe ist die Zusammenfassung des VM-Laufs (songformer_alle.json, Skript esc_songformer.py). Lieder, die
schon einen sicheren Whisper-Treffer in data/refrain.csv haben, bleiben unberührt. Gewertet wird der erste
als Refrain erkannte Abschnitt hinter dem Spielstart, 1 s früher gestartet, weil die Modelle leicht zu spät liegen.

Als unsicher gilt, was weniger als 25 s oder mehr als 90 s nach dem Spielstart beginnt oder gar keinen
Refrain hat. Die Grenzen stammen aus Finns Hörprobe von zwölf Liedern (data/raw/allin1_vm/hoerbewertung.csv).

Ergebnis
  data/refrain_songformer.csv        id;youtube_id;refrain_sek;quelle: Lieder innerhalb der Grenzen (quelle songformer)
                                     und Prüflieder mit Text-Treffer im Abgleich (quelle online)
  data/refrain_schaetzung.csv        id;youtube_id;refrain_schaetz_sek: Prüflieder, bei denen nur SongFormer eine Stelle sieht
  data/raw/refrain_pruefliste.md     alle übrigen Lieder, vorn der Auftrag für ChatGPT
Lieder aus data/refrain_manuell.csv (von Hand gehört) werden in den beiden CSV-Dateien und im Abgleich übersprungen.

Das Skript ändert keine Lieddaten und enthält keine Liedtexte. Die Online-Antworten gehören nur in data/raw/.

Existiert die CSV-Antwort von ChatGPT (Standard data/raw/refrain_chatgpt.csv, sonst --antworten), wird sie
zusätzlich abgeglichen (id;erste_worte;position;...).
Die genannten ersten Worte werden im Whisper-Text unseres Videos gesucht (data/raw/refrain_cache.json),
so spielt ein anderes Vorspiel in der Quelle keine Rolle. Vorschlag ist die früheste Stelle ab 15 s nach dem
Spielstart, an der Text und SongFormer übereinstimmen oder der Text sehr gut passt, sonst SongFormer allein.
Das Ergebnis data/raw/refrain_abgleich.md ist eine Hörtabelle und ändert keine Lieddaten.

Aufruf
  .venv/Scripts/python.exe tools/13_songformer_refrain.py [--quelle data/raw/allin1_vm/songformer_alle.json]
  .venv/Scripts/python.exe tools/13_songformer_refrain.py --antworten data/raw/refrain_chatgpt.csv
"""
import argparse
import csv
import difflib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

ESC = Path(__file__).resolve().parent.parent
DATA = ESC / "data"
RAW = DATA / "raw"
VORLAUF = 1
FRUEHESTENS = 25
SPAETESTENS = 90

AUFTRAG = """# Auftrag für ChatGPT: Erste Refrainzeile von ESC-Liedern finden

Ich baue ein privates Musikquiz mit Eurovision-Beiträgen. Für die Lieder in der Tabelle unten suche ich, wo der **erste Refrain** beginnt.

Die Sekunde im Video bestimme ich selbst. Von dir brauche ich nur die Worte, mit denen der Refrain beginnt.

## Regeln

1. **Keine Sekundenangaben.** Zeiten aus dem Netz gehören oft zu einer anderen Fassung mit längerem oder kürzerem Vorspiel.
2. **Quellen in dieser Reihenfolge:** offizielle Eurovision-Videos und eurovision.com oder eurovision.de, dann Liedtext-Seiten, die Abschnitte ausdrücklich kennzeichnen (zum Beispiel Genius oder lizenzierte Portale), Fan-Seiten nur als letzte Möglichkeit. Nenne je Lied die Seite, die du wirklich geprüft hast.
3. **Nur die ersten 3 bis 6 gesungenen Wörter** der ersten Refrainzeile in der Originalsprache, bei nicht lateinischer Schrift zusätzlich in Umschrift. Gib keine längeren Textstellen und keine vollständigen Liedtexte aus.
4. **Refrain heißt Chorus.** Pre-Chorus, Bridge und Post-Chorus zählen nicht, auch wenn sie sich wiederholen. Der Refrain ist der wiederkehrende Hauptteil, oft mit dem Titel.
5. **Hat das Lied keinen klassischen Refrain,** trage bei `position` `kein_refrain` ein und nenne bei `erste_worte`, falls klar erkennbar, den Beginn des Hauptteils.
6. **Nichts erfinden und nicht raten.** Findest du keine verlässliche Quelle, bleibt `erste_worte` leer und `sicherheit` ist `nichts_gefunden`. Eine ehrliche Lücke hilft mir mehr als eine geratene Zeile.
7. **Maßgeblich ist die ESC-Fassung** des angegebenen Jahres. Unterscheidet sie sich von der Studiofassung, schreibe das in `notiz`.

## Spalten

| Spalte | Inhalt |
|---|---|
| `id` | genau wie in der Tabelle |
| `erste_worte` | die ersten 3 bis 6 Wörter der ersten Refrainzeile |
| `position` | wo der Refrain im Lied steht, zum Beispiel `nach Strophe 1 und Pre-Chorus`, `gleich am Anfang`, `kein_refrain` |
| `sicherheit` | `beschriftet` (die Quelle nennt den Abschnitt ausdrücklich Chorus oder Refrain), `wiederholung` (von dir aus den Wiederholungen im Text abgeleitet), `unsicher` oder `nichts_gefunden` |
| `quelle_url` | die geprüfte Seite |
| `notiz` | kurz, nur wenn nötig |

## Ausgabe

Arbeite in Blöcken von **25 Liedern** in der Reihenfolge der Tabelle. Gib jeden Block als Codeblock im CSV-Format mit Semikolon aus, jeder Block beginnt mit dieser Kopfzeile:

```
id;erste_worte;position;sicherheit;quelle_url;notiz
```

Nenne danach nur noch die Id, mit der es weitergeht. Bei „weiter“ machst du mit dem nächsten Block weiter. Lass kein Lied aus und ändere keine Id.

## Lieder
"""


def bewerte(eintrag, start):
    """(Refrainstart oder None, Grund für die Prüfung oder None)."""
    if eintrag is None:
        return None, "kein Ergebnis"
    refrains = [r for r in eintrag["refrains"] if r - VORLAUF > start]
    if not refrains:
        return None, "kein Refrain"
    sek = int(refrains[0] - VORLAUF + 0.5)
    abstand = sek - start
    if abstand < FRUEHESTENS:
        return sek, "früh"
    if abstand > SPAETESTENS:
        return sek, "spät"
    return sek, None


TEXT_MIN = 0.7      # Ähnlichkeit, ab der eine Stelle im Whisper-Text als Treffer zählt
TEXT_GUT = 0.8      # ab hier genügt der Text auch ohne Bestätigung durch SongFormer
GLEICH = 4          # Sekunden, innerhalb derer Text und SongFormer dieselbe Stelle meinen
AB_START = 15       # frühere Refrains bringen gegenüber dem Spielstart nichts


def woerter(text):
    text = unicodedata.normalize("NFKD", text.lower())
    return re.findall(r"[^\W_]+", "".join(z for z in text if not unicodedata.combining(z)))


def textstellen(worte, zeile, ab):
    """[(Sekunde, Ähnlichkeit)] aller Stellen im Whisper-Text, die den ersten vier Wörtern der Zeile ähneln."""
    umschrift = re.search(r"\(([^)]*)\)", zeile)  # bei fremder Schrift steht die Umschrift in Klammern
    anker = woerter(umschrift.group(1) if umschrift else zeile)[:4]
    if not anker:
        return []
    folge = [(t, w) for t, wort in worte for w in woerter(wort)]
    ziel, n, treffer = " ".join(anker), len(anker), []
    for j in range(len(folge) - n + 1):
        r = difflib.SequenceMatcher(None, " ".join(w for _, w in folge[j:j + n]), ziel).ratio()
        if r >= TEXT_MIN and folge[j][0] >= ab:
            if treffer and folge[j][0] - treffer[-1][0] <= 8:
                treffer[-1] = max(treffer[-1], (treffer[-1][0], r), key=lambda x: x[1])
            else:
                treffer.append((folge[j][0], r))
    return treffer


def abgleich(antworten, songs, ergebnis, cache):
    zeilen = ["| Id | Lied | Vorschlag | Grundlage | Weitere Stellen | ChatGPT: Lage | Quelle |", "|---|---|---|---|---|---|---|"]
    arten, aus = Counter(), {}
    for a in antworten:
        s = songs.get(a["id"])
        e = ergebnis.get(a["id"])
        if not s or not e:
            continue
        start = s["start_sek"] or 0
        w = cache.get(s["id"]) or {}
        worte = w.get("worte", []) if w.get("youtube_id") == s["youtube_id"] else []
        text = textstellen(worte, a["erste_worte"], start + AB_START)
        sf = [r for r in e["refrains"] if r - VORLAUF >= start + AB_START]
        kandidaten = []
        for t, r in text:
            nah = [x for x in sf if abs(x - t) <= GLEICH]
            if nah:
                kandidaten.append((min(t, nah[0]), "Text + SongFormer"))
            elif r >= TEXT_GUT:
                kandidaten.append((t, "Text"))
        if not kandidaten and sf:
            kandidaten = [(sf[0], "nur SongFormer")]
        if kandidaten:
            sek, art = min(kandidaten)
            sek = max(int(sek - VORLAUF), start)
            if sek - start > SPAETESTENS:
                art += ", spät"
        else:
            sek, art = None, "nichts"
        if a["position"].strip() == "kein_refrain":
            art += ", laut Quelle kein Refrain"
        arten[art] += 1
        aus[s["id"]] = (sek, art)
        weitere = sorted({int(x - VORLAUF) for x, _ in text} | {int(x - VORLAUF) for x in sf} - {sek})
        link = (f"[{sek} s](https://www.youtube.com/watch?v={s['youtube_id']}&t={sek}s)" if sek is not None else "–")
        zeilen.append("| " + " | ".join(zelle(x) for x in (
            s["id"], f"{s['interpret']} – {s['titel']}", link, art, ", ".join(map(str, weitere[:6])),
            a["position"], a["sicherheit"])) + " |")
    kopf = ("# Abgleich der ChatGPT-Antworten\n\nVorschlag ist die früheste Stelle ab 15 s nach dem Spielstart, an der die "
            "ChatGPT-Zeile im Whisper-Text unseres Videos vorkommt und SongFormer dort einen Refrain sieht, oder an der der "
            "Text sehr gut passt. Sonst gilt SongFormer allein. Alle Zeiten 1 s früher. Unter „Weitere Stellen“ stehen die "
            "übrigen Text- und SongFormer-Treffer.\n\n")
    (RAW / "refrain_abgleich.md").write_text(kopf + "\n".join(zeilen) + "\n", encoding="utf-8")
    print("Abgleich:", dict(arten))
    return aus


def zelle(text):
    return str(text if text is not None else "").replace("|", "/").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quelle", type=Path, default=RAW / "allin1_vm" / "songformer_alle.json")
    ap.add_argument("--liste", type=Path, default=RAW / "allin1_vm" / "gesamt" / "lieder_392.json")
    ap.add_argument("--antworten", type=Path, default=RAW / "refrain_chatgpt.csv",
                    help="CSV-Antwort von ChatGPT zur Prüfliste (Standard: data/raw/refrain_chatgpt.csv, falls vorhanden)")
    args = ap.parse_args()

    songs = {s["id"]: s for s in json.loads((ESC / "app" / "data" / "esc_songs.json").read_text(encoding="utf-8"))["songs"]}
    whisper = {o["id"] for o in csv.DictReader((DATA / "refrain.csv").open(encoding="utf-8-sig"), delimiter=";")}
    manuell_datei = DATA / "refrain_manuell.csv"
    manuell = ({o["id"] for o in csv.DictReader(manuell_datei.open(encoding="utf-8-sig"), delimiter=";")}
               if manuell_datei.exists() else set())
    ergebnis = json.loads(args.quelle.read_text(encoding="utf-8"))
    liste = json.loads(args.liste.read_text(encoding="utf-8"))

    sicher, pruefen, gruende = [], [], Counter()
    for lied in liste:
        s = songs.get(lied["id"])
        if not s or s["youtube_id"] != lied["youtube_id"] or s["id"] in whisper:
            continue
        e = ergebnis.get(s["id"])
        if e is not None and e["youtube_id"] != s["youtube_id"]:
            e = None
        sek, grund = bewerte(e, s["start_sek"] or 0)
        gruende[grund or "sicher"] += 1
        if grund:
            pruefen.append(s)
        else:
            sicher.append({"id": s["id"], "youtube_id": s["youtube_id"], "refrain_sek": sek, "quelle": "songformer"})

    zeilen = ["| Id | Jahr | Land | Interpret | Titel | Sprache | YouTube |", "|---|---|---|---|---|---|---|"]
    for s in pruefen:
        zeilen.append("| " + " | ".join(zelle(x) for x in (s["id"], s["jahr"], s["land"], s["interpret"], s["titel"], s["sprache"],
                                                            f"https://www.youtube.com/watch?v={s['youtube_id']}")) + " |")
    (RAW / "refrain_pruefliste.md").write_text(AUFTRAG + "\n" + "\n".join(zeilen) + "\n", encoding="utf-8")
    print(f"{len(sicher)} sicher, {len(pruefen)} auf der Prüfliste:", dict(gruende))

    online, schaetz = [], []
    if args.antworten and args.antworten.exists():
        antworten = [a for a in csv.DictReader(args.antworten.open(encoding="utf-8-sig"), delimiter=";")
                     if a["id"] not in manuell]
        cache = json.loads((RAW / "refrain_cache.json").read_text(encoding="utf-8"))
        for i, (sek, art) in abgleich(antworten, songs, ergebnis, cache).items():
            if sek is None:
                continue
            zeile = {"id": i, "youtube_id": songs[i]["youtube_id"]}
            if art in ("Text", "Text + SongFormer"):
                online.append({**zeile, "refrain_sek": sek, "quelle": "online"})
            elif art.startswith("nur SongFormer") and ", spät" not in art:
                schaetz.append({**zeile, "refrain_schaetz_sek": sek})

    alle = [x for x in sicher if x["id"] not in manuell] + online
    with (DATA / "refrain_songformer.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, ["id", "youtube_id", "refrain_sek", "quelle"], delimiter=";")
        w.writeheader()
        w.writerows(alle)
    with (DATA / "refrain_schaetzung.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, ["id", "youtube_id", "refrain_schaetz_sek"], delimiter=";")
        w.writeheader()
        w.writerows(schaetz)
    print(f"refrain_songformer.csv: {len(alle) - len(online)} songformer + {len(online)} online, "
          f"refrain_schaetzung.csv: {len(schaetz)}")


if __name__ == "__main__":
    main()
