"""01: Wikipedia-Jahresartikel (en) holen (Cache raw/wiki_<jahr>.json) und parsen (raw/parsed_<jahr>.json).

Aufruf:
  python 01_fetch_wikipedia.py              # fehlende laden, alle parsen
  python 01_fetch_wikipedia.py --force      # alle neu laden
  python 01_fetch_wikipedia.py --parse-only # nur parsen
  python 01_fetch_wikipedia.py --years 1974 2015
"""
import argparse
import sys
import time

import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from common import RAW, USER_AGENT, load_json, save_json  # noqa: E402

API = "https://en.wikipedia.org/w/api.php"
YEARS = list(range(1956, 2027))
EXTRA = {"1993q": "Kvalifikacija za Millstreet"}


def page_for(key):
    if key in EXTRA:
        return EXTRA[key]
    return f"Eurovision Song Contest {key}"


def fetch(key, force=False, sess=None):
    out = RAW / f"wiki_{key}.json"
    if out.exists() and not force:
        return False
    params = {"action": "parse", "page": page_for(key), "prop": "text|wikitext|revid",
              "format": "json", "formatversion": "2", "redirects": "1"}
    for attempt in range(4):
        try:
            r = sess.get(API, params=params, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                print(f"  {key}: HTTP {r.status_code}; warte", flush=True)
                time.sleep(10 * (attempt + 1))
                continue
            r.raise_for_status()
            js = r.json()
            if "error" in js:
                print(f"  {key}: API-Fehler {js['error'].get('info')}")
                save_json(out, js)
                return True
            save_json(out, js)
            return True
        except Exception as e:  # noqa: BLE001
            print(f"  {key}: {e}; neuer Versuch")
            time.sleep(3 * (attempt + 1))
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--parse-only", action="store_true")
    ap.add_argument("--years", nargs="*")
    a = ap.parse_args()
    keys = [str(y) for y in YEARS] + list(EXTRA)
    if a.years:
        keys = [k for k in keys if k in a.years or k.rstrip("q") in a.years]
    if not a.parse_only:
        s = requests.Session()
        s.headers["User-Agent"] = USER_AGENT
        for k in keys:
            if fetch(k, a.force, s):
                print(f"geladen: {k}", flush=True)
                time.sleep(1.0)
    from wiki_parse import parse_year  # noqa: E402
    for k in keys:
        raw = load_json(RAW / f"wiki_{k}.json")
        if not raw or "parse" not in raw:
            print(f"fehlt: {k}")
            continue
        try:
            res = parse_year(k, raw["parse"])
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            print(f"Parserfehler {k}: {e}")
            continue
        save_json(RAW / f"parsed_{k}.json", res)
        print(f"{k}: ort={res.get('ort')} teiln={len(res.get('teilnehmer', []))} "
              + " ".join(f"{n}={len(v)}" for n, v in res.get("runden", {}).items()), flush=True)


if __name__ == "__main__":
    main()
