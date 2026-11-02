// Spiellogik mit den echten Liedern. Start im Projektordner: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  filterPool, placeTokens, yearTokens, neighborTokens, tokenPoints, applyTokens, skipCost, renewCost,
  fmtTokens, tokenLabel, suggest, countryStats, relRank, hasVideo,
} from '../app/js/data.js';
import {
  DEFAULT_RULES, PRESETS, presetById, presetMatches, matchingPreset, migrateSettings, migrateState, SETTINGS_VERSION,
} from '../app/js/settings.js';

const raw = JSON.parse(readFileSync(new URL('../app/data/esc_songs.json', import.meta.url), 'utf8'));
// Felder wie in data.js/normalize, das nicht exportiert ist
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const songs = raw.songs.map((s) => ({
  ...s, jahr: num(s.jahr), platz: num(s.platz), teilnehmer: num(s.teilnehmer), punkte: num(s.punkte),
  platz_finale: num(s.platz_finale), land_iso: s.land_iso.toUpperCase(), sonderfall: s.sonderfall || '',
  runde_ende: s.runde_ende || '', sieger: s.sieger === true || s.sieger === 'ja', youtube_id: (s.youtube_id || '').trim(), embed_ok: s.embed_ok === 'nein' ? false : true,
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
