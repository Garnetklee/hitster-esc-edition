"""05 – YouTube-Links prüfen: Verfügbarkeit + Einbettbarkeit (Logik wie tools/check_links.py).

Je youtube_id aus esc/data/raw/youtube_cache.json:
  1. oEmbed  https://www.youtube.com/oembed?format=json&url=...  -> 200 ok, 404 = weg, 401/403 = Einbetten verboten
  2. yt-dlp-Metadaten (nicht flach): availability, playable_in_embed, age_limit, view_count
Ergebnis: esc/data/raw/links_cache.json
  {"<youtube_id>": {"oembed", "embed_ok", "verfuegbar", "views", "age_limit", "grund"}}
  embed_ok   = oEmbed 200 und playable_in_embed nicht False und age_limit < 18
  verfuegbar = Video existiert und ist öffentlich/nicht gelistet (oEmbed 200/401/403, yt-dlp ohne "unavailable"/"private")

--repair: Für Beiträge, deren Video nicht einbettbar/verfügbar ist, wird in youtube_cache.json der nächstbeste
glaubwürdige Kandidat (Liste "kandidaten" aus 04) geprüft und bei Erfolg übernommen; das alte Video landet in
"verworfen". Nicht gleichzeitig mit 04 laufen lassen (beide schreiben youtube_cache.json).

Aufruf
  python 05_check_links.py [--input csv|json] [--ids ...] [--limit N] [--workers 8] [--force] [--repair]
"""
import argparse
import importlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import yt_dlp

from yt_common import LINKS_CACHE, YT_CACHE, filter_ids, load_input, load_json, save_json

find_mod = importlib.import_module("04_find_youtube")  # für start_sek()
pause_until = 0.0


def oembed(yid):
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(
        f"https://www.youtube.com/watch?v={yid}")
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:
        return str(e)[:40]


def meta(yid):
    """-> (info|None, fehlertext|None, rate_limited)"""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "ignore_no_formats_error": True,
            "socket_timeout": 20}
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            return y.extract_info(f"https://www.youtube.com/watch?v={yid}", download=False, process=False), None, False
    except Exception as ex:
        msg = str(ex)
        rl = "429" in msg or "not a bot" in msg or "Too Many Requests" in msg
        return None, msg, rl


def check(yid):
    global pause_until
    oe = oembed(yid)
    info, err, rl = None, None, False
    for attempt in range(4):
        while time.time() < pause_until:
            time.sleep(1)
        info, err, rl = meta(yid)
        if not rl:
            break
        wait = 60 * (attempt + 1)
        pause_until = max(pause_until, time.time() + wait)
        print(f"  Rate-Limit bei {yid}, Pause {wait}s", flush=True)
    if rl:
        return None  # nicht cachen
    age = views = None
    grund = ""
    playable = None
    verf = oe in (200, 401, 403)
    if info:
        age = info.get("age_limit")
        views = info.get("view_count")
        playable = info.get("playable_in_embed")
        av = info.get("availability")
        if av in ("private", "needs_auth", "subscriber_only", "premium_only"):
            verf = False
            grund = f"availability={av}"
        elif av == "needs_auth" or (age or 0) >= 18:
            grund = "Altersbeschränkung"
    else:
        e = (err or "").lower()
        if "confirm your age" in e or "age-restricted" in e or "inappropriate" in e:
            age, grund = 18, "Altersbeschränkung"
        elif "unavailable" in e or "private" in e or "removed" in e or "terminated" in e or "copyright" in e:
            verf, grund = False, "yt-dlp: " + (err or "")[:80]
        else:
            grund = "yt-dlp-Fehler: " + (err or "")[:80]
    embed = oe == 200 and playable is not False and (age or 0) < 18 and verf
    if not grund:
        if oe == 404:
            grund = "oEmbed 404 (weg)"
        elif oe in (401, 403):
            grund = f"oEmbed {oe} (Einbetten verboten)"
        elif oe != 200:
            grund = f"oEmbed {oe}"
        elif playable is False:
            grund = "playable_in_embed=False"
    return {"oembed": oe, "embed_ok": bool(embed), "verfuegbar": bool(verf), "views": views, "age_limit": age,
            "grund": grund}


def run_checks(ids, links, workers, label="Prüfe"):
    t0, done = time.time(), 0
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(check, y): y for y in ids}
        for f in as_completed(futs):
            y = futs[f]
            done += 1
            try:
                r = f.result()
            except Exception as exc:
                r = None
                print(f"  FEHLER {y}: {exc}", flush=True)
            if r:
                links[y] = r
                if not r["embed_ok"]:
                    print(f"  [{done}/{len(ids)}] {y}: NICHT einbettbar – {r['grund']}", flush=True)
            if done % 20 == 0 or done == len(ids):
                save_json(LINKS_CACHE, links)
                el = time.time() - t0
                print(f"  {label}: {done}/{len(ids)}, {el:.0f}s, ~{el / done * (len(ids) - done):.0f}s Rest", flush=True)


def repair(song_ids, yt, links, workers):
    bad = [sid for sid in song_ids if yt[sid].get("youtube_id")
           and not links.get(yt[sid]["youtube_id"], {}).get("embed_ok", True)]
    print(f"Reparatur: {len(bad)} Beiträge mit nicht einbettbarem Video", flush=True)

    def fix(sid):
        e = yt[sid]
        tried = set(e.get("verworfen", [])) | {e["youtube_id"]}
        for c in e.get("kandidaten", []):
            if not c.get("ok") or c["id"] in tried:
                continue
            r = links.get(c["id"]) or check(c["id"])
            if r is None:
                continue
            links[c["id"]] = r
            tried.add(c["id"])
            if r["embed_ok"]:
                return sid, c
        return sid, None

    fixed = 0
    with ThreadPoolExecutor(workers) as ex:
        for f in as_completed([ex.submit(fix, s) for s in bad]):
            sid, c = f.result()
            e = yt[sid]
            if c:
                e.setdefault("verworfen", []).append(e["youtube_id"])
                e.update(youtube_id=c["id"], start_sek=find_mod.start_sek(c), video_typ=c["typ"], kanal=c["ch"],
                         video_titel=c["t"], dauer=c["d"], views=c["v"])
                fixed += 1
                print(f"  {sid}: ersetzt durch {c['id']} ({c['typ']}) {c['t'][:60]}", flush=True)
            else:
                print(f"  {sid}: kein einbettbarer Ersatz", flush=True)
    save_json(YT_CACHE, yt)
    save_json(LINKS_CACHE, links)
    print(f"Reparatur: {fixed}/{len(bad)} ersetzt", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input")
    ap.add_argument("--ids")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--repair", action="store_true")
    a = ap.parse_args()

    yt = load_json(YT_CACHE)
    links = load_json(LINKS_CACHE)
    if a.input or a.ids:
        song_ids = [r["id"] for r in filter_ids(load_input(a.input), a.ids) if r["id"] in yt]
    else:
        song_ids = list(yt)
    yids = sorted({yt[s]["youtube_id"] for s in song_ids if yt[s].get("youtube_id")})
    todo = [y for y in yids if a.force or y not in links]
    if a.limit:
        todo = todo[:a.limit]
    print(f"{len(song_ids)} Beiträge, {len(yids)} Videos, {len(todo)} zu prüfen", flush=True)
    t0 = time.time()
    if todo:
        run_checks(todo, links, a.workers)
    if a.repair:
        repair(song_ids, yt, links, a.workers)

    with_vid = [s for s in song_ids if yt[s].get("youtube_id")]
    ok = [s for s in with_vid if links.get(yt[s]["youtube_id"], {}).get("embed_ok")]
    print(f"Fertig in {time.time() - t0:.0f}s. Einbettbar: {len(ok)}/{len(with_vid)} Beiträge mit Video "
          f"({100 * len(ok) / max(1, len(with_vid)):.1f} %), bezogen auf alle {len(song_ids)}: "
          f"{100 * len(ok) / max(1, len(song_ids)):.1f} %")
    for s in with_vid:
        l = links.get(yt[s]["youtube_id"])
        if l and not l["embed_ok"]:
            print(f"  PROBLEM {s}: {yt[s]['youtube_id']} – {l['grund']}")


if __name__ == "__main__":
    sys.exit(main())
