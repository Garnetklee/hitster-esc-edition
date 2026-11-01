// Hitster ESC Edition – Hauptmodul (UI + Spielablauf)
import {
  loadSongs, filterPool, fitsGap, sortedIndex, relRank, placementText, shuffle, pickRandom,
  QUICK_COUNTRIES, hasVideo, isCancelled, freePlacePoints, matchCountry, matchText,
} from './data.js';
import * as YTP from './player.js';
import {
  SETTINGS_VERSION, PRESETS, DEFAULT_PRESET, BONUS_TARGETS, TIME_LIMITS, presetById, rulesEqual, migrateSettings, migrateState,
} from './settings.js';

const KEY_STATE = 'esc_hitster_state';
const KEY_SETTINGS = 'esc_hitster_settings';
const KEY_ERRORS = 'esc_hitster_errors';
const MAX_TOKENS = 5;
const START_TOKENS = 2;
const DEV = new URLSearchParams(location.search).get('dev') === '1';

let DATA = { file: '', generiert: '', songs: [] };
let BY_ID = new Map();
let COUNTRY_NAMES = new Map(); // ISO -> deutscher Name
let state = null; // laufendes Spiel
let stealPick = null; // Index des Spielers, der gerade eine Lücke zum Klauen wählt
let audioStatus = 'idle'; // idle | loading | playing | paused
let loadAttempt = 1;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ Speicher */
const store = {
  get(k, fb = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('localStorage', e); } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};
function save() { if (state) { state.savedAt = new Date().toISOString(); store.set(KEY_STATE, state); } }
const readErrors = () => store.get(KEY_ERRORS, []);
function logError(song, code) {
  const list = readErrors();
  list.push({ id: song ? song.id : '', youtube_id: song ? song.youtube_id : '', code: String(code), zeit: new Date().toISOString() });
  store.set(KEY_ERRORS, list.slice(-300));
}

/* ------------------------------------------------------------------ Toast */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------ Karten-HTML */
function flagHTML(iso) {
  if (!iso || iso === 'YU' || iso === 'CS') return `<span class="flag flag-txt">${esc(iso || '?')}</span>`;
  return `<img class="flag" src="https://flagcdn.com/w80/${esc(iso.toLowerCase())}.png" alt="${esc(iso)}" data-iso="${esc(iso)}" loading="lazy">`;
}
// Flaggen-Fallback: bei Ladefehler ISO-Text anzeigen
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img && img.tagName === 'IMG' && img.classList.contains('flag')) {
    const span = document.createElement('span');
    span.className = 'flag flag-txt';
    span.textContent = img.dataset.iso || '?';
    img.replaceWith(span);
  }
}, true);

function cardHTML(s, cls = '') {
  const crown = s.sieger ? '<span class="crown" title="Sieger">👑</span>' : '';
  return `<div class="card ${s.sieger ? 'winner' : ''} ${cls}" data-id="${esc(s.id)}">
    ${crown}
    <div class="c-year">${s.jahr}</div>
    <div class="c-land">${flagHTML(s.land_iso)}<span>${esc(s.land)}</span></div>
    <div class="c-artist">${esc(s.interpret)}</div>
    <div class="c-title">${esc(s.titel)}</div>
    <div class="c-place">${esc(placementText(s))}${s.punkte !== null ? ` · ${s.punkte} P.` : ''}</div>
  </div>`;
}
function mysteryHTML(cls = '') {
  const preview = state && state.cur ? tipHTML(guessFields(state.cur)) : '';
  return `<div class="card mystery ${cls} ${preview ? 'tip' : ''}" data-drag="1" aria-label="Verdeckte Karte"><span class="m-q">?</span><div class="guess-preview">${preview}</div></div>`;
}

/* ------------------------------------------------------------------ Setup */
const setup = {
  names: ['Spieler 1', 'Spieler 2'],
  countries: new Set(),
  hasPop: false,
  minYear: 1956,
  maxYear: 2026,
};

function readFilter() {
  const mode = ($('input[name=pool]:checked') || {}).value || 'alle';
  return {
    mode,
    topN: Math.max(1, parseInt($('#inp-topn').value, 10) || 100),
    from: parseInt($('#inp-from').value, 10) || setup.minYear,
    to: parseInt($('#inp-to').value, 10) || setup.maxYear,
    toMax: (parseInt($('#inp-to').value, 10) || setup.maxYear) >= setup.maxYear,
    incl2020: $('#chk-2020').checked,
    countries: [...setup.countries],
  };
}

const radioVal = (name) => ($(`input[name=${name}]:checked`) || {}).value;
function setRadio(name, value) {
  const r = $(`input[name=${name}][value="${value}"]`);
  if (r) r.checked = true;
}

function readRules() {
  return {
    steal: $('#chk-steal').checked,
    country: radioVal('r-country') || 'off',
    place: radioVal('r-place') || 'off',
    exact: parseInt(radioVal('r-exact'), 10) || 0,
    artist: $('#chk-artist').checked,
    title: $('#chk-title').checked,
    bonus: radioVal('r-bonus') || 'tokens',
    convertAt: parseInt(radioVal('r-convert'), 10) || 5,
    timeLimit: parseInt(radioVal('r-limit'), 10) || 0,
  };
}

function writeRules(r) {
  $('#chk-steal').checked = !!r.steal;
  setRadio('r-country', r.country);
  setRadio('r-place', r.place);
  setRadio('r-exact', r.exact);
  $('#chk-artist').checked = !!r.artist;
  $('#chk-title').checked = !!r.title;
  setRadio('r-bonus', r.bonus);
  setRadio('r-convert', r.convertAt);
  setRadio('r-limit', r.timeLimit);
}

/** Id des passenden Modus oder 'custom'. Zeitraum, 2020 und Länder gehören mit zum Modus. */
function currentPreset() {
  const f = readFilter();
  if (f.from !== setup.minYear || f.to !== setup.maxYear || !f.incl2020 || f.countries.length) return 'custom';
  const r = readRules();
  const hit = PRESETS.find((p) => rulesEqual(r, p.rules));
  return hit ? hit.id : 'custom';
}

function renderPresets() {
  const on = currentPreset();
  const custom = { id: 'custom', name: 'Custom', desc: 'Eigene Regeln in den erweiterten Einstellungen.' };
  $('#preset-grid').innerHTML = [...PRESETS, custom].map((p) =>
    `<button type="button" class="preset ${p.id === on ? 'on' : ''}" data-preset="${p.id}" aria-pressed="${p.id === on}">
      <span class="preset-name">${esc(p.name)}</span><span class="preset-desc">${esc(p.desc)}</span>
    </button>`).join('');
}

function applyPreset(id) {
  writeRules(presetById(id).rules);
  $('#inp-from').value = setup.minYear;
  $('#inp-to').value = setup.maxYear;
  $('#chk-2020').checked = true;
  setup.countries = new Set();
  renderCountryChips();
  updateCount();
}

function renderPlayerInputs() {
  const box = $('#player-list');
  box.innerHTML = setup.names.map((n, i) =>
    `<label class="player-input"><span class="pnum">${i + 1}</span><input type="text" maxlength="16" value="${esc(n)}" data-i="${i}" aria-label="Name Spieler ${i + 1}" enterkeyhint="done"></label>`).join('');
  $$('input', box).forEach((inp) => inp.addEventListener('input', () => { setup.names[+inp.dataset.i] = inp.value; updateCount(); }));
  $('#btn-add-player').disabled = setup.names.length >= 8;
  $('#btn-remove-player').disabled = setup.names.length <= 2;
}

function renderCountryChips() {
  const isos = [...COUNTRY_NAMES.keys()].sort((a, b) => COUNTRY_NAMES.get(a).localeCompare(COUNTRY_NAMES.get(b), 'de'));
  $('#country-chips').innerHTML = isos.map((iso) =>
    `<button type="button" class="chip ${setup.countries.has(iso) ? 'on' : ''}" data-iso="${iso}">${flagHTML(iso)}<span>${esc(COUNTRY_NAMES.get(iso))}</span></button>`).join('');
  $('#country-sel-info').textContent = setup.countries.size ? `(${setup.countries.size} gewählt)` : '(alle)';
}

function updateCount() {
  const f = readFilter();
  const n = filterPool(DATA.songs, f, DEV).length;
  const players = setup.names.length;
  const need = players + 5;
  $('#pool-count').textContent = n;
  $('#pool-need').textContent = n < need ? `– mindestens ${need} nötig` : '';
  $('#btn-start').disabled = n < need;
  $('.pool-count').classList.toggle('low', n < need);
  const r = readRules();
  $('#convert-box').hidden = r.bonus !== 'convert';
  $('#place-hint').hidden = r.place !== 'free';
  renderPresets();
}

function applySettings(st) {
  if (!st) return;
  if (Array.isArray(st.players) && st.players.length >= 2) setup.names = st.players.slice(0, 8);
  if (st.target) $('#inp-target').value = st.target;
  const f = st.filter || {};
  if (f.mode) { const r = $(`input[name=pool][value="${f.mode}"]`); if (r && !r.disabled) r.checked = true; }
  if (f.topN) $('#inp-topn').value = f.topN;
  if (f.from) $('#inp-from').value = f.from;
  // "bis" am alten Datenende gespeichert -> mit neuen Daten bis zum neuen Ende
  if (f.to && !f.toMax) $('#inp-to').value = Math.min(f.to, setup.maxYear);
  $('#chk-2020').checked = !!f.incl2020;
  setup.countries = new Set((f.countries || []).filter((c) => COUNTRY_NAMES.has(c)));
  if (st.rules) writeRules(st.rules);
}

function initSetup() {
  const years = DATA.songs.map((s) => s.jahr);
  setup.minYear = Math.min(...years);
  setup.maxYear = Math.max(...years);
  for (const id of ['#inp-from', '#inp-to']) { $(id).min = setup.minYear; $(id).max = setup.maxYear; }
  $('#inp-from').value = setup.minYear;
  $('#inp-to').value = setup.maxYear;

  setup.hasPop = DATA.songs.some((s) => s.pop_rang !== null);
  const topnRadio = $('input[name=pool][value=topn]');
  topnRadio.disabled = !setup.hasPop;
  $('#inp-topn').disabled = !setup.hasPop;
  $('#topn-label').classList.toggle('disabled', !setup.hasPop);
  $('#topn-hint').hidden = setup.hasPop;

  $('#convert-opts').innerHTML = BONUS_TARGETS.map((n) =>
    `<label class="chip-radio"><input type="radio" name="r-convert" value="${n}"><span>${n}</span></label>`).join('');
  $('#limit-opts').innerHTML = TIME_LIMITS.map((n) =>
    `<label class="chip-radio"><input type="radio" name="r-limit" value="${n}"><span>${n ? `${n} s` : 'Aus'}</span></label>`).join('');
  writeRules(presetById(DEFAULT_PRESET).rules);
  applySettings(migrateSettings(store.get(KEY_SETTINGS)));
  renderPlayerInputs();
  renderCountryChips();

  const withVideo = DATA.songs.filter(hasVideo).length;
  const hint = $('#noid-hint');
  if (DEV) {
    hint.hidden = false;
    hint.innerHTML = `<b>Dev-Modus aktiv:</b> Lieder ohne YouTube-Video kommen in den Pool und werden ohne Audio gespielt (${withVideo} von ${DATA.songs.length} Liedern haben ein Video).`;
  } else if (!withVideo) {
    hint.hidden = false;
    hint.innerHTML = `<b>Noch keine Lieder mit YouTube-Video.</b> Die Videosuche läuft vermutlich noch. Zum Testen ohne Audio: <a href="?dev=1">Dev-Modus öffnen (?dev=1)</a>.`;
  }

  $('#btn-add-player').onclick = () => { if (setup.names.length < 8) { setup.names.push(`Spieler ${setup.names.length + 1}`); renderPlayerInputs(); updateCount(); } };
  $('#btn-remove-player').onclick = () => { if (setup.names.length > 2) { setup.names.pop(); renderPlayerInputs(); updateCount(); } };
  $('#setup').addEventListener('input', updateCount);
  $('#setup').addEventListener('change', updateCount);
  $('#preset-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.preset'); if (!b) return;
    if (b.dataset.preset === 'custom') {
      $('#advanced').open = true;
      $('#advanced').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else applyPreset(b.dataset.preset);
  });
  $('#inp-topn').addEventListener('focus', () => { if (setup.hasPop) $('input[name=pool][value=topn]').checked = true; updateCount(); });
  $('#country-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const iso = b.dataset.iso;
    setup.countries.has(iso) ? setup.countries.delete(iso) : setup.countries.add(iso);
    renderCountryChips(); updateCount();
  });
  $$('[data-quick]').forEach((b) => b.addEventListener('click', () => {
    const q = b.dataset.quick;
    setup.countries = q === 'alle' ? new Set() : new Set(QUICK_COUNTRIES[q].filter((c) => COUNTRY_NAMES.has(c)));
    if (q !== 'alle' && !setup.countries.size) toast('Keines dieser Länder ist im Datensatz.');
    renderCountryChips(); updateCount();
  }));
  $('#btn-start').onclick = startGame;

  // Fortsetzen anbieten
  const saved = store.get(KEY_STATE);
  if (saved && !saved.finished && Array.isArray(saved.players) && saved.players.length) {
    $('#resume-box').hidden = false;
    const when = saved.savedAt ? new Date(saved.savedAt).toLocaleString('de-DE') : '';
    $('#resume-info').textContent = `${saved.players.map((p) => `${p.name} (${p.timeline.length})`).join(', ')} · gespeichert ${when}`;
    $('#btn-resume').onclick = () => resumeGame(migrateState(saved));
    $('#btn-discard').onclick = () => { store.del(KEY_STATE); $('#resume-box').hidden = true; };
  }
  updateCount();
}

/* ------------------------------------------------------------------ Spielzustand */
const S = (id) => BY_ID.get(id);
const activeP = () => state.players[state.active];
const tlSongs = (p) => p.timeline.map(S).filter(Boolean);
const rules = () => state.settings.rules;
const bonusCards = (p) => (rules().bonus === 'convert' ? Math.floor(p.bonus / rules().convertAt) : 0);
const score = (p) => p.timeline.length + bonusCards(p);
function pool() { return state ? filterPool(DATA.songs, state.settings.filter, DEV) : filterPool(DATA.songs, readFilter(), DEV); }

function draw() {
  const used = new Set(state.used);
  const candidates = pool().filter((s) => !used.has(s.id));
  if (!candidates.length) return null;
  const s = pickRandom(candidates);
  state.used.push(s.id);
  return s;
}

function newTurn(song) {
  const others = shuffle([...COUNTRY_NAMES.keys()].filter((c) => c !== song.land_iso)).slice(0, 3);
  return {
    songId: song.id,
    phase: 'listen',
    gap: null,
    steal: null,
    country: { options: shuffle([song.land_iso, ...others]), guess: null, text: '' },
    place: { neighborId: null, guess: null, free: '', hf: false },
    exact: '',
    artistTip: '',
    titleTip: '',
    heard: 0,
    timeUp: false,
    released: false,
    result: null,
  };
}

function startGame() {
  const names = setup.names.map((n, i) => (n || '').trim() || `Spieler ${i + 1}`);
  const settings = {
    v: SETTINGS_VERSION,
    players: names,
    target: Math.min(30, Math.max(3, parseInt($('#inp-target').value, 10) || 10)),
    filter: readFilter(),
    rules: readRules(),
  };
  store.set(KEY_SETTINGS, settings);
  state = { v: 1, settings, players: names.map((name) => ({ name, timeline: [], tokens: START_TOKENS, bonus: 0 })), active: 0, round: 1, used: [], cur: null, finished: false };
  for (const p of state.players) {
    const s = draw();
    if (s) p.timeline.push(s.id);
  }
  state.active = Math.floor(Math.random() * state.players.length);
  showScreen('game');
  startTurn();
}

function resumeGame(saved) {
  state = saved;
  // Lieder, die es nicht mehr gibt, entfernen
  for (const p of state.players) p.timeline = p.timeline.filter((id) => BY_ID.has(id));
  showScreen('game');
  if (!state.cur || !S(state.cur.songId)) { startTurn(); return; }
  save();
  render();
  loadAudio(false);
}

function startTurn() {
  stealPick = null;
  const song = draw();
  if (!song) { toast('Der Pool ist leer – Spielende!'); endGame(); return; }
  state.cur = newTurn(song);
  save();
  render();
  loadAudio(true);
}

function loadAudio(tryAutoplay) {
  const song = S(state.cur.songId);
  loadAttempt = 1;
  if (!song.youtube_id) { setAudioStatus('idle'); YTP.stop(); return; }
  const userActive = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
  const autoplay = tryAutoplay && userActive && state.cur.phase === 'listen';
  setAudioStatus(autoplay ? 'loading' : 'idle');
  YTP.load(song.youtube_id, song.start_sek || 0, autoplay);
}

function replaceSong(reason) {
  // Lied ersetzen (Fehler/Überspringen): Klau-Token zurück, Rest der Runde neu
  const c = state.cur;
  if (c.steal) state.players[c.steal.p].tokens = Math.min(MAX_TOKENS, state.players[c.steal.p].tokens + 1);
  startTurn();
  if (reason) toast(reason);
}

function setGap(g) {
  const c = state.cur;
  if (c.phase !== 'listen' || c.steal) return;
  if (c.gap !== g) {
    c.gap = g;
    if (rules().place === 'neighbor') { c.place.neighborId = null; c.place.guess = null; }
  }
  save(); render(); scrollToGap(g);
}

function placeNeighbor() {
  const c = state.cur;
  const song = S(c.songId);
  const mine = relRank(song);
  if (c.gap === null || mine === null) return null;
  const tl = tlSongs(activeP());
  const left = c.gap > 0 ? tl[c.gap - 1] : null;
  const right = c.gap < tl.length ? tl[c.gap] : null;
  for (const nb of [left, right]) {
    const r = relRank(nb);
    if (nb && r !== null && r !== mine) return nb;
  }
  return null;
}

function skip() {
  const p = activeP();
  if (state.cur.phase !== 'listen' || p.tokens < 1) return;
  p.tokens -= 1;
  replaceSong(`${p.name} überspringt (−1 Token).`);
}

function eligibleStealers() {
  return state.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== state.active && p.tokens >= 1);
}

function openSteal() {
  const list = eligibleStealers();
  if (!list.length) { toast('Niemand hat ein Token zum Klauen.'); return; }
  $('#steal-players').innerHTML = list.map(({ p, i }) =>
    `<button type="button" class="btn" data-i="${i}">${esc(p.name)} <span class="muted">(${p.tokens} Token)</span></button>`).join('');
  $$('#steal-players button').forEach((b) => b.addEventListener('click', () => {
    stealPick = +b.dataset.i;
    $('#dlg-steal').close();
    render();
  }));
  $('#dlg-steal').showModal();
}

function setSteal(g) {
  const c = state.cur;
  if (stealPick === null || c.phase !== 'listen') return;
  if (g === c.gap) { toast('Bitte eine andere Lücke wählen.'); return; }
  const sp = state.players[stealPick];
  if (sp.tokens < 1) { stealPick = null; render(); return; }
  sp.tokens -= 1;
  c.steal = { p: stealPick, gap: g };
  stealPick = null;
  toast(`${sp.name} klaut (−1 Token).`);
  save(); render();
}

function reveal() {
  const c = state.cur;
  if (c.phase !== 'listen' || c.gap === null) return;
  stealPick = null;
  const p = activeP();
  const song = S(c.songId);
  const tl = tlSongs(p);
  const correct = fitsGap(tl, c.gap, song.jahr);
  const stealOk = c.steal ? fitsGap(tl, c.steal.gap, song.jahr) : null;
  const R = rules();
  let countryOk = null;
  if (R.country === 'choice' && c.country.guess) countryOk = c.country.guess === song.land_iso;
  if (R.country === 'free' && c.country.text.trim()) countryOk = matchCountry(c.country.text, COUNTRY_NAMES) === song.land_iso;
  let placeOk = null;
  let placePts = 0;
  if (R.place === 'neighbor' && c.place.guess && c.place.neighborId) {
    const nb = S(c.place.neighborId);
    const better = relRank(song) < relRank(nb);
    placeOk = (c.place.guess === 'besser') === better;
    placePts = placeOk ? 1 : 0;
  }
  if (R.place === 'free' && relRank(song) !== null && (c.place.hf || c.place.free !== '')) {
    placePts = freePlacePoints(song, c.place);
    placeOk = placePts > 0;
  }
  const exactYear = parseInt(c.exact, 10);
  const exactOk = R.exact > 0 && !isNaN(exactYear) ? correct && exactYear === song.jahr : null;
  const artistState = R.artist ? matchText(c.artistTip, song.interpret) : null;
  const titleState = R.title ? matchText(c.titleTip, song.titel) : null;
  const pts = (countryOk ? 1 : 0) + placePts + (exactOk ? R.exact : 0)
    + (artistState === 'ok' ? 1 : 0) + (titleState === 'ok' ? 1 : 0);
  const gain = applyBonus(p, pts);
  const tips = guessFields(c);
  const guess = {};
  if (!isNaN(exactYear) && R.exact > 0) {
    const off = Math.abs(exactYear - song.jahr);
    guess.year = { tip: tips.year, state: off === 0 ? (correct ? 'ok' : 'near') : off <= 2 ? 'near' : 'bad' };
  }
  if (countryOk !== null) guess.land = { tip: tips.land, iso: tips.landIso, state: countryOk ? 'ok' : 'bad' };
  if (artistState) guess.artist = { tip: tips.artist, state: artistState };
  if (titleState) guess.title = { tip: tips.title, state: titleState };
  if (placeOk !== null) {
    const near = R.place === 'free' && !c.place.hf && placePts === 1;
    guess.place = { tip: tips.place, state: near ? 'near' : placeOk ? 'ok' : 'bad' };
  }

  let stolenBy = null;
  if (correct) {
    p.timeline.splice(c.gap, 0, song.id);
  } else if (c.steal && stealOk) {
    const sp = state.players[c.steal.p];
    const stl = tlSongs(sp);
    sp.timeline.splice(sortedIndex(stl, song.jahr), 0, song.id);
    stolenBy = c.steal.p;
  }
  c.result = { correct, stealOk, countryOk, placeOk, placePts, exactOk, artistState, titleState, guess, pts, gain, stolenBy };
  c.phase = 'reveal';
  save(); render();
  if (correct) scrollToCard(song.id);
}

/** Bonuspunkte verbuchen. Gibt zurück, was tatsächlich dazukam. */
function applyBonus(p, pts) {
  const R = rules();
  if (!pts) return { tokens: 0, cards: 0 };
  if (R.bonus === 'tokens') {
    const before = p.tokens;
    p.tokens = Math.min(MAX_TOKENS, p.tokens + pts);
    return { tokens: p.tokens - before, cards: 0 };
  }
  const before = bonusCards(p);
  p.bonus += pts;
  return { tokens: 0, cards: bonusCards(p) - before };
}

function nextTurn() {
  const target = state.settings.target;
  if (state.players.some((p) => score(p) >= target)) { endGame(); return; }
  state.active = (state.active + 1) % state.players.length;
  state.round += state.active === 0 ? 1 : 0;
  startTurn();
}

function endGame() {
  YTP.stop();
  state.finished = true;
  save();
  store.del(KEY_STATE);
  const target = state.settings.target;
  const ranking = state.players.map((p, i) => ({ ...p, i, sc: score(p), bc: bonusCards(p) }))
    .sort((a, b) => b.sc - a.sc || b.bonus - a.bonus || b.tokens - a.tokens);
  const top = ranking[0];
  const winners = ranking.filter((r) => r.sc === top.sc && r.bonus === top.bonus && r.tokens === top.tokens);
  $('#end-title').textContent = winners.length > 1
    ? `Unentschieden: ${winners.map((w) => w.name).join(' & ')}`
    : `${top.name} gewinnt${top.sc >= target ? '!' : ' (meiste Karten)'}`;
  $('#end-ranking').innerHTML = `<ol class="ranking">${ranking.map((r) =>
    `<li><span class="r-name">${esc(r.name)}</span><span class="r-cards">${r.timeline.length} Karten${r.bc ? ` + ${r.bc} Bonuskarte${r.bc > 1 ? 'n' : ''}` : ''}</span>${rules().bonus === 'tokens' ? '' : `<span class="r-star">★ ${r.bonus}</span>`}<span class="tokens">${tokensHTML(r.tokens)}</span>
      <button class="btn small ghost" data-tl="${r.i}">Zeitleiste</button></li>`).join('')}</ol>`;
  $$('#end-ranking [data-tl]').forEach((b) => b.addEventListener('click', () => showTimeline(+b.dataset.tl)));
  showScreen('end');
}

/* ------------------------------------------------------------------ Rendern */
function showScreen(name) {
  for (const s of ['setup', 'game', 'end']) $(`#screen-${s}`).hidden = s !== name;
  $('#btn-menu').hidden = name !== 'game';
  document.body.classList.toggle('on-setup', name === 'setup');
  window.scrollTo(0, 0);
}

const tokensHTML = (n) => `<span class="tok-dots" title="${n} Token">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(Math.max(0, MAX_TOKENS - n))}</span>`;

/** Nur die eigenen Eingaben, egal ob richtig oder falsch. */
function guessFields(c) {
  const R = rules();
  const f = {};
  if (R.exact > 0 && String(c.exact).trim()) f.year = String(c.exact).trim();
  if (R.country === 'choice' && c.country.guess) {
    f.land = COUNTRY_NAMES.get(c.country.guess) || c.country.guess;
    f.landIso = c.country.guess;
  }
  if (R.country === 'free' && c.country.text.trim()) {
    f.land = c.country.text.trim();
    f.landIso = matchCountry(f.land, COUNTRY_NAMES);
  }
  if (R.artist && c.artistTip.trim()) f.artist = c.artistTip.trim();
  if (R.title && c.titleTip.trim()) f.title = c.titleTip.trim();
  if (R.place === 'free') {
    if (c.place.hf) f.place = 'Im Halbfinale raus';
    else if (String(c.place.free).trim()) f.place = `Platz ${String(c.place.free).trim()}`;
  }
  if (R.place === 'neighbor' && c.place.guess && c.place.neighborId) {
    const nb = S(c.place.neighborId);
    f.place = `${c.place.guess === 'besser' ? '▲ Besser' : '▼ Schlechter'} als ${nb ? nb.interpret : 'Nachbar'}`;
  }
  return f;
}

/** Eigene Eingaben im Aufbau einer echten Karte. states färbt beim Auflösen die Schrift. */
function tipHTML(f, states = {}) {
  const row = (key, cls, inner) => (f[key] ? `<div class="${cls} ${states[key] ? `g-${states[key]}` : ''}">${inner}</div>` : '');
  return row('year', 'c-year', esc(f.year))
    + row('land', 'c-land', `${f.landIso ? flagHTML(f.landIso) : ''}<span>${esc(f.land)}</span>`)
    + row('artist', 'c-artist', esc(f.artist))
    + row('title', 'c-title', esc(f.title))
    + row('place', 'c-place', esc(f.place));
}

/** Aktualisiert nur die Vorschau, damit das Eingabefeld beim Tippen den Fokus behält. */
function updateGuessPreview() {
  const preview = tipHTML(guessFields(state.cur));
  for (const card of $$('#timeline .card.mystery, #deck .card.mystery')) {
    $('.guess-preview', card).innerHTML = preview;
    card.classList.toggle('tip', !!preview);
  }
}

/** Die eigene Karte beim Auflösen: dasselbe Design wie die Vorschau, nur die Schriftfarbe zeigt die Bewertung. */
function ownCardHTML(g) {
  const f = {};
  const states = {};
  for (const k of ['year', 'land', 'artist', 'title', 'place']) {
    if (g[k]) { f[k] = g[k].tip; states[k] = g[k].state; }
  }
  if (g.land) f.landIso = g.land.iso;
  const html = tipHTML(f, states);
  return `<div class="card big tip own ${html ? '' : 'empty'}">${html || '<span class="m-q">?</span>'}</div>`;
}

function youtubeLink(id) {
  const https = `https://www.youtube.com/watch?v=${id}`;
  if (/android/i.test(navigator.userAgent)) {
    return { href: `intent://www.youtube.com/watch?v=${id}#Intent;scheme=https;package=com.google.android.youtube;S.browser_fallback_url=${encodeURIComponent(https)};end`, target: '' };
  }
  return { href: https, target: ' target="_blank" rel="noopener"' };
}

function starHTML(p) {
  const R = rules();
  if (R.bonus === 'count') return `<span class="s-star">★ <b>${p.bonus}</b></span>`;
  if (R.bonus === 'convert') return `<span class="s-star">★ <b>${p.bonus % R.convertAt}</b>/${R.convertAt}</span>`;
  return '';
}

function render() {
  if (!state || !state.cur) return;
  const c = state.cur;
  const p = activeP();
  const target = state.settings.target;

  $('#scoreboard').innerHTML = state.players.map((pl, i) =>
    `<button class="score ${i === state.active ? 'active' : ''}" data-i="${i}">
      <span class="s-name">${esc(pl.name)}</span>
      <span class="s-cards"><b>${score(pl)}</b>/${target}${bonusCards(pl) ? ` <small>(${bonusCards(pl)} Bonus)</small>` : ''}</span>
      ${starHTML(pl)}
      ${tokensHTML(pl.tokens)}
    </button>`).join('');
  $$('#scoreboard .score').forEach((b) => b.addEventListener('click', () => showTimeline(+b.dataset.i)));

  $('#turn-banner').innerHTML = `<span class="tb-name">${esc(p.name)}</span> ist dran <span class="muted small">· Runde ${state.round}${DEV ? ' · Dev-Modus' : ''}</span>`;

  const sb = $('#steal-banner');
  if (stealPick !== null) {
    sb.hidden = false;
    sb.innerHTML = `<span><b>${esc(state.players[stealPick].name)}</b>: tippe eine andere Lücke in der Zeitleiste von ${esc(p.name)}.</span><button class="btn small ghost" id="btn-steal-cancel">Abbrechen</button>`;
    $('#btn-steal-cancel').onclick = () => { stealPick = null; render(); };
  } else if (c.steal && c.phase === 'listen') {
    sb.hidden = false;
    sb.innerHTML = `<span><b>${esc(state.players[c.steal.p].name)}</b> klaut und setzt auf eine andere Lücke.</span>`;
  } else sb.hidden = true;

  renderTimeline();
  renderDeck();
  renderControls();
  renderBonus();
  renderReveal();
}

function renderTimeline() {
  const c = state.cur;
  const el = $('#timeline');
  const scroll = el.scrollLeft;
  const tl = tlSongs(activeP());
  const song = S(c.songId);
  let html = '';
  if (c.phase === 'reveal') {
    const r = c.result;
    tl.forEach((s, i) => {
      if (!r.correct && i === c.gap) html += cardHTML(song, 'wrong new');
      html += cardHTML(s, s.id === song.id ? 'correct new' : '');
    });
    if (!r.correct && c.gap === tl.length) html += cardHTML(song, 'wrong new');
  } else {
    for (let i = 0; i <= tl.length; i++) {
      const placed = c.gap === i;
      const stolen = c.steal && c.steal.gap === i;
      const cls = ['gap', placed ? 'placed' : '', stolen ? 'stolen' : '', stealPick !== null ? 'steal-mode' : ''].join(' ');
      const label = stolen ? `<span class="gap-badge">${esc(state.players[c.steal.p].name)}</span>` : '';
      html += `<div class="${cls}" data-gap="${i}" role="button" aria-label="Lücke ${i + 1}">${placed ? mysteryHTML(c.steal ? 'locked' : '') : '<span class="gap-plus">+</span>'}${label}</div>`;
      if (i < tl.length) html += cardHTML(tl[i]);
    }
  }
  el.innerHTML = html;
  el.scrollLeft = scroll;
  $$('.gap', el).forEach((g) => g.addEventListener('click', () => {
    const i = +g.dataset.gap;
    if (stealPick !== null) setSteal(i); else setGap(i);
  }));
  $$('[data-drag]', el).forEach(bindDrag);
}

function renderDeck() {
  const c = state.cur;
  const d = $('#deck');
  if (c.phase !== 'listen') { d.innerHTML = ''; return; }
  const song = S(c.songId);
  const audioNote = song.youtube_id ? '' : '<div class="muted small">Kein Video – Dev-Modus ohne Audio</div>';
  if (c.gap === null) {
    d.innerHTML = `<div class="deck-slot">${mysteryHTML('pulse')}</div>
      <div class="deck-hint">Ziehe die Karte an die richtige Stelle deiner Zeitleiste – oder tippe auf eine Lücke <b>+</b>.${audioNote}</div>`;
    $$('[data-drag]', d).forEach(bindDrag);
  } else {
    d.innerHTML = `<div class="deck-hint">${c.steal ? 'Karte liegt fest (es wird geklaut).' : 'Karte liegt. Du kannst sie noch verschieben.'}${audioNote}</div>`;
  }
}

function renderControls() {
  const c = state.cur;
  const el = $('#controls');
  if (c.phase !== 'listen') { el.innerHTML = ''; return; }
  const p = activeP();
  const song = S(c.songId);
  const hasAudio = !!song.youtube_id;
  const R = rules();
  const canSteal = c.gap !== null && !c.steal && stealPick === null && eligibleStealers().length > 0;
  const limited = R.timeLimit > 0 && !c.released;
  const limitBar = limited && hasAudio
    ? `<div class="limit ${c.timeUp ? 'up' : ''}"><div class="limit-bar"><i id="limit-fill" style="width:${limitPercent(c)}%"></i></div><span id="limit-text">${limitText(c)}</span></div>`
    : '';
  el.innerHTML = `
    <div class="row player-row">
      <button class="btn play big" id="btn-play" ${hasAudio ? '' : 'disabled'}>${playLabel()}</button>
      <button class="btn" id="btn-restart" ${hasAudio ? '' : 'disabled'}>↺ Neu ab Start</button>
    </div>
    ${limitBar}
    <div class="stall" id="stall" ${c.stalled ? '' : 'hidden'}>
      <span>Das Lied lädt gerade nicht. Vielleicht läuft Werbung oder die Verbindung hängt.</span>
      <button class="btn small" id="btn-other-song">Anderes Lied (gratis)</button>
    </div>
    <div class="row action-row">
      <button class="btn ghost" id="btn-skip" ${p.tokens >= 1 ? '' : 'disabled'}>Überspringen <small>(1 Token)</small></button>
      ${R.steal ? `<button class="btn ghost" id="btn-steal" ${canSteal ? '' : 'disabled'}>Klauen…</button>` : ''}
      ${R.exact > 0 ? `<label class="exact"><span>Genaues Jahr <small>(+${R.exact} Bonus)</small></span><input type="number" id="inp-exact" inputmode="numeric" min="1956" max="2100" placeholder="optional" enterkeyhint="done" value="${esc(c.exact)}"></label>` : ''}
      <button class="btn primary big" id="btn-reveal" ${c.gap !== null ? '' : 'disabled'}>Auflösen</button>
    </div>`;
  $('#btn-play').onclick = () => {
    if (!YTP.isReady()) { toast('Player lädt noch …'); return; }
    renewLimit();
    if (audioStatus === 'idle' || audioStatus === 'paused') setAudioStatus('loading');
    YTP.toggle();
  };
  $('#btn-restart').onclick = () => {
    if (!YTP.isReady()) { toast('Player lädt noch …'); return; }
    renewLimit();
    setAudioStatus('loading');
    YTP.restart();
  };
  $('#btn-skip').onclick = skip;
  $('#btn-other-song').onclick = () => replaceSong('Neues Lied.');
  if (R.steal) $('#btn-steal').onclick = openSteal;
  if (R.exact > 0) $('#inp-exact').addEventListener('input', (e) => { c.exact = e.target.value; save(); updateGuessPreview(); });
  $('#btn-reveal').onclick = reveal;
}

function bonusHint() {
  return rules().bonus === 'tokens' ? '+1 Token' : '+1 Bonus';
}

function countryBoxHTML(c, R) {
  if (R.country === 'choice') {
    return `<div class="bonus-box"><div class="bonus-q">Land raten <small class="muted">(${bonusHint()})</small></div><div class="opts">${
      c.country.options.map((iso) => `<button class="opt ${c.country.guess === iso ? 'sel' : ''}" data-country="${iso}" ${c.country.guess ? 'disabled' : ''}>${flagHTML(iso)}<span>${esc(COUNTRY_NAMES.get(iso) || iso)}</span></button>`).join('')
    }</div></div>`;
  }
  const names = [...COUNTRY_NAMES.values()].sort((x, y) => x.localeCompare(y, 'de'));
  return `<div class="bonus-box"><div class="bonus-q">Land raten <small class="muted">(${bonusHint()})</small></div>
    <input type="text" class="free-input" id="inp-country" list="country-list" autocomplete="off" enterkeyhint="done" placeholder="Land eingeben" value="${esc(c.country.text)}">
    <datalist id="country-list">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist></div>`;
}

function placeBoxHTML(c, R) {
  const song = S(c.songId);
  if (R.place === 'free') {
    const inner = relRank(song) === null
      ? '<div class="muted small">Für dieses Lied gibt es keine Platzierung – entfällt.</div>'
      : `<div class="free-place">
          <input type="number" class="free-input" id="inp-place" inputmode="numeric" min="1" max="40" placeholder="Platz im Finale" enterkeyhint="done" value="${esc(c.place.free)}" ${c.place.hf ? 'disabled' : ''}>
          <button type="button" class="opt ${c.place.hf ? 'sel' : ''}" id="btn-hf">Im Halbfinale raus</button>
        </div>`;
    return `<div class="bonus-box"><div class="bonus-q">Platzierung <small class="muted">(exakt +2, bis 2 daneben +1)</small></div>${inner}</div>`;
  }
  let inner;
  if (c.gap === null) inner = '<div class="muted small">Lege zuerst die Karte ab.</div>';
  else if (relRank(song) === null) inner = '<div class="muted small">Für dieses Lied gibt es keine Platzierung – entfällt.</div>';
  else {
    const nb = placeNeighbor();
    if (!nb) inner = '<div class="muted small">Keine vergleichbare Nachbarkarte – entfällt.</div>';
    else {
      if (c.place.neighborId !== nb.id) { c.place.neighborId = nb.id; c.place.guess = null; }
      const g = c.place.guess;
      inner = `<div class="small">Besser oder schlechter platziert als <b>${esc(nb.interpret)}</b> (${nb.jahr}, ${esc(placementText(nb))})?</div>
        <div class="opts two">
          <button class="opt ${g === 'besser' ? 'sel' : ''}" data-place="besser" ${g ? 'disabled' : ''}>▲ Besser</button>
          <button class="opt ${g === 'schlechter' ? 'sel' : ''}" data-place="schlechter" ${g ? 'disabled' : ''}>▼ Schlechter</button>
        </div>`;
    }
  }
  return `<div class="bonus-box"><div class="bonus-q">Platzierung schätzen <small class="muted">(${bonusHint()})</small></div>${inner}</div>`;
}

function songBoxHTML(c, R) {
  const field = (id, label, value) => `<input type="text" class="free-input" id="${id}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="${label}" aria-label="${label}" value="${esc(value)}">`;
  const parts = [R.artist ? 'Interpret' : '', R.title ? 'Titel' : ''].filter(Boolean).join(' und ');
  return `<div class="bonus-box"><div class="bonus-q">${parts} raten <small class="muted">(je ${bonusHint()})</small></div>
    <div class="col song-fields">${R.artist ? field('inp-artist', 'Interpret', c.artistTip) : ''}${R.title ? field('inp-title', 'Titel', c.titleTip) : ''}</div></div>`;
}

function renderBonus() {
  const c = state.cur;
  const el = $('#bonus');
  const R = rules();
  const hasSong = R.artist || R.title;
  if (c.phase !== 'listen' || (R.country === 'off' && R.place === 'off' && !hasSong)) { el.innerHTML = ''; return; }
  el.innerHTML = (hasSong ? songBoxHTML(c, R) : '') + (R.country !== 'off' ? countryBoxHTML(c, R) : '') + (R.place !== 'off' ? placeBoxHTML(c, R) : '');
  const changed = () => { save(); updateGuessPreview(); };
  $$('[data-country]', el).forEach((b) => b.addEventListener('click', () => { c.country.guess = b.dataset.country; renderBonus(); changed(); }));
  $$('[data-place]', el).forEach((b) => b.addEventListener('click', () => { c.place.guess = b.dataset.place; renderBonus(); changed(); }));
  const ci = $('#inp-country', el);
  if (ci) ci.addEventListener('input', () => { c.country.text = ci.value; changed(); });
  const pi = $('#inp-place', el);
  if (pi) pi.addEventListener('input', () => { c.place.free = pi.value; changed(); });
  const ai = $('#inp-artist', el);
  if (ai) ai.addEventListener('input', () => { c.artistTip = ai.value; changed(); });
  const ti = $('#inp-title', el);
  if (ti) ti.addEventListener('input', () => { c.titleTip = ti.value; changed(); });
  const hf = $('#btn-hf', el);
  if (hf) hf.addEventListener('click', () => { c.place.hf = !c.place.hf; if (c.place.hf) c.place.free = ''; renderBonus(); changed(); });
}

function renderReveal() {
  const c = state.cur;
  const el = $('#reveal');
  if (c.phase !== 'reveal') { el.hidden = true; el.innerHTML = ''; return; }
  const r = c.result;
  const song = S(c.songId);
  const p = activeP();
  const lines = [];
  lines.push(r.correct ? `<div class="verdict ok">Richtig! ${esc(p.name)} behält die Karte.</div>` : `<div class="verdict bad">Leider falsch – die Karte fliegt raus.</div>`);
  if (c.steal) {
    const sp = state.players[c.steal.p];
    if (r.stolenBy !== null) lines.push(`<div class="line ok">🦝 ${esc(sp.name)} hat richtig geklaut und bekommt die Karte!</div>`);
    else lines.push(`<div class="line">${esc(sp.name)} hat beim Klauen ${r.stealOk ? 'auch richtig gelegen – aber der aktive Spieler war schneller.' : 'falsch gelegen.'}</div>`);
  }
  const R = rules();
  const textLine = (label, tip, st) => {
    if (!st) return;
    const word = { ok: 'richtig · +1', near: 'teilweise richtig', bad: 'falsch' }[st];
    lines.push(`<div class="line ${st}">${label} („${esc(tip.trim())}“): ${word}</div>`);
  };
  textLine('Interpret', c.artistTip, r.artistState);
  textLine('Titel', c.titleTip, r.titleState);
  if (r.countryOk !== null) {
    const typed = R.country === 'free' ? ` („${esc(c.country.text.trim())}“)` : '';
    lines.push(`<div class="line ${r.countryOk ? 'ok' : 'bad'}">Land raten${typed}: ${r.countryOk ? 'richtig' : `falsch, es war ${esc(song.land)}`}</div>`);
  }
  if (r.placeOk !== null) {
    const tip = R.place === 'free' ? ` (Tipp: ${c.place.hf ? 'Halbfinal-Aus' : `Platz ${esc(c.place.free)}`})` : '';
    const st = r.guess && r.guess.place ? r.guess.place.state : (r.placeOk ? 'ok' : 'bad');
    const word = { ok: 'richtig', near: 'fast richtig', bad: 'falsch' }[st];
    lines.push(`<div class="line ${st}">Platzierung${tip}: ${word}${r.placePts ? ` · +${r.placePts}` : ''}</div>`);
  }
  if (r.exactOk !== null) {
    const exactHit = parseInt(c.exact, 10) === song.jahr;
    const word = r.exactOk ? `Punktlandung! +${R.exact}` : exactHit ? 'stimmt, aber die Karte liegt falsch – kein Bonus' : Math.abs(parseInt(c.exact, 10) - song.jahr) <= 2 ? 'knapp daneben' : 'daneben';
    const st = r.exactOk ? 'ok' : r.guess && r.guess.year ? r.guess.year.state : 'bad';
    lines.push(`<div class="line ${st}">Genaues Jahr (Tipp: ${esc(c.exact)}): ${word}</div>`);
  }
  if (r.gain.tokens) lines.push(`<div class="line ok">+${r.gain.tokens} Token für ${esc(p.name)}</div>`);
  else if (r.pts && R.bonus !== 'tokens') lines.push(`<div class="line ok">★ +${r.pts} Bonus für ${esc(p.name)}</div>`);
  if (r.gain.cards) lines.push(`<div class="line ok big-line">+${r.gain.cards} Bonuskarte für ${esc(p.name)}!</div>`);
  const someoneWon = state.players.some((pl) => score(pl) >= state.settings.target);
  const nextName = state.players[(state.active + 1) % state.players.length].name;
  const hasOwn = r.guess && (R.exact > 0 || R.country !== 'off' || R.place !== 'off' || R.artist || R.title);
  const yt = song.youtube_id ? youtubeLink(song.youtube_id) : null;
  el.hidden = false;
  el.innerHTML = `<div class="reveal-card ${hasOwn ? '' : 'solo'}">${hasOwn ? ownCardHTML(r.guess) : ''}${cardHTML(song, `big ${r.correct ? 'correct' : 'wrong'}`)}</div>
    <div class="reveal-info">${lines.join('')}
      ${yt ? `<div class="row"><a class="btn yt" id="btn-yt" href="${esc(yt.href)}"${yt.target}>▶ Ganzes Video auf YouTube</a></div>` : ''}
      <div class="row"><button class="btn primary big" id="btn-next">${someoneWon ? 'Zur Siegerehrung' : `Weiter: ${esc(nextName)}`}</button></div>
    </div>`;
  $('#btn-next').onclick = nextTurn;
  if (yt) $('#btn-yt').addEventListener('click', () => YTP.pause());
}

function showTimeline(i) {
  const p = state.players[i];
  $('#tl-title').textContent = `Zeitleiste von ${p.name} (${p.timeline.length} Karten)`;
  $('#tl-view').innerHTML = tlSongs(p).map((s) => cardHTML(s)).join('') || '<div class="muted">Noch keine Karten.</div>';
  $('#dlg-timeline').showModal();
}

function scrollToGap(g) {
  const el = $(`#timeline .gap[data-gap="${g}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}
function scrollToCard(id) {
  const el = $(`#timeline .card.new[data-id="${CSS.escape(id)}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

/* ------------------------------------------------------------------ Drag & Drop (Pointer-Events, Touch-tauglich) */
let drag = null;
const DRAG_BAND = 140; // so weit darf der Finger über/unter der Zeitleiste sein

function bindDrag(card) {
  card.addEventListener('pointerdown', onDragStart);
}

function onDragStart(e) {
  const c = state.cur;
  if (c.phase !== 'listen' || c.steal || stealPick !== null) return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  const src = e.currentTarget;
  const rect = src.getBoundingClientRect();
  drag = { src, startX: e.clientX, startY: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height, ghost: null, gap: null, moved: false, x: e.clientX, y: e.clientY, raf: null };
  window.addEventListener('pointermove', onDragMove, { passive: false });
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragCancel);
}

function onDragMove(e) {
  if (!drag) return;
  e.preventDefault();
  drag.x = e.clientX; drag.y = e.clientY;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
    drag.moved = true;
    const g = drag.src.cloneNode(true);
    g.classList.add('ghost');
    g.classList.remove('pulse');
    g.style.width = `${drag.w}px`;
    g.style.height = `${drag.h}px`;
    document.body.appendChild(g);
    drag.ghost = g;
    drag.src.classList.add('drag-src');
    document.body.classList.add('dragging');
    drag.raf = requestAnimationFrame(autoScroll);
  }
  drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px) rotate(-4deg)`;
  updateDropTarget();
}

function updateDropTarget() {
  const tlEl = $('#timeline');
  const r = tlEl.getBoundingClientRect();
  let best = null;
  if (drag.y > r.top - DRAG_BAND && drag.y < r.bottom + DRAG_BAND) {
    let bestD = Infinity;
    for (const g of $$('.gap', tlEl)) {
      const gr = g.getBoundingClientRect();
      if (gr.right < r.left - 20 || gr.left > r.right + 20) continue; // nicht sichtbar
      const d = Math.abs(drag.x - (gr.left + gr.width / 2));
      if (d < bestD) { bestD = d; best = g; }
    }
  }
  $$('.gap.hover', tlEl).forEach((g) => g !== best && g.classList.remove('hover'));
  if (best) best.classList.add('hover');
  drag.gap = best ? +best.dataset.gap : null;
}

function autoScroll() {
  if (!drag) return;
  const tlEl = $('#timeline');
  const r = tlEl.getBoundingClientRect();
  if (drag.y > r.top - DRAG_BAND && drag.y < r.bottom + DRAG_BAND) {
    const edge = Math.min(90, r.width / 4);
    const speed = (depth) => 3 + 9 * Math.min(1, depth / edge);
    if (drag.x < r.left + edge) tlEl.scrollLeft -= speed(r.left + edge - drag.x);
    else if (drag.x > r.right - edge) tlEl.scrollLeft += speed(drag.x - (r.right - edge));
    updateDropTarget();
  }
  drag.raf = requestAnimationFrame(autoScroll);
}

function cleanupDrag() {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragCancel);
  if (drag) {
    if (drag.raf) cancelAnimationFrame(drag.raf);
    if (drag.ghost) drag.ghost.remove();
    drag.src.classList.remove('drag-src');
  }
  document.body.classList.remove('dragging');
  $$('#timeline .gap.hover').forEach((g) => g.classList.remove('hover'));
}

function onDragEnd() {
  const d = drag;
  cleanupDrag();
  drag = null;
  if (d && d.moved && d.gap !== null) setGap(d.gap);
  else if (d && !d.moved && state.cur.gap === null) toast('Ziehe die Karte in die Zeitleiste oder tippe auf eine Lücke.');
}
function onDragCancel() { cleanupDrag(); drag = null; }

/* ------------------------------------------------------------------ Zeitlimit */
const limitOf = () => (state ? rules().timeLimit : 0);
const limitActive = (c) => limitOf() > 0 && c && c.phase === 'listen' && !c.released;
const limitPercent = (c) => Math.max(0, 100 - (c.heard / limitOf()) * 100);
const limitText = (c) => (c.timeUp ? '⏱ Zeit um' : `⏱ ${Math.ceil(Math.max(0, limitOf() - c.heard))} s`);

function playLabel() {
  const c = state && state.cur;
  if (c && limitActive(c) && c.timeUp && audioStatus !== 'playing') return `▶ Weitere ${limitOf()} s hören`;
  if (audioStatus === 'loading') return `<span class="spin"></span> Lädt …${loadAttempt > 1 ? ` <small>(Versuch ${loadAttempt})</small>` : ''}`;
  if (audioStatus === 'playing') return '<span class="eq"><i></i><i></i><i></i></span> Läuft · Pause';
  return '▶ Abspielen';
}

function setAudioStatus(st) {
  audioStatus = st;
  const b = $('#btn-play');
  if (b) b.innerHTML = playLabel();
}

/** Nach Ablauf startet ein Klick auf Abspielen ein neues Zeitfenster, beliebig oft. */
function renewLimit() {
  const c = state.cur;
  if (limitActive(c) && c.timeUp) { c.timeUp = false; c.heard = 0; save(); renderControls(); }
}

let limitLast = 0;
function limitTick() {
  const now = Date.now();
  const dt = (now - limitLast) / 1000;
  limitLast = now;
  const c = state && state.cur;
  if (!limitActive(c) || c.timeUp) return;
  if (YTP.state() !== YTP.State.PLAYING) return;
  c.heard += dt;
  if (c.heard >= limitOf()) {
    c.heard = limitOf();
    c.timeUp = true;
    YTP.pause();
    save();
    const box = $('.limit');
    if (box) box.classList.add('up');
    const btn = $('#btn-play');
    if (btn) btn.innerHTML = playLabel();
  }
  const fill = $('#limit-fill');
  if (fill) { fill.style.width = `${limitPercent(c)}%`; $('#limit-text').textContent = limitText(c); }
}

/** Das Lied hängt: nichts automatisch überspringen, die Spieler entscheiden. */
function handleStall(st, cur) {
  if (!state || !state.cur || state.cur.phase !== 'listen') return;
  const song = S(state.cur.songId);
  if (!song || !cur || cur.videoId !== song.youtube_id) return;
  logError(song, `timeout (Status ${st})`);
  state.cur.stalled = true;
  save();
  const box = $('#stall');
  if (box) box.hidden = false;
}

/* ------------------------------------------------------------------ Player-Ereignisse */
function initAudio() {
  if (!DATA.songs.some((s) => s.youtube_id)) return; // nichts abzuspielen
  YTP.initPlayer({
    onState(st) {
      if (st === YTP.State.PLAYING) setAudioStatus('playing');
      else if (st === YTP.State.BUFFERING) setAudioStatus('loading');
      else if (st === YTP.State.PAUSED) setAudioStatus('paused');
      else if (st === YTP.State.ENDED || st === YTP.State.CUED) setAudioStatus('idle');
      if (st === YTP.State.PLAYING && state && state.cur && state.cur.stalled) {
        state.cur.stalled = false;
        save();
        const box = $('#stall');
        if (box) box.hidden = true;
      }
    },
    onError(code, cur) {
      if (!state || !state.cur) return;
      const song = S(state.cur.songId);
      if (!song || !cur || cur.videoId !== song.youtube_id) return;
      logError(song, code);
      console.warn('YouTube-Fehler', code, song.id, song.youtube_id);
      if (state.cur.phase === 'listen') replaceSong(`Video nicht abspielbar (Fehler ${code}) – neues Lied.`);
    },
    onStalled: handleStall,
    onRetry(attempt) { loadAttempt = attempt; setAudioStatus('loading'); },
    onBlocked() { setAudioStatus('idle'); toast('Tippe auf „▶ Abspielen“, um das Lied zu starten.'); },
    onApiFail() { toast('YouTube-Player konnte nicht geladen werden (offline?).', 5000); },
  });
}

/* ------------------------------------------------------------------ Info-Dialog */
function openInfo() {
  const withVideo = DATA.songs.filter(hasVideo).length;
  const years = DATA.songs.map((s) => s.jahr);
  $('#info-data').innerHTML = `
    <div>Datenquelle: <b>${esc(DATA.file)}</b>${DATA.generiert ? ` (erzeugt ${esc(DATA.generiert)})` : ''}</div>
    <div>${DATA.songs.length} Beiträge (${Math.min(...years)}–${Math.max(...years)}), davon ${withVideo} mit abspielbarem Video, ${DATA.songs.filter(isCancelled).length} aus 2020.</div>
    <div>Popularitätsrang: ${DATA.songs.some((s) => s.pop_rang !== null) ? 'vorhanden' : 'noch nicht vorhanden'}</div>
    <div>Dev-Modus: ${DEV ? 'an' : 'aus'} <span class="muted">(URL-Parameter ?dev=1)</span></div>`;
  renderErrors();
  $('#dlg-info').showModal();
}
function renderErrors() {
  const list = readErrors();
  $('#err-count').textContent = `(${list.length})`;
  $('#err-list').innerHTML = list.length
    ? `<table><tr><th>Zeit</th><th>ID</th><th>YouTube</th><th>Code</th></tr>${list.slice().reverse().map((e) =>
      `<tr><td>${esc(new Date(e.zeit).toLocaleString('de-DE'))}</td><td>${esc(e.id)}</td><td>${esc(e.youtube_id)}</td><td>${esc(e.code)}</td></tr>`).join('')}</table>`
    : '<div class="muted">Keine Fehler protokolliert.</div>';
}

/* ------------------------------------------------------------------ Start */
async function main() {
  // Enter schließt nur die Tastatur, löst nie etwas aus
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Enter' && t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'number')) {
      e.preventDefault();
      t.blur();
    }
  });
  $('#btn-info').onclick = openInfo;
  $('#btn-clear-errors').onclick = () => { store.del(KEY_ERRORS); renderErrors(); };
  $('#btn-menu').onclick = () => $('#dlg-menu').showModal();
  $('#btn-end-game').onclick = () => { $('#dlg-menu').close(); endGame(); };
  $('#btn-abort-game').onclick = () => {
    $('#dlg-menu').close();
    if (!confirm('Spiel wirklich abbrechen? Der Spielstand wird gelöscht.')) return;
    YTP.stop(); store.del(KEY_STATE); state = null; location.reload();
  };
  $('#btn-new-game').onclick = () => { state = null; location.reload(); };

  try {
    DATA = await loadSongs();
  } catch (e) {
    $('#loading').textContent = e.message;
    return;
  }
  BY_ID = new Map(DATA.songs.map((s) => [s.id, s]));
  COUNTRY_NAMES = new Map();
  for (const s of DATA.songs) if (s.land_iso && !COUNTRY_NAMES.has(s.land_iso)) COUNTRY_NAMES.set(s.land_iso, s.land || s.land_iso);
  $('#loading').hidden = true;
  $('#setup').hidden = false;
  initSetup();
  initAudio();
  limitLast = Date.now();
  setInterval(limitTick, 250);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker:', e));
  }
}

// Für Tests/Inspektion
window.ESC = {
  get state() { return state; },
  get data() { return DATA; },
  pool,
  song: S,
  draw: () => state && draw(),
  setGap: (g) => setGap(g),
  reveal: () => reveal(),
  next: () => nextTurn(),
  skip: () => skip(),
  score: (p) => score(p),
  stall: (st, cur) => handleStall(st, cur),
  matchText,
  render: () => render(),
  errors: readErrors,
  player: YTP,
  dev: DEV,
};

main();
