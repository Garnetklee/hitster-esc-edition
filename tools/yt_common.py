"""Gemeinsame Hilfsfunktionen für 04_find_youtube.py, 05_check_links.py, 06_popularity.py.

- Eingabe laden (esc_songs.csv mit Semikolon/utf-8-sig oder JSON im sample.json-Format)
- Caches atomar speichern (tmp-Datei + os.replace)
- Text-Normalisierung (Akzente, Sonderzeichen) für den Fuzzy-Abgleich
"""
import csv
import json
import os
import re
import sys
import threading
import unicodedata
from pathlib import Path

ESC = Path(__file__).resolve().parent.parent
DATA = ESC / "data"
RAW = DATA / "raw"
DEFAULT_INPUT = DATA / "esc_songs.csv"
YT_CACHE = RAW / "youtube_cache.json"
LINKS_CACHE = RAW / "links_cache.json"
POP_FILE = RAW / "popularity.json"

OFFICIAL_CHANNEL_IDS = {"UCRpjHHu8ivVWs73uxHlWwFA"}  # "Eurovision Song Contest"
OFFICIAL_CHANNEL_NAMES = {"eurovision song contest"}

try:  # Windows-Konsole: Umlaute/Emojis in Videotiteln nicht abstürzen lassen
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_save_lock = threading.Lock()


def load_input(path=None):
    """Liste von Dicts (mind. id, jahr, land, interpret, titel, runde_ende)."""
    p = Path(path) if path else DEFAULT_INPUT
    if p.suffix.lower() == ".json":
        d = json.loads(p.read_text(encoding="utf-8-sig"))
        rows = d["songs"] if isinstance(d, dict) else d
    else:
        with p.open(encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f, delimiter=";"))
    out = []
    for r in rows:
        if not r.get("id"):
            continue
        r = dict(r)
        try:
            r["jahr"] = int(r.get("jahr") or str(r["id"])[:4])
        except ValueError:
            r["jahr"] = int(str(r["id"])[:4])
        out.append(r)
    return out


def load_json(path, default=None):
    p = Path(path)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"WARNUNG: {p} defekt, starte leer", file=sys.stderr)
    return {} if default is None else default


def save_json(path, data):
    """Atomar speichern: erst tmp-Datei, dann os.replace."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with _save_lock:
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
        os.replace(tmp, p)


_SPECIAL = str.maketrans({"ß": "ss", "ø": "o", "Ø": "o", "æ": "ae", "Æ": "ae", "œ": "oe", "Œ": "oe",
                          "đ": "d", "Đ": "d", "ł": "l", "Ł": "l", "ı": "i", "þ": "th", "ð": "d",
                          "’": "'", "‘": "'", "&": " and "})


def norm(s):
    s = (s or "").translate(_SPECIAL)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("'", "")
    s = re.sub(r"[^a-z0-9а-яёα-ω]+", " ", s)  # kyrillisch/griechisch bleibt erhalten
    return " ".join(s.split())


def filter_ids(rows, ids_arg):
    if not ids_arg:
        return rows
    want = {i.strip() for i in ids_arg.split(",") if i.strip()}
    return [r for r in rows if r["id"] in want]
