"""HTML-Parser für die Wikipedia-Jahresartikel (wird von 01_fetch_wikipedia.py benutzt)."""
import copy
import re

from bs4 import BeautifulSoup

from common import iso_from_en, stadt_de


def clean(el):
    """Text eines Elements ohne Fußnoten/Referenzen."""
    if el is None:
        return ""
    for s in el.find_all(["sup", "style"]):
        s.decompose()
    for s in el.find_all(class_=["reference", "noprint", "sortkey", "mw-ref"]):
        s.decompose()
    t = el.get_text(" ", strip=True)
    t = t.replace("\xa0", " ")
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\s+([,.;:!?)])", r"\1", t)
    t = re.sub(r"\(\s+", "(", t)
    return t.strip()


def strip_quotes(t):
    t = t.strip()
    t = re.sub(r'^"\s*', "", t)
    t = re.sub(r'\s*"', '"', t) if False else t
    # Titel steht als "Titel" ggf. mit Übersetzung ("Titel" (Übersetzung)) bzw. mehrere Zeilen
    m = re.match(r'^(.*?)"\s*(\(.*\))?\s*$', t)
    if m:
        t = m.group(1)
    t = t.strip().strip('"').strip()
    return t


def table_grid(table):
    """Expandiert rowspan/colspan. Liefert Liste von Zeilen: [(text, is_th, html_el)]."""
    grid = {}
    rows = []
    trs = table.find_all("tr")
    # nur direkte Zeilen dieser Tabelle (keine verschachtelten)
    trs = [tr for tr in trs if tr.find_parent("table") is table]
    for ri, tr in enumerate(trs):
        ci = 0
        cells = [c for c in tr.find_all(["td", "th"], recursive=False)]
        for c in cells:
            while (ri, ci) in grid:
                ci += 1
            try:
                rs = int(re.sub(r"\D", "", c.get("rowspan", "1")) or 1)
            except ValueError:
                rs = 1
            try:
                cs = int(re.sub(r"\D", "", c.get("colspan", "1")) or 1)
            except ValueError:
                cs = 1
            rs = min(rs, 60)
            cs = min(cs, 60)
            raw_text = c.get_text(" ", strip=True)
            txt = clean(copy.copy(c))
            info = (txt, c.name == "th", raw_text, c)
            for dr in range(rs):
                for dc in range(cs):
                    grid[(ri + dr, ci + dc)] = info
            ci += cs
        rows.append(ri)
    nrows = len(trs)
    out = []
    for ri in range(nrows):
        cols = sorted(c for (r, c) in grid if r == ri)
        out.append([grid[(ri, c)] for c in cols])
    return out, trs


def section_of(table):
    """Überschriften-Pfad (h2 > h3 > h4) vor der Tabelle."""
    path = []
    for lvl in ("h4", "h3", "h2"):
        h = table.find_previous(lvl)
        if h is not None:
            path.append((lvl, clean(BeautifulSoup(str(h), "lxml")), h))
    # nur Überschriften, die nach der übergeordneten kommen
    res = {}
    h2 = next((p for p in path if p[0] == "h2"), None)
    res["h2"] = h2[1] if h2 else ""
    h3 = next((p for p in path if p[0] == "h3"), None)
    if h3 and h2 and _after(h3[2], h2[2]):
        res["h3"] = h3[1]
    else:
        res["h3"] = ""
    h4 = next((p for p in path if p[0] == "h4"), None)
    if h4 and res["h3"] and _after(h4[2], h3[2]):
        res["h4"] = h4[1]
    else:
        res["h4"] = ""
    return res


def _after(a, b):
    """True, wenn Element a im Dokument nach b steht."""
    for el in b.find_all_next(a.name):
        if el is a:
            return True
    return False


def header_map(grid):
    """Bestimmt Kopfzeilen und Spaltenindex für Land/Interpret/Titel/Sprache/Punkte/Platz/R/O."""
    hdr_rows = 0
    for row in grid:
        if row and all(c[1] for c in row):
            hdr_rows += 1
        else:
            break
    if hdr_rows == 0:
        return None, 0
    names = []
    ncol = max(len(r) for r in grid[:hdr_rows])
    for ci in range(ncol):
        parts = []
        for r in grid[:hdr_rows]:
            if ci < len(r):
                t = r[ci][0].lower()
                if t not in parts:
                    parts.append(t)
        names.append(" ".join(parts))
    m = {}
    for ci, n in enumerate(names):
        def setk(k):
            if k not in m:
                m[k] = ci
        if re.search(r"\bcountry\b|\bnation\b", n):
            setk("land")
        elif re.search(r"artist|performer|singer", n):
            setk("interpret")
        elif re.search(r"\bsong\b|\btitle\b", n):
            setk("titel")
        elif re.search(r"language", n):
            setk("sprache")
        elif re.search(r"^r/o|running|^no\.?$|^draw|^order", n):
            setk("ro")
        elif re.search(r"^points|\bpoints$|^score|total|^votes", n) and "jury" not in n and "televote" not in n:
            setk("punkte")
        elif re.search(r"^place|^rank|^pos", n):
            setk("platz")
    return m, hdr_rows


def to_int(t):
    m = re.match(r"^\s*[=T]?\s*(\d+)", t or "")
    return int(m.group(1)) if m else None


def classify(sec, cap, m):
    """Einordnung einer Tabelle: teilnehmer | finale | hf | hf1 | hf2 | vorrunde | None."""
    h = " / ".join([sec.get("h2", ""), sec.get("h3", ""), sec.get("h4", ""), cap]).lower()
    if not m or "land" not in m:
        return None
    if re.search(r"award|ogae|barbara dex|marcel bezen|other awards|incidents|spokesperson|broadcast|international", h):
        return None
    if "sprache" in m and "interpret" in m and "titel" in m and "platz" not in m:
        if "participant" in h or "participating" in h or "entries" in h or "returning" in h or "participants" in cap.lower():
            return "teilnehmer"
        return "teilnehmer?"
    if "platz" not in m and "punkte" not in m:
        return None
    if "interpret" not in m and "titel" not in m:
        return None
    if re.search(r"semi-final 1|first semi", h):
        return "hf1"
    if re.search(r"semi-final 2|second semi", h):
        return "hf2"
    if re.search(r"semi-final|semi final", h):
        return "hf"
    if re.search(r"qualif|pre-qualif|preselection|pre-selection|audio", h):
        return "vorrunde"
    if re.search(r"final|results|contest overview|overview", h):
        return "finale"
    return "finale?"


def parse_infobox(soup):
    ib = soup.find("table", class_="infobox")
    ort = ""
    land_ort = ""
    if ib:
        for tr in ib.find_all("tr"):
            th = tr.find("th")
            td = tr.find("td")
            if th and td and th.get_text(strip=True).lower().startswith("venue"):
                for br in td.find_all("br"):
                    br.replace_with("|")
                for s_ in td.find_all(["sup", "style"]):
                    s_.decompose()
                lines = [l.strip() for l in td.get_text("").split("|") if l.strip()]
                last = lines[-1] if lines else ""
                parts = [p.strip() for p in last.split(",")]
                land_ort = parts[-1] if parts else ""
                ort = parts[-2] if len(parts) >= 2 else parts[0]
                break
    return stadt_de(ort), land_ort


def parse_year(key, parse):
    soup = BeautifulSoup(parse["text"], "lxml")
    ort, ort_land = parse_infobox(soup)
    res = {"key": key, "titel": parse.get("title"), "revid": parse.get("revid"), "ort": ort,
           "ort_land_en": ort_land, "teilnehmer": [], "runden": {}, "tabellen": [], "warnungen": []}
    for t in soup.find_all("table", class_="wikitable"):
        if t.find_parent("table") is not None:
            continue
        cap_el = t.find("caption")
        cap = clean(BeautifulSoup(str(cap_el), "lxml")) if cap_el else ""
        sec = section_of(t)
        grid, trs = table_grid(t)
        m, nh = header_map(grid)
        kind = classify(sec, cap, m)
        res["tabellen"].append({"sec": sec, "cap": cap, "kind": kind, "map": m, "rows": len(grid) - nh})
        if kind is None:
            continue
        entries = []
        for ri, row in enumerate(grid[nh:]):
            def g(k):
                ci = m.get(k)
                if ci is None or ci >= len(row):
                    return ""
                return row[ci][0]
            land_raw = g("land")
            iso = iso_from_en(land_raw)
            if not iso:
                # evtl. Fußzeile / Unterüberschrift
                if land_raw and len(row) > 2:
                    res["warnungen"].append(f"{kind}: unbekanntes Land '{land_raw}'")
                continue
            e = {"land_en": land_raw, "iso": iso, "interpret": g("interpret"),
                 "titel": strip_quotes(g("titel")), "titel_roh": g("titel")}
            if "sprache" in m:
                e["sprache_en"] = g("sprache")
            if "ro" in m:
                e["ro"] = to_int(g("ro"))
            if "punkte" in m:
                e["punkte"] = to_int(g("punkte"))
                e["punkte_roh"] = g("punkte")
            if "platz" in m:
                e["platz"] = to_int(g("platz"))
                e["platz_roh"] = g("platz")
            # Zeilenhinweise (z. B. disqualifiziert/zurückgezogen) aus dem Zeilentext
            rowtxt = " ".join(c[2] for c in row).lower()
            if "disqualif" in rowtxt:
                e["hinweis"] = "disqualifiziert"
            elif "withdr" in rowtxt:
                e["hinweis"] = "zurueckgezogen"
            entries.append(e)
        if not entries:
            continue
        base = kind.rstrip("?")
        if base == "teilnehmer":
            for e in entries:
                e["tab"] = cap
            if not res["teilnehmer"] or kind == "teilnehmer":
                if kind == "teilnehmer" and res["teilnehmer"] and res.get("_tk") == "teilnehmer":
                    res["teilnehmer"].extend(entries)
                else:
                    res["teilnehmer"] = entries
                    res["_tk"] = kind
            continue
        name = base
        if name in res["runden"]:
            # mehrere Tabellen gleicher Art: nur die erste mit Platzspalte zählt
            if kind.endswith("?"):
                continue
            if res.get("_rk", {}).get(name, "").endswith("?") is False and "platz" not in m:
                continue
            if "platz" in m and not any("platz" in x for x in res["runden"][name]):
                res["runden"][name] = entries
                res.setdefault("_rk", {})[name] = kind
            continue
        res["runden"][name] = entries
        res.setdefault("_rk", {})[name] = kind
    res.pop("_tk", None)
    res.pop("_rk", None)
    return res
