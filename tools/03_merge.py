"""03: Wikipedia (raw/parsed_<jahr>.json) + Wikidata (raw/wikidata.json) -> data/esc_songs.csv + data/merge_report.json

Bestehende youtube/popularitäts-Werte werden aus raw/*_cache.json übernommen (apply_caches) und – falls dort
nichts steht – aus einer bereits vorhandenen esc_songs.csv beibehalten.
Aufruf: python 03_merge.py
"""
import difflib
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (COLS, DATA, RAW, apply_caches, land_de, load_json, norm_text, read_csv,  # noqa: E402
                    save_json, sprache_de, write_csv)

YEARS = range(1956, 2027)
KEEP_COLS = ["youtube_id", "start_sek", "video_typ", "embed_ok", "yt_views", "lastfm_listener", "spotify_pop",
             "pop_score", "pop_rang"]
ROUND_ORDER = {"Finale": 0, "HF1": 1, "HF2": 2, "HF": 1, "Vorentscheid": 3, "": 9}


def sim(a, b):
    a, b = norm_text(a), norm_text(b)
    if not a or not b:
        return 0.0
    if a == b or a in b or b in a:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def idx(entries):
    d = {}
    for e in entries or []:
        d.setdefault(e["iso"], []).append(e)
    return d


def n_gewertet(entries):
    n = sum(1 for e in entries if e.get("platz") is not None)
    return n or len(entries)


def pick(lst, titel):
    """Aus mehreren Einträgen desselben Landes (1956) den zum Titel passenden wählen."""
    if not lst:
        return None
    if len(lst) == 1:
        return lst[0]
    return max(lst, key=lambda e: sim(e.get("titel", ""), titel))


def build_year(jahr, P, P93q, report):
    rows = []
    runden = P.get("runden", {})
    fin = runden.get("finale", [])
    hfs = {}
    if jahr >= 2008:
        hfs = {"HF1": runden.get("hf1", []), "HF2": runden.get("hf2", [])}
    elif jahr >= 2004:
        hfs = {"HF": runden.get("hf", []) or runden.get("hf1", [])}
    vor = []
    if jahr == 1996:
        vor = runden.get("vorrunde", [])
    if jahr == 1993 and P93q:
        r = P93q.get("runden", {})
        vor = r.get("vorrunde") or r.get("finale") or []
    fin_i = idx(fin)
    hf_i = {k: idx(v) for k, v in hfs.items()}
    vor_i = idx(vor)

    # Basisliste: Teilnehmertabelle(n); dann Länder aus den Runden ergänzen
    base = list(P.get("teilnehmer", []))
    if jahr == 1956:  # Siegertitel "Refrain" bekommt die Haupt-ID 1956-CH
        base.sort(key=lambda e: 0 if norm_text(e.get("titel", "")) == "refrain" else 1)
    teiln_n = len(base)
    seen = Counter(e["iso"] for e in base)
    for src in [fin] + list(hfs.values()) + [vor]:
        for e in src:
            if seen[e["iso"]] == 0:
                base.append(dict(e, _nur_runde=True))
                seen[e["iso"]] += 1
                report["luecken"].append(f"{jahr}-{e['iso']}: nur in Ergebnistabelle, nicht in Teilnehmertabelle")

    used = Counter()
    for e in base:
        iso = e["iso"]
        used[iso] += 1
        rid = f"{jahr}-{iso}" + (f"-{used[iso]}" if used[iso] > 1 else "")
        r = {c: "" for c in COLS}
        r.update(id=rid, jahr=jahr, austragungsort=P.get("ort", ""), land=land_de(iso), land_iso=iso,
                 interpret=e.get("interpret", ""), titel=e.get("titel", ""),
                 sprache=sprache_de(e.get("sprache_en", "")), sieger="nein", quelle="W", status="ok", start_sek=0)
        notes, sonder = [], []
        f = pick(fin_i.get(iso), r["titel"])
        if jahr == 1956:
            f = None  # keine Wertung bekannt
        h_key, h = None, None
        for k, d in hf_i.items():
            if iso in d:
                h_key, h = k, d[iso][0]
        v = vor_i.get(iso, [None])[0]
        if f is not None and f.get("platz") is None and jahr not in (1956, 2020):
            # im Finale ohne Platz (z. B. 2024 Niederlande): disqualifiziert -> letzte gewertete Runde zählt
            sonder.append("disqualifiziert")
            notes.append(f"im Finale disqualifiziert/ohne Wertung (Finaltabelle: {f.get('platz_roh') or '-'})")
            f = None
        if f is not None:
            r["runde_ende"] = "Finale"
            r["platz"] = f.get("platz") or ""
            r["teilnehmer"] = n_gewertet(fin)
            r["punkte"] = "" if f.get("punkte") is None else f["punkte"]
            r["platz_finale"] = r["platz"]
            if not r["titel"]:
                r["titel"] = f.get("titel", "")
            if not r["interpret"]:
                r["interpret"] = f.get("interpret", "")
            if f.get("titel") and r["titel"] and sim(f["titel"], r["titel"]) < 0.6:
                notes.append(f"Titel in Finaltabelle: {f['titel']}")
        if h is not None:
            nr = 2 if h_key == "HF2" else 1
            r["platz_hf"] = h.get("platz") or ""
            r["hf_nr"] = nr
            if f is None:
                r["runde_ende"] = h_key
                r["platz"] = h.get("platz") or ""
                r["teilnehmer"] = n_gewertet(hfs[h_key])
                r["punkte"] = "" if h.get("punkte") is None else h["punkte"]
        if v is not None:
            r["platz_hf"] = v.get("platz") or ""
            r["hf_nr"] = 1
            if f is None:
                r["runde_ende"] = "Vorentscheid"
                r["platz"] = v.get("platz") or ""
                r["teilnehmer"] = n_gewertet(vor)
                r["punkte"] = "" if v.get("punkte") is None else v["punkte"]
                notes.append("in der Vorrunde ausgeschieden" if jahr == 1996 else
                             "in Kvalifikacija za Millstreet ausgeschieden")
            else:
                notes.append("Vorrunde: Platz %s" % (v.get("platz") or "?"))
        # Sonderfälle
        if jahr == 1956:
            sonder.append("ohne_wertung_1956")
            r["runde_ende"] = "Finale"
            r["teilnehmer"] = len(P.get("teilnehmer", [])) or 14
            if norm_text(r["titel"]) == "refrain" and iso == "CH":
                r.update(platz=1, platz_finale=1, sieger="ja")
                notes.append("1956 nur Sieger bekannt")
        if jahr == 2020:
            sonder.append("abgesagt_2020")
            r.update(runde_ende="", platz="", teilnehmer="", punkte="", platz_finale="", platz_hf="", hf_nr="")
            notes.append("ESC 2020 abgesagt")
        if r.get("platz_finale") == 1:
            r["sieger"] = "ja"
        if jahr == 1969 and r.get("platz_finale") == 1:
            sonder.append("geteilt_1969")
        for src in (e, f, h, v):
            if src and src.get("hinweis") and src["hinweis"] not in sonder:
                sonder.append(src["hinweis"])
        if not r["runde_ende"] and jahr != 2020:
            r["status"] = "prüfen"
            notes.append("keine Platzierung gefunden")
            report["luecken"].append(f"{rid}: keine Platzierung")
        if r["runde_ende"] and r["platz"] == "" and jahr != 1956:
            r["status"] = "prüfen"
            notes.append("Platz fehlt")
            report["luecken"].append(f"{rid}: Platz fehlt in Runde {r['runde_ende']}")
        r["sonderfall"] = ",".join(sonder)
        r["notiz"] = "; ".join(notes)
        rows.append(r)
    return rows, teiln_n


def wd_check(rows, wd, report):
    by_year = defaultdict(list)
    for x in (wd or {}).get("rows", []):
        by_year[x["jahr"]].append(x)
    for r in rows:
        cands = by_year.get(r["jahr"], [])
        best, bs = None, 0.0
        for x in cands:
            s = sim(x["titel"], r["titel"])
            if s > bs:
                best, bs = x, s
        by_iso = [x for x in cands if x["iso"] == r["land_iso"] and x.get("iso_quelle") in ("qualifier", "nation")]
        if best is not None and bs >= 0.85:
            m = best
        elif len(by_iso) == 1:
            m = by_iso[0]
            if sim(m["titel"], r["titel"]) < 0.5 and r["jahr"] != 1956:
                # WD-Label ist evtl. "X in the Eurovision ..." o. ä. -> nur bei echtem Liedtitel melden
                if " in the eurovision" not in m["titel"].lower() and not m["titel"].startswith("Q"):
                    r["status"] = "prüfen"
                    note = f"Wikidata-Titel abweichend: {m['titel']}"
                    r["notiz"] = "; ".join(x for x in [r["notiz"], note] if x)
                    report["konflikte"].append({"id": r["id"], "art": "titel", "wikipedia": r["titel"],
                                                "wikidata": m["titel"], "qid": m["qid"]})
            continue
        else:
            continue
        p = m.get("platz")
        mine = {r.get("platz"), r.get("platz_finale"), r.get("platz_hf")} - {"", None}
        if p and mine and p not in mine and r["jahr"] not in (1956, 2020):
            r["status"] = "prüfen"
            note = f"Wikidata-Platz {p} (Wikipedia {r['platz']})"
            r["notiz"] = "; ".join(x for x in [r["notiz"], note] if x)
            report["konflikte"].append({"id": r["id"], "art": "platz", "wikipedia": r["platz"],
                                        "wikidata": p, "qid": m["qid"]})
        else:
            if r["quelle"] == "W":
                r["quelle"] = "W+WD"


def main():
    wd = load_json(RAW / "wikidata.json", {})
    old = {r["id"]: r for r in read_csv(DATA / "esc_songs.csv")}
    report = {"jahre": {}, "konflikte": [], "luecken": [], "zaehlabweichungen": []}
    allrows = []
    P93q = load_json(RAW / "parsed_1993q.json")
    for jahr in YEARS:
        P = load_json(RAW / f"parsed_{jahr}.json")
        if not P:
            report["luecken"].append(f"{jahr}: parsed_{jahr}.json fehlt")
            continue
        rows, teiln_n = build_year(jahr, P, P93q, report)
        rd = P.get("runden", {})
        info = {"beitraege": len(rows), "teilnehmer_tabelle": teiln_n, "ort": P.get("ort", ""),
                "runden": {k: len(v) for k, v in rd.items()}}
        if jahr == 1993 and P93q:
            info["runden"]["kvalifikacija"] = len((P93q.get("runden", {}).get("vorrunde")
                                                   or P93q.get("runden", {}).get("finale") or []))
        report["jahre"][jahr] = info
        if len(rows) != teiln_n:
            report["zaehlabweichungen"].append(f"{jahr}: {len(rows)} Beiträge vs. {teiln_n} in Teilnehmertabelle")
        # Plausibilität: Plätze je Runde
        for rn in ("Finale", "HF", "HF1", "HF2", "Vorentscheid"):
            ps = [r["platz"] for r in rows if r["runde_ende"] == rn and r["platz"] != ""]
            n = [r["teilnehmer"] for r in rows if r["runde_ende"] == rn]
            if ps and max(ps) > (n[0] if n else 0):
                report["zaehlabweichungen"].append(f"{jahr} {rn}: Platz {max(ps)} > Teilnehmer {n[0]}")
        allrows.extend(rows)
    wd_check(allrows, wd, report)
    # bestehende YouTube-/Popularitätswerte beibehalten
    for r in allrows:
        o = old.get(r["id"])
        if o:
            for c in KEEP_COLS:
                if o.get(c) not in (None, ""):
                    r[c] = o[c]
    apply_caches(allrows)
    allrows.sort(key=lambda r: (r["jahr"], ROUND_ORDER.get(r["runde_ende"], 9),
                                r["platz"] if r["platz"] != "" else 999, r["id"]))
    write_csv(DATA / "esc_songs.csv", allrows)
    report["gesamt"] = len(allrows)
    report["status_pruefen"] = sum(1 for r in allrows if r["status"] == "prüfen")
    report["quelle"] = dict(Counter(r["quelle"] for r in allrows))
    save_json(DATA / "merge_report.json", report)
    dek = Counter(f"{r['jahr'] // 10 * 10}er" for r in allrows)
    print(f"esc_songs.csv: {len(allrows)} Beiträge; prüfen={report['status_pruefen']}; quelle={report['quelle']}")
    print("je Jahrzehnt:", dict(sorted(dek.items())))
    for z in report["zaehlabweichungen"]:
        print("ZÄHLUNG:", z)
    for l in report["luecken"][:40]:
        print("LÜCKE:", l)
    print(f"Konflikte: {len(report['konflikte'])}")
    by_id = {r["id"]: r for r in allrows}
    print("Stichproben:")
    for sid in ("1974-SE", "2010-DE", "2015-DE", "2013-AT", "2018-CH", "2024-NL", "1956-CH", "1993-EE", "1996-DE"):
        r = by_id.get(sid)
        if r:
            print(f"  {sid}: {r['interpret']} – {r['titel']}: {r['runde_ende']} Platz {r['platz']} von "
                  f"{r['teilnehmer']}, {r['punkte']} Pkt, sieger={r['sieger']} {r['sonderfall']}")


if __name__ == "__main__":
    main()
