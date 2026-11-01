"""02: Wikidata-Gegenprobe. Alle Beiträge (Lieder) mit P1344 -> ESC-Ausgabe (Q110288240),
Qualifier P1352 (Platz), P1351 (Punkte), P1268/P17/P4649 (Land). Ergebnis: raw/wikidata.json

Aufruf: python 02_fetch_wikidata.py [--force]
"""
import argparse
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RAW, USER_AGENT, iso_from_en, save_json  # noqa: E402

URL = "https://query.wikidata.org/sparql"

QUERY = """
SELECT ?s ?sLabel ?c ?cLabel ?rank ?pts ?ctyLabel ?cty2Label ?origLabel
       (GROUP_CONCAT(DISTINCT ?perfLabel; separator=" | ") AS ?perfs)
       (GROUP_CONCAT(DISTINCT ?typ; separator=" ") AS ?typen)
WHERE {
  ?c wdt:P31 wd:Q110288240 .
  ?s p:P1344 ?st . ?st ps:P1344 ?c .
  ?s wdt:P31 ?typ .
  FILTER(?typ NOT IN (wd:Q5, wd:Q215380, wd:Q9212979, wd:Q16523578, wd:Q2088357, wd:Q5741069, wd:Q35718073))
  ?s wdt:P175 ?perf .
  OPTIONAL { ?st pq:P1352 ?rank . }
  OPTIONAL { ?st pq:P1351 ?pts . }
  OPTIONAL { ?st pq:P1268 ?cty . }
  OPTIONAL { ?st pq:P17 ?cty2 . }
  OPTIONAL { ?s wdt:P495 ?orig . }
  OPTIONAL { ?perf rdfs:label ?perfLabel . FILTER(LANG(?perfLabel) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,de,fr". }
}
GROUP BY ?s ?sLabel ?c ?cLabel ?rank ?pts ?ctyLabel ?cty2Label ?origLabel
"""

# Länder-Teilnahmen ("Schweden beim ESC 1974"): Land + enthaltene Lieder (P527) + ggf. Platz
QUERY_NAT = """
SELECT ?n ?ctyLabel ?cLabel ?rank ?rank2 ?song WHERE {
  ?c wdt:P31 wd:Q110288240 .
  ?n wdt:P31 wd:Q35718073 ; wdt:P17 ?cty ; (wdt:P361|wdt:P1344) ?c .
  OPTIONAL { ?n p:P1344 ?st . ?st ps:P1344 ?c ; pq:P1352 ?rank . }
  OPTIONAL { ?n wdt:P1352 ?rank2 . }
  OPTIONAL { ?n wdt:P527 ?song . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""


def sparql(q):
    for attempt in range(4):
        try:
            r = requests.get(URL, params={"query": q, "format": "json"},
                             headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"},
                             timeout=300)
            r.raise_for_status()
            return [{k: x["value"] for k, x in b.items()} for b in r.json()["results"]["bindings"]]
        except Exception as e:  # noqa: BLE001
            print("Fehler:", e)
            time.sleep(10 * (attempt + 1))
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    out = RAW / "wikidata.json"
    if out.exists() and not a.force:
        print("wikidata.json vorhanden (--force zum Neuladen)")
        return
    nat = sparql(QUERY_NAT)
    song_land = {}
    nat_rows = []
    for v in nat:
        m = re.search(r"(\d{4})", v.get("cLabel", ""))
        if not m:
            continue
        iso = iso_from_en(v.get("ctyLabel", "")) or ""
        rk = v.get("rank") or v.get("rank2")
        song = v.get("song", "").rsplit("/", 1)[-1]
        if song:
            song_land[(song, int(m.group(1)))] = iso
        nat_rows.append({"jahr": int(m.group(1)), "iso": iso, "land_en": v.get("ctyLabel", ""),
                         "platz": int(float(rk)) if rk else None, "song_qid": song})
    time.sleep(2)
    res = sparql(QUERY)
    rows = []
    for v in res:
        m = re.search(r"(\d{4})", v.get("cLabel", ""))
        if not m:
            continue
        qid = v["s"].rsplit("/", 1)[-1]
        land = v.get("ctyLabel") or v.get("cty2Label") or ""
        iso, iso_src = iso_from_en(land), "qualifier"
        if not iso and song_land.get((qid, int(m.group(1)))):
            iso, iso_src = song_land[(qid, int(m.group(1)))], "nation"
        if not iso and iso_from_en(v.get("origLabel", "")):
            iso, iso_src = iso_from_en(v.get("origLabel", "")), "herkunft"
        if not iso:
            iso, iso_src = "", ""
        rows.append({
            "qid": qid, "titel": v.get("sLabel", ""), "jahr": int(m.group(1)),
            "contest": v.get("cLabel", ""), "land_en": land or v.get("origLabel", ""), "iso": iso, "iso_quelle": iso_src,
            "platz": int(float(v["rank"])) if v.get("rank") else None,
            "punkte": int(float(v["pts"])) if v.get("pts") else None,
            "interpret": v.get("perfs", ""), "typen": v.get("typen", ""),
        })
    save_json(out, {"abgerufen": time.strftime("%Y-%m-%dT%H:%M:%S"), "anzahl": len(rows), "rows": rows,
                    "nationen": nat_rows})
    print(f"wikidata: {len(rows)} Zeilen, mit ISO {sum(1 for x in rows if x['iso'])}, "
          f"mit Platz {sum(1 for x in rows if x['platz'])}")


if __name__ == "__main__":
    main()
