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

/** Vier Länder zum Raten: das richtige und drei, die im selben Jahr teilgenommen haben. */
export function countryOptions(song, songs) {
  const sameYear = [...new Set(songs.filter((s) => s.jahr === song.jahr).map((s) => s.land_iso))]
    .filter((iso) => iso && iso !== song.land_iso);
  return shuffle([song.land_iso, ...shuffle(sameYear).slice(0, 3)]);
}

/** Tokens für einen freien Platz-Tipp: exakt 1, bis 2 Plätze daneben ½, richtiges Halbfinal-Aus ½. */
export function placeTokens(s, guess) {
  const out = s.runde_ende !== 'Finale';
  if (guess.hf) return out ? 0.5 : 0;
  const n = parseInt(guess.free, 10);
  if (isNaN(n) || out) return 0;
  const d = Math.abs(n - s.platz);
  return d === 0 ? 1 : d <= 2 ? 0.5 : 0;
}

/** Tokens für das genaue Jahr: exakt 1, bis 2 Jahre daneben ½, nur wenn die Karte richtig liegt. */
export function yearTokens(tip, year, correct) {
  if (!correct || isNaN(tip)) return 0;
  const d = Math.abs(tip - year);
  return d === 0 ? 1 : d <= 2 ? 0.5 : 0;
}

/** Besser/schlechter ist ein 50:50-Tipp und bringt deshalb nur ½. */
export const neighborTokens = (ok) => (ok ? 0.5 : 0);

/** Summe eines Zugs. Interpret, Titel und Land bringen je ½. */
export function tokenPoints({ countryOk, artistState, titleState, placePts = 0, yearPts = 0 }) {
  const half = [countryOk, artistState === 'ok', titleState === 'ok'].filter(Boolean).length;
  return half * 0.5 + placePts + yearPts;
}

/** Tokens gutschreiben. Beim Umwandeln wird aus je convertAt Tokens eine Bonuskarte. */
export function applyTokens(p, n, r) {
  p.tokens += n;
  let cards = 0;
  if (n && r.convert) {
    while (p.tokens >= r.convertAt) {
      p.tokens -= r.convertAt;
      p.bonusCards += 1;
      cards += 1;
    }
  }
  return { tokens: n, cards };
}

export const skipCost = (p) => (p.freeSkips > 0 ? 0 : 1);

/** Preis fürs Weiterhören: im schweren Modus ist nur das erste Mal gratis. */
export const renewCost = (r, renewals) => (r.renew === 'paid' && renewals >= 1 ? 0.5 : 0);

/** 2,5 statt 2.5, ½ statt 0,5. */
export const fmtTokens = (n) => (n === 0.5 ? '½' : String(n).replace('.', ','));
export const tokenLabel = (n) => `${fmtTokens(n)} ${n === 0.5 || n === 1 ? 'Token' : 'Tokens'}`;

const fold = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ß/g, 'ss');

/** Vorschläge beim Tippen: Treffer am Anfang zuerst, ohne Akzent-Unterschiede. */
export function suggest(text, list, max = 6) {
  const q = fold(text).trim();
  if (q.length < 2) return [];
  const start = [];
  const inner = [];
  for (const item of list) {
    const pos = fold(item).indexOf(q);
    if (pos === 0) start.push(item);
    else if (pos > 0) inner.push(item);
  }
  return [...start, ...inner].slice(0, max);
}

/** Statistik eines Landes. Halbfinalplätze sind eine andere Skala und zählen deshalb getrennt. */
export function countryStats(songs, iso) {
  const entries = songs.filter((s) => s.land_iso === iso);
  const held = entries.filter((s) => !isCancelled(s));
  const counts = new Map();
  for (const s of held) if (s.platz_finale !== null) counts.set(s.platz_finale, (counts.get(s.platz_finale) || 0) + 1);
  const worst = counts.size ? Math.max(...counts.keys()) : 0;
  const all = Array.from({ length: worst }, (_, i) => ({ place: i + 1, count: counts.get(i + 1) || 0 }));
  return {
    entries: entries.length,
    cancelled: entries.length - held.length,
    notFinal: held.filter((s) => s.runde_ende !== 'Finale').length,
    unrated: held.filter((s) => s.runde_ende === 'Finale' && s.platz_finale === null).length,
    top: all.filter((a) => a.count).sort((a, b) => b.count - a.count || a.place - b.place).slice(0, 5),
    all,
  };
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

const textWords = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/ß/g, 'ss').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const withoutBrackets = (t) => String(t).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');

const FILL_WORDS = new Set(['the', 'and', 'for', 'you', 'der', 'die', 'das', 'und', 'ein', 'eine', 'les', 'los', 'las', 'una', 'des', 'del']);

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Vergleicht einen Freitext-Tipp mit der Lösung: 'ok', 'near' (teilweise) oder 'bad'; null ohne Tipp. */
export function matchText(tip, answer) {
  const t = textWords(withoutBrackets(tip));
  if (!t.length) return null;
  let a = textWords(withoutBrackets(answer));
  if (!a.length) a = textWords(answer);
  const joined = a.join('');
  const tolerance = joined.length <= 3 ? 0 : joined.length <= 7 ? 1 : 2;
  if (levenshtein(t.join(''), joined) <= tolerance) return 'ok';
  const isKey = (w) => w.length >= 3 && !FILL_WORDS.has(w);
  const keys = a.filter(isKey);
  const partial = t.filter(isKey).some((w) => keys.some((k) => levenshtein(w, k) <= (k.length <= 4 ? 0 : 1)));
  return partial ? 'near' : 'bad';
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

/** Überlappung der Karten in px: 0, solange alles passt, sonst so wenig wie möglich, begrenzt auf maxShare der Kartenbreite. */
export function overlapPx(n, slotW, avail, maxShare = 0.45) {
  if (n < 2) return 0;
  const need = n * slotW - avail;
  if (need <= 0) return 0;
  // n-1 Überlappungen, dazu links und rechts je eine halbe als Platz fürs Auseinanderschieben
  return Math.min(Math.ceil(need / Math.max(n - 2, 0.5)), Math.round(slotW * maxShare));
}

/** Millisekunden als m:ss, ab einer Stunde als h:mm:ss. */
export function fmtDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Heatmap-Wert eines Beitrags: kind win | final | hf | none | cancelled, heat 0–1 nur im Finale. */
export function heatValue(s) {
  if (isCancelled(s)) return { kind: 'cancelled', heat: -3 };
  if (s.sieger) return { kind: 'win', heat: 2 };
  if (/disqualifiziert|zurueckgezogen|ohne_wertung/.test(s.sonderfall) || s.platz === null) return { kind: 'none', heat: -2 };
  if (s.runde_ende !== 'Finale') return { kind: 'hf', heat: -1 };
  const heat = s.teilnehmer > 1 ? 1 - (s.platz - 1) / (s.teilnehmer - 1) : 1;
  return { kind: 'final', heat: Math.max(0, Math.min(1, heat)) };
}

/** Land × Jahr für die Heatmap, bei mehreren Beiträgen im Jahr zählt der beste. Länder alphabetisch. */
export function heatMatrix(songs) {
  const years = songs.map((s) => s.jahr);
  const from = Math.min(...years);
  const to = Math.max(...years);
  const countries = new Map();
  for (const s of songs) {
    if (!countries.has(s.land_iso)) countries.set(s.land_iso, { iso: s.land_iso, name: s.land, cells: new Map() });
    const cells = countries.get(s.land_iso).cells;
    const v = heatValue(s);
    const old = cells.get(s.jahr);
    if (!old) cells.set(s.jahr, { ...v, songs: [s] });
    else {
      old.songs.push(s);
      if (v.heat > old.heat) { old.kind = v.kind; old.heat = v.heat; }
    }
  }
  return {
    years: Array.from({ length: to - from + 1 }, (_, i) => from + i),
    countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')),
  };
}
