"""09 – Intro-Prüfung: ab wann setzt die Musik bei alten ESC-Liedern ein? (Standard: Jahr <= 1979)

Je Video werden die ersten 90 s Ton geladen (yt-dlp, nur temporär unter data/raw/intro_tmp/),
mit ffmpeg zu Mono 16 kHz dekodiert und per numpy analysiert. Je Fenster (0,5 s) werden Lautstärke,
spektrale Flachheit, Hüllkurven-Stetigkeit und Modulation im Sprechtakt (2-8 Hz) gemessen.
Musik = tonal, stetig, ohne Sprechmodulation. Sprache = starke Silbenmodulation mit vielen Pausen,
Applaus = hohe spektrale Flachheit. Vorschlag = erste Sekunde, ab der mindestens 8 s lang überwiegend
Musik erkannt wird.

Ergebnis:
  data/raw/intro_cache.json     id -> {youtube_id, vorschlag, sicherheit, kurve, fehler}
  data/raw/intro_pruefung.html  Abweichungen und unsichere Fälle mit Kurve und YouTube-Links
Mit --schreibe-overrides werden sichere Abweichungen (hoch, <= 60 s, Abweichung >= 3 s) in
data/overrides.csv eingetragen. Danach tools/07_export_json.py laufen lassen.

Aufruf
  python 09_check_intro.py [--ids 1967-DE,1969-DE] [--input data/esc_songs.json] [--pause 4]
                           [--schreibe-overrides] [--nur-bericht]
"""
import argparse
import csv
import html
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from yt_common import DATA, RAW, filter_ids, load_input, load_json, save_json

CACHE = RAW / "intro_cache.json"
TMP = RAW / "intro_tmp"
REPORT = RAW / "intro_pruefung.html"
OVERRIDES = DATA / "overrides.csv"
DEFAULT_INPUT = DATA / "esc_songs.json"

SR = 16000          # Abtastrate nach dem Dekodieren
DAUER = 90          # Sekunden, die geprüft werden
FENSTER = 0.5       # Sekunden je Analysefenster
RUN = 16            # 16 Fenster = 8 s am Stück
ANTEIL_RUN = 0.8    # Anteil Musikfenster innerhalb des Laufs
SCHWELLE = 0.5      # ab diesem Musik-Anteil gilt ein Fenster als Musik
MAX_SICHER = 60     # Vorschläge darüber nie als sicher behandeln
ABWEICHUNG = 3      # Sekunden, ab denen ein Lied im Bericht und Override auftaucht
MAX_START = 30      # Overrides starten höchstens hier: lieber etwas vom Lied verpassen als das ganze Intro hören

try:  # Windows-Konsole: Umlaute nicht abstürzen lassen
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def analyse(x):
    """Schätzt den Musikeinsatz eines Mono-Signals (SR Hz, float -1..1).

    Gibt ein Dict mit vorschlag (s oder None), sicherheit ("hoch"/"niedrig"), kurve (Musik-Anteil je
    Sekunde, 0..1) und Diagnosewerten (lauf, kontrast) zurück.
    """
    hop = SR // 100  # 10-ms-Hüllkurve
    n_env = len(x) // hop
    if n_env < 500:
        raise ValueError("Audio kürzer als 5 s")
    env = np.sqrt(np.mean(x[: n_env * hop].reshape(n_env, hop) ** 2, axis=1) + 1e-12)
    env_db = 20 * np.log10(env)
    ref = np.percentile(env_db, 95)               # typischer Lautstärke-Pegel des Liedes
    env_db = np.maximum(env_db, ref - 40)         # Stille auf 40 dB unter Pegel begrenzen
    leise = env_db < ref - 30                     # Pause relativ zum Pegel
    n_win = n_env // 50                           # Fenster zu 0,5 s

    # Spektrale Flachheit über 512-Punkte-STFT (32 ms, Hop 16 ms), Band ca. 100 Hz bis 8 kHz
    nfft, hs = 512, 256
    nfr = (len(x) - nfft) // hs + 1
    idx = np.arange(nfft)[None, :] + hs * np.arange(nfr)[:, None]
    P = np.abs(np.fft.rfft(x[idx] * np.hanning(nfft), axis=1)) ** 2 + 1e-12
    Pb = P[:, 3:257]
    flat = np.exp(np.mean(np.log(Pb), axis=1)) / np.mean(Pb, axis=1)
    f_zeit = (np.arange(nfr) * hs + nfft / 2) / SR
    f_win = np.minimum((f_zeit / FENSTER).astype(int), n_win - 1)
    cnt = np.bincount(f_win, minlength=n_win)
    fl = np.bincount(f_win, weights=flat, minlength=n_win) / np.maximum(cnt, 1)

    # Pro Fenster: Stille-Anteil, Stetigkeit der Hüllkurve, Sprechmodulation (2-8 Hz, 4-s-Kontext)
    e_pad = np.pad(env_db, (200, 200), mode="edge")
    fr_mod = np.fft.rfftfreq(400, d=0.01)
    band_all = (fr_mod >= 0.5) & (fr_mod <= 16)
    band_sprech = (fr_mod >= 2) & (fr_mod <= 8)
    sil = np.zeros(n_win)
    std = np.zeros(n_win)
    mod = np.zeros(n_win)
    for w in range(n_win):
        a, b = w * 50, (w + 1) * 50
        sil[w] = leise[a:b].mean()
        loud = env_db[a:b][~leise[a:b]]
        std[w] = loud.std() if loud.size > 2 else 0.0
        c = a + 25
        seg = e_pad[c: c + 400]
        seg = (seg - seg.mean()) * np.hanning(400)
        Sp = np.abs(np.fft.rfft(seg)) ** 2
        mod[w] = Sp[band_sprech].sum() / (Sp[band_all].sum() + 1e-12)

    tonal = np.clip((0.04 - fl) / 0.03, 0, 1)     # Flachheit <= 0.01 -> 1, >= 0.04 -> 0
    stetig = np.clip((5 - std) / 2, 0, 1)         # Hüllkurven-Streuung <= 3 dB -> 1, >= 5 dB -> 0
    sprech = np.clip((mod - 0.35) / 0.25, 0, 1)   # starke Silbenmodulation -> 1
    m = (1 - sil) * (0.5 * tonal + 0.3 * stetig + 0.2 * (1 - sprech))
    ms = (m + np.append(m[1:], m[-1])) / 2        # ca. 1 s glätten
    kurve = [round(float(np.mean(ms[2 * s: 2 * s + 2])), 2) for s in range(min(DAUER, n_win // 2))]

    ja = ms >= SCHWELLE
    start = None
    for i in range(n_win - RUN + 1):
        if ja[i: i + RUN].mean() >= ANTEIL_RUN:
            start = i
            break
    if start is None:
        return {"vorschlag": None, "sicherheit": "niedrig", "kurve": kurve, "lauf": None, "kontrast": None}

    lauf = float(ms[start: start + RUN].mean())
    anteil = float(ja[start: start + RUN].mean())
    davor = ms[max(0, start - 8): start]          # 4 s vor dem Lauf
    kontrast = float(lauf - davor.mean()) if davor.size else None
    vorschlag = int(round(start * FENSTER))
    # Ohne Zeit davor gibt es keinen Kontrast zum Vergleichen, das ist also nie sicher
    hoch = (anteil >= 0.85 and lauf >= 0.6 and vorschlag <= MAX_SICHER
            and kontrast is not None and kontrast >= 0.25)
    return {"vorschlag": vorschlag, "sicherheit": "hoch" if hoch else "niedrig", "kurve": kurve,
            "lauf": round(lauf, 2), "kontrast": None if kontrast is None else round(kontrast, 2)}


def lade(yid):
    """Lädt die ersten 90 s Audio nach data/raw/intro_tmp/. Gibt (Pfad, ffmpeg-Pfad) zurück."""
    import imageio_ffmpeg
    import yt_dlp

    TMP.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    # yt-dlp erkennt den ffmpeg-Namen aus imageio_ffmpeg nicht; daher eine Kopie als ffmpeg.exe im Tmp-Ordner
    bin_dir = TMP / "bin"
    bin_dir.mkdir(exist_ok=True)
    ffmpeg_kopie = bin_dir / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    if not ffmpeg_kopie.exists():
        shutil.copy(ffmpeg, ffmpeg_kopie)
    if str(bin_dir) not in os.environ.get("PATH", ""):  # yt-dlp prüft für Teilabschnitte den PATH
        os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
    opts = {
        "format": "bestaudio/best",
        "download_ranges": yt_dlp.utils.download_range_func(None, [(0, DAUER)]),
        "force_keyframes_at_cuts": False,
        "outtmpl": str(TMP / f"{yid}.%(ext)s"),
        "ffmpeg_location": str(ffmpeg_kopie),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "retries": 2,
    }
    with yt_dlp.YoutubeDL(opts) as y:
        y.download([f"https://www.youtube.com/watch?v={yid}"])
    dateien = [p for p in TMP.glob(f"{yid}.*") if p.suffix not in (".part", ".ytdl")]
    if not dateien:
        raise RuntimeError("keine Audiodatei geladen")
    return max(dateien, key=lambda p: p.stat().st_size), str(ffmpeg)


def lade_mit_wiederholung(yid):
    for versuch in range(3):
        try:
            return lade(yid)
        except Exception as ex:
            msg = str(ex)
            drossel = any(k in msg for k in ("429", "Too Many Requests", "not a bot"))
            if drossel and versuch < 2:
                wait = 60 * (versuch + 1)
                print(f"   Drosselung, Pause {wait} s", flush=True)
                time.sleep(wait)
                continue
            raise


def dekodiere(pfad, ffmpeg):
    r = subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-i", str(pfad), "-t", str(DAUER), "-vn",
                        "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                       capture_output=True, timeout=300)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError("ffmpeg: " + r.stderr.decode("utf-8", "replace")[:160])
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def pruefe(row):
    yid = row["youtube_id"]
    try:
        pfad, ffmpeg = lade_mit_wiederholung(yid)
        try:
            erg = analyse(dekodiere(pfad, ffmpeg))
        finally:
            for p in TMP.glob(f"{yid}.*"):
                p.unlink(missing_ok=True)
        return {"youtube_id": yid, "fehler": None, **erg}
    except Exception as ex:
        for p in TMP.glob(f"{yid}.*"):
            p.unlink(missing_ok=True)
        return {"youtube_id": yid, "vorschlag": None, "sicherheit": None, "kurve": [],
                "fehler": f"{type(ex).__name__}: {str(ex)[:160]}"}


def fertig(cache, row):
    e = cache.get(row["id"])
    return bool(e) and e.get("youtube_id") == row["youtube_id"] and e.get("vorschlag") is not None


def zusammenfassung(e):
    if e.get("fehler"):
        return f"FEHLER: {e['fehler']}"
    if e.get("vorschlag") is None:
        return "kein Musik-Lauf gefunden (niedrige Sicherheit)"
    return (f"Vorschlag {e['vorschlag']} s, Sicherheit {e['sicherheit']}, "
            f"Lauf {e.get('lauf')}, Kontrast {e.get('kontrast')}")


def abweichung(row, e):
    if e.get("vorschlag") is None:
        return None
    return abs(e["vorschlag"] - (row.get("start_sek") or 0))


def svg_kurve(kurve, ist, vor):
    w, h = 180, 40
    if not kurve:
        return ""
    n = max(len(kurve) - 1, 1)
    pts = " ".join(f"{i * w / n:.1f},{h - 2 - v * (h - 4):.1f}" for i, v in enumerate(kurve))
    s = (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" class="kurve">'
         f'<polyline points="{pts}" fill="none" stroke="#1d4ed8" stroke-width="1.2"/>')
    for sek, farbe in ((ist, "#dc2626"), (vor, "#16a34a")):
        if sek is not None and 0 <= sek <= DAUER:
            x = sek * w / DAUER
            s += f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{h}" stroke="{farbe}" stroke-width="1"/>'
    return s + "</svg>"


def schreibe_bericht(auswahl, cache):
    zeilen, fehler = [], []
    for r in sorted(auswahl, key=lambda r: (r["jahr"], r["id"])):
        e = cache.get(r["id"])
        if not e or e.get("youtube_id") != r["youtube_id"]:
            continue
        if e.get("fehler"):
            fehler.append((r, e))
            continue
        abw = abweichung(r, e)
        if abw is None or e["sicherheit"] == "niedrig" or abw >= ABWEICHUNG:
            zeilen.append((r, e))

    def link(yid, sek):
        return f'<a href="https://www.youtube.com/watch?v={yid}&amp;t={sek}s" target="_blank">{sek} s</a>'

    tr = []
    for r, e in zeilen:
        ist = r.get("start_sek") or 0
        vor = e.get("vorschlag")
        tr.append(
            "<tr>"
            f"<td>{html.escape(r.get('land') or '')}</td>"
            f"<td>{r['jahr']}</td>"
            f"<td>{html.escape(r.get('interpret') or '')} – {html.escape(r.get('titel') or '')}</td>"
            f"<td>{link(r['youtube_id'], ist)}</td>"
            f"<td>{'–' if vor is None else link(r['youtube_id'], vor)}</td>"
            f"<td class='{e['sicherheit']}'>{e['sicherheit']}</td>"
            f"<td>{svg_kurve(e.get('kurve'), ist, vor)}</td>"
            "</tr>")
    fe = "".join(f"<li>{html.escape(r['id'])}: {html.escape(e['fehler'])}</li>" for r, e in fehler)
    n_hoch = sum(1 for _, e in zeilen if e["sicherheit"] == "hoch")
    doc = f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Intro-Prüfung</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 16px; color: #111; background: #fff; }}
table {{ border-collapse: collapse; font-size: 14px; }}
th, td {{ border-bottom: 1px solid #ddd; padding: 4px 8px; text-align: left; vertical-align: middle; }}
td.hoch {{ color: #15803d; }} td.niedrig {{ color: #b45309; font-weight: bold; }}
.kurve {{ display: block; }}
</style></head><body>
<h1>Intro-Prüfung</h1>
<p>Lieder mit Abweichung &ge; {ABWEICHUNG} s oder niedriger Sicherheit: {len(zeilen)} (davon hohe Sicherheit: {n_hoch}).
Fehler: {len(fehler)}. Rot = aktueller Start, grün = Vorschlag, blau = Musik-Anteil je Sekunde (0 bis 90 s).</p>
<table><tr><th>Land</th><th>Jahr</th><th>Interpret – Titel</th><th>aktuell</th><th>Vorschlag</th><th>Sicherheit</th><th>Kurve 0–90 s</th></tr>
{''.join(tr)}
</table>
<h2>Fehler</h2><ul>{fe or '<li>keine</li>'}</ul>
</body></html>
"""
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    with REPORT.open("w", encoding="utf-8", newline="\n") as f:
        f.write(doc)
    return len(zeilen), n_hoch, len(fehler)


def schreibe_overrides(auswahl, cache):
    text = OVERRIDES.read_text(encoding="utf-8-sig")
    vorhandene = {(z.get("id") or "").strip() for z in csv.DictReader(text.splitlines(), delimiter=";")
                  if (z.get("feld") or "").strip() == "start_sek"}
    neu = []
    for r in auswahl:
        e = cache.get(r["id"])
        if not e or e.get("youtube_id") != r["youtube_id"] or e.get("vorschlag") is None:
            continue
        v = min(e["vorschlag"], MAX_START)
        if r["id"] in vorhandene:
            continue
        # Nur später starten: Die Prüfung soll Intros kürzen, nie verlängern
        if v - (r.get("start_sek") or 0) < ABWEICHUNG:
            continue
        neu.append(f"{r['id']};start_sek;{v};Intro-Prüfung konservativ: Start bei {v} s, höchstens {MAX_START} s")
    if neu:
        if not text.endswith("\n"):
            text += "\n"
        text += "\n".join(neu) + "\n"
        with OVERRIDES.open("w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    return len(neu)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=str(DEFAULT_INPUT))
    ap.add_argument("--ids")
    ap.add_argument("--pause", type=float, default=4.0)
    ap.add_argument("--schreibe-overrides", action="store_true")
    ap.add_argument("--nur-bericht", action="store_true")
    a = ap.parse_args()

    rows = load_input(a.input)
    if a.ids:
        auswahl = filter_ids(rows, a.ids)
    else:
        auswahl = [r for r in rows if r["jahr"] <= 1979]
    auswahl = [r for r in auswahl if r.get("youtube_id")]

    cache = load_json(CACHE)
    zu_tun = [r for r in auswahl if not fertig(cache, r)]
    print(f"{len(auswahl)} Lieder ausgewählt, {len(auswahl) - len(zu_tun)} schon fertig, {len(zu_tun)} zu prüfen",
          flush=True)

    if not a.nur_bericht:
        t0 = time.time()
        for i, r in enumerate(zu_tun, 1):
            print(f"[{i}/{len(zu_tun)}] {r['id']} {r['youtube_id']} {r.get('titel', '')}", flush=True)
            e = pruefe(r)
            cache[r["id"]] = e
            save_json(CACHE, cache)
            print("   " + zusammenfassung(e), flush=True)
            if i < len(zu_tun):
                time.sleep(a.pause)
        print(f"Downloads und Analyse fertig in {time.time() - t0:.0f} s", flush=True)
        shutil.rmtree(TMP, ignore_errors=True)

    geprueft = [r for r in auswahl if fertig(cache, r)]
    n_hoch = sum(1 for r in geprueft if cache[r["id"]]["sicherheit"] == "hoch")
    n_niedrig = len(geprueft) - n_hoch
    n_fehler = sum(1 for r in auswahl if cache.get(r["id"], {}).get("fehler"))
    n_zeilen, _, _ = schreibe_bericht(auswahl, cache)
    print(f"Geprüft: {len(geprueft)}, hohe Sicherheit: {n_hoch}, niedrige Sicherheit: {n_niedrig} "
          f"(davon ohne Musik-Lauf: {sum(1 for r in geprueft if cache[r['id']]['vorschlag'] is None)}), "
          f"Fehler: {n_fehler}")
    print(f"Bericht: {REPORT} ({n_zeilen} Zeilen)")
    if a.schreibe_overrides:
        print(f"Neue start_sek-Overrides: {schreibe_overrides(auswahl, cache)}")


if __name__ == "__main__":
    sys.exit(main())
