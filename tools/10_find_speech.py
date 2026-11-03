"""10 – Sprachsuche: Wo wird in den ersten 90 s der alten ESC-Videos gesprochen oder gesungen?

Grundlage für die Suche nach Moderation vor dem Lied. Je Video werden die ersten 90 s Ton geladen und
lokal mit Whisper (faster-whisper, Modell small, nur Prozessor) in Passagen mit Zeitstempel und Text zerlegt.
Der Ton wird nur temporär unter data/raw/intro_tmp/ abgelegt und bleibt auf dem Rechner.

Das Skript ändert keine Lieddaten, weder data/overrides.csv noch esc_songs.json. Eine Regel für den
Startpunkt fehlt bewusst noch, sie wird erst aus den Ergebnissen der Stichproben abgeleitet.

Läuft mit einem eigenen venv außerhalb des Projekts:
  py -3.13 -m venv $HOME/esc-intro-venv
  $HOME/esc-intro-venv/Scripts/python.exe -m pip install faster-whisper yt-dlp imageio-ffmpeg

Ergebnis
  data/raw/speech_cache.json   id -> {youtube_id, sprache, segmente: [{von, bis, text, kein_text, logprob}], fehler}

Aufruf (Standard: alle Lieder bis 1979; fertige Lieder werden übersprungen)
  $HOME/esc-intro-venv/Scripts/python.exe tools/10_find_speech.py [--ids 1967-DE,1969-DE] [--pause 4]
"""
import argparse
import importlib
import sys
import time

from yt_common import DATA, RAW, filter_ids, load_input, load_json, save_json

intro = importlib.import_module("09_check_intro")  # lädt und dekodiert den Ton

CACHE = RAW / "speech_cache.json"
DEFAULT_INPUT = DATA / "esc_songs.json"
MODELL = "small"

try:  # Windows-Konsole: Umlaute nicht abstürzen lassen
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def erkenne(modell, audio, multilingual=False):
    # Kein Sprachfilter und kein Textkontext: Musik soll nicht wegfallen, eine Ansage den Gesang nicht beeinflussen
    segmente, info = modell.transcribe(audio, vad_filter=False, condition_on_previous_text=False, beam_size=1,
                                       multilingual=multilingual)
    return {
        "sprache": info.language,
        "segmente": [{
            "von": round(s.start, 1),
            "bis": round(s.end, 1),
            "text": s.text.strip(),
            "kein_text": round(s.no_speech_prob, 2),
            "logprob": round(s.avg_logprob, 2),
        } for s in segmente],
    }


def pruefe(modell, row, multilingual=False):
    yid = row["youtube_id"]
    try:
        pfad, ffmpeg = intro.lade_mit_wiederholung(yid)
        return {"youtube_id": yid, "fehler": None, **erkenne(modell, intro.dekodiere(pfad, ffmpeg), multilingual)}
    except Exception as ex:
        return {"youtube_id": yid, "sprache": None, "segmente": [], "fehler": f"{type(ex).__name__}: {str(ex)[:160]}"}
    finally:
        for p in intro.TMP.glob(f"{yid}.*"):
            p.unlink(missing_ok=True)


def fertig(cache, row):
    e = cache.get(row["id"])
    return bool(e) and e.get("youtube_id") == row["youtube_id"] and not e.get("fehler")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=str(DEFAULT_INPUT))
    ap.add_argument("--ids")
    ap.add_argument("--pause", type=float, default=4.0)
    ap.add_argument("--modell", default=MODELL)
    ap.add_argument("--multilingual", action="store_true", help="Sprache je Abschnitt neu bestimmen")
    ap.add_argument("--tag", help="eigener Cache und Tmp-Ordner, damit ein Vergleich parallel zum Hauptlauf laufen kann")
    a = ap.parse_args()

    from faster_whisper import WhisperModel

    cache_pfad = RAW / f"speech_cache_{a.tag}.json" if a.tag else CACHE
    if a.tag:
        intro.TMP = RAW / f"intro_tmp_{a.tag}"
    rows = load_input(a.input)
    auswahl = filter_ids(rows, a.ids) if a.ids else [r for r in rows if r["jahr"] <= 1979]
    auswahl = [r for r in auswahl if r.get("youtube_id")]
    cache = load_json(cache_pfad)
    zu_tun = [r for r in auswahl if not fertig(cache, r)]
    print(f"{len(auswahl)} Lieder ausgewählt, {len(zu_tun)} zu prüfen", flush=True)

    modell = WhisperModel(a.modell, device="cpu", compute_type="int8")
    t0 = time.time()
    for i, r in enumerate(zu_tun, 1):
        print(f"[{i}/{len(zu_tun)}] {r['id']} {r['youtube_id']} {r.get('titel', '')}", flush=True)
        e = pruefe(modell, r, a.multilingual)
        cache[r["id"]] = e
        save_json(cache_pfad, cache)
        if e["fehler"]:
            print(f"   Fehler: {e['fehler']}", flush=True)
        for s in e["segmente"]:
            print(f"   {s['von']:5.1f}-{s['bis']:5.1f} [{s['kein_text']:.2f} {s['logprob']:+.2f}] {s['text'][:70]}", flush=True)
        if i < len(zu_tun):
            time.sleep(a.pause)
    n_fehler = sum(1 for r in auswahl if cache.get(r["id"], {}).get("fehler"))
    print(f"Fertig in {time.time() - t0:.0f} s, Fehler: {n_fehler}. Ergebnis: {cache_pfad}", flush=True)


if __name__ == "__main__":
    main()
