"""12 – Refrain finden: Wo beginnt ein Refrain? Grundlage für einen eigenen Refrain-Modus.

Je Video wird der ganze Ton geladen und lokal mit Whisper (faster-whisper) mit Zeitstempel je Wort
aufgeschrieben. Liedtexte aus dem Netz werden nicht genutzt. Der Ton wird nur temporär unter
data/raw/intro_tmp_refrain/ abgelegt. Gesucht wird in dieser Reihenfolge:
  titel        Der ganze Titel fällt an mindestens zwei Stellen: Start vor der ersten Nennung
  titelwort    Ein langes Wort des Titels fällt an mindestens drei Stellen (bei langen Titeln,
               von denen im Refrain nur ein Teil gesungen wird)
  wiederholung Die am häufigsten wiederholte Wortfolge
Kleine Hörfehler bei Titeln werden toleriert. Ein Refrain muss zwischen 15 und 150 s nach dem Spielstart
liegen. Irgendein Refrain genügt, es muss nicht der erste sein.

Das Skript ändert keine Lieddaten und gibt keinen Liedtext aus, nur Zeiten und Kennzahlen.
Erkannte Wörter bleiben nur im git-ignorierten Cache. Ein erneuter Aufruf überspringt fertige Lieder und
wertet sie nur neu aus, das geht ohne Download und ohne Modell.

Läuft mit dem venv von 10_find_speech.py, Standardauswahl sind die ESC-Ikonen und alle Lieder ab 2000:
  $HOME/esc-intro-venv/Scripts/python.exe tools/12_find_refrain.py [--ids 1974-SE,2012-SE] [--threads 16] [--multilingual]

Ergebnis
  data/raw/refrain_cache.json   id -> {youtube_id, worte: [[zeit, wort]], refrain_sek, art, sicherheit, fehler}
  data/raw/refrain_bericht.txt  Zusammenfassung und unsichere Lieder mit YouTube-Link zur gefundenen Stelle
  data/refrain.csv              id;youtube_id;refrain_sek;sicherheit, nur sichere und mittlere Treffer.
                                Liegt im Repo, 07_export_json.py übernimmt daraus das Feld refrain_sek.

Mit --ohne-erkennung wird nur der Cache neu ausgewertet, ohne Download und ohne Whisper.
"""
import argparse
import csv
import importlib
import math
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from yt_common import DATA, RAW, filter_ids, load_input, load_json, save_json

intro = importlib.import_module("09_check_intro")  # lädt und dekodiert den Ton

CACHE = RAW / "refrain_cache.json"
BERICHT = RAW / "refrain_bericht.txt"
REFRAIN_CSV = DATA / "refrain.csv"
FUER_APP = ("hoch", "mittel")  # unsichere Treffer starten in der App normal
DEFAULT_INPUT = DATA / "esc_songs.json"
IKONEN = Path(__file__).resolve().parent.parent / "app" / "js" / "ikonen.js"
MODELL = "large-v3-turbo"
AB_JAHR = 2000
N = 4               # Wörter je Wortfolge
ABSTAND = 8         # Sekunden zwischen zwei Wiederholungen, damit „la la la“ nicht zählt
TITEL_ABSTAND = 15  # Sekunden zwischen zwei Titelnennungen, damit sie als getrennte Stellen zählen
RUECKBLICK = 25     # so weit vor der besten Wortfolge darf der Refrain beginnen
LUECKE = 4          # größere Pause beendet den Refrainblock
VORLAUF = 1         # Sekunden vor dem ersten Wort starten
FRUEHESTENS = 15    # Sekunden nach dem Spielstart, früher ist es eher die erste Strophe
SPAETESTENS = 150   # Sekunden nach dem Spielstart

try:  # Windows-Konsole: Umlaute nicht abstürzen lassen
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def norm(wort):
    s = unicodedata.normalize("NFKD", wort or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("ß", "ss")
    return re.sub(r"[^a-z0-9]", "", s)


def abstand(a, b):
    vor = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        akt = [i]
        for j, cb in enumerate(b, 1):
            akt.append(min(vor[j] + 1, akt[-1] + 1, vor[j - 1] + (ca != cb)))
        vor = akt
    return vor[-1]


def passt(wort, ziel):
    """Gleich oder mit kleinem Hörfehler: ab 5 Zeichen 1, ab 8 Zeichen 2 Fehler erlaubt."""
    if wort == ziel:
        return True
    tol = 0 if len(ziel) < 5 else 1 if len(ziel) < 8 else 2
    return tol > 0 and abs(len(wort) - len(ziel)) <= tol and abstand(wort, ziel) <= tol


def erkenne(modell, audio, multilingual=False):
    segmente, _ = modell.transcribe(audio, vad_filter=False, condition_on_previous_text=False, beam_size=1,
                                    word_timestamps=True, multilingual=multilingual)
    worte = []
    for s in segmente:
        for w in s.words or []:
            n = norm(w.word)
            if n:
                worte.append([round(w.start, 2), n])
    return worte


def zeilenanfang(worte, i):
    """Zurück zum Anfang der Zeile: höchstens 8 s, bis zur ersten Pause von 1 s."""
    j = i
    while j > 0 and worte[j][0] - worte[j - 1][0] < 1 and worte[i][0] - worte[j - 1][0] <= 8:
        j -= 1
    return max(0, math.floor(worte[j][0] - VORLAUF))


def stellen(worte, ziel, ab):
    """Indizes der ersten Nennung je getrennter Stelle; zwei Wörter hintereinander zählen auch („fairy tale“)."""
    treffer = [i for i in range(len(worte))
               if passt(worte[i][1], ziel) or (i + 1 < len(worte) and passt(worte[i][1] + worte[i + 1][1], ziel))]
    erste = []
    for i in treffer:
        if not erste or worte[i][0] - worte[erste[-1]][0] >= TITEL_ABSTAND:
            erste.append(i)
    return [i for i in erste if FRUEHESTENS <= worte[i][0] - ab <= SPAETESTENS]


def titel_refrain(worte, titel, ab):
    """(Startsekunde, Art) über den Titel oder None."""
    sauber = re.sub(r"\(.*?\)|\[.*?\]", " ", titel or "")
    ziel = norm(sauber)
    if len(ziel) >= 5:
        orte = stellen(worte, ziel, ab)
        if len(orte) >= 2:
            return zeilenanfang(worte, orte[0]), "titel"
    # Lange Titel: oft wird nur ein Teil gesungen, dann zählt das längste Wort, aber strenger
    lange = sorted({norm(w) for w in sauber.split() if len(norm(w)) >= 6}, key=len, reverse=True)
    if len(lange) and len(lange[0]) < len(ziel):
        orte = stellen(worte, lange[0], ab)
        if len(orte) >= 3:
            return zeilenanfang(worte, orte[0]), "titelwort"
    return None


def wiederholt_refrain(worte, ab):
    """(Startsekunde, Anzahl) über die häufigste wiederholte Wortfolge oder None."""
    orte = defaultdict(list)
    for i in range(len(worte) - N + 1):
        folge = tuple(w for _, w in worte[i: i + N])
        if len(set(folge)) == 1:
            continue
        if not orte[folge] or worte[i][0] - worte[orte[folge][-1]][0] >= ABSTAND:
            orte[folge].append(i)
    kandidaten = [f for f in orte if len(orte[f]) >= 2]
    gueltig = [f for f in kandidaten if FRUEHESTENS <= worte[orte[f][0]][0] - ab <= SPAETESTENS]
    if not gueltig:
        return None
    beste = max(gueltig, key=lambda f: (len(orte[f]), -orte[f][0]))
    i = orte[beste][0]
    # Zurück bis zum Anfang des wiederholten Blocks, damit der Refrain nicht mitten in der Zeile beginnt
    wiederholt = {j for f in kandidaten for j in orte[f]}
    while (i - 1 in wiederholt and worte[i][0] - worte[i - 1][0] < LUECKE
           and worte[orte[beste][0]][0] - worte[i - 1][0] <= RUECKBLICK and worte[i - 1][0] - ab >= FRUEHESTENS):
        i -= 1
    return max(0, math.floor(worte[i][0] - VORLAUF)), len(orte[beste])


def refrain(worte, titel, ab):
    """(Startsekunde, Art, Sicherheit). Art: titel | titelwort | wiederholung | None."""
    worte = [w for w in worte if w[0] >= ab]
    if len(worte) < N * 3:
        return None, None, "kein Text"
    t = titel_refrain(worte, titel, ab)
    w = wiederholt_refrain(worte, ab)
    if t:
        return t[0], t[1], "hoch" if t[1] == "titel" else "mittel"
    if w:
        # Ohne Titel ist eine oft wiederholte Wortfolge noch am verlässlichsten
        return w[0], "wiederholung", "mittel" if w[1] >= 4 else "niedrig"
    return None, None, "nichts gefunden"


def auswahl(rows, ids):
    if ids:
        return filter_ids(rows, ids)
    ikonen = set(re.findall(r"\d{4}-[A-Z]{2}(?:-\d+)?", IKONEN.read_text(encoding="utf-8")))
    return [r for r in rows if r["jahr"] >= AB_JAHR or r["id"] in ikonen]


def schreibe_bericht(rows, cache):
    sicher, arten, offen = Counter(), Counter(), []
    for r in rows:
        e = cache.get(r["id"])
        if not e or e.get("youtube_id") != r["youtube_id"]:
            sicher["noch nicht geprüft"] += 1
            continue
        if e.get("fehler"):
            sicher["technischer Fehler"] += 1
            offen.append(f"{r['id']};technischer Fehler;{r.get('titel')}")
            continue
        sicher[e["sicherheit"]] += 1
        arten[e["art"] or "keine"] += 1
        if e["sicherheit"] != "hoch":
            link = f"https://www.youtube.com/watch?v={r['youtube_id']}&t={e['refrain_sek'] or 0}s"
            offen.append(f"{r['id']};{e['sicherheit']};{r.get('titel')};{link}")
    text = [f"Lieder: {len(rows)}", "Sicherheit:"] + [f"  {k}: {n}" for k, n in sicher.most_common()]
    text += ["Gefunden über:"] + [f"  {k}: {n}" for k, n in arten.most_common()]
    text += ["", "Nicht sichere Lieder (id;Sicherheit;Titel;Link zur gefundenen Stelle)"] + offen
    BERICHT.write_text("\n".join(text) + "\n", encoding="utf-8")
    return text[: 3 + len(sicher) + len(arten)]


def schreibe_csv(rows, cache):
    """Sichere und mittlere Refrains für den Export, sortiert nach id."""
    out = []
    for r in rows:
        e = cache.get(r["id"])
        if e and e.get("youtube_id") == r["youtube_id"] and e.get("sicherheit") in FUER_APP and e.get("refrain_sek"):
            out.append({"id": r["id"], "youtube_id": r["youtube_id"], "refrain_sek": e["refrain_sek"], "sicherheit": e["sicherheit"]})
    out.sort(key=lambda x: x["id"])
    with REFRAIN_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "youtube_id", "refrain_sek", "sicherheit"], delimiter=";", lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    return len(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=str(DEFAULT_INPUT))
    ap.add_argument("--ids")
    ap.add_argument("--modell", default=MODELL)
    ap.add_argument("--multilingual", action="store_true", help="Sprache je Abschnitt neu bestimmen")
    ap.add_argument("--pause", type=float, default=4.0)
    ap.add_argument("--threads", type=int, default=8, help="Rechen-Threads für Whisper, 8 = ein Thread je Kern")
    ap.add_argument("--ohne-erkennung", action="store_true", help="nur den Cache neu auswerten")
    a = ap.parse_args()

    intro.DAUER = 600  # ganzes Lied statt der ersten 90 s
    intro.TMP = RAW / "intro_tmp_refrain"
    rows = [r for r in auswahl(load_input(a.input), a.ids) if r.get("youtube_id")]
    cache = load_json(CACHE)
    fertig = lambda r: (e := cache.get(r["id"])) and e.get("youtube_id") == r["youtube_id"] and not e.get("fehler")
    zu_tun = 0 if a.ohne_erkennung else sum(1 for r in rows if not fertig(r))
    print(f"{len(rows)} Lieder ausgewählt, {zu_tun} zu erkennen, etwa {zu_tun} Minuten", flush=True)
    modell = None
    t0 = time.time()
    k = 0
    for r in rows:
        yid = r["youtube_id"]
        e = cache.get(r["id"])
        if not fertig(r) and a.ohne_erkennung:
            continue
        if not fertig(r):
            if modell is None:  # erst laden, wenn wirklich etwas zu erkennen ist
                from faster_whisper import WhisperModel
                modell = WhisperModel(a.modell, device="cpu", compute_type="int8", cpu_threads=a.threads)
            k += 1
            print(f"[{k}/{zu_tun}] {r['id']} {r.get('titel', '')}", flush=True)
            try:
                pfad, ffmpeg = intro.lade_mit_wiederholung(yid)
                e = {"youtube_id": yid, "fehler": None,
                     "worte": erkenne(modell, intro.dekodiere(pfad, ffmpeg), a.multilingual)}
            except Exception as ex:
                e = {"youtube_id": yid, "fehler": f"{type(ex).__name__}: {str(ex)[:160]}", "worte": []}
            finally:
                for p in intro.TMP.glob(f"{yid}.*"):
                    p.unlink(missing_ok=True)
            if k < zu_tun:
                time.sleep(a.pause)
        sek, art, sicherheit = refrain(e["worte"], r.get("titel", ""), r.get("start_sek") or 0)
        e.update(refrain_sek=sek, art=art, sicherheit=sicherheit)
        e.pop("anzahl", None)
        e.pop("titel", None)
        cache[r["id"]] = e
        save_json(CACHE, cache)
        if not fertig(r) or a.ids:
            fehler = f", Fehler: {e['fehler']}" if e["fehler"] else ""
            print(f"   {r['id']}: Refrain ab {sek} s, {art or '-'}, Sicherheit {sicherheit}{fehler}", flush=True)
    print("\n".join(schreibe_bericht(rows, cache)))
    print(f"{schreibe_csv(rows, cache)} Refrains für die App in {REFRAIN_CSV}", flush=True)
    print(f"Fertig in {time.time() - t0:.0f} s. Bericht: {BERICHT}", flush=True)


if __name__ == "__main__":
    main()
