// Reine Logik der Spielmodi „Higher Lower“ und „Streaming ranken“ (ohne DOM, damit testbar)
import { filterPool, isCancelled } from './data.js';

export const MODI_VERSION = 1;

/* ------------------------------------------------------------------ Higher Lower */

const imFinale = (s) => s.runde_ende === 'Finale' && !isCancelled(s) && !s.sonderfall.includes('ohne_wertung');

/**
 * Vergleichsgrößen. `wert` ist die Zahl, nach der verglichen wird (größer = „höher“),
 * `anzeige` der Text auf der Karte. Beim Platz ist ein kleinerer Platz besser, daher zählt -Platz.
 */
export const HL_METRIKEN = {
  views: {
    label: 'YouTube-Aufrufe',
    ok: (s) => s.yt_views !== null && s.yt_views !== undefined && s.yt_views > 0,
    wert: (s) => s.yt_views,
    anzeige: (s) => fmtViews(s.yt_views),
    hoch: 'Mehr Aufrufe', tief: 'Weniger Aufrufe',
    frage: 'Hat dieses Lied mehr oder weniger Aufrufe?',
  },
  platz: {
    label: 'Platzierung im Finale',
    ok: (s) => imFinale(s) && s.platz_finale !== null,
    wert: (s) => -s.platz_finale,
    anzeige: (s) => `Platz ${s.platz_finale}`,
    hoch: 'Besserer Platz', tief: 'Schlechterer Platz',
    frage: 'Landete dieses Lied auf einem besseren oder schlechteren Platz?',
  },
  punkte: {
    label: 'Punkte im Finale',
    ok: (s) => imFinale(s) && s.punkte !== null,
    wert: (s) => s.punkte,
    anzeige: (s) => `${s.punkte} Punkte`,
    hoch: 'Mehr Punkte', tief: 'Weniger Punkte',
    frage: 'Bekam dieses Lied mehr oder weniger Punkte?',
  },
};

export const HL_ARTEN = {
  serie: { label: 'Serie nacheinander', info: 'Jeder spielt, bis er einen Fehler macht. Dann ist der Nächste dran. Wer die längste Serie schafft, gewinnt.' },
  abwechseln: { label: 'Abwechseln', info: 'Nach jedem Tipp ist der Nächste dran, jeder mit eigenen Karten. Wer falsch liegt, scheidet aus. Die längste Serie gewinnt.' },
  teamwork: { label: 'Teamwork', info: 'Alle raten abwechselnd an denselben Karten und wollen gemeinsam möglichst weit kommen.' },
};

/** 12.345.678 -> „12,3 Mio.“ */
export function fmtViews(n) {
  if (n === null || n === undefined) return '–';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} Mio.`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} Tsd.`;
  return String(n);
}

/** Lieder, die für die Vergleichsgröße taugen. Ein Video ist nicht nötig, es wird nichts abgespielt. */
export function hlPool(songs, filter, metrik) {
  const m = HL_METRIKEN[metrik];
  return filterPool(songs, filter, true).filter(m.ok);
}

/** Zieht ein Lied mit anderem Wert als `wert`. Bevorzugt noch nicht benutzte, sonst beliebige. */
export function hlZiehe(pool, metrik, wert, benutzt, rnd = Math.random) {
  const m = HL_METRIKEN[metrik];
  const passend = pool.filter((s) => m.wert(s) !== wert);
  const frisch = passend.filter((s) => !benutzt.includes(s.id));
  const liste = frisch.length ? frisch : passend;
  return liste.length ? liste[Math.floor(rnd() * liste.length)] : null;
}

export function hlBewerte(metrik, tipp, links, rechts) {
  const m = HL_METRIKEN[metrik];
  const hoeher = m.wert(rechts) > m.wert(links);
  return tipp === 'hoch' ? hoeher : !hoeher;
}

/** Neues Spiel. `ketten[i]` hält die zwei Karten; bei Serie und Teamwork gibt es nur eine Kette. */
export function hlStart({ art, metrik, filter, names }, pool, rnd = Math.random) {
  if (!HL_ARTEN[art] || !HL_METRIKEN[metrik]) throw new Error('Unbekannte Spielart oder Vergleichsgröße');
  const st = {
    v: MODI_VERSION, art, metrik, filter, benutzt: [],
    spieler: names.map((name) => ({ name, serie: 0, aus: false })),
    aktiv: 0, ketten: [], phase: 'tipp', letzte: null, ende: false,
  };
  const anzahl = art === 'abwechseln' ? names.length : 1;
  for (let i = 0; i < anzahl; i++) {
    const ketten = hlNeueKette(st, pool, rnd);
    if (!ketten) throw new Error('Zu wenige Lieder im Pool');
    st.ketten.push(ketten);
  }
  return st;
}

function hlNeueKette(st, pool, rnd) {
  const m = HL_METRIKEN[st.metrik];
  const a = hlZiehe(pool, st.metrik, undefined, st.benutzt, rnd);
  if (!a) return null;
  st.benutzt.push(a.id);
  const b = hlZiehe(pool, st.metrik, m.wert(a), st.benutzt, rnd);
  if (!b) return null;
  st.benutzt.push(b.id);
  return { links: a.id, rechts: b.id };
}

const kettenIndex = (st) => (st.art === 'abwechseln' ? st.aktiv : 0);

/** Tipp abgeben (`hoch`/`tief`). Danach ist `phase` = 'auf' und `letzte` beschreibt das Ergebnis. */
export function hlTipp(st, tipp, byId) {
  if (st.phase !== 'tipp' || st.ende) return st;
  const k = st.ketten[kettenIndex(st)];
  const ok = hlBewerte(st.metrik, tipp, byId(k.links), byId(k.rechts));
  const sp = st.spieler[st.aktiv];
  if (ok) sp.serie += 1;
  st.letzte = { ok, spieler: st.aktiv, tipp, links: k.links, rechts: k.rechts };
  st.phase = 'auf';
  return st;
}

function naechsterSpieler(st) {
  const n = st.spieler.length;
  for (let i = 1; i <= n; i++) {
    const j = (st.aktiv + i) % n;
    if (!st.spieler[j].aus) return j;
  }
  return -1;
}

/** Nach der Auflösung: Karten weiterschieben, Spieler wechseln oder beenden. */
export function hlWeiter(st, pool, rnd = Math.random) {
  if (st.phase !== 'auf') return st;
  const { ok } = st.letzte;
  const ki = kettenIndex(st);
  const k = st.ketten[ki];
  const m = HL_METRIKEN[st.metrik];
  const sp = st.spieler[st.aktiv];
  st.phase = 'tipp';

  if (ok) {
    const neu = hlZiehe(pool, st.metrik, m.wert(findeIn(pool, k.rechts)), st.benutzt, rnd);
    if (!neu) { st.ende = true; st.phase = 'ende'; return st; }
    st.benutzt.push(neu.id);
    st.ketten[ki] = { links: k.rechts, rechts: neu.id };
    if (st.art !== 'serie') {
      const n = naechsterSpieler(st);
      if (n >= 0) st.aktiv = n;
    }
    return st;
  }

  // Fehler
  if (st.art === 'teamwork') { st.ende = true; st.phase = 'ende'; return st; }
  sp.aus = true;
  const n = naechsterSpieler(st);
  if (n < 0) { st.ende = true; st.phase = 'ende'; return st; }
  st.aktiv = n;
  if (st.art === 'serie') {
    const kette = hlNeueKette(st, pool, rnd);
    if (!kette) { st.ende = true; st.phase = 'ende'; return st; }
    st.ketten[0] = kette;
  }
  return st;
}

function findeIn(pool, id) { return pool.find((s) => s.id === id); }

/** Rangliste nach Serie (absteigend), Gleichstand = gleicher Platz. */
export function hlRangliste(st) {
  const liste = st.spieler.map((s, i) => ({ i, name: s.name, serie: s.serie })).sort((a, b) => b.serie - a.serie);
  let platz = 0;
  return liste.map((x, idx) => {
    if (idx === 0 || x.serie !== liste[idx - 1].serie) platz = idx + 1;
    return { ...x, platz };
  });
}

/** Liest einen gespeicherten Stand und gibt null zurück, wenn er nicht (mehr) passt. */
export function hlLade(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== MODI_VERSION) return null;
  if (!HL_ARTEN[raw.art] || !HL_METRIKEN[raw.metrik]) return null;
  if (!Array.isArray(raw.spieler) || !raw.spieler.length || !Array.isArray(raw.ketten) || !raw.ketten.length) return null;
  if (!raw.ketten.every((k) => k && k.links && k.rechts)) return null;
  if (typeof raw.aktiv !== 'number' || !raw.spieler[raw.aktiv]) return null;
  return { ...raw, benutzt: Array.isArray(raw.benutzt) ? raw.benutzt : [], phase: raw.phase || 'tipp' };
}

/* ------------------------------------------------------------------ Streaming ranken */

export const STREAM_AB_JAHR = 2000;
export const STREAM_MIN_VIEWS = 10_000_000;

/** Bekannte Lieder ab 2000 mit genug Aufrufen. */
export function streamPool(songs, minViews = STREAM_MIN_VIEWS) {
  return songs.filter((s) => s.jahr >= STREAM_AB_JAHR && !isCancelled(s) && s.yt_views !== null && s.yt_views >= minViews);
}

/** Passt `views` in die Lücke `gap` (0..n) der nach Aufrufen sortierten Leiste? Gleichstand zählt als richtig. */
export function streamFits(leiste, gap, views) {
  const links = gap > 0 ? leiste[gap - 1] : null;
  const rechts = gap < leiste.length ? leiste[gap] : null;
  return (!links || links.yt_views <= views) && (!rechts || views <= rechts.yt_views);
}

export function streamIndex(leiste, views) {
  let i = 0;
  while (i < leiste.length && leiste[i].yt_views <= views) i++;
  return i;
}

/** Neues Spiel: jeder Spieler bekommt eine Startkarte, danach folgt das Ziehen. */
export function streamStart({ names, ziel, minViews = STREAM_MIN_VIEWS }, pool, rnd = Math.random) {
  const mix = pool.slice();
  for (let i = mix.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mix[i], mix[j]] = [mix[j], mix[i]]; }
  if (mix.length < names.length + 2) throw new Error('Zu wenige Lieder im Pool');
  const spieler = names.map((name, i) => ({ name, leiste: [mix[i].id] }));
  return {
    v: MODI_VERSION, ziel, minViews, spieler, aktiv: 0,
    stapel: mix.slice(names.length).map((s) => s.id), cur: null, phase: 'lege', letzte: null, ende: false,
  };
}

export function streamZiehe(st) {
  if (st.cur) return st;
  st.cur = st.stapel.shift() || null;
  if (!st.cur) st.ende = true;
  return st;
}

/** Karte in Lücke legen. `byId` liefert das Lied zur Id. */
export function streamLege(st, gap, byId) {
  if (st.phase !== 'lege' || !st.cur) return st;
  const sp = st.spieler[st.aktiv];
  const leiste = sp.leiste.map(byId);
  const song = byId(st.cur);
  const ok = streamFits(leiste, gap, song.yt_views);
  if (ok) sp.leiste.splice(streamIndex(leiste, song.yt_views), 0, song.id);
  st.letzte = { ok, spieler: st.aktiv, id: song.id, gap };
  st.phase = 'auf';
  return st;
}

/** Nach der Auflösung: nächster Spieler. Das Spiel endet nach vollständiger Runde, sobald jemand das Ziel hat. */
export function streamWeiter(st) {
  if (st.phase !== 'auf') return st;
  st.cur = null;
  st.phase = 'lege';
  st.aktiv = (st.aktiv + 1) % st.spieler.length;
  if (st.aktiv === 0 && st.spieler.some((s) => s.leiste.length >= st.ziel)) st.ende = true;
  if (st.ende) st.phase = 'ende';
  else streamZiehe(st);
  if (st.ende) st.phase = 'ende';
  return st;
}

export function streamRangliste(st) {
  const liste = st.spieler.map((s, i) => ({ i, name: s.name, karten: s.leiste.length })).sort((a, b) => b.karten - a.karten);
  let platz = 0;
  return liste.map((x, idx) => {
    if (idx === 0 || x.karten !== liste[idx - 1].karten) platz = idx + 1;
    return { ...x, platz };
  });
}

export function streamLade(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== MODI_VERSION) return null;
  if (!Array.isArray(raw.spieler) || !raw.spieler.length || !raw.spieler.every((s) => s && Array.isArray(s.leiste) && s.leiste.length)) return null;
  if (!Array.isArray(raw.stapel) || typeof raw.aktiv !== 'number' || !raw.spieler[raw.aktiv]) return null;
  return { ...raw, phase: raw.phase || 'lege' };
}
