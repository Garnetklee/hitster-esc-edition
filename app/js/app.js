// Hitster ESC Edition – Hauptmodul (UI + Spielablauf)
import {
  loadSongs, filterPool, fitsGap, sortedIndex, relRank, placementText, shuffle, pickRandom,
  QUICK_COUNTRIES, hasVideo, isCancelled, placeTokens, yearTokens, neighborTokens, tokenPoints, applyTokens, skipCost, renewCost,
  fmtTokens, tokenLabel, suggest, countryStats, matchCountry, matchText, countryOptions, overlapPx, fmtDuration, heatMatrix,
} from './data.js';
import * as YTP from './player.js';
import {
  SETTINGS_VERSION, PRESETS, DEFAULT_PRESET, CONVERT_TARGETS, TARGET_CHOICES, TIME_LIMITS, presetById, matchingPreset, migrateSettings, migrateState,
} from './settings.js';
import { startFireworks } from './fireworks.js';

const KEY_STATE = 'esc_hitster_state';
const KEY_SETTINGS = 'esc_hitster_settings';
const KEY_ERRORS = 'esc_hitster_errors';
const START_TOKENS = 2;
const DEV = new URLSearchParams(location.search).get('dev') === '1';

let DATA = { file: '', generiert: '', songs: [] };
let BY_ID = new Map();
let COUNTRY_NAMES = new Map(); // ISO -> deutscher Name
let ARTISTS = []; // alle echten Interpreten für die Autovervollständigung
let TITLES = [];
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
    suggest: $('#chk-suggest').checked,
    convert: $('#chk-convert').checked,
    convertAt: parseInt(radioVal('r-convert'), 10) || 5,
    timeLimit: parseInt(radioVal('r-limit'), 10) || 0,
    renew: radioVal('r-renew') || 'free',
  };
}

function writeRules(r) {
  $('#chk-steal').checked = !!r.steal;
  setRadio('r-country', r.country);
  setRadio('r-place', r.place);
  setRadio('r-exact', r.exact);
  $('#chk-artist').checked = !!r.artist;
  $('#chk-title').checked = !!r.title;
  $('#chk-suggest').checked = !!r.suggest;
  $('#chk-convert').checked = !!r.convert;
  setRadio('r-convert', r.convertAt);
  setRadio('r-limit', r.timeLimit);
  setRadio('r-renew', r.renew);
}

/** Id des passenden Modus oder 'custom'. Zeitraum und Länder gelten für jeden Modus. */
function currentPreset() {
  const hit = matchingPreset(readRules());
  return hit ? hit.id : 'custom';
}

let lastPresetHTML = '';
function renderPresets() {
  const on = currentPreset();
  const r = readRules();
  const custom = { id: 'custom', name: 'Custom', desc: 'Eigene Regeln in den erweiterten Einstellungen.' };
  const toggle = (p, key, label) => `<label class="switch mini"><input type="checkbox" data-preset="${p.id}" data-toggle="${key}" ${p.id === on && r[key] !== 'off' ? 'checked' : ''}><span class="slider"></span><span>${label}</span></label>`;
  const html = [...PRESETS, custom].map((p) =>
    `<div class="preset ${p.id === on ? 'on' : ''}" data-preset="${p.id}">
      <button type="button" class="preset-main" data-preset="${p.id}" aria-pressed="${p.id === on}">
        <span class="preset-name">${esc(p.name)}</span>${p.sub ? `<span class="preset-sub">${esc(p.sub)}</span>` : ''}<span class="preset-desc">${esc(p.desc)}</span>
      </button>
      ${p.toggles ? `<div class="preset-toggles">${toggle(p, 'country', 'Länderfeld')}${toggle(p, 'place', 'Platzierung')}</div>` : ''}
    </div>`).join('');
  if (html === lastPresetHTML) return; // sonst verlieren die Regler bei jeder Eingabe den Fokus
  lastPresetHTML = html;
  $('#preset-grid').innerHTML = html;
}

function applyPreset(id) {
  if (id === currentPreset()) return;
  writeRules(presetById(id).rules);
  updateCount();
}

/** Ziel-Auswahl an das freie Feld anpassen, bei einem anderen Wert ist keine Auswahl markiert. */
function syncTarget() {
  const v = $('#inp-target').value;
  $$('input[name=target]').forEach((r) => { r.checked = r.value === v; });
}

function renderPlayerInputs() {
  const box = $('#player-list');
  box.innerHTML = setup.names.map((n, i) =>
    `<label class="player-input"><span class="pnum">${i + 1}</span><input type="text" maxlength="16" value="${esc(n)}" data-i="${i}" aria-label="Name Spieler ${i + 1}" enterkeyhint="done"></label>`).join('');
  $$('input', box).forEach((inp) => inp.addEventListener('input', () => { setup.names[+inp.dataset.i] = inp.value; updateCount(); }));
  $('#btn-add-player').disabled = setup.names.length >= 8;
  $('#btn-remove-player').disabled = setup.names.length <= 1;
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
  $('#convert-box').hidden = !r.convert;
  renderPresets();
}

function applySettings(st) {
  if (!st) return;
  if (Array.isArray(st.players) && st.players.length >= 1) setup.names = st.players.slice(0, 8);
  if (st.target) $('#inp-target').value = st.target;
  const f = st.filter || {};
  if (f.mode) { const r = $(`input[name=pool][value="${f.mode}"]`); if (r && !r.disabled) r.checked = true; }
  if (f.topN) $('#inp-topn').value = f.topN;
  if (f.from) $('#inp-from').value = f.from;
  // "bis" am alten Datenende gespeichert -> mit neuen Daten bis zum neuen Ende
  if (f.to && !f.toMax) $('#inp-to').value = Math.min(f.to, setup.maxYear);
  setup.countries = new Set((f.countries || []).filter((c) => COUNTRY_NAMES.has(c)));
  if (st.rules) writeRules(st.rules);
  $('#chk-time').checked = !!st.trackTime;
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

  $('#target-opts').innerHTML = TARGET_CHOICES.map((n) =>
    `<label class="chip-radio"><input type="radio" name="target" value="${n}"><span>${n}</span></label>`).join('');
  $('#convert-opts').innerHTML = CONVERT_TARGETS.map((n) =>
    `<label class="chip-radio"><input type="radio" name="r-convert" value="${n}"><span>${n}</span></label>`).join('');
  $('#limit-opts').innerHTML = TIME_LIMITS.map((n) =>
    `<label class="chip-radio"><input type="radio" name="r-limit" value="${n}"><span>${n ? `${n} s` : 'Aus'}</span></label>`).join('');
  writeRules(presetById(DEFAULT_PRESET).rules);
  applySettings(migrateSettings(store.get(KEY_SETTINGS)));
  syncTarget();
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
  $('#btn-remove-player').onclick = () => { if (setup.names.length > 1) { setup.names.pop(); renderPlayerInputs(); updateCount(); } };
  $('#setup').addEventListener('input', updateCount);
  $('#setup').addEventListener('change', updateCount);
  $('#preset-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.preset-main'); if (!b) return;
    if (b.dataset.preset === 'custom') {
      $('#advanced').open = true;
      $('#advanced').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else applyPreset(b.dataset.preset);
  });
  // Läuft vor dem input-Listener von #setup, der die Karten danach neu zeichnet
  $('#preset-grid').addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.toggle) return;
    const p = presetById(t.dataset.preset);
    const r = currentPreset() === p.id ? readRules() : { ...p.rules };
    r[t.dataset.toggle] = t.checked ? p.toggles[t.dataset.toggle] : 'off';
    writeRules(r);
  });
  $('#target-opts').addEventListener('change', (e) => { $('#inp-target').value = e.target.value; });
  $('#inp-target').addEventListener('input', syncTarget);
  $('#stats-countries').innerHTML = [...COUNTRY_NAMES.values()].sort((a, b) => a.localeCompare(b, 'de')).map((n) => `<option value="${esc(n)}"></option>`).join('');
  $('#stats-input').addEventListener('input', renderStats);
  $('#stats').addEventListener('toggle', () => { if ($('#stats').open) { renderHeatmap(); renderStats(); } });
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
const score = (p) => p.timeline.length + p.bonusCards;
const isSolo = () => state.players.length === 1;
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
  return {
    songId: song.id,
    phase: 'listen',
    gap: null,
    steal: null,
    country: { options: countryOptions(song, DATA.songs), guess: null, text: '' },
    place: { neighborId: null, guess: null, free: '', hf: false },
    exact: '',
    artistTip: '',
    titleTip: '',
    heard: 0,
    timeUp: false,
    released: false,
    renewals: 0,
    elapsed: 0,
    clockOn: false,
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
    trackTime: $('#chk-time').checked,
  };
  store.set(KEY_SETTINGS, settings);
  state = { v: 1, settings, players: names.map((name) => ({ name, timeline: [], tokens: START_TOKENS, bonusCards: 0, freeSkips: 1, wrong: [], time: 0 })), active: 0, round: 1, used: [], cur: null, finished: false };
  for (const p of state.players) {
    const s = draw();
    if (s) p.timeline.push(s.id);
  }
  state.active = Math.floor(Math.random() * state.players.length);
  state.first = state.active;
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
  if (state.cur.clockOn) clockStart();
}

function startTurn() {
  hidePlayer();
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
  clockStop();
  const c = state.cur;
  if (c.steal) state.players[c.steal.p].tokens += 1;
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
  if (g !== null) clockStart();
  save(); render();
  if (g !== null) scrollToGap(g);
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
  const cost = skipCost(p);
  if (state.cur.phase !== 'listen' || p.tokens < cost) return;
  if (cost) p.tokens -= cost;
  else p.freeSkips -= 1;
  replaceSong(`${p.name} überspringt (${cost ? '−1 Token' : 'gratis'}).`);
}

function eligibleStealers() {
  return state.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== state.active && p.tokens >= 1);
}

function openSteal() {
  const list = eligibleStealers();
  if (!list.length) { toast('Niemand hat ein Token zum Klauen.'); return; }
  $('#steal-players').innerHTML = list.map(({ p, i }) =>
    `<button type="button" class="btn" data-i="${i}">${esc(p.name)} <span class="muted">(${tokenLabel(p.tokens)})</span></button>`).join('');
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

/** Ja/Nein-Dialog, liefert true bei Bestätigung. */
function confirmDlg(title, text, okLabel, cancelLabel) {
  return new Promise((resolve) => {
    const d = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = okLabel;
    $('#confirm-cancel').textContent = cancelLabel;
    // Ergebnis direkt melden: Das close-Ereignis kommt erst mit dem nächsten Frame, im Hintergrund also gar nicht
    const finish = (answer) => { d.close(); resolve(answer); };
    $('#confirm-ok').onclick = () => finish(true);
    $('#confirm-cancel').onclick = () => finish(false);
    d.oncancel = (e) => { e.preventDefault(); finish(false); };
    d.showModal();
  });
}

/** Felder, die in diesem Zug möglich wären, aber noch leer sind. */
function missingFields(c) {
  const R = rules();
  const song = S(c.songId);
  const list = [];
  if (R.exact > 0 && !String(c.exact).trim()) list.push('Genaues Jahr');
  if (R.artist && !c.artistTip.trim()) list.push('Interpret');
  if (R.title && !c.titleTip.trim()) list.push('Titel');
  if (R.country === 'choice' && !c.country.guess) list.push('Land');
  if (R.country === 'free' && !c.country.text.trim()) list.push('Land');
  if (relRank(song) !== null) {
    if (R.place === 'free' && !c.place.hf && !String(c.place.free).trim()) list.push('Platzierung');
    if (R.place === 'neighbor' && placeNeighbor() && !c.place.guess) list.push('Platzierung');
  }
  return list;
}

async function tryReveal() {
  const c = state.cur;
  if (c.phase !== 'listen' || c.gap === null) return;
  const missing = missingFields(c);
  if (missing.length && !await confirmDlg('Noch nicht alles ausgefüllt', `Offen: ${missing.join(', ')}. Dafür gibt es dann keine Tokens.`, 'Trotzdem auflösen', 'Zurück')) return;
  reveal();
}

function reveal() {
  const c = state.cur;
  if (c.phase !== 'listen' || c.gap === null) return;
  clockStop();
  stealPick = null;
  hidePlayer();
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
    placePts = neighborTokens(placeOk);
  }
  if (R.place === 'free' && relRank(song) !== null && (c.place.hf || c.place.free !== '')) {
    placePts = placeTokens(song, c.place);
    placeOk = placePts > 0;
  }
  const exactYear = parseInt(c.exact, 10);
  const exactOk = R.exact > 0 && !isNaN(exactYear) ? correct && exactYear === song.jahr : null;
  const yearPts = R.exact > 0 ? yearTokens(exactYear, song.jahr, correct) : 0;
  const artistState = R.artist ? matchText(c.artistTip, song.interpret) : null;
  const titleState = R.title ? matchText(c.titleTip, song.titel) : null;
  const pts = tokenPoints({ countryOk, artistState, titleState, placePts, yearPts });
  const gain = applyTokens(p, pts, R);
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
    const near = R.place === 'free' && !c.place.hf && placePts === 0.5;
    guess.place = { tip: tips.place, state: near ? 'near' : placeOk ? 'ok' : 'bad' };
  }

  let stolenBy = null;
  if (!correct) p.wrong.push(song.id);
  if (correct) {
    p.timeline.splice(c.gap, 0, song.id);
  } else if (c.steal && stealOk) {
    const sp = state.players[c.steal.p];
    const stl = tlSongs(sp);
    sp.timeline.splice(sortedIndex(stl, song.jahr), 0, song.id);
    stolenBy = c.steal.p;
  }
  c.result = { correct, stealOk, countryOk, placeOk, placePts, exactOk, yearPts, artistState, titleState, guess, pts, gain, stolenBy };
  c.phase = 'reveal';
  save(); render();
  if (correct) scrollToCard(song.id);
}

const nextPlayer = () => (state.active + 1) % state.players.length;
const targetReached = () => state.players.some((p) => score(p) >= state.settings.target);

function nextTurn() {
  const next = nextPlayer();
  if (next === state.first && targetReached()) { endGame(); return; }
  state.active = next;
  state.round += next === state.first ? 1 : 0;
  startTurn();
}

function endGame() {
  clockStop();
  hidePlayer();
  YTP.stop();
  state.finished = true;
  save();
  store.del(KEY_STATE);
  const target = state.settings.target;
  const solo = isSolo();
  const ranking = state.players.map((p, i) => ({ ...p, i, sc: score(p) })).sort((a, b) => b.sc - a.sc || b.tokens - a.tokens);
  ranking.forEach((r, n) => {
    const prev = ranking[n - 1];
    r.rank = prev && prev.sc === r.sc && prev.tokens === r.tokens ? prev.rank : n + 1;
  });
  const top = ranking[0];
  const winners = ranking.filter((r) => r.rank === 1);
  const rounds = `${state.round} ${state.round === 1 ? 'Runde' : 'Runden'}`;
  const cardsText = (r) => `${r.timeline.length} ${r.timeline.length === 1 ? 'Karte' : 'Karten'}${r.bonusCards ? ` + ${r.bonusCards} Bonuskarte${r.bonusCards > 1 ? 'n' : ''}` : ''}`;
  if (solo) {
    $('#end-title').textContent = top.sc >= target ? `Geschafft in ${rounds}!` : `${top.sc} von ${target} Karten nach ${rounds}`;
    $('#end-sub').textContent = `${cardsText(top)}, ${tokenLabel(top.tokens)} übrig`;
  } else {
    $('#end-title').textContent = winners.length > 1
      ? `Unentschieden: ${winners.map((w) => w.name).join(' & ')}`
      : `${top.name} gewinnt${top.sc >= target ? '!' : ' (meiste Karten)'}`;
    $('#end-sub').textContent = '';
  }
  $('#end-heart').style.display = solo ? '' : 'none';
  const podium = [ranking[1], ranking[0], ranking[2]].filter(Boolean);
  $('#end-podium').innerHTML = solo ? '' : podium.map((r) =>
    `<div class="podium-step rank-${r.rank}">
      <div class="podium-name">${r.rank === 1 ? '👑 ' : ''}${esc(r.name)}</div>
      <div class="podium-score">${r.sc} ${r.sc === 1 ? 'Karte' : 'Karten'} · ${tokenLabel(r.tokens)}</div>
      <div class="podium-block">${r.rank}</div>
    </div>`).join('');
  $('#end-ranking').innerHTML = solo ? '' : `<ol class="ranking">${ranking.map((r) =>
    `<li value="${r.rank}"><span class="r-name">${esc(r.name)}</span><span class="r-cards">${cardsText(r)}</span><span class="r-tokens">${tokenLabel(r.tokens)}</span></li>`).join('')}</ol>`;
  $('#end-tabs').innerHTML = solo ? '' : ranking.map((r) => `<button type="button" class="btn small ghost" data-end="${r.i}">${esc(r.name)}</button>`).join('');
  $$('#end-tabs [data-end]').forEach((b) => b.addEventListener('click', () => showEndCards(+b.dataset.end)));
  renderEndTimes(solo);
  showEndCards(top.i);
  showScreen('end');
  if (!solo || top.sc >= target) {
    startFireworks($('#fireworks'));
    playEndMusic();
  }
}

/** Gesamtzeit groß, bei mehreren Spielern im Vergleich, schnellste zuerst. */
function renderEndTimes(solo) {
  const box = $('#end-times');
  box.hidden = !state.settings.trackTime;
  if (box.hidden) return;
  const list = state.players.slice().sort((a, b) => a.time - b.time);
  const max = Math.max(...list.map((p) => p.time), 1);
  box.innerHTML = solo
    ? `<h3>⏱ Gesamtzeit</h3><div class="time-big">${fmtDuration(list[0].time)}</div>`
    : `<h3>⏱ Gesamtzeit</h3>${list.map((p) =>
      `<div class="time-row"><span class="time-name">${esc(p.name)}</span><span class="time-bar"><i style="width:${(p.time / max) * 100}%"></i></span><span class="time-val">${fmtDuration(p.time)}</span></div>`).join('')}`;
}

function playEndMusic() {
  const a = $('#end-audio');
  const b = $('#btn-end-audio');
  b.hidden = false;
  a.currentTime = 0;
  // Blockt der Browser den Start, bleibt der Knopf zum Einschalten
  a.play().catch(() => { b.textContent = '🔊 Musik an'; });
}

/** Zeitleiste und falsch geratene Karten eines Spielers in der Auswertung. */
function showEndCards(i) {
  const p = state.players[i];
  $('#end-tl-title').textContent = `Zeitleiste von ${p.name} (${p.timeline.length} ${p.timeline.length === 1 ? 'Karte' : 'Karten'})`;
  $('#end-tl').innerHTML = tlSongs(p).map((s) => cardHTML(s)).join('');
  const wrong = p.wrong.map(S).filter(Boolean).sort((a, b) => a.jahr - b.jahr);
  $('#end-wrong-title').textContent = `Falsch geraten (${wrong.length})`;
  $('#end-wrong').innerHTML = wrong.map((s) => cardHTML(s, 'wrong')).join('') || '<div class="muted">Keine falschen Karten.</div>';
  fitOverlap($('#end-tl'));
  fitOverlap($('#end-wrong'));
  $$('#end-tabs [data-end]').forEach((b) => b.classList.toggle('on', +b.dataset.end === i));
}

/* ------------------------------------------------------------------ Rendern */
function showScreen(name) {
  for (const s of ['setup', 'game', 'end', 'music']) $(`#screen-${s}`).hidden = s !== name;
  $('#btn-menu').hidden = name !== 'game';
  document.body.classList.toggle('on-setup', name === 'setup');
  window.scrollTo(0, 0);
}

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

function render() {
  if (!state || !state.cur) return;
  const c = state.cur;
  const p = activeP();

  renderScoreboard();

  $('#turn-banner').innerHTML = `<span class="tb-name">${esc(p.name)}</span> ist dran <span class="muted small">· Runde ${state.round}${DEV ? ' · Dev-Modus' : ''}</span>${targetReached() && !isSolo() ? ' <span class="last-round">Letzte Runde</span>' : ''}`;

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

function renderScoreboard() {
  const target = state.settings.target;
  $('#scoreboard').innerHTML = state.players.map((pl, i) =>
    `<button class="score ${i === state.active ? 'active' : ''}" data-i="${i}">
      <span class="s-name">${esc(pl.name)}</span>
      <span class="s-cards">Karten <b>${score(pl)}</b>/${target}${pl.bonusCards ? ` <small>(${pl.bonusCards} Bonus)</small>` : ''}</span>
      <span class="s-tokens">Tokens <b>${fmtTokens(pl.tokens)}</b></span>
    </button>`).join('');
  $$('#scoreboard .score').forEach((b) => b.addEventListener('click', () => showTimeline(+b.dataset.i)));
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
      const picking = stealPick !== null; // nur beim Klauen gibt es antippbare Lücken, sonst wird gezogen
      const cls = ['gap', placed ? 'placed' : '', stolen ? 'stolen' : '', picking ? 'steal-mode' : ''].join(' ');
      const label = stolen ? `<span class="gap-badge">${esc(state.players[c.steal.p].name)}</span>` : '';
      html += `<div class="${cls}" data-gap="${i}" ${picking ? `role="button" aria-label="Lücke ${i + 1}"` : ''}>${placed ? mysteryHTML(c.steal ? 'locked' : '') : picking ? '<span class="gap-plus">+</span>' : ''}${label}</div>`;
      if (i < tl.length) html += cardHTML(tl[i]);
    }
  }
  el.innerHTML = html;
  fitOverlap(el);
  el.scrollLeft = scroll;
  $$('.gap', el).forEach((g) => g.addEventListener('click', () => {
    if (stealPick !== null) setSteal(+g.dataset.gap);
  }));
  $$('[data-drag]', el).forEach(bindDrag);
}

/** Karten überlappen lassen, sobald sonst seitlich gescrollt werden müsste. */
function fitOverlap(el) {
  if (!el.clientWidth) return;
  const cards = $$('.card', el);
  const pad = parseFloat(getComputedStyle(el).getPropertyValue('--tl-pad')) || 0;
  const px = cards.length ? overlapPx(cards.length, cards[0].offsetWidth + 8, el.clientWidth - 2 * pad) : 0;
  el.style.setProperty('--overlap', `${px}px`);
  el.classList.toggle('overlap', px > 0);
}

function renderDeck() {
  const c = state.cur;
  const d = $('#deck');
  if (c.phase !== 'listen') { d.innerHTML = ''; return; }
  const song = S(c.songId);
  const audioNote = song.youtube_id ? '' : '<div class="muted small">Kein Video – Dev-Modus ohne Audio</div>';
  if (c.gap === null) {
    d.innerHTML = `<div class="deck-slot">${mysteryHTML('pulse')}</div>
      <div class="deck-hint">Ziehe die Karte an die richtige Stelle deiner Zeitleiste.${audioNote}</div>`;
    $$('[data-drag]', d).forEach(bindDrag);
  } else {
    d.innerHTML = c.steal
      ? `<div class="deck-hint">Karte liegt fest (es wird geklaut).${audioNote}</div>`
      : `<button type="button" class="deck-slot deck-return" id="deck-return"><span>↩</span><small>Zurücklegen</small></button>
         <div class="deck-hint">Karte liegt. Du kannst sie verschieben oder hierher zurückziehen.${audioNote}</div>`;
    if (!c.steal) $('#deck-return').onclick = () => setGap(null);
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
  const showSteal = R.steal && !isSolo();
  const cost = skipCost(p);
  const locked = limitLocked(c);
  const limited = R.timeLimit > 0 && !c.released;
  const limitBar = limited && hasAudio
    ? `<div class="limit ${c.timeUp ? 'up' : ''}"><div class="limit-bar"><i id="limit-fill" style="width:${limitPercent(c)}%"></i></div><span id="limit-text">${limitText(c)}</span></div>`
    : '';
  el.innerHTML = `
    <div class="row player-row">
      <button class="btn play big" id="btn-play" ${hasAudio && !locked ? '' : 'disabled'}>${playLabel()}</button>
      <button class="btn" id="btn-restart" ${hasAudio && !locked ? '' : 'disabled'}>↺ Neu ab Start</button>
    </div>
    <div class="row"><button class="btn hint" id="btn-hint" ${hasAudio ? '' : 'disabled'}>💡 Hinweis: Video einblenden <small>(gratis)</small></button></div>
    ${limitBar}
    ${locked ? '<div class="muted small">Zu wenig Tokens zum Weiterhören. Du kannst trotzdem auflösen.</div>' : ''}
    <div class="stall" id="stall" ${c.stalled ? '' : 'hidden'}>
      <span>Noch keine Musik? Tippe auf Abspielen. Läuft Werbung, kannst du sie im Player überspringen.</span>
      <div class="row">
        <button class="btn small" id="btn-stall-player">📺 Player zeigen</button>
        <button class="btn small" id="btn-other-song">Anderes Lied (gratis)</button>
      </div>
    </div>
    <div class="row action-row">
      <button class="btn ghost" id="btn-skip" ${p.tokens >= cost ? '' : 'disabled'}>Überspringen <small>(${cost ? '1 Token' : 'gratis'})</small></button>
      ${showSteal ? `<button class="btn ghost" id="btn-steal" ${canSteal ? '' : 'disabled'}>Klauen…</button>` : ''}
      <button class="btn primary big" id="btn-reveal" ${c.gap !== null ? '' : 'disabled'}>Auflösen</button>
    </div>`;
  $('#btn-play').onclick = () => withRenewal(() => {
    if (audioStatus === 'idle' || audioStatus === 'paused') setAudioStatus('loading');
    YTP.toggle();
  });
  $('#btn-restart').onclick = () => withRenewal(() => {
    setAudioStatus('loading');
    YTP.restart();
  });
  $('#btn-skip').onclick = skip;
  $('#btn-other-song').onclick = () => replaceSong('Neues Lied.');
  $('#btn-hint').onclick = () => showPlayer('hint');
  $('#btn-stall-player').onclick = () => showPlayer('ad');
  if (showSteal) $('#btn-steal').onclick = openSteal;
  $('#btn-reveal').onclick = tryReveal;
}

function yearBoxHTML(c) {
  return `<div class="bonus-box"><div class="bonus-q">Genaues Jahr <small class="muted">(exakt 1 Token, bis 2 daneben ½, Karte muss richtig liegen)</small></div>
    <input type="number" class="free-input" id="inp-exact" inputmode="numeric" min="1956" max="2100" placeholder="Jahr" aria-label="Genaues Jahr" enterkeyhint="done" value="${esc(c.exact)}"></div>`;
}

function countryBoxHTML(c, R) {
  if (R.country === 'choice') {
    return `<div class="bonus-box"><div class="bonus-q">Land raten <small class="muted">(½ Token)</small></div><div class="opts">${
      c.country.options.map((iso) => `<button class="opt ${c.country.guess === iso ? 'sel' : ''}" data-country="${iso}">${flagHTML(iso)}<span>${esc(COUNTRY_NAMES.get(iso) || iso)}</span></button>`).join('')
    }</div></div>`;
  }
  const names = [...COUNTRY_NAMES.values()].sort((x, y) => x.localeCompare(y, 'de'));
  return `<div class="bonus-box"><div class="bonus-q">Land raten <small class="muted">(½ Token)</small></div>
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
    return `<div class="bonus-box"><div class="bonus-q">Platzierung <small class="muted">(exakt 1 Token, bis 2 daneben ½)</small></div>${inner}</div>`;
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
          <button class="opt ${g === 'besser' ? 'sel' : ''}" data-place="besser">▲ Besser</button>
          <button class="opt ${g === 'schlechter' ? 'sel' : ''}" data-place="schlechter">▼ Schlechter</button>
        </div>`;
    }
  }
  return `<div class="bonus-box"><div class="bonus-q">Platzierung schätzen <small class="muted">(½ Token)</small></div>${inner}</div>`;
}

function songBoxHTML(c, R) {
  const field = (id, label, value) => `<div class="suggest-wrap"><input type="text" class="free-input" id="${id}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="${label}" aria-label="${label}" value="${esc(value)}"><div class="suggest-list" hidden></div></div>`;
  const parts = [R.artist ? 'Interpret' : '', R.title ? 'Titel' : ''].filter(Boolean).join(' und ');
  return `<div class="bonus-box"><div class="bonus-q">${parts} raten <small class="muted">(je ½ Token)</small></div>
    <div class="col song-fields">${R.artist ? field('inp-artist', 'Interpret', c.artistTip) : ''}${R.title ? field('inp-title', 'Titel', c.titleTip) : ''}</div></div>`;
}

/** Vorschlagsmenü unter einem Eingabefeld. Freies Tippen bleibt möglich. */
function bindSuggest(input, list, onPick) {
  const box = input.parentElement.querySelector('.suggest-list');
  const close = () => { box.hidden = true; box.innerHTML = ''; };
  input.addEventListener('input', () => {
    const hits = suggest(input.value, list);
    if (!hits.length || (hits.length === 1 && hits[0] === input.value)) { close(); return; }
    box.innerHTML = hits.map((h) => `<button type="button" class="suggest-item" tabindex="-1" data-v="${esc(h)}">${esc(h)}</button>`).join('');
    box.hidden = false;
  });
  input.addEventListener('blur', close);
  // pointerdown statt click: sonst schließt der blur das Menü, bevor der Klick ankommt
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.suggest-item');
    if (!b) return;
    e.preventDefault();
    input.value = b.dataset.v;
    onPick(input.value);
    close();
  });
}

function renderBonus() {
  const c = state.cur;
  const el = $('#bonus');
  const R = rules();
  const hasSong = R.artist || R.title;
  const hasYear = R.exact > 0;
  if (c.phase !== 'listen' || (R.country === 'off' && R.place === 'off' && !hasSong && !hasYear)) { el.innerHTML = ''; return; }
  el.innerHTML = (hasYear ? yearBoxHTML(c) : '') + (hasSong ? songBoxHTML(c, R) : '') + (R.country !== 'off' ? countryBoxHTML(c, R) : '') + (R.place !== 'off' ? placeBoxHTML(c, R) : '');
  const changed = () => { save(); updateGuessPreview(); };
  $$('[data-country]', el).forEach((b) => b.addEventListener('click', () => { c.country.guess = c.country.guess === b.dataset.country ? null : b.dataset.country; renderBonus(); changed(); }));
  $$('[data-place]', el).forEach((b) => b.addEventListener('click', () => { c.place.guess = c.place.guess === b.dataset.place ? null : b.dataset.place; renderBonus(); changed(); }));
  const yi = $('#inp-exact', el);
  if (yi) yi.addEventListener('input', () => { c.exact = yi.value; changed(); });
  const ci = $('#inp-country', el);
  if (ci) ci.addEventListener('input', () => { c.country.text = ci.value; changed(); });
  const pi = $('#inp-place', el);
  if (pi) pi.addEventListener('input', () => { c.place.free = pi.value; changed(); });
  const ai = $('#inp-artist', el);
  if (ai) ai.addEventListener('input', () => { c.artistTip = ai.value; changed(); });
  const ti = $('#inp-title', el);
  if (ti) ti.addEventListener('input', () => { c.titleTip = ti.value; changed(); });
  if (R.suggest && ai) bindSuggest(ai, ARTISTS, (v) => { c.artistTip = v; changed(); });
  if (R.suggest && ti) bindSuggest(ti, TITLES, (v) => { c.titleTip = v; changed(); });
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
    const word = { ok: 'richtig · +½', near: 'teilweise richtig', bad: 'falsch' }[st];
    lines.push(`<div class="line ${st}">${label} („${esc(tip.trim())}“): ${word}</div>`);
  };
  textLine('Interpret', c.artistTip, r.artistState);
  textLine('Titel', c.titleTip, r.titleState);
  if (r.countryOk !== null) {
    const typed = R.country === 'free' ? ` („${esc(c.country.text.trim())}“)` : '';
    lines.push(`<div class="line ${r.countryOk ? 'ok' : 'bad'}">Land raten${typed}: ${r.countryOk ? 'richtig · +½' : `falsch, es war ${esc(song.land)}`}</div>`);
  }
  if (r.placeOk !== null) {
    const tip = R.place === 'free' ? ` (Tipp: ${c.place.hf ? 'Halbfinal-Aus' : `Platz ${esc(c.place.free)}`})` : '';
    const st = r.guess && r.guess.place ? r.guess.place.state : (r.placeOk ? 'ok' : 'bad');
    const word = { ok: 'richtig', near: 'fast richtig', bad: 'falsch' }[st];
    lines.push(`<div class="line ${st}">Platzierung${tip}: ${word}${r.placePts ? ` · +${fmtTokens(r.placePts)}` : ''}</div>`);
  }
  if (r.exactOk !== null) {
    const off = Math.abs(parseInt(c.exact, 10) - song.jahr);
    const yearPts = r.yearPts ?? (r.exactOk ? 1 : 0);
    const word = r.exactOk ? 'Punktlandung! +1'
      : yearPts ? `knapp daneben · +${fmtTokens(yearPts)}`
        : off === 0 ? 'stimmt, aber die Karte liegt falsch – kein Token'
          : off <= 2 ? 'knapp daneben, aber die Karte liegt falsch' : 'daneben';
    const st = r.exactOk ? 'ok' : r.guess && r.guess.year ? r.guess.year.state : 'bad';
    lines.push(`<div class="line ${st}">Genaues Jahr (Tipp: ${esc(c.exact)}): ${word}</div>`);
  }
  if (r.gain.tokens) lines.push(`<div class="line ok">+${tokenLabel(r.gain.tokens)} für ${esc(p.name)}</div>`);
  if (r.gain.cards) lines.push(`<div class="line ok big-line">+${r.gain.cards} Bonuskarte für ${esc(p.name)}!</div>`);
  if (state.settings.trackTime) lines.push(`<div class="line">⏱ ${fmtDuration(c.elapsed)} für dieses Lied · ${esc(p.name)} gesamt ${fmtDuration(p.time)}</div>`);
  const gameOver = targetReached() && nextPlayer() === state.first;
  const nextName = state.players[nextPlayer()].name;
  const hasOwn = r.guess && (R.exact > 0 || R.country !== 'off' || R.place !== 'off' || R.artist || R.title);
  const yt = song.youtube_id ? youtubeLink(song.youtube_id) : null;
  el.hidden = false;
  el.innerHTML = `<div class="reveal-card ${hasOwn ? '' : 'solo'}">${hasOwn ? ownCardHTML(r.guess) : ''}${cardHTML(song, `big ${r.correct ? 'correct' : 'wrong'}`)}</div>
    <div class="reveal-info">${lines.join('')}
      ${yt ? `<div class="row"><a class="btn yt" id="btn-yt" href="${esc(yt.href)}"${yt.target}>▶ Ganzes Video auf YouTube</a></div>` : ''}
      <div class="row"><button class="btn primary big" id="btn-next">${gameOver ? (isSolo() ? 'Zur Auswertung' : 'Zur Siegerehrung') : `Weiter: ${esc(nextName)}`}</button></div>
    </div>`;
  $('#btn-next').onclick = nextTurn;
  if (yt) $('#btn-yt').addEventListener('click', () => YTP.pause());
}

function showTimeline(i) {
  const p = state.players[i];
  $('#tl-title').textContent = `Zeitleiste von ${p.name} (${p.timeline.length} Karten)`;
  $('#tl-view').innerHTML = tlSongs(p).map((s) => cardHTML(s)).join('') || '<div class="muted">Noch keine Karten.</div>';
  $('#dlg-timeline').showModal();
  fitOverlap($('#tl-view'));
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
  const slot = $('#deck .deck-slot');
  const sr = slot ? slot.getBoundingClientRect() : null;
  drag.overDeck = !!sr && drag.x > sr.left - 12 && drag.x < sr.right + 12 && drag.y > sr.top - 12 && drag.y < sr.bottom + 12;
  if (slot) slot.classList.toggle('hover', drag.overDeck);
  if (!drag.overDeck && drag.y > r.top - DRAG_BAND && drag.y < r.bottom + DRAG_BAND) {
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
  if (!drag.overDeck && drag.y > r.top - DRAG_BAND && drag.y < r.bottom + DRAG_BAND) {
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
  $$('#deck .deck-slot.hover').forEach((s) => s.classList.remove('hover'));
}

function onDragEnd() {
  const d = drag;
  cleanupDrag();
  drag = null;
  if (d && d.moved && d.overDeck) { if (state.cur.gap !== null) setGap(null); }
  else if (d && d.moved && d.gap !== null) setGap(d.gap);
  else if (d && !d.moved && state.cur.gap === null) toast('Ziehe die Karte in die Zeitleiste.');
}
function onDragCancel() { cleanupDrag(); drag = null; }

/* ------------------------------------------------------------------ Zeitlimit */
const limitOf = () => (state ? rules().timeLimit : 0);
const limitActive = (c) => limitOf() > 0 && c && c.phase === 'listen' && !c.released;
const limitPercent = (c) => Math.max(0, 100 - (c.heard / limitOf()) * 100);
const limitText = (c) => (c.timeUp ? '⏱ Zeit um' : `⏱ ${Math.ceil(Math.max(0, limitOf() - c.heard))} s`);

/** Zeit um und zu wenig Tokens zum Weiterhören? */
const limitLocked = (c) => limitActive(c) && c.timeUp && activeP().tokens < renewCost(rules(), c.renewals);

function playLabel() {
  const c = state && state.cur;
  if (c && limitLocked(c)) return '⏱ Zeit um';
  if (c && limitActive(c) && c.timeUp && audioStatus !== 'playing') {
    const price = renewCost(rules(), c.renewals);
    const note = rules().renew !== 'paid' ? '' : ` <small>(${price ? `${fmtTokens(price)} Token` : 'gratis'})</small>`;
    return `▶ Weitere ${limitOf()} s hören${note}`;
  }
  if (audioStatus === 'loading') return `<span class="spin"></span> Lädt …${loadAttempt > 1 ? ` <small>(Versuch ${loadAttempt})</small>` : ''}`;
  if (audioStatus === 'playing') return '<span class="eq"><i></i><i></i><i></i></span> Läuft · Pause';
  return '▶ Abspielen';
}

function setAudioStatus(st) {
  audioStatus = st;
  const b = $('#btn-play');
  if (b) b.innerHTML = playLabel();
}

/** Abspielen und Neustart: Nach Ablauf der Zeit beginnt hier ein neues Zeitfenster, wenn nötig gegen Tokens. */
async function withRenewal(action) {
  if (!YTP.isReady()) { toast('Player lädt noch …'); return; }
  const c = state.cur;
  if (limitActive(c) && c.timeUp) {
    const p = activeP();
    const price = renewCost(rules(), c.renewals);
    if (p.tokens < price) return;
    if (price) {
      const ok = await confirmDlg('Weiterhören kostet Tokens', `Noch ${limitOf()} s kosten ${tokenLabel(price)}. ${p.name} hat ${tokenLabel(p.tokens)}.`, 'Bezahlen und weiterhören', 'Abbrechen');
      if (!ok) return;
      p.tokens -= price;
    }
    c.renewals += 1;
    c.timeUp = false;
    c.heard = 0;
    save();
    renderScoreboard();
    renderControls();
  }
  action();
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
    renderControls();
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

/** Nicht gestartet (Autoplay blockiert oder Werbung): Hinweis zeigen, nichts neu laden. */
function handleBlocked(cur) {
  setAudioStatus('idle');
  if (!state || !state.cur || state.cur.phase !== 'listen') return;
  const song = S(state.cur.songId);
  if (!song || !cur || cur.videoId !== song.youtube_id) return;
  state.cur.stalled = true;
  save();
  const box = $('#stall');
  if (box) box.hidden = false;
}

/* ------------------------------------------------------------------ Player einblenden (Werbung überspringen) */
let playerShown = false;
let playerMode = 'ad'; // ad: Ausschnitt zum Überspringen | hint: ganzes Video als Hinweis
let shownWhilePlaying = false;

function showPlayer(mode = 'ad') {
  playerShown = true;
  playerMode = mode;
  shownWhilePlaying = YTP.state() === YTP.State.PLAYING;
  const wrap = $('#yt-wrap');
  wrap.classList.add('show');
  wrap.classList.toggle('masked', mode === 'ad');
  wrap.removeAttribute('aria-hidden');
  $('#yt-bar-text').textContent = mode === 'hint'
    ? 'Hinweis: Das Video bleibt sichtbar, bis du es schließt.'
    : 'Sobald im Ausschnitt „Überspringen“ erscheint, tippe darauf. Das Fenster schließt sich, wenn das Lied startet.';
  $('#btn-unmask-player').hidden = mode === 'hint';
  $('#yt-bar').hidden = false;
}

function hidePlayer() {
  playerShown = false;
  const wrap = $('#yt-wrap');
  wrap.classList.remove('show', 'masked');
  wrap.setAttribute('aria-hidden', 'true');
  $('#yt-bar').hidden = true;
}

/* ------------------------------------------------------------------ Zeit tracken */
let clockFrom = null; // Beginn der laufenden Messung, die Summen stehen im Spielstand

/** Läuft ab dem ersten Abspielen oder Ziehen. Lade- und Werbezeit zählen so nicht mit. */
function clockStart() {
  const c = state && state.cur;
  if (!c || !state.settings.trackTime || c.phase !== 'listen' || clockFrom !== null || document.hidden) return;
  c.clockOn = true;
  clockFrom = Date.now();
}

function clockStop() {
  if (clockFrom === null) return;
  const dt = Date.now() - clockFrom;
  clockFrom = null;
  state.cur.elapsed += dt;
  activeP().time += dt;
}

/** Versteckter Tab zählt nicht, beim Schließen bleibt die bisherige Zeit gespeichert. */
function clockVisibility() {
  if (document.hidden) { clockStop(); save(); }
  else if (state && state.cur && state.cur.clockOn) clockStart();
}

/* ------------------------------------------------------------------ Nur Musik hören */
let music = null; // { list, i, status, errors }, nur solange der Player offen ist
let musicSeeking = false;

function openMusic() {
  const list = shuffle(filterPool(DATA.songs, readFilter(), DEV).filter(hasVideo));
  if (!list.length) { toast('Keine Lieder mit Video in dieser Auswahl.'); return; }
  music = { list, i: 0, status: 'idle', errors: 0 };
  showScreen('music');
  musicLoad();
}

function closeMusic() {
  music = null;
  hidePlayer();
  YTP.stop();
  showScreen('setup');
}

function musicLoad() {
  const s = music.list[music.i];
  hidePlayer();
  $('#music-stall').hidden = true;
  musicStatus('loading');
  YTP.load(s.youtube_id, s.start_sek || 0, true);
  renderMusic();
}

function musicGo(step) {
  const n = music.list.length;
  music.i = (music.i + step + n) % n;
  musicLoad();
}

function musicStatus(st) {
  music.status = st;
  $('#btn-music-play').innerHTML = st === 'playing' ? '⏸ Pause'
    : st === 'loading' ? '<span class="spin"></span> Lädt …' : '▶ Abspielen';
  const eq = $('#music-card .eq');
  if (eq) eq.classList.toggle('on', st === 'playing');
}

function renderMusic() {
  const s = music.list[music.i];
  const n = music.list.length;
  $('#music-count').textContent = `Lied ${music.i + 1} von ${n}`;
  $('#music-card').innerHTML = `<div class="music-cover"><span class="c-year">${s.jahr}</span>${flagHTML(s.land_iso)}<span class="eq ${music.status === 'playing' ? 'on' : ''}"><i></i><i></i><i></i></span></div>
    <div class="music-title">${esc(s.titel)}</div>
    <div class="music-artist">${esc(s.interpret)}</div>
    <div class="music-meta">${esc(s.land)} · ${esc(placementText(s))}</div>`;
  const next = Array.from({ length: Math.min(8, n - 1) }, (_, k) => (music.i + k + 1) % n);
  $('#music-queue').innerHTML = next.map((i) => {
    const q = music.list[i];
    return `<li><button type="button" data-i="${i}"><b>${q.jahr}</b><span>${esc(q.interpret)} – ${esc(q.titel)}</span></button></li>`;
  }).join('');
  musicTick();
}

function musicTick() {
  if (!music) return;
  const dur = YTP.duration();
  const pos = YTP.position();
  $('#music-pos').textContent = fmtDuration(pos * 1000);
  $('#music-dur').textContent = fmtDuration(dur * 1000);
  if (!musicSeeking) $('#music-seek').value = dur ? Math.round((pos / dur) * 1000) : 0;
}

function musicState(st) {
  if (st === YTP.State.PLAYING) {
    music.errors = 0;
    $('#music-stall').hidden = true;
    musicStatus('playing');
  } else if (st === YTP.State.BUFFERING) musicStatus('loading');
  else if (st === YTP.State.PAUSED || st === YTP.State.CUED) musicStatus('paused');
  else if (st === YTP.State.ENDED) musicGo(1);
}

function musicError(code) {
  logError(music.list[music.i], code);
  music.errors += 1;
  if (music.errors >= 5) { musicStatus('idle'); toast('Mehrere Videos nicht abspielbar, bitte später erneut versuchen.', 5000); return; }
  musicGo(1);
}

function musicStall() {
  musicStatus('idle');
  $('#music-stall').hidden = false;
}

function initMusic() {
  $('#btn-music').onclick = openMusic;
  $('#btn-music-back').onclick = closeMusic;
  $('#btn-music-play').onclick = () => {
    if (music.status === 'idle' || music.status === 'paused') musicStatus('loading');
    YTP.toggle();
  };
  $('#btn-music-next').onclick = () => musicGo(1);
  $('#btn-music-prev').onclick = () => {
    const s = music.list[music.i];
    if (YTP.position() - (s.start_sek || 0) > 3) YTP.restart(); else musicGo(-1);
  };
  $('#btn-music-player').onclick = () => showPlayer('ad');
  const seek = $('#music-seek');
  seek.addEventListener('input', () => { musicSeeking = true; });
  seek.addEventListener('change', () => {
    musicSeeking = false;
    YTP.seek((seek.value / 1000) * YTP.duration());
  });
  $('#music-queue').addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    music.i = +b.dataset.i;
    musicLoad();
  });
  setInterval(musicTick, 500);
}

/* ------------------------------------------------------------------ Player-Ereignisse */
function initAudio() {
  if (!DATA.songs.some((s) => s.youtube_id)) return; // nichts abzuspielen
  YTP.initPlayer({
    onState(st) {
      // Werbung vorbei, das Lied lädt oder startet: Player sofort verstecken, damit nichts verraten wird
      if (playerShown && playerMode === 'ad' && !shownWhilePlaying && (st === YTP.State.PLAYING || st === YTP.State.BUFFERING)) hidePlayer();
      if (st !== YTP.State.PLAYING) shownWhilePlaying = false;
      if (music) { musicState(st); return; }
      if (st === YTP.State.PLAYING) clockStart();
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
      if (music) { musicError(code); return; }
      if (!state || !state.cur) return;
      const song = S(state.cur.songId);
      if (!song || !cur || cur.videoId !== song.youtube_id) return;
      logError(song, code);
      console.warn('YouTube-Fehler', code, song.id, song.youtube_id);
      if (state.cur.phase === 'listen') replaceSong(`Video nicht abspielbar (Fehler ${code}) – neues Lied.`);
    },
    onStalled(st, cur) { if (music) musicStall(); else handleStall(st, cur); },
    onRetry(attempt) { loadAttempt = attempt; setAudioStatus('loading'); },
    onBlocked(cur) { if (music) musicStall(); else handleBlocked(cur); },
    onApiFail() { toast('YouTube-Player konnte nicht geladen werden (offline?).', 5000); },
  });
}

/* ------------------------------------------------------------------ Statistik */
let heat = null; // wird erst beim ersten Öffnen der Statistik gebaut

function renderHeatmap() {
  if (heat) return;
  heat = heatMatrix(DATA.songs);
  const cellClass = (c) => (c.kind === 'final' ? `h${Math.min(4, Math.floor(c.heat * 5))}` : c.kind);
  const head = `<div class="hm-row"><span class="hm-name"></span>${heat.years.map((y) => `<span class="hm-year">${y % 10 === 0 ? y : ''}</span>`).join('')}</div>`;
  const rows = heat.countries.map((k) => `<div class="hm-row" data-iso="${esc(k.iso)}"><span class="hm-name">${esc(k.name)}</span>${heat.years.map((y) => {
    const c = k.cells.get(y);
    return c ? `<i class="hm ${cellClass(c)}" data-y="${y}"></i>` : '<i class="hm"></i>';
  }).join('')}</div>`).join('');
  $('#heatmap').innerHTML = head + rows;
  const show = (e) => {
    const cell = e.target.closest('[data-y]');
    if (!cell) return;
    const k = heat.countries.find((x) => x.iso === cell.parentElement.dataset.iso);
    const y = +cell.dataset.y;
    $$('#heatmap .hm.on').forEach((x) => x.classList.remove('on'));
    cell.classList.add('on');
    $('#heat-detail').innerHTML = k.cells.get(y).songs.map((s) =>
      `<div><b>${esc(k.name)} ${y}</b>: ${esc(s.interpret)} – ${esc(s.titel)} · ${esc(placementText(s))}</div>`).join('');
  };
  $('#heatmap').addEventListener('click', show);
  $('#heatmap').addEventListener('mouseover', show);
}

/** Das gesuchte Land steht hervorgehoben ganz oben, sonst alphabetisch. */
function highlightHeat(iso) {
  if (!heat) return;
  const box = $('#heatmap');
  const order = [...heat.countries].sort((a, b) => (b.iso === iso) - (a.iso === iso));
  for (const k of order) {
    const row = $(`.hm-row[data-iso="${CSS.escape(k.iso)}"]`, box);
    row.classList.toggle('sel', k.iso === iso);
    box.appendChild(row);
  }
}

function renderStats() {
  const box = $('#stats-result');
  const text = $('#stats-input').value;
  const iso = text.trim() ? matchCountry(text, COUNTRY_NAMES) : null;
  highlightHeat(iso);
  if (!text.trim()) { box.innerHTML = ''; return; }
  if (!iso) { box.innerHTML = '<div class="muted small">Land aus der Liste wählen.</div>'; return; }
  const st = countryStats(DATA.songs, iso);
  const notes = [
    st.notFinal ? `Nicht im Finale: ${st.notFinal}` : '',
    st.unrated ? `Ohne Wertung: ${st.unrated}` : '',
  ].filter(Boolean).join(' · ');
  box.innerHTML = `<div class="stat-head">${flagHTML(iso)}<b>${esc(COUNTRY_NAMES.get(iso))}</b></div>
    <div><b class="stat-num">${st.entries}</b> Teilnahmen${st.cancelled ? ' <span class="muted small">(davon 1 im abgesagten Jahr 2020)</span>' : ''}</div>
    <h3>Häufigste Platzierungen im Finale</h3>
    ${st.top.length ? `<ol class="stat-top">${st.top.map((a) => `<li>Platz ${a.place} <b>${a.count}×</b></li>`).join('')}</ol>` : '<div class="muted small">Noch nie im Finale platziert.</div>'}
    ${notes ? `<div class="muted small">${notes}</div>` : ''}
    ${st.all.length ? `<details class="sub-details"><summary>Alle Platzierungen</summary>
      <div class="stat-all">${st.all.map((a) => `<div class="${a.count ? '' : 'muted'}">Platz ${a.place}: <b>${a.count}×</b></div>`).join('')}</div></details>` : ''}`;
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
  $('#btn-hide-player').onclick = hidePlayer;
  $('#btn-unmask-player').onclick = () => $('#yt-wrap').classList.remove('masked');
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
  const endAudio = $('#end-audio');
  const endAudioBtn = $('#btn-end-audio');
  endAudioBtn.onclick = () => { if (endAudio.paused) endAudio.play(); else endAudio.pause(); };
  endAudio.addEventListener('play', () => { endAudioBtn.textContent = '🔇 Musik aus'; });
  endAudio.addEventListener('pause', () => { endAudioBtn.textContent = '🔊 Musik an'; });
  document.addEventListener('visibilitychange', clockVisibility);
  window.addEventListener('pagehide', () => { clockStop(); save(); });
  const tlObserver = new ResizeObserver((list) => list.forEach((x) => fitOverlap(x.target)));
  for (const id of ['#timeline', '#tl-view', '#end-tl', '#end-wrong']) tlObserver.observe($(id));
  initMusic();

  try {
    DATA = await loadSongs();
  } catch (e) {
    $('#loading').textContent = e.message;
    return;
  }
  BY_ID = new Map(DATA.songs.map((s) => [s.id, s]));
  COUNTRY_NAMES = new Map();
  for (const s of DATA.songs) if (s.land_iso && !COUNTRY_NAMES.has(s.land_iso)) COUNTRY_NAMES.set(s.land_iso, s.land || s.land_iso);
  const sortedUnique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  ARTISTS = sortedUnique(DATA.songs.map((s) => s.interpret));
  TITLES = sortedUnique(DATA.songs.map((s) => s.titel));
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
  tryReveal: () => tryReveal(),
  missing: () => missingFields(state.cur),
  next: () => nextTurn(),
  skip: () => skip(),
  score: (p) => score(p),
  stall: (st, cur) => handleStall(st, cur),
  countryOptions,
  showPlayer: (mode) => showPlayer(mode),
  get music() { return music; },
  openMusic: () => openMusic(),
  closeMusic: () => closeMusic(),
  fit: () => fitOverlap($('#timeline')),
  end: () => endGame(),
  matchText,
  render: () => render(),
  errors: readErrors,
  player: YTP,
  dev: DEV,
};

main();
