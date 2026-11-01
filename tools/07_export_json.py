"""esc_songs.csv + Caches + overrides.csv -> esc_songs.json (für die App).

Reihenfolge: CSV lesen -> YouTube-/Link-/Popularitäts-Caches anwenden (common.apply_caches)
-> overrides.csv (id;feld;wert;grund) zuletzt anwenden -> Typen umwandeln -> JSON.
Schreibt esc/data/esc_songs.json und eine Kopie nach esc/app/data/esc_songs.json.

    py tools/07_export_json.py
"""
import csv, json, shutil, sys
from datetime import datetime
from pathlib import Path

ESC = Path(__file__).resolve().parent.parent
DATA = ESC / "data"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import COLS, read_csv, apply_caches  # noqa: E402

INT = {"jahr", "platz", "teilnehmer", "punkte", "platz_finale", "platz_hf", "hf_nr", "start_sek",
       "yt_views", "lastfm_listener", "spotify_pop", "pop_rang"}
FLOAT = {"pop_score"}
BOOL = {"sieger", "embed_ok"}


def conv(k, v):
    v = (v or "").strip() if isinstance(v, str) else v
    if k in INT:
        if v in ("", None):
            return None
        try:
            return int(float(v))
        except ValueError:
            return None
    if k in FLOAT:
        try:
            return round(float(v), 4) if v not in ("", None) else None
        except ValueError:
            return None
    if k in BOOL:
        return {"ja": True, "nein": False}.get(str(v).lower()) if v not in ("", None) else None
    return "" if v is None else str(v)


def main():
    rows = read_csv(DATA / "esc_songs.csv")
    apply_caches(rows)
    by_id = {r["id"]: r for r in rows}
    ov = DATA / "overrides.csv"
    n_ov = 0
    if ov.exists():
        for o in csv.DictReader(ov.open(encoding="utf-8-sig"), delimiter=";"):
            r = by_id.get((o.get("id") or "").strip())
            f = (o.get("feld") or "").strip()
            if r is None or f not in COLS:
                print("Override ignoriert:", o)
                continue
            r[f] = o.get("wert") or ""
            n_ov += 1
    songs = [{k: conv(k, r.get(k, "")) for k in COLS} for r in rows]
    out = {"generiert": datetime.now().isoformat(timespec="seconds"), "anzahl": len(songs), "songs": songs}
    txt = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    (DATA / "esc_songs.json").write_text(txt, encoding="utf-8")
    (ESC / "app" / "data").mkdir(parents=True, exist_ok=True)
    shutil.copy(DATA / "esc_songs.json", ESC / "app" / "data" / "esc_songs.json")
    spielbar = sum(1 for s in songs if s["youtube_id"] and s["embed_ok"] is not False)
    print(f"{len(songs)} Beiträge, {n_ov} Overrides, {spielbar} spielbar (youtube_id, nicht als nicht einbettbar markiert)")


if __name__ == "__main__":
    main()
