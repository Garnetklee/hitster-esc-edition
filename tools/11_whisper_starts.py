"""11 – Startpunkte aus den Whisper-Ergebnissen von 10_find_speech.py (ohne Download, ohne Modell).

Ziel ist, Spoiler zu vermeiden, also dass Interpret oder Titel vor dem Lied genannt werden:
  moderation  Sprache gleich am Anfang, danach eine klare Pause: Start am Ende dieser Passage
  interpret   Der Name des Interpreten fällt, großgeschrieben wie ein Name: Start nach der letzten Nennung
  titel       Der Titel fällt genau einmal in den ersten 15 s: Start danach. Später oder öfter genannt
              gehört er vermutlich zum Gesang und zählt nicht. Gesungene Titel sind kein Spoiler.
Wird der Name später genannt als das Ende der Moderation, zählt die spätere Stelle. Ohne Treffer
gibt es keine Zeile, das Lied behält seinen bisherigen Start.

Ergebnis
  data/intro_whisper.csv              id;start_sek;art;grund, wird von 07_export_json.py angewendet
  data/raw/intro_whisper_bericht.txt  Zusammenfassung und Lieder, bei denen nichts erkannt wurde

Aufruf
  python tools/11_whisper_starts.py
"""
import csv
import math
import re
import sys
import unicodedata
from collections import Counter

from yt_common import DATA, RAW, load_input, load_json

CACHE = RAW / "speech_cache.json"
AUSGABE = DATA / "intro_whisper.csv"
BERICHT = RAW / "intro_whisper_bericht.txt"
DEFAULT_INPUT = DATA / "esc_songs.json"

BIS_JAHR = 1979
PAUSE = 3           # Sekunden Stille nach der Moderation
MOD_START = 5       # Moderation beginnt spätestens hier
MOD_MIN = 3         # kürzere Passagen sind zu unsicher
MOD_MAX = 45        # längere Passagen sind zu unsicher
MIN_DICHTE = 5      # Zeichen je Sekunde, darunter ist der Text oft erfunden
MAX_KEIN_TEXT = 0.7  # Whisper hält die Passage eher nicht für Sprache
TITEL_BIS = 15      # Titel danach zählen nicht als Ansage
NAME_BIS = 70        # spätere Treffer sind eher Gesang oder falsch verstanden
MIN_NAME = 4        # kürzere Namensteile treffen zu leicht zufällig

FUELLWORTE = {"and", "und", "les", "the", "with", "feat", "singers", "group", "band", "trio", "duo", "quartet",
              "sisters", "brothers", "orchestra", "chor", "chorus", "avec", "von", "van", "del", "des", "der"}

try:  # Windows-Konsole: Umlaute nicht abstürzen lassen
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def ohne_akzente(text):
    s = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in s if not unicodedata.combining(c)).replace("ß", "ss")


def worte(text):
    return re.findall(r"[a-z0-9]+", ohne_akzente(text).lower())


def grosse_worte(text):
    """Nur großgeschriebene Wörter: So zählen „back“ oder „heart“ im Gesang nicht als Name."""
    return [w.lower() for w in re.findall(r"[A-Z][A-Za-z0-9]*", ohne_akzente(text))]


def abstand(a, b):
    vor = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        akt = [i]
        for j, cb in enumerate(b, 1):
            akt.append(min(vor[j] + 1, akt[-1] + 1, vor[j - 1] + (ca != cb)))
        vor = akt
    return vor[-1]


def toleranz(wort):
    return 0 if len(wort) < 5 else 1 if len(wort) < 8 else 2


def enthaelt_wort(segment, wort):
    return any(abs(len(w) - len(wort)) <= 2 and abstand(w, wort) <= toleranz(wort) for w in segment)


def name_teile(row):
    titel = set(worte(row.get("titel")))
    return {w for w in worte(row.get("interpret")) if len(w) >= MIN_NAME and w not in FUELLWORTE and w not in titel}


def letzte_nennung(segmente, teile):
    treffer = [s for s in segmente if s["bis"] <= NAME_BIS and any(enthaelt_wort(grosse_worte(s["text"]), t) for t in teile)]
    return treffer[-1] if treffer else None


def titel_stelle(seg_worte, segmente, row):
    """Segment der einzigen Titelnennung oder None. Mehrfache Nennung ist vermutlich Gesang."""
    titel = worte(row.get("titel"))
    if not titel or len("".join(titel)) < 5:
        return None
    ziel = "".join(titel)
    treffer = []
    for w, s in zip(seg_worte, segmente):
        for i in range(max(len(w) - len(titel) + 1, 0)):
            if abstand("".join(w[i: i + len(titel)]), ziel) <= toleranz(ziel):
                treffer.append(s)
                break
    return treffer[0] if len(treffer) == 1 and treffer[0]["bis"] <= TITEL_BIS else None


def moderation_ende(segmente):
    """Ende der Moderation oder (None, Grund)."""
    if not segmente or segmente[0]["von"] > MOD_START:
        return None, "keine Sprache am Anfang"
    block = [segmente[0]]
    pause = False
    for s in segmente[1:]:
        if s["von"] - block[-1]["bis"] >= PAUSE:
            pause = True
            break
        block.append(s)
    ende = block[-1]["bis"]
    zeichen = sum(len(s["text"]) for s in block)
    if not pause:
        return None, "keine Pause nach der Sprache"
    if ende > MOD_MAX:
        return None, "Passage über 45 s"
    if ende < MOD_MIN:
        return None, "Passage unter 3 s"
    if zeichen / max(ende - block[0]["von"], 1) < MIN_DICHTE:
        return None, "wenig Text"
    if max(s["kein_text"] for s in block) >= MAX_KEIN_TEXT:
        return None, "klingt eher nach Gesang"
    return ende, None


def bewerte(row, e):
    """(Zeitpunkt, Art, Grund) je Lied; Zeitpunkt None bedeutet keine Kürzung."""
    if not e:
        return None, None, "kein Ergebnis"
    if e.get("fehler"):
        return None, None, "technischer Fehler"
    segmente = e["segmente"]
    seg_worte = [worte(s["text"]) for s in segmente]
    ende, grund = moderation_ende(segmente)
    nennung = letzte_nennung(segmente, name_teile(row))
    if nennung and (ende is None or nennung["bis"] > ende):
        return nennung["bis"], "interpret", nennung["text"][:80]
    if ende is not None:
        return ende, "moderation", segmente[0]["text"][:80]
    titel = titel_stelle(seg_worte, segmente, row)
    if titel:
        return titel["bis"], "titel", titel["text"][:80]
    return None, None, grund


def main():
    rows = [r for r in load_input(str(DEFAULT_INPUT)) if r["jahr"] <= BIS_JAHR and r.get("youtube_id")]
    cache = load_json(CACHE)
    zeilen, ohne = [], Counter()
    ohne_liste = []
    for r in rows:
        e = cache.get(r["id"])
        if e and e.get("youtube_id") != r["youtube_id"]:
            e = None  # Video wurde inzwischen getauscht
        zeit, art, grund = bewerte(r, e)
        if zeit is None:
            ohne[grund] += 1
            ohne_liste.append(f"{r['id']};{grund};{r.get('interpret')} - {r.get('titel')}")
        else:
            zeilen.append({"id": r["id"], "start_sek": math.ceil(zeit), "art": art, "grund": grund.replace(";", ",")})

    with AUSGABE.open("w", encoding="utf-8", newline="\n") as f:
        w = csv.DictWriter(f, fieldnames=["id", "start_sek", "art", "grund"], delimiter=";", lineterminator="\n")
        w.writeheader()
        w.writerows(zeilen)

    arten = Counter(z["art"] for z in zeilen)
    text = [f"Lieder bis {BIS_JAHR}: {len(rows)}", f"Gekürzt: {len(zeilen)}"]
    text += [f"  {a}: {n}" for a, n in arten.most_common()]
    text += [f"Nicht gekürzt: {sum(ohne.values())}"]
    text += [f"  {g}: {n}" for g, n in ohne.most_common()]
    text += ["", "Lieder ohne Kürzung (id;Grund;Lied)"] + ohne_liste
    BERICHT.write_text("\n".join(text) + "\n", encoding="utf-8")
    print("\n".join(text[: 4 + len(arten) + len(ohne)]))
    print(f"Ergebnis: {AUSGABE}\nBericht: {BERICHT}")


if __name__ == "__main__":
    main()
