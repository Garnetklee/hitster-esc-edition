"""esc_songs.csv + Caches + intro_whisper.csv + overrides.csv -> esc_songs.json (für die App).

Dazu kommt refrain_sek aus drei Dateien, spätere überschreiben frühere: data/refrain.csv (Whisper, 12_find_refrain.py),
data/refrain_songformer.csv (SongFormer und Online-Recherche, 13_songformer_refrain.py) und data/refrain_manuell.csv
(von Hand gehört). Jeweils nur, wenn das Video noch dasselbe ist und der Wert hinter dem Spielstart liegt.
refrain_schaetz_sek aus data/refrain_schaetzung.csv gibt es nur für Lieder ohne refrain_sek (unsichere Schätzung).

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
    # Startpunkte aus 11_whisper_starts.py, von Hand gesetzte Overrides gehen danach vor
    whisper = DATA / "intro_whisper.csv"
    n_wh = 0
    if whisper.exists():
        for o in csv.DictReader(whisper.open(encoding="utf-8-sig"), delimiter=";"):
            r = by_id.get((o.get("id") or "").strip())
            if r is not None:
                r["start_sek"] = o.get("start_sek") or ""
                n_wh += 1
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
    # Refrain-Start nur, wenn er zum aktuellen Video gehört und hinter dem Spielstart liegt
    def lese(name):
        p = DATA / name
        return {o["id"]: o for o in csv.DictReader(p.open(encoding="utf-8-sig"), delimiter=";")} if p.exists() else {}

    def treffer(quelle, s, feld):
        o = quelle.get(s["id"])
        sek = conv("start_sek", o[feld]) if o and o["youtube_id"] == s["youtube_id"] else None
        return sek if sek and sek > (s["start_sek"] or 0) else None

    quellen = [lese("refrain.csv"), lese("refrain_songformer.csv"), lese("refrain_manuell.csv")]
    schaetzung = lese("refrain_schaetzung.csv")
    je_quelle, n_sch = [0, 0, 0], 0
    for s in songs:
        s["refrain_sek"], herkunft = None, None
        for k, q in enumerate(quellen):
            sek = treffer(q, s, "refrain_sek")
            if sek:
                s["refrain_sek"], herkunft = sek, k
        if herkunft is not None:
            je_quelle[herkunft] += 1
        s["refrain_schaetz_sek"] = None if s["refrain_sek"] else treffer(schaetzung, s, "refrain_schaetz_sek")
        n_sch += s["refrain_schaetz_sek"] is not None
    n_rf = sum(je_quelle)
    out = {"generiert": datetime.now().isoformat(timespec="seconds"), "anzahl": len(songs), "songs": songs}
    txt = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    (DATA / "esc_songs.json").write_text(txt, encoding="utf-8")
    (ESC / "app" / "data").mkdir(parents=True, exist_ok=True)
    shutil.copy(DATA / "esc_songs.json", ESC / "app" / "data" / "esc_songs.json")
    spielbar = sum(1 for s in songs if s["youtube_id"] and s["embed_ok"] is not False)
    print(f"{len(songs)} Beiträge, {n_wh} Whisper-Starts, {n_rf} Refrains (Whisper {je_quelle[0]}, SongFormer/online {je_quelle[1]}, manuell {je_quelle[2]}), {n_sch} Schätzungen, {n_ov} Overrides, {spielbar} spielbar (youtube_id, nicht als nicht einbettbar markiert)")


if __name__ == "__main__":
    main()
