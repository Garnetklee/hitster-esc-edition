"""04 – YouTube-Video je ESC-Beitrag suchen (yt-dlp "ytsearch", flach, ohne API-Key).

Ergebnis: esc/data/raw/youtube_cache.json
  {"<id>": {"youtube_id", "start_sek", "video_typ" (live|studio|""), "kanal", "video_titel", "dauer", "views",
            "query", "kandidaten": [{id,t,ch,d,v,s,typ,ok}], "schluessel"}}
Fortsetzbar: Einträge im Cache werden übersprungen (außer --force / --retry-empty, oder wenn sich
Interpret/Titel in der Eingabe geändert haben -> Feld "schluessel").

Suche
  1. ytsearch8:"<Interpret> <Titel> Eurovision <Jahr> live"
  2. (falls kein überzeugender Live-Treffer) ytsearch8:"<Interpret> <Titel> <Land engl.> Eurovision <Jahr>"
  3. (falls weiterhin kein Live-Treffer) ytsearch8:"<Interpret> <Titel>" -> Studiofassung/offizielles Video

Bewertung je Kandidat (Punkte, höher = besser)
  + 30 * Anteil der Titel-Wörter im Videotitel, + 20 * Anteil der Interpret-Wörter (Akzente normalisiert, fuzzy)
  + 40 offizieller Kanal "Eurovision Song Contest"
  + 10 Jahr im Videotitel, - 25 anderes ESC-Jahr im Videotitel (außer es steht im Liedtitel)
  - 12 zusätzliches anderes Jahr neben dem richtigen (z. B. "Eurovision 2003 ... live 2004")
  + 40 gilt auch für Kollab-Kanäle "Eurovision Song Contest and <Interpret>"
  2020 (abgesagt) und 1996-Audio-Vorrunde (runde_ende=Vorentscheid): kein Live-Treffer möglich -> Video/Studio
  ab 2004: falls kein offizieller Live-Treffer bzw. Finalist nur mit Semi-Final-Video -> 4. Suche
  "<Interpret> <Titel> Grand Final|Semi-Final Eurovision <Jahr>"
  ohne glaubwürdigen Treffer: Notfall-Suchen "<Land> Eurovision <Jahr> <Interpret>" und "<Titel> Eurovision <Jahr>"
  +  6 ESC-Bezug (eurovision/esc/song contest), + 6 "live"
  Runde: Finalisten +6 "grand final", -8 "semi-final"; HF-Aus +8 "semi-final", -20 "grand final"
  - 40 und unbrauchbar: reaction, cover, karaoke, lyrics, rehearsal, national final, Vorentscheid-Namen
       (Melodifestivalen, Sanremo, Unser Lied, MGP, UMK, ...), full show, recap, instrumental, ...
  - 15 Notlösung: preview, postcard, remix, reprise / winner's performance (offizieller Kanal trotzdem vor Fan-Uploads)
  - 30 und unbrauchbar: Dauer < 100 s oder > 600 s
  Live-Treffer glaubwürdig ("ok"): Titel-Anteil >= 0.6, Interpret-Anteil >= 0.5 (oder offizieller Kanal und
  Titel vollständig), ESC-Bezug oder offizieller Kanal, kein Studio-Merkmal ("official video", "audio",
  "lyric", ...), kein anderes ESC-Jahr, keine harte Negativ-Markierung.
  Studio-Fallback glaubwürdig: Titel-Anteil >= 0.7, Interpret-Anteil >= 0.5; + 10 "official",
  + 10 Künstlerkanal/Topic/VEVO, - 20 Live-Mitschnitte ohne ESC-Bezug (TV-Shows, Konzerte).

start_sek-Heuristik (Ansage/Postcard überspringen)
  - offizielle Live-Videos: 3 s (Dauer <= 200 s), 5 s (<= 260 s), sonst 8 s
  - andere Live-Mitschnitte: max(0, min(30, Dauer - 190)) – Überlänge = vermutlich Ansage/Postcard
  - Studio: 0

Aufruf
  python 04_find_youtube.py [--input esc/data/esc_songs.csv|sample.json] [--limit N] [--ids 1974-SE,2010-DE]
                            [--workers 8] [--force] [--retry-empty]
"""
import argparse
import difflib
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import yt_dlp

from yt_common import (YT_CACHE, OFFICIAL_CHANNEL_IDS, OFFICIAL_CHANNEL_NAMES, filter_ids, load_input,
                       load_json, norm, save_json)

LAND_EN = {
    "AD": "Andorra", "AL": "Albania", "AM": "Armenia", "AT": "Austria", "AU": "Australia", "AZ": "Azerbaijan",
    "BA": "Bosnia", "BE": "Belgium", "BG": "Bulgaria", "BY": "Belarus", "CH": "Switzerland", "CS": "Serbia Montenegro",
    "CY": "Cyprus", "CZ": "Czech Republic", "DE": "Germany", "DK": "Denmark", "EE": "Estonia", "ES": "Spain",
    "FI": "Finland", "FR": "France", "GB": "United Kingdom", "GE": "Georgia", "GR": "Greece", "HR": "Croatia",
    "HU": "Hungary", "IE": "Ireland", "IL": "Israel", "IS": "Iceland", "IT": "Italy", "LT": "Lithuania",
    "LU": "Luxembourg", "LV": "Latvia", "MA": "Morocco", "MC": "Monaco", "MD": "Moldova", "ME": "Montenegro",
    "MK": "North Macedonia", "MT": "Malta", "NL": "Netherlands", "NO": "Norway", "PL": "Poland", "PT": "Portugal",
    "RO": "Romania", "RS": "Serbia", "RU": "Russia", "SE": "Sweden", "SI": "Slovenia", "SK": "Slovakia",
    "SM": "San Marino", "TR": "Turkey", "UA": "Ukraine", "YU": "Yugoslavia",
}

HARD_NEG = [
    "reaction", "reacts", "reacting", "react", "cover", "karaoke", "lyrics", "lyric video", "letra", "testo",
    "paroles", "rehearsal", "repetition", "probe", "national final", "national selection", "preselection",
    "pre selection", "vorentscheid", "melodifestivalen", "sanremo", "unser lied", "unser star", "mgp",
    "melodi grand prix", "umk", "uuden musiikin kilpailu", "festival da cancao", "benidorm fest", "eesti laul",
    "supernova", "beovizija", "pesma za evroviziju", "a dal", "vidbir", "selectia nationala", "songvakeppnin",
    "eurosong", "objetivo eurovision", "destination eurovision", "das deutsche finale", "krajowe eliminacje",
    "eurovizijos atranka", "national finals", "full show", "recap", "all songs", "top 10", "top 20", "top 40",
    "ranking", "my top", "instrumental", "nightcore", "8d", "slowed", "sped up", "piano version",
    "tutorial", "parody", "interview", "jury show", "jury final", "press conference", "flag parade",
    "turquoise carpet", "behind the scenes", "mashup", "medley", "snippet", "junior eurovision", "jesc",
    "eurovision again", "second chance", "tribute", "guitar", "drum", "backing track", "minus", "acapella",
    "a cappella", "subtitles", "sub espanol", "traduction", "translation", "concert", "eurovision in concert",
    "acoustic", "akustik", "unplugged", "totp", "top of the pops", "gmtv", "wetten dass", "stage version",
    "audience pov", "fancam", "fan cam", "wiwi jam", "at home", "pre party", "preparty", "london eurovision party", "israel calling", "madrid pre",
]
SOFT_NEG = ["preview", "postcard", "swedish version", "remix", "reprise", "winners performance", "winner performance", "victory performance",
            "winning performance", "after winning", "after the victory", "full performance with postcard"]
STUDIO_MARK = ["official video", "official music video", "music video", "videoclip", "video clip", "official audio",
               "audio", "lyric", "clip officiel", "clip oficial", "videoclip oficial", "studio version", "visualizer",
               "official clip"]
ESC_MARK = ["eurovision", "esc", "song contest", "grand prix eurovision", "concours eurovision", "eurovisie",
            "eurovisao", "eurovizija", "eurovisión"]
STOP = {"the", "and", "a", "of", "la", "le", "les", "el", "il", "der", "die", "das", "de", "feat", "ft", "with"}

pause_until = 0.0
pause_lock = threading.Lock()
pause_count = 0


def has(t, phrase):
    return f" {phrase} " in f" {t} "


def coverage(needle, hay):
    """Anteil der Wörter aus needle, die (fuzzy) im Videotitel vorkommen."""
    n = norm(needle)
    if not n:
        return 0.0
    if n.replace(" ", "") and n.replace(" ", "") in hay.replace(" ", ""):
        return 1.0
    toks = [w for w in n.split() if w not in STOP] or n.split()
    htoks = hay.split()
    hit = 0
    for w in toks:
        if w in htoks:
            hit += 1
        elif len(w) >= 4 and any(difflib.SequenceMatcher(None, w, h).ratio() >= 0.8 for h in htoks):
            hit += 1
    return hit / len(toks)


def title_coverage(titel, hay):
    """Wie coverage(), aber auch ohne Klammerzusatz und für Teile mit "/" (z. B. "Sufi (Hey Ya Hey)")."""
    variants = {titel, re.sub(r"\s*[\(\[].*?[\)\]]", "", titel)}
    variants |= {v for v in re.split(r"\s+/\s+", titel)}
    return max(coverage(v, hay) for v in variants if v.strip())


def years_in(t):
    return {int(y) for y in re.findall(r"\b(19[5-9]\d|20[0-3]\d)\b", t)}


def evaluate(e, song):
    t = norm(e.get("title"))
    ch = e.get("channel") or e.get("uploader") or ""
    official = (e.get("channel_id") in OFFICIAL_CHANNEL_IDS) or any(
        norm(ch) == n or norm(ch).startswith(n + " and ") for n in OFFICIAL_CHANNEL_NAMES)  # auch Kollab-Kanäle
    song_txt = norm(song["titel"]) + " " + norm(song["interpret"])
    tc = title_coverage(song["titel"], t)
    ac = coverage(song["interpret"], t)
    if official and ac < 0.5 and coverage(song["interpret"], norm(ch)) >= 0.5:
        ac = 1.0
    jahr = song["jahr"]
    ys = years_in(t) - years_in(norm(song["titel"]))
    year_hit = jahr in ys
    year_conflict = bool(ys) and not year_hit
    year_extra = year_hit and len(ys) > 1  # z. B. "Eurovision 2003 ... (live 2004)"
    esc = any(has(t, m) for m in ESC_MARK) or "eurovision" in t
    studio = any(has(t, m) for m in STUDIO_MARK if not has(song_txt, m))
    live = has(t, "live") or has(t, "performance")
    hard = [m for m in HARD_NEG if has(t, m) and not has(song_txt, m)]
    soft = [m for m in SOFT_NEG if has(t, m) and not has(song_txt, m)]
    dur = e.get("duration")
    dur_bad = dur is not None and (dur < 100 or dur > 600)

    s = 30 * tc + 20 * ac
    s += 40 if official else 0
    s += 10 if year_hit else 0
    s -= 25 if year_conflict else 0
    s -= 12 if year_extra else 0
    s += 6 if esc else 0
    s += 6 if live else 0
    finalist = (song.get("runde_ende") or "Finale") == "Finale"
    semi = has(t, "semi final") or has(t, "semifinal") or has(t, "semi")
    gfinal = has(t, "grand final") or (has(t, "final") and not semi)
    if finalist:
        s += 6 if gfinal else 0
        s -= 8 if semi else 0
    else:
        s += 8 if semi else 0
        s -= 20 if has(t, "grand final") else 0
    s -= 40 * bool(hard)
    s -= 15 * bool(soft)
    s -= 30 if dur_bad else 0

    match_ok = tc >= 0.6 and (ac >= 0.5 or (official and tc >= 1.0)) and not hard and not dur_bad
    # 2020 abgesagt: es gibt keinen ESC-Liveauftritt -> nur Studio/offizielles Video
    # 1996 Audio-Vorrunde (runde_ende=Vorentscheid): ebenfalls kein Liveauftritt
    no_live = jahr == 2020 or (jahr == 1996 and (song.get("runde_ende") or "") == "Vorentscheid")
    live_ok = match_ok and not studio and (esc or official) and not year_conflict and not no_live
    if live_ok:
        typ = "live"
    else:
        typ = "studio"
        s += 10 if has(t, "official") else 0
        nch = norm(ch)
        if ch.endswith("- Topic") or "vevo" in nch or coverage(song["interpret"], nch) >= 0.7:
            s += 10
        if live and not studio:
            s -= 20  # TV-/Konzertmitschnitt ohne ESC-Bezug
        s += 8 if (esc or official) else 0  # ESC-Bezug (z. B. Preview-Video 1996) bevorzugen
    studio_ok = tc >= 0.7 and ac >= 0.5 and not hard and not dur_bad
    ok = live_ok or studio_ok
    return {"id": e.get("id"), "t": e.get("title") or "", "ch": ch, "d": dur, "v": e.get("view_count"),
            "s": round(s, 1), "typ": typ, "ok": bool(ok), "off": official, "soft": bool(soft)}


def start_sek(c):
    if c["typ"] != "live":
        return 0
    d = c.get("d") or 0
    if c.get("off"):
        return 3 if d <= 200 else 5 if d <= 260 else 8
    return max(0, min(30, d - 190))


def search(q, n=8):
    global pause_until, pause_count
    for attempt in range(5):
        while time.time() < pause_until:
            time.sleep(1)
        try:
            with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": True,
                                   "skip_download": True, "socket_timeout": 20}) as y:
                r = y.extract_info(f"ytsearch{n}:{q}", download=False)
            return [e for e in (r.get("entries") or []) if e and e.get("id")]
        except Exception as ex:
            msg = str(ex)
            if "429" in msg or "Sign in to confirm" in msg or "rate" in msg.lower():
                with pause_lock:
                    pause_count += 1
                    wait = min(600, 60 * (attempt + 1))
                    pause_until = max(pause_until, time.time() + wait)
                print(f"  Rate-Limit ({msg[:60]}), Pause {wait}s", flush=True)
            else:
                time.sleep(2 + attempt * 3 + random.random())
    return None  # Fehler -> nicht cachen


def find(song):
    base = f"{song['interpret']} {song['titel']}"
    qs = [f"{base} Eurovision {song['jahr']} live"]
    land = LAND_EN.get((song.get("land_iso") or "").upper()) or song.get("land") or ""
    qs.append(f"{base} {land} Eurovision {song['jahr']}".replace("  ", " "))
    qs.append(base)
    seen, cands, used = set(), [], []
    for i, q in enumerate(qs):
        if i == 2 and any(c["ok"] and c["typ"] == "live" for c in cands):
            break
        if i == 1 and any(c["ok"] and c["typ"] == "live" and (c["off"] or c["s"] >= 75) for c in cands):
            break
        res = search(q)
        if res is None:
            if not cands:
                return None
            continue
        used.append(q)
        for e in res:
            if e["id"] in seen:
                continue
            seen.add(e["id"])
            cands.append(evaluate(e, song))
    # Notfall: YouTube liefert für manche Kombinationen 0 Treffer (z. B. "MFÖ Didai didai dai")
    if not any(c["ok"] for c in cands):
        for q in (f"{land} Eurovision {song['jahr']} {song['interpret']}", f"{song['titel']} Eurovision {song['jahr']}"):
            res = search(q)
            if res:
                used.append(q)
                for e in res:
                    if e["id"] not in seen:
                        seen.add(e["id"])
                        cands.append(evaluate(e, song))
    # Sortierung: glaubwürdig live > glaubwürdig studio > Rest; innerhalb nach Punkten
    rank = lambda c: (c["ok"] and c["typ"] == "live" and (not c["soft"] or c["off"]),
                      c["ok"] and c["typ"] == "live", c["ok"], c["s"])
    cands.sort(key=rank, reverse=True)
    # ab 2004: richtige Runde vom offiziellen Kanal nachsuchen, falls nicht schon gefunden
    finalist = (song.get("runde_ende") or "Finale") == "Finale"
    b = cands[0] if cands else None
    if song["jahr"] >= 2004 and song["jahr"] != 2020 and b and (
            not b["off"] or (finalist and "semi" in b["t"].lower()) or b["typ"] != "live"):
        q = f"{base} {'Grand Final' if finalist else 'Semi-Final'} Eurovision {song['jahr']}"
        res = search(q)
        if res:
            used.append(q)
            for e in res:
                if e["id"] not in seen:
                    seen.add(e["id"])
                    cands.append(evaluate(e, song))
            cands.sort(key=rank, reverse=True)
    best = cands[0] if cands and cands[0]["ok"] else None
    entry = {
        "youtube_id": best["id"] if best else "",
        "start_sek": start_sek(best) if best else 0,
        "video_typ": best["typ"] if best else "",
        "kanal": best["ch"] if best else "",
        "video_titel": best["t"] if best else "",
        "dauer": best["d"] if best else None,
        "views": best["v"] if best else None,
        "query": " | ".join(used),
        "kandidaten": cands[:8],
        "schluessel": norm(base),
    }
    return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--ids")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--retry-empty", action="store_true")
    a = ap.parse_args()

    rows = filter_ids(load_input(a.input), a.ids)
    cache = load_json(YT_CACHE)
    todo = []
    for r in rows:
        c = cache.get(r["id"])
        key = norm(f"{r['interpret']} {r['titel']}")
        if a.force or c is None or c.get("schluessel") != key or (a.retry_empty and not c.get("youtube_id")):
            todo.append(r)
    if a.limit:
        todo = todo[:a.limit]
    print(f"{len(rows)} Beiträge, {len(rows) - len(todo)} im Cache, {len(todo)} zu suchen", flush=True)
    t0, done, fails = time.time(), 0, 0
    with ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(find, r): r for r in todo}
        for f in as_completed(futs):
            r = futs[f]
            try:
                e = f.result()
            except Exception as exc:
                e = None
                print(f"  FEHLER {r['id']}: {exc}", flush=True)
            done += 1
            if e is None:
                fails += 1
            else:
                cache[r["id"]] = e
                print(f"[{done}/{len(todo)}] {r['id']} {e['video_typ'] or '-':6} {e['youtube_id'] or '---------- '} "
                      f"{e['kanal'][:24]:24} | {e['video_titel'][:70]}", flush=True)
            if done % 20 == 0:
                save_json(YT_CACHE, cache)
                el = time.time() - t0
                print(f"  -- gespeichert, {done}/{len(todo)}, {el:.0f}s, ~{el / done * (len(todo) - done):.0f}s Rest",
                      flush=True)
    save_json(YT_CACHE, cache)
    sel = [cache[r["id"]] for r in rows if r["id"] in cache]
    n_live = sum(1 for c in sel if c["video_typ"] == "live")
    n_st = sum(1 for c in sel if c["video_typ"] == "studio")
    print(f"Fertig in {time.time() - t0:.0f}s. Fehler (nicht gecacht): {fails}. "
          f"Gesamt {len(sel)}/{len(rows)}: live {n_live}, studio {n_st}, ohne {len(sel) - n_live - n_st}. "
          f"Rate-Limit-Pausen: {pause_count}")


if __name__ == "__main__":
    sys.exit(main())
