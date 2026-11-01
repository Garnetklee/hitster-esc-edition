"""Gemeinsame Hilfsfunktionen für die ESC-Datenpipeline (Schema siehe data/SCHEMA.md)."""
import csv
import json
import re
import unicodedata
from pathlib import Path

ESC = Path(__file__).resolve().parent.parent
DATA = ESC / "data"
RAW = DATA / "raw"
RAW.mkdir(parents=True, exist_ok=True)

USER_AGENT = "HitsterESC/1.0 (private project; https://github.com/Garnetklee/hitster-esc)"

COLS = ("id;jahr;austragungsort;land;land_iso;interpret;titel;sprache;runde_ende;platz;teilnehmer;punkte;"
        "platz_finale;platz_hf;hf_nr;sieger;sonderfall;youtube_id;start_sek;video_typ;embed_ok;yt_views;"
        "lastfm_listener;spotify_pop;pop_score;pop_rang;quelle;status;notiz").split(";")


def read_csv(path):
    path = Path(path)
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


def write_csv(path, rows, cols=COLS):
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, delimiter=";", extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: ("" if r.get(c) is None else r.get(c)) for c in cols})
    tmp.replace(path)


def load_json(path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path, obj):
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


# ---------------------------------------------------------------- Länder
# ISO2 -> deutscher Name
ISO_DE = {
    "AD": "Andorra", "AL": "Albanien", "AM": "Armenien", "AT": "Österreich", "AU": "Australien",
    "AZ": "Aserbaidschan", "BA": "Bosnien und Herzegowina", "BE": "Belgien", "BG": "Bulgarien",
    "BY": "Belarus", "CH": "Schweiz", "CY": "Zypern", "CZ": "Tschechien", "DE": "Deutschland",
    "DK": "Dänemark", "EE": "Estland", "ES": "Spanien", "FI": "Finnland", "FR": "Frankreich",
    "GB": "Vereinigtes Königreich", "GE": "Georgien", "GR": "Griechenland", "HR": "Kroatien",
    "HU": "Ungarn", "IE": "Irland", "IL": "Israel", "IS": "Island", "IT": "Italien", "LT": "Litauen",
    "LU": "Luxemburg", "LV": "Lettland", "MA": "Marokko", "MC": "Monaco", "MD": "Moldau",
    "ME": "Montenegro", "MK": "Nordmazedonien", "MT": "Malta", "NL": "Niederlande", "NO": "Norwegen",
    "PL": "Polen", "PT": "Portugal", "RO": "Rumänien", "RS": "Serbien", "RU": "Russland",
    "SE": "Schweden", "SI": "Slowenien", "SK": "Slowakei", "SM": "San Marino", "TR": "Türkei",
    "UA": "Ukraine", "YU": "Jugoslawien", "CS": "Serbien und Montenegro", "LB": "Libanon",
    "TN": "Tunesien",
}

# englischer Name (wie in Wikipedia-Tabellen) -> ISO2
EN_ISO = {
    "andorra": "AD", "albania": "AL", "armenia": "AM", "austria": "AT", "australia": "AU",
    "azerbaijan": "AZ", "bosnia and herzegovina": "BA", "bosnia & herzegovina": "BA", "belgium": "BE",
    "bulgaria": "BG", "belarus": "BY", "switzerland": "CH", "cyprus": "CY", "czech republic": "CZ",
    "czechia": "CZ", "germany": "DE", "west germany": "DE", "denmark": "DK", "estonia": "EE",
    "spain": "ES", "finland": "FI", "france": "FR", "united kingdom": "GB", "georgia": "GE",
    "greece": "GR", "croatia": "HR", "hungary": "HU", "ireland": "IE", "israel": "IL", "iceland": "IS",
    "italy": "IT", "lithuania": "LT", "luxembourg": "LU", "latvia": "LV", "morocco": "MA",
    "monaco": "MC", "moldova": "MD", "montenegro": "ME", "north macedonia": "MK", "macedonia": "MK",
    "fyr macedonia": "MK", "f.y.r. macedonia": "MK", "former yugoslav republic of macedonia": "MK",
    "malta": "MT", "netherlands": "NL", "the netherlands": "NL", "norway": "NO", "poland": "PL",
    "portugal": "PT", "romania": "RO", "serbia": "RS", "russia": "RU", "sweden": "SE",
    "slovenia": "SI", "slovakia": "SK", "san marino": "SM", "turkey": "TR", "türkiye": "TR",
    "turkiye": "TR", "ukraine": "UA", "yugoslavia": "YU", "serbia and montenegro": "CS",
    "lebanon": "LB", "tunisia": "TN",
}


def iso_from_en(name):
    n = norm_country(name)
    return EN_ISO.get(n)


def norm_country(name):
    n = (name or "").strip().lower()
    n = re.sub(r"\[.*?\]", "", n)
    n = n.replace("\xa0", " ").strip(" *†‡§#")
    n = re.sub(r"\s+", " ", n)
    return n


def land_de(iso):
    return ISO_DE.get(iso, iso)


# ---------------------------------------------------------------- Sprachen
LANG_DE = {
    "english": "Englisch", "french": "Französisch", "german": "Deutsch", "italian": "Italienisch",
    "spanish": "Spanisch", "portuguese": "Portugiesisch", "dutch": "Niederländisch", "swedish": "Schwedisch",
    "norwegian": "Norwegisch", "danish": "Dänisch", "finnish": "Finnisch", "icelandic": "Isländisch",
    "greek": "Griechisch", "turkish": "Türkisch", "hebrew": "Hebräisch", "serbo-croatian": "Serbokroatisch",
    "serbian": "Serbisch", "croatian": "Kroatisch", "bosnian": "Bosnisch", "slovene": "Slowenisch",
    "slovenian": "Slowenisch", "macedonian": "Mazedonisch", "montenegrin": "Montenegrinisch",
    "albanian": "Albanisch", "polish": "Polnisch", "czech": "Tschechisch", "slovak": "Slowakisch",
    "hungarian": "Ungarisch", "romanian": "Rumänisch", "bulgarian": "Bulgarisch", "russian": "Russisch",
    "ukrainian": "Ukrainisch", "belarusian": "Belarussisch", "estonian": "Estnisch", "latvian": "Lettisch",
    "lithuanian": "Litauisch", "armenian": "Armenisch", "georgian": "Georgisch", "azerbaijani": "Aserbaidschanisch",
    "maltese": "Maltesisch", "luxembourgish": "Luxemburgisch", "irish": "Irisch", "breton": "Bretonisch",
    "corsican": "Korsisch", "catalan": "Katalanisch", "arabic": "Arabisch", "latin": "Latein",
    "sanskrit": "Sanskrit", "swiss german": "Schweizerdeutsch", "romansh": "Rätoromanisch",
    "neapolitan": "Neapolitanisch", "basque": "Baskisch", "galician": "Galicisch", "asturian": "Asturisch",
    "sardinian": "Sardisch", "friulian": "Friaulisch", "occitan": "Okzitanisch", "venetian": "Venezianisch",
    "sami": "Samisch", "northern sami": "Nordsamisch", "võro": "Võro", "voro": "Võro", "udmurt": "Udmurtisch",
    "crimean tatar": "Krimtatarisch", "tatar": "Tatarisch", "romani": "Romani", "japanese": "Japanisch",
    "korean": "Koreanisch", "imaginary": "Fantasiesprache", "constructed": "Fantasiesprache",
    "hawaiian": "Hawaiisch", "swahili": "Swahili", "yiddish": "Jiddisch", "aramaic": "Aramäisch",
    "faroese": "Färöisch", "greenlandic": "Grönländisch", "ladino": "Ladino", "lingala": "Lingala",
    "zulu": "Zulu", "piedmontese": "Piemontesisch", "abkhaz": "Abchasisch", "ossetian": "Ossetisch",
    "mingrelian": "Mingrelisch", "svan": "Swanisch", "chechen": "Tschetschenisch", "hindi": "Hindi",
    "persian": "Persisch", "kurdish": "Kurdisch", "lezgian": "Lesgisch", "cypriot greek": "Zyprisch-Griechisch",
    "west frisian": "Westfriesisch", "frisian": "Friesisch", "low german": "Niederdeutsch",
    "austrian german": "Deutsch", "bavarian": "Bairisch", "viennese": "Wienerisch", "scots": "Scots",
    "scottish gaelic": "Schottisch-Gälisch", "welsh": "Walisisch", "manx": "Manx", "cornish": "Kornisch",
    "latgalian": "Lettgallisch", "livonian": "Livisch", "setu": "Setu", "karelian": "Karelisch",
    "ingrian": "Ischorisch", "rusyn": "Russinisch", "kashubian": "Kaschubisch", "silesian": "Schlesisch",
    "spanish (flamenco)": "Spanisch", "french creole": "Französisch-Kreolisch", "antillean creole": "Antillen-Kreolisch",
    "haitian creole": "Haitianisch", "tahitian": "Tahitianisch", "italian (neapolitan)": "Neapolitanisch",
    "monegasque": "Monegassisch", "sranan tongo": "Sranantongo", "papiamento": "Papiamentu",
    "yoruba": "Yoruba", "wolof": "Wolof", "malagasy": "Madagassisch", "dagestani": "Dagestanisch",
    "hutsul": "Huzulisch", "mixed": "Gemischt", "samogitian": "Schemaitisch", "surzhyk": "Surschyk",
    "lithuanian sign language": "Litauische Gebärdensprache", "northern sámi": "Nordsamisch", "sámi": "Samisch",
    "amharic": "Amharisch", "yankunytjatjara": "Yankunytjatjara", "slovene and english": "Slowenisch, Englisch",
}


def sprache_de(text):
    """Übersetzt eine englische Sprachangabe (auch 'English, French' / 'English and French')."""
    if not text:
        return ""
    t = re.sub(r"\[.*?\]", "", text)
    t = t.replace("\xa0", " ")
    parts = re.split(r"\s*(?:,|/|;|\band\b|&|\+)\s*", t)
    out = []
    for p in parts:
        p0 = p.strip().strip(".").strip()
        if not p0:
            continue
        k = p0.lower()
        k = re.sub(r"^(partially|partly|mostly|some)\s+", "", k)
        k = re.sub(r"\s*\(.*?\)\s*", "", k).strip()
        k = re.sub(r"\s+language$", "", k)
        de = LANG_DE.get(k)
        if de is None:
            de = p0  # unbekannt: Original behalten
        if de not in out:
            out.append(de)
    return ", ".join(out)


# ---------------------------------------------------------------- Städte
STADT_DE = {
    "Vienna": "Wien", "Copenhagen": "Kopenhagen", "Athens": "Athen", "Lisbon": "Lissabon",
    "The Hague": "Den Haag", "Brussels": "Brüssel", "Rome": "Rom", "Naples": "Neapel",
    "Luxembourg": "Luxemburg", "Luxembourg City": "Luxemburg", "Moscow": "Moskau", "Kyiv": "Kiew",
    "Kiev": "Kiew", "Belgrade": "Belgrad", "Turin": "Turin", "Munich": "München",
    "Frankfurt": "Frankfurt", "Frankfurt am Main": "Frankfurt", "Düsseldorf": "Düsseldorf",
    "Zagreb": "Zagreb", "Jerusalem": "Jerusalem", "Gothenburg": "Göteborg", "Malmö": "Malmö",
    "Lugano": "Lugano", "Cannes": "Cannes", "Hilversum": "Hilversum", "London": "London",
    "Amsterdam": "Amsterdam", "Madrid": "Madrid", "Dublin": "Dublin", "Edinburgh": "Edinburgh",
    "Brighton": "Brighton", "Stockholm": "Stockholm", "Paris": "Paris", "Harrogate": "Harrogate",
    "Bergen": "Bergen", "Lausanne": "Lausanne", "Millstreet": "Millstreet", "Oslo": "Oslo",
    "Birmingham": "Birmingham", "Tallinn": "Tallinn", "Riga": "Riga", "Istanbul": "Istanbul",
    "Helsinki": "Helsinki", "Baku": "Baku", "Liverpool": "Liverpool", "Basel": "Basel",
    "Rotterdam": "Rotterdam", "Bærum": "Oslo", "Fornebu": "Oslo", "Tel Aviv": "Tel Aviv", "Lisboa": "Lissabon",
}


def stadt_de(name):
    name = (name or "").strip()
    return STADT_DE.get(name, name)


# ---------------------------------------------------------------- Text
def norm_text(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


# ---------------------------------------------------------------- Caches
def _int(v):
    try:
        if v is None or v == "":
            return ""
        return int(float(v))
    except Exception:
        return ""


def apply_caches(rows):
    """Übernimmt YouTube-/Link-/Popularitätswerte aus raw/*_cache.json (vom YouTube-Agenten)."""
    yt = load_json(RAW / "youtube_cache.json", {}) or {}
    links = load_json(RAW / "links_cache.json", {}) or {}
    pop = load_json(RAW / "popularity.json", {}) or {}
    for r in rows:
        y = yt.get(r["id"])
        if isinstance(y, dict) and y.get("youtube_id"):
            r["youtube_id"] = y.get("youtube_id", "")
            st = _int(y.get("start_sek"))
            r["start_sek"] = st if st != "" else (r.get("start_sek") or 0)
            if y.get("video_typ"):
                r["video_typ"] = y["video_typ"]
            if y.get("views") not in (None, "") and not r.get("yt_views"):
                r["yt_views"] = _int(y.get("views"))
        yid = r.get("youtube_id")
        if yid and isinstance(links.get(yid), dict):
            l = links[yid]
            e, v = l.get("embed_ok"), l.get("verfuegbar")
            if e is True and v is True:
                r["embed_ok"] = "ja"
            elif e is False or v is False:
                r["embed_ok"] = "nein"
            else:
                r["embed_ok"] = ""
            if l.get("views") not in (None, ""):
                r["yt_views"] = _int(l.get("views"))
        p = pop.get(r["id"])
        if isinstance(p, dict):
            for k in ("yt_views", "lastfm_listener", "pop_rang"):
                if p.get(k) not in (None, ""):
                    r[k] = _int(p[k])
            if p.get("pop_score") not in (None, ""):
                try:
                    r["pop_score"] = round(float(p["pop_score"]), 4)
                except Exception:
                    pass
            if p.get("spotify_pop") not in (None, ""):
                r["spotify_pop"] = _int(p["spotify_pop"])
    return rows
