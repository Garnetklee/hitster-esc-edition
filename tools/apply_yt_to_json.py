"""Hilfsskript: YouTube-/Popularitäts-Caches in eine JSON-Datei im sample.json-Format übernehmen.

Setzt youtube_id, start_sek, video_typ, embed_ok, yt_views, lastfm_listener, pop_score, pop_rang.
(Für die Masterliste esc_songs.csv übernehmen das 03_merge.py / 07_export_json.py.)

Aufruf: python apply_yt_to_json.py esc/data/sample.json [weitere Ziel-Kopien ...]
"""
import json
import shutil
import sys
from pathlib import Path

from yt_common import LINKS_CACHE, POP_FILE, YT_CACHE, load_json, norm


def main():
    src = Path(sys.argv[1])
    yt, links, pop = load_json(YT_CACHE), load_json(LINKS_CACHE), load_json(POP_FILE)
    d = json.loads(src.read_text(encoding="utf-8-sig"))
    n = 0
    for s in d["songs"]:
        # Schlüssel kann zwischen sample.json und esc_songs.csv abweichen (z. B. 1956-CH vs. 1956-CH-2):
        # über Interpret+Titel absichern
        key = norm(f"{s['interpret']} {s['titel']}")
        sid = s["id"]
        if (yt.get(sid) or {}).get("schluessel") != key:
            sid = next((k for k, v in yt.items() if k[:4] == str(s["jahr"]) and v.get("schluessel") == key), None)
        e = yt.get(sid) if sid else None
        if e:
            s["youtube_id"] = e["youtube_id"]
            s["start_sek"] = e["start_sek"]
            s["video_typ"] = e["video_typ"]
            l = links.get(e["youtube_id"])
            s["embed_ok"] = l["embed_ok"] if (l and e["youtube_id"]) else None
            n += bool(e["youtube_id"])
        p = pop.get(sid) if sid else None
        if p:
            for k in ("yt_views", "lastfm_listener", "pop_score", "pop_rang"):
                s[k] = p.get(k)
    text = json.dumps(d, ensure_ascii=False, indent=1)
    src.write_text(text + "\n", encoding="utf-8")
    for t in sys.argv[2:]:
        Path(t).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, t)
    print(f"{n}/{len(d['songs'])} mit youtube_id -> {src}" + (f" (+ Kopie: {', '.join(sys.argv[2:])})" if sys.argv[2:] else ""))


if __name__ == "__main__":
    main()
