// Spiellogik mit den echten Liedern. Start im Projektordner: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  filterPool, placeTokens, yearTokens, neighborTokens, tokenPoints, applyTokens, skipCost, renewCost,
  fmtTokens, tokenLabel, suggest, countryStats, relRank, hasVideo, overlapPx, fmtDuration, heatMatrix, heatValue, searchSongs,
  overviewStats, entriesOfYear, entriesOfCountry, historyEntry, songStart, playerFilter, handicapLabel,
} from '../app/js/data.js';
import {
  DEFAULT_RULES, PRESETS, presetById, presetMatches, matchingPreset, migrateSettings, migrateState, SETTINGS_VERSION,
} from '../app/js/settings.js';
import { IKONEN } from '../app/js/ikonen.js';

const raw = JSON.parse(readFileSync(new URL('../app/data/esc_songs.json', import.meta.url), 'utf8'));
// Felder wie in data.js/normalize, das nicht exportiert ist
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const songs = raw.songs.map((s) => ({
  ...s, jahr: num(s.jahr), platz: num(s.platz), teilnehmer: num(s.teilnehmer), punkte: num(s.punkte),
  platz_finale: num(s.platz_finale), land_iso: s.land_iso.toUpperCase(), sonderfall: s.sonderfall || '',
  refrain_sek: num(s.refrain_sek), runde_ende: s.runde_ende || '', sieger: s.sieger === true || s.sieger === 'ja', youtube_id: (s.youtube_id || '').trim(), embed_ok: s.embed_ok === 'nein' ? false : true,
}));
const byId = (id) => songs.find((s) => s.id === id);
const FILTER = { mode: 'alle', from: 1956, to: 2026, countries: [] };

test('freie Platzierung: exakt 1, bis 2 daneben ½, sonst 0', () => {
  const lena = byId('2010-DE'); // Platz 1 im Finale
  assert.equal(placeTokens(lena, { free: '1', hf: false }), 1);
  assert.equal(placeTokens(lena, { free: '3', hf: false }), 0.5);
  assert.equal(placeTokens(lena, { free: '4', hf: false }), 0);
});

test('Halbfinal-Aus: richtig getippt ½, Platz-Tipp 0, bei Finalisten falsch', () => {
  const out = byId('2013-AT');
  assert.equal(placeTokens(out, { free: '', hf: true }), 0.5);
  assert.equal(placeTokens(out, { free: '14', hf: false }), 0);
  assert.equal(placeTokens(byId('2010-DE'), { free: '', hf: true }), 0);
});

test('genaues Jahr: exakt 1, bis 2 daneben ½, nur bei richtiger Karte', () => {
  assert.equal(yearTokens(2010, 2010, true), 1);
  assert.equal(yearTokens(2012, 2010, true), 0.5);
  assert.equal(yearTokens(2008, 2010, true), 0.5);
  assert.equal(yearTokens(2013, 2010, true), 0);
  assert.equal(yearTokens(2010, 2010, false), 0);
  assert.equal(yearTokens(NaN, 2010, true), 0);
});

test('Summe: Interpret, Titel, Land je ½, teilweise richtig zählt nicht', () => {
  assert.equal(tokenPoints({ countryOk: true, artistState: 'ok', titleState: 'ok' }), 1.5);
  assert.equal(tokenPoints({ countryOk: false, artistState: 'near', titleState: 'bad' }), 0);
  assert.equal(tokenPoints({ countryOk: true, artistState: 'ok', titleState: 'ok', placePts: 1, yearPts: 1 }), 3.5);
  assert.equal(neighborTokens(true), 0.5);
  assert.equal(neighborTokens(false), 0);
});

test('Tokens haben kein Limit, Umwandeln ergibt Bonuskarten', () => {
  const p = { tokens: 4.5, bonusCards: 0 };
  assert.deepEqual(applyTokens(p, 3.5, DEFAULT_RULES), { tokens: 3.5, cards: 0 });
  assert.equal(p.tokens, 8);
  const q = { tokens: 4.5, bonusCards: 0 };
  assert.equal(applyTokens(q, 1, { ...DEFAULT_RULES, convert: true, convertAt: 5 }).cards, 1);
  assert.deepEqual([q.tokens, q.bonusCards], [0.5, 1]);
});

test('Skip: erster gratis, danach 1 Token', () => {
  assert.equal(skipCost({ freeSkips: 1 }), 0);
  assert.equal(skipCost({ freeSkips: 0 }), 1);
});

test('Weiterhören: schwerer Modus einmal gratis, dann ½, einfacher immer gratis', () => {
  const hard = presetById('esc').rules;
  assert.equal(renewCost(hard, 0), 0);
  assert.equal(renewCost(hard, 1), 0.5);
  assert.equal(renewCost(hard, 4), 0.5);
  assert.equal(renewCost(presetById('edition').rules, 9), 0);
});

test('Anzeige der Tokens', () => {
  assert.equal(fmtTokens(2.5), '2,5');
  assert.equal(fmtTokens(0.5), '½');
  assert.equal(tokenLabel(1), '1 Token');
  assert.equal(tokenLabel(0), '0 Tokens');
  assert.equal(tokenLabel(1.5), '1,5 Tokens');
});

test('2020 ist immer dabei, solange es im Zeitraum liegt', () => {
  const pool = filterPool(songs, FILTER);
  assert.equal(pool.filter((s) => s.jahr === 2020).length, 41);
  assert.equal(filterPool(songs, { ...FILTER, to: 2019 }).filter((s) => s.jahr === 2020).length, 0);
  assert.equal(filterPool(songs, { ...FILTER, mode: 'finale' }).filter((s) => s.jahr === 2020).length, 0);
  assert.equal(relRank(pool.find((s) => s.jahr === 2020)), null);
  assert.ok(pool.every(hasVideo));
});

test('Modi: Regler dürfen aus oder auf dem Wert des Modus stehen', () => {
  const hard = presetById('esc');
  assert.equal(matchingPreset({ ...hard.rules }).id, 'esc');
  assert.equal(matchingPreset({ ...hard.rules, country: 'free' }).id, 'esc');
  assert.equal(matchingPreset({ ...hard.rules, country: 'free', place: 'free' }).id, 'esc');
  assert.equal(presetMatches({ ...hard.rules, country: 'choice' }, hard), false);
  assert.equal(matchingPreset({ ...hard.rules, country: 'choice' }), undefined);
  const easy = presetById('edition');
  assert.equal(matchingPreset({ ...easy.rules, country: 'choice', place: 'neighbor' }).id, 'edition');
  assert.equal(matchingPreset({ ...easy.rules, steal: true }), undefined);
  assert.deepEqual(PRESETS.map((p) => p.id), ['entspannt', 'klassisch', 'edition', 'esc']);
});

test('Vorschläge: echte Namen, ohne Akzent-Unterschiede, höchstens 6', () => {
  const artists = [...new Set(songs.map((s) => s.interpret))];
  assert.deepEqual(suggest('a', artists), []);
  assert.ok(suggest('abba', artists).includes('ABBA'));
  assert.ok(suggest('celine', artists).some((a) => a.includes('Céline')));
  assert.ok(suggest('la', artists).length <= 6);
  assert.deepEqual(suggest('xyzqq', artists), []);
});

test('Statistik Deutschland', () => {
  const de = countryStats(songs, 'DE');
  assert.equal(de.entries, 72);
  assert.equal(de.cancelled, 1);
  assert.equal(de.top.length, 5);
  assert.deepEqual(de.top[0], { place: 8, count: 8 });
  assert.equal(de.all.find((a) => a.place === 3).count, 5);
  assert.equal(de.notFinal, 1);
  assert.equal(de.all.reduce((sum, a) => sum + a.count, 0) + de.notFinal + de.unrated + de.cancelled, de.entries);
});

test('Migration: Party und Profi werden zu Klassisch', () => {
  const party = { v: 3, players: ['A'], rules: { steal: false, country: 'choice', place: 'neighbor', exact: 1, artist: false, title: false, bonus: 'count', convertAt: 5, timeLimit: 30 } };
  const profi = { v: 3, rules: { steal: false, country: 'free', place: 'free', exact: 2, artist: true, title: true, bonus: 'convert', convertAt: 5, timeLimit: 20 } };
  for (const st of [party, profi]) {
    const m = migrateSettings(st);
    assert.equal(m.v, SETTINGS_VERSION);
    assert.equal(matchingPreset(m.rules).id, 'klassisch');
    assert.equal('bonus' in m.rules, false);
  }
});

test('Migration: eigene Regeln bleiben, Umwandeln bleibt erhalten', () => {
  const m = migrateSettings({ v: 3, rules: { steal: true, country: 'off', place: 'off', exact: 2, artist: true, title: false, bonus: 'convert', convertAt: 4, timeLimit: 45 } });
  assert.equal(m.rules.exact, 1);
  assert.equal(m.rules.convert, true);
  assert.equal(m.rules.convertAt, 4);
  assert.equal(m.rules.steal, true);
  assert.equal(m.rules.renew, 'free');
  assert.equal(migrateSettings({ v: SETTINGS_VERSION, rules: { x: 1 } }).rules.x, 1);
});

test('Migration laufendes Spiel: Bonus wird zu Tokens oder Bonuskarten', () => {
  const game = (bonus) => ({
    settings: { rules: { country: 'choice', place: 'off', exact: 2, bonus, convertAt: 5, timeLimit: 30 } },
    players: [{ name: 'A', timeline: [], tokens: 2, bonus: 7 }],
    cur: { songId: '2010-DE', phase: 'listen', country: {}, place: {} },
  });
  const count = migrateState(game('count'));
  assert.deepEqual([count.players[0].tokens, count.players[0].bonusCards, count.players[0].freeSkips], [9, 0, 1]);
  assert.deepEqual(count.players[0].wrong, []);
  assert.equal(count.settings.rules.timeLimit, 30);
  assert.equal(count.cur.renewals, 0);
  const convert = migrateState(game('convert'));
  assert.deepEqual([convert.players[0].tokens, convert.players[0].bonusCards], [4, 1]);
  const twice = migrateState(migrateState(game('count')));
  assert.equal(twice.players[0].tokens, 9);
});

test('Überlappung: erst wenn nötig, dann alles passend, höchstens 45 % der Karte', () => {
  assert.equal(overlapPx(1, 146, 100), 0);
  assert.equal(overlapPx(5, 146, 800), 0);
  const px = overlapPx(8, 146, 800);
  assert.ok(px > 0 && px < 146 * 0.45);
  assert.ok(8 * 146 - 6 * px <= 800);
  assert.equal(overlapPx(30, 146, 800), Math.round(146 * 0.45));
});

test('Zeitanzeige', () => {
  assert.equal(fmtDuration(0), '0:00');
  assert.equal(fmtDuration(83000), '1:23');
  assert.equal(fmtDuration(3723000), '1:02:03');
});

test('Heatmap mit echten Daten: Sieg, Sonderfälle und bester Beitrag im Jahr', () => {
  const m = heatMatrix(songs);
  assert.equal(m.years[0], 1956);
  assert.equal(m.years.at(-1), 2026);
  const de = m.countries.find((k) => k.iso === 'DE');
  assert.equal(de.cells.get(2010).kind, 'win'); // Lena
  assert.equal(de.cells.get(2020).kind, 'cancelled');
  assert.equal(de.cells.get(1956).kind, 'none');
  assert.equal(de.cells.get(1956).songs.length, 2);
  assert.equal(m.countries.find((k) => k.iso === 'CH').cells.get(1956).kind, 'win'); // Lys Assia, 2. Beitrag ohne Wertung
  assert.equal(de.cells.has(1994) && de.cells.get(1994).kind, 'final');
  for (const s of songs) {
    const v = heatValue(s);
    if (v.kind === 'final') assert.ok(v.heat >= 0 && v.heat <= 1, s.id);
  }
  const hf = songs.find((s) => s.runde_ende === 'HF1' && s.platz !== null);
  assert.equal(heatValue(hf).kind, 'hf');
});

test('Migration: Zeit tracken ergänzt alte Stände', () => {
  assert.equal(migrateSettings({ v: 4, rules: { ...DEFAULT_RULES, artist: true } }).trackTime, false);
  assert.equal(migrateSettings({ v: 4, rules: { ...DEFAULT_RULES, artist: true } }).v, SETTINGS_VERSION);
  const saved = migrateState({
    settings: { rules: { ...DEFAULT_RULES } }, players: [{ name: 'A', timeline: [], tokens: 2, bonusCards: 0, freeSkips: 1, wrong: [] }],
    cur: { country: {}, place: {} },
  });
  assert.equal(saved.settings.trackTime, false);
  assert.equal(saved.players[0].time, 0);
  assert.equal(saved.cur.elapsed, 0);
  assert.equal(saved.cur.clockOn, false);
});

test('Lied suchen: Titel, Land mit Jahr, ohne Akzente, höchstens max Treffer', () => {
  assert.equal(searchSongs(songs, 'anouschka')[0].id, '1967-DE');
  assert.equal(searchSongs(songs, 'Deutschland 1969')[0].id, '1969-DE');
  assert.ok(searchSongs(songs, 'Mathe Altery').some((s) => s.id === '1956-FR'));
  assert.equal(searchSongs(songs, 'Deutschland').length, 8);
  assert.deepEqual(searchSongs(songs, '   '), []);
  assert.deepEqual(searchSongs(songs, 'gibtesnichtxyz'), []);
});

test('ESC-Ikonen: jede Id gibt es, alle Jahrzehnte sind vertreten, alle haben ein Video', () => {
  for (const id of IKONEN) assert.ok(byId(id), id);
  const pool = filterPool(songs, { ...FILTER, mode: 'ikonen' });
  assert.equal(pool.length, IKONEN.size);
  assert.deepEqual([...new Set(pool.map((s) => Math.floor(s.jahr / 10) * 10))].sort(), [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]);
});

test('Bekannteste je Jahrzehnt: höchstens N pro Jahrzehnt, jeweils die mit dem besten Rang', () => {
  const pool = filterPool(songs, { ...FILTER, mode: 'jahrzehnt', decadeN: 5 });
  const perDecade = Map.groupBy(pool, (s) => Math.floor(s.jahr / 10));
  assert.equal(perDecade.size, 8);
  for (const list of perDecade.values()) assert.equal(list.length, 5);
  assert.ok(pool.some((s) => s.id === '1974-SE')); // Waterloo
  const worst70s = Math.max(...perDecade.get(197).map((s) => s.pop_rang));
  const others = filterPool(songs, FILTER).filter((s) => Math.floor(s.jahr / 10) === 197 && s.pop_rang !== null && !perDecade.get(197).includes(s));
  assert.ok(others.every((s) => s.pop_rang > worst70s));
});

test('Bekannteste je Jahrzehnt: Zeitraum wird vor der Auswahl angewendet', () => {
  const pool = filterPool(songs, { ...FILTER, from: 1974, to: 1975, mode: 'jahrzehnt', decadeN: 3 });
  assert.equal(pool.length, 3);
  assert.ok(pool.every((s) => s.jahr === 1974 || s.jahr === 1975));
});

test('Statistikseite: Länder, Siege und Länder ohne Sieg aus den echten Daten', () => {
  const o = overviewStats(songs);
  const winnerIso = new Set(songs.filter((s) => s.sieger).map((s) => s.land_iso));
  assert.equal(o.countries, new Set(songs.map((s) => s.land_iso)).size);
  assert.equal(o.contests, 70); // 1956 bis 2026 ohne 2020
  assert.deepEqual(o.topWinners.slice(0, 2).map((k) => k.iso).sort(), ['IE', 'SE']);
  assert.equal(o.topWinners[0].wins, 7);
  assert.equal(o.topWinners.length, 6); // vier Länder teilen sich mit 5 Siegen Platz 3
  const never = o.neverWon.map((k) => k.iso);
  assert.ok(never.includes('MT') && never.includes('CY'));
  assert.ok(!never.includes('DE') && !never.includes('YU'));
  assert.equal(o.neverWon.length + winnerIso.size, o.countries);
  assert.deepEqual(o.recentWinners.slice(0, 2).map((s) => s.id), ['2026-BG', '2025-AT']);
});

test('Suche nach Jahr: Sieger zuerst, Finale vor Halbfinale; nach Land: neueste zuerst', () => {
  const y = entriesOfYear(songs, 2010);
  assert.equal(y[0].id, '2010-DE');
  assert.equal(y.length, songs.filter((s) => s.jahr === 2010).length);
  const firstHf = y.findIndex((s) => s.runde_ende !== 'Finale');
  assert.ok(firstHf > 0 && y.slice(firstHf).every((s) => s.runde_ende !== 'Finale'));
  assert.equal(entriesOfYear(songs, 1969).slice(0, 4).filter((s) => s.sieger).length, 4);
  const c = entriesOfCountry(songs, 'DE');
  assert.ok(c.every((s, i) => !i || c[i - 1].jahr >= s.jahr));
  assert.equal(c.length, songs.filter((s) => s.land_iso === 'DE').length);
});

test('Spielverlauf: Eintrag übernimmt Rangliste, Modus und Pool-Namen', () => {
  const e = historyEntry(
    [{ name: 'A', rank: 1, sc: 10, tokens: 2, time: 5000 }, { name: 'B', rank: 2, sc: 7, tokens: 0.5 }],
    { when: '2026-11-04T12:00:00.000Z', modeName: 'Klassisch', poolMode: 'ikonen', target: 10 },
  );
  assert.equal(e.pool, 'ESC-Ikonen');
  assert.deepEqual(e.spieler[1], { name: 'B', platz: 2, karten: 7, tokens: 0.5, zeit: 0 });
});

test('Refrain-Start: nur mit Schalter und nur hinter dem Spielstart', () => {
  const mit = songs.filter((s) => s.refrain_sek);
  assert.ok(mit.length > 600, `${mit.length} Refrains`);
  for (const s of mit) assert.ok(s.refrain_sek > (s.start_sek || 0), s.id);
  const s = mit[0];
  assert.equal(songStart(s, true), s.refrain_sek);
  assert.equal(songStart(s, false), s.start_sek || 0);
  const ohne = songs.find((x) => x.jahr < 2000 && !x.refrain_sek && !IKONEN.has(x.id));
  assert.equal(songStart(ohne, true), ohne.start_sek || 0);
});

test('Handicap: eigener Pool und Zeitraum, Länder bleiben gemeinsam', () => {
  const base = { ...FILTER, countries: ['DE'] };
  const hc = { mode: 'top10', topN: 100, decadeN: 15, from: 2000, to: 2026 };
  const f = playerFilter(base, hc);
  assert.deepEqual(f.countries, ['DE']);
  const own = filterPool(songs, f, true);
  assert.ok(own.length > 0);
  for (const s of own) assert.ok(s.land_iso === 'DE' && s.jahr >= 2000 && s.platz_finale <= 10, s.id);
  assert.equal(playerFilter(base, null), base);
  assert.equal(handicapLabel(hc), 'Top 10 · 2000–2026');
  assert.equal(handicapLabel({ ...hc, mode: 'topn', topN: 50 }), 'Top-50 bekannteste · 2000–2026');
});

test('Migration v6: Refrain, Siegermusik und Handicaps ergänzen alte Stände', () => {
  const m = migrateSettings({ v: 5, rules: { ...DEFAULT_RULES, artist: true }, trackTime: true });
  assert.equal(m.v, SETTINGS_VERSION);
  assert.equal(m.refrain, false);
  assert.equal(m.endFull, false);
  assert.deepEqual(m.handicaps, []);
  assert.equal(m.trackTime, true);
  const saved = migrateState({
    settings: { rules: { ...DEFAULT_RULES } }, players: [{ name: 'A', timeline: [], tokens: 2, bonusCards: 0, freeSkips: 1, wrong: [], time: 0 }], cur: null,
  });
  assert.equal(saved.settings.refrain, false);
  assert.equal(saved.players[0].handicap, null);
});
