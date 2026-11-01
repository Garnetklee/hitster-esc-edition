// Datenladen, Pool-Filter und reine Spiellogik (ohne DOM)

export const QUICK_COUNTRIES = {
  dach: ['DE', 'AT', 'CH'],
  skandinavien: ['SE', 'NO', 'DK', 'FI', 'IS'],
  big5: ['DE', 'FR', 'GB', 'IT', 'ES'],
};

const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const bool = (v) => (v === true || v === 'ja' || v === 'true' ? true : v === false || v === 'nein' || v === 'false' ? false : null);

function normalize(s) {
  return {
    ...s,
    id: String(s.id),
    jahr: num(s.jahr),
    land: s.land || '',
    land_iso: (s.land_iso || '').toUpperCase(),
    interpret: s.interpret || '',
    titel: s.titel || '',
    runde_ende: s.runde_ende || '',
    platz: num(s.platz),
    teilnehmer: num(s.teilnehmer),
    punkte: num(s.punkte),
    platz_finale: num(s.platz_finale),
    platz_hf: num(s.platz_hf),
    hf_nr: num(s.hf_nr),
    sieger: bool(s.sieger) === true,
    sonderfall: s.sonderfall || '',
    youtube_id: (s.youtube_id || '').trim(),
    start_sek: num(s.start_sek) || 0,
    embed_ok: bool(s.embed_ok),
    pop_rang: num(s.pop_rang),
  };
}

/** Lädt zuerst data/esc_songs.json, sonst data/sample.json. */
export async function loadSongs() {
  for (const file of ['data/esc_songs.json', 'data/sample.json']) {
    try {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) continue;
      const json = await res.json();
      const list = Array.isArray(json) ? json : json.songs;
      if (!Array.isArray(list) || !list.length) continue;
      const songs = list.map(normalize).filter((s) => s.id && s.jahr);
      return { file, generiert: json.generiert || '', songs };
    } catch (e) {
      console.warn('Konnte', file, 'nicht laden:', e);
    }
  }
  throw new Error('Keine Lieder-Datei gefunden (data/esc_songs.json oder data/sample.json).');
}

export const isCancelled = (s) => s.sonderfall.includes('abgesagt') || s.jahr === 2020;
export const hasVideo = (s) => !!s.youtube_id && s.embed_ok !== false;

/** Filtert die Lieder nach den Setup-Einstellungen. dev=true ignoriert die YouTube-Pflicht. */
export function filterPool(songs, f, dev = false) {
  const countries = f.countries && f.countries.length ? new Set(f.countries) : null;
  return songs.filter((s) => {
    if (!dev && !hasVideo(s)) return false;
    if (!f.incl2020 && isCancelled(s)) return false;
    if (f.from && s.jahr < f.from) return false;
    if (f.to && s.jahr > f.to) return false;
    if (countries && !countries.has(s.land_iso)) return false;
    switch (f.mode) {
      case 'finale': return s.runde_ende === 'Finale';
      case 'top10': return s.platz_finale !== null && s.platz_finale <= 10;
      case 'top3': return s.platz_finale !== null && s.platz_finale <= 3;
      case 'sieger': return s.sieger;
      case 'nul': return s.punkte === 0;
      case 'topn': return s.pop_rang !== null && s.pop_rang <= (f.topN || 100);
      default: return true;
    }
  });
}

/** Passt das Jahr in die Lücke `gap` (0..n) der nach Jahr sortierten Zeitleiste? Gleiche Jahre zählen als richtig. */
export function fitsGap(timeline, gap, year) {
  const left = gap > 0 ? timeline[gap - 1] : null;
  const right = gap < timeline.length ? timeline[gap] : null;
  return (!left || left.jahr <= year) && (!right || year <= right.jahr);
}

/** Index, an dem ein Lied sortiert eingefügt wird. */
export function sortedIndex(timeline, year) {
  let i = 0;
  while (i < timeline.length && timeline[i].jahr <= year) i++;
  return i;
}

/** Relative Platzierung (kleiner = besser) oder null. */
export function relRank(s) {
  if (!s || s.platz === null || !s.teilnehmer || isCancelled(s)) return null;
  return s.platz / s.teilnehmer;
}

/** Bonuspunkte für einen freien Platz-Tipp: exakt 2, bis 2 Plätze daneben 1, richtiges Halbfinal-Aus 1. */
export function freePlacePoints(s, guess) {
  const out = s.runde_ende !== 'Finale';
  if (guess.hf) return out ? 1 : 0;
  const n = parseInt(guess.free, 10);
  if (isNaN(n) || out) return 0;
  const d = Math.abs(n - s.platz);
  return d === 0 ? 2 : d <= 2 ? 1 : 0;
}

const normName = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z]/g, '');

const COUNTRY_ALIASES = {
  holland: 'NL', netherlands: 'NL',
  england: 'GB', uk: 'GB', grossbritannien: 'GB', vereinigteskoenigreich: 'GB', unitedkingdom: 'GB',
  oesterreich: 'AT', tuerkei: 'TR', rumaenien: 'RO', daenemark: 'DK',
  moldawien: 'MD', mazedonien: 'MK', weissrussland: 'BY', bosnien: 'BA', tschechischerepublik: 'CZ',
  germany: 'DE', sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', iceland: 'IS',
  france: 'FR', italy: 'IT', spain: 'ES', greece: 'GR', turkey: 'TR', austria: 'AT',
  switzerland: 'CH', belgium: 'BE', ireland: 'IE', russia: 'RU', ukraine: 'UA', poland: 'PL',
};

/** Freitext -> ISO-Code oder null. names: Map ISO -> deutscher Name. */
export function matchCountry(text, names) {
  const t = normName(text);
  if (!t) return null;
  for (const [iso, name] of names) if (normName(name) === t) return iso;
  const alias = COUNTRY_ALIASES[t];
  return alias && names.has(alias) ? alias : null;
}

/** Text „Platz X von Y“ inkl. Sonderfälle. */
export function placementText(s) {
  const sf = s.sonderfall;
  if (sf.includes('abgesagt') || (s.jahr === 2020 && s.platz === null)) return '2020 abgesagt';
  if (sf.includes('disqualifiziert')) return 'disqualifiziert';
  if (sf.includes('zurueckgezogen')) return 'zurückgezogen';
  if (sf.includes('ohne_wertung')) return s.sieger ? 'Sieger (ohne Wertung)' : 'ohne Wertung';
  if (s.platz === null) return s.sieger ? 'Sieger' : 'Platzierung unbekannt';
  const base = `Platz ${s.platz}${s.teilnehmer ? ` von ${s.teilnehmer}` : ''}`;
  const r = s.runde_ende;
  if (r === 'HF1' || r === 'HF2') return `${r}: ${base}`;
  if (r === 'HF') return `Halbfinale: ${base}`;
  if (r === 'Vorentscheid') return `Vorrunde: ${base}`;
  return base;
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
