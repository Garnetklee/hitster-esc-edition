"""06 – Popularität: YouTube-Aufrufe (+ optional Last.fm-Hörer) -> pop_score und pop_rang.

Quellen
  yt_views        : Maximum aus (a) view_count des gewählten Videos (links_cache.json aus 05, sonst youtube_cache.json)
                    und (b) den Aufrufen aller glaubwürdigen Kandidaten aus 04 (ok=True: Interpret+Titel passen,
                    z. B. offizielles Musikvideo oder Künstlerkanal). So gehen Klassiker, deren ESC-Liveauftritt
                    wenig Aufrufe hat (ABBA „Waterloo“), nicht unter. Kein API-Key nötig.
  lastfm_listener : Last.fm track.getInfo (listeners) – NUR wenn esc/.env eine Zeile LASTFM_API_KEY=... enthält.
                    Ergebnisse werden in esc/data/raw/lastfm_cache.json gecacht.
Score
  je Kennzahl: log10(wert + 1), dann Min-Max-Normierung auf 0–1 über alle Beiträge mit Wert
  pop_score = Mittel der verfügbaren normierten Kennzahlen (4 Nachkommastellen)
  pop_rang  = 1 für den höchsten Score; nur Beiträge mit Score bekommen einen Rang
Ergebnis: esc/data/raw/popularity.json  {"<id>": {"yt_views", "lastfm_listener", "pop_score", "pop_rang"}}

Aufruf
  python 06_popularity.py [--input csv|json] [--ids ...] [--limit N] [--workers 8]
"""
import argparse
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from yt_common import ESC, LINKS_CACHE, POP_FILE, RAW, YT_CACHE, filter_ids, load_input, load_json, save_json

LASTFM_CACHE = RAW / "lastfm_cache.json"


def lastfm_key():
    env = ESC / ".env"
    if not env.exists():
        return None
    for line in env.read_text(encoding="utf-8-sig").splitlines():
        if line.strip().startswith("LASTFM_API_KEY"):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            return v or None
    return None


def lastfm_listeners(key, artist, track):
    q = urllib.parse.urlencode({"method": "track.getInfo", "api_key": key, "artist": artist, "track": track,
                                "autocorrect": 1, "format": "json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen("https://ws.audioscrobbler.com/2.0/?" + q, timeout=15) as r:
                d = json.loads(r.read().decode("utf-8"))
            if "track" in d:
                return int(d["track"].get("listeners") or 0)
            if d.get("error") in (6,):  # Track nicht gefunden
                return 0
            if d.get("error") == 29:  # Rate-Limit
                time.sleep(10 * (attempt + 1))
                continue
            return None
        except Exception:
            time.sleep(2 * (attempt + 1))
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input")
    ap.add_argument("--ids")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()

    yt = load_json(YT_CACHE)
    links = load_json(LINKS_CACHE)
    rows = filter_ids(load_input(a.input), a.ids)
    if a.limit:
        rows = rows[:a.limit]

    lfm = {}
    key = lastfm_key()
    if key:
        lcache = load_json(LASTFM_CACHE)
        todo = [r for r in rows if r["id"] not in lcache]
        print(f"Last.fm: {len(todo)} Abfragen", flush=True)
        done = 0
        with ThreadPoolExecutor(min(a.workers, 4)) as ex:
            futs = {ex.submit(lastfm_listeners, key, r["interpret"], r["titel"]): r for r in todo}
            for f in as_completed(futs):
                v = f.result()
                done += 1
                if v is not None:
                    lcache[futs[f]["id"]] = v
                if done % 20 == 0:
                    save_json(LASTFM_CACHE, lcache)
                    print(f"  Last.fm {done}/{len(todo)}", flush=True)
        save_json(LASTFM_CACHE, lcache)
        lfm = {k: v for k, v in lcache.items() if v}  # 0 = nicht gefunden -> kein Wert
    else:
        print("Last.fm: kein LASTFM_API_KEY in esc/.env – Spalte bleibt leer", flush=True)

    pop = load_json(POP_FILE)
    vals = {}
    for r in rows:
        e = yt.get(r["id"]) or {}
        yid = e.get("youtube_id")
        v = None
        if yid:
            v = (links.get(yid) or {}).get("views")
            if v is None:
                v = e.get("views")
        cand = [c.get("v") for c in e.get("kandidaten", []) if c.get("ok") and c.get("v")]
        if cand:
            v = max([v or 0] + cand)
        vals[r["id"]] = {"yt_views": v, "lastfm_listener": lfm.get(r["id"])}

    # Normierung über alle Einträge der Datei (bestehende + neue), damit Ränge konsistent bleiben
    for k, v in vals.items():
        pop[k] = {**pop.get(k, {}), **v}
    norm = {}
    for m in ("yt_views", "lastfm_listener"):
        logs = {k: math.log10(v[m] + 1) for k, v in pop.items() if v.get(m)}
        if not logs:
            continue
        lo, hi = min(logs.values()), max(logs.values())
        for k, l in logs.items():
            norm.setdefault(k, []).append((l - lo) / (hi - lo) if hi > lo else 1.0)
    for k, v in pop.items():
        v["pop_score"] = round(sum(norm[k]) / len(norm[k]), 4) if k in norm else None
        v["pop_rang"] = None
    ranked = sorted((k for k in pop if pop[k]["pop_score"] is not None), key=lambda k: -pop[k]["pop_score"])
    for i, k in enumerate(ranked, 1):
        pop[k]["pop_rang"] = i
    save_json(POP_FILE, pop)
    print(f"{len(ranked)}/{len(pop)} Beiträge mit Popularität. Top 10:")
    for k in ranked[:10]:
        print(f"  {pop[k]['pop_rang']:>4} {k} score={pop[k]['pop_score']} views={pop[k]['yt_views']}")


if __name__ == "__main__":
    sys.exit(main())
