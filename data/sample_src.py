"""Erzeugt data/sample.json (handverlesene Testbeiträge, Format wie esc_songs.json)."""
import json
from pathlib import Path

K = "id jahr austragungsort land land_iso interpret titel sprache runde_ende platz teilnehmer punkte platz_finale platz_hf hf_nr sieger sonderfall notiz".split()
R = [
    ("1956-CH", 1956, "Lugano", "Schweiz", "CH", "Lys Assia", "Refrain", "Französisch", "Finale", 1, 14, None, 1, None, None, True, "ohne_wertung_1956", "1956 nur Sieger bekannt"),
    ("1964-IT", 1964, "Kopenhagen", "Italien", "IT", "Gigliola Cinquetti", "Non ho l'età", "Italienisch", "Finale", 1, 16, 49, 1, None, None, True, "", ""),
    ("1969-GB", 1969, "Madrid", "Vereinigtes Königreich", "GB", "Lulu", "Boom Bang-a-Bang", "Englisch", "Finale", 1, 16, 18, 1, None, None, True, "geteilt_1969", ""),
    ("1969-FR", 1969, "Madrid", "Frankreich", "FR", "Frida Boccara", "Un jour, un enfant", "Französisch", "Finale", 1, 16, 18, 1, None, None, True, "geteilt_1969", ""),
    ("1974-SE", 1974, "Brighton", "Schweden", "SE", "ABBA", "Waterloo", "Englisch", "Finale", 1, 17, 24, 1, None, None, True, "", ""),
    ("1974-GB", 1974, "Brighton", "Vereinigtes Königreich", "GB", "Olivia Newton-John", "Long Live Love", "Englisch", "Finale", 4, 17, 14, 4, None, None, False, "", ""),
    ("1978-NO", 1978, "Paris", "Norwegen", "NO", "Jahn Teigen", "Mil etter mil", "Norwegisch", "Finale", 20, 20, 0, 20, None, None, False, "", "Nul points"),
    ("1982-DE", 1982, "Harrogate", "Deutschland", "DE", "Nicole", "Ein bißchen Frieden", "Deutsch", "Finale", 1, 18, 161, 1, None, None, True, "", ""),
    ("1988-CH", 1988, "Dublin", "Schweiz", "CH", "Céline Dion", "Ne partez pas sans moi", "Französisch", "Finale", 1, 21, 137, 1, None, None, True, "", ""),
    ("1990-IT", 1990, "Zagreb", "Italien", "IT", "Toto Cutugno", "Insieme: 1992", "Italienisch", "Finale", 1, 22, 149, 1, None, None, True, "", ""),
    ("1997-GB", 1997, "Dublin", "Vereinigtes Königreich", "GB", "Katrina and the Waves", "Love Shine a Light", "Englisch", "Finale", 1, 25, 227, 1, None, None, True, "", ""),
    ("2000-DK", 2000, "Stockholm", "Dänemark", "DK", "Olsen Brothers", "Fly on the Wings of Love", "Englisch", "Finale", 1, 24, 195, 1, None, None, True, "", ""),
    ("2003-GB", 2003, "Riga", "Vereinigtes Königreich", "GB", "Jemini", "Cry Baby", "Englisch", "Finale", 26, 26, 0, 26, None, None, False, "", "Nul points"),
    ("2006-FI", 2006, "Athen", "Finnland", "FI", "Lordi", "Hard Rock Hallelujah", "Englisch", "Finale", 1, 24, 292, 1, 1, 1, True, "", ""),
    ("2010-DE", 2010, "Oslo", "Deutschland", "DE", "Lena", "Satellite", "Englisch", "Finale", 1, 25, 246, 1, None, None, True, "", ""),
    ("2012-SE", 2012, "Baku", "Schweden", "SE", "Loreen", "Euphoria", "Englisch", "Finale", 1, 26, 372, 1, 1, 1, True, "", ""),
    ("2013-AT", 2013, "Malmö", "Österreich", "AT", "Natália Kelly", "Shine", "Englisch", "HF1", 14, 16, 27, None, 14, 1, False, "", "HF-Aus"),
    ("2014-AT", 2014, "Kopenhagen", "Österreich", "AT", "Conchita Wurst", "Rise Like a Phoenix", "Englisch", "Finale", 1, 26, 290, 1, 1, 2, True, "", ""),
    ("2015-DE", 2015, "Wien", "Deutschland", "DE", "Ann Sophie", "Black Smoke", "Englisch", "Finale", 27, 27, 0, 27, None, None, False, "", "Nul points"),
    ("2015-AT", 2015, "Wien", "Österreich", "AT", "The Makemakes", "I Am Yours", "Englisch", "Finale", 26, 27, 0, 26, None, None, False, "", "Nul points"),
    ("2018-CH", 2018, "Lissabon", "Schweiz", "CH", "ZiBBZ", "Stones", "Englisch", "HF1", 13, 19, 86, None, 13, 1, False, "", "HF-Aus"),
    ("2020-DE", 2020, "Rotterdam", "Deutschland", "DE", "Ben Dolic", "Violent Thing", "Englisch", "", None, None, None, None, None, None, False, "abgesagt_2020", "ESC 2020 abgesagt"),
    ("2021-IT", 2021, "Rotterdam", "Italien", "IT", "Måneskin", "Zitti e buoni", "Italienisch", "Finale", 1, 26, 524, 1, None, None, True, "", ""),
    ("2023-SE", 2023, "Liverpool", "Schweden", "SE", "Loreen", "Tattoo", "Englisch", "Finale", 1, 26, 583, 1, 1, 1, True, "", ""),
    ("2025-AT", 2025, "Basel", "Österreich", "AT", "JJ", "Wasted Love", "Englisch", "Finale", 1, 26, 436, 1, None, None, True, "", ""),
]
songs = []
for r in R:
    s = dict(zip(K, r))
    s.update(youtube_id="", start_sek=0, video_typ="", embed_ok=None, yt_views=None, lastfm_listener=None,
             spotify_pop=None, pop_score=None, pop_rang=None, quelle="M", status="ok")
    songs.append(s)
out = Path(__file__).with_name("sample.json")
out.write_text(json.dumps({"generiert": "2026-11-01T06:00:00", "anzahl": len(songs), "songs": songs},
                          ensure_ascii=False, indent=1), encoding="utf-8")
print(len(songs), "->", out)
