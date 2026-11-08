// Spielmodi „Higher Lower“ und „Streaming ranken“ – Oberfläche. Die Regeln stehen in modi-logik.js.
import { POOL_LABELS } from './data.js';
import {
  HL_METRIKEN, HL_ARTEN, fmtViews, hlPool, hlStart, hlTipp, hlWeiter, hlRangliste, hlLade,
  STREAM_MIN_VIEWS, STREAM_AB_JAHR, streamPool, streamStart, streamZiehe, streamLege, streamWeiter, streamRangliste, streamLade,
} from './modi-logik.js';
import { startFireworks } from './fireworks.js';

const KEY = {
  hlState: 'esc_hl_state', hlSettings: 'esc_hl_settings', hlRekord: 'esc_hl_rekord',
  stState: 'esc_stream_state', stSettings: 'esc_stream_settings',
};
const HL_POOLS = ['alle', 'finale', 'top10', 'top3', 'sieger', 'topn', 'jahrzehnt', 'ikonen'];
const MAX_SPIELER = 8;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, fb = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};

let SONGS = [];
let BY_ID = new Map();
const byId = (id) => BY_ID.get(id);

const flag = (iso) => (!iso || iso === 'YU' || iso === 'CS'
  ? `<span class="flag flag-txt">${esc(iso || '?')}</span>`
  : `<img class="flag" src="https://flagcdn.com/w80/${esc(iso.toLowerCase())}.png" alt="${esc(iso)}" data-iso="${esc(iso)}" loading="lazy">`);

// Hintergrundmusik aus app.js: play(song), toggle(), stop(), showPlayer(), volume(), onStatus(fn)
let audio = { play() {}, toggle() {}, stop() {}, showPlayer() {}, volume: () => 100, onStatus() {} };

export function initModi(songs, bg) {
  if (bg) audio = bg;
  SONGS = songs;
  BY_ID = new Map(songs.map((s) => [s.id, s]));
  hl.init();
  st.init();
}

/** Beim Wechsel auf den Reiter. */
export function openModus(name) {
  if (name === 'hl') hl.show();
  if (name === 'stream') st.show();
}

/* ------------------------------------------------------------------ gemeinsame Bausteine */
function namenHTML(names, prefix) {
  return `<div class="player-list">${names.map((n, i) =>
    `<label class="player-input"><span class="pnum">${i + 1}</span><input type="text" maxlength="16" value="${esc(n)}" data-name="${i}" aria-label="Name Spieler ${i + 1}" enterkeyhint="done"></label>`).join('')}</div>
  <div class="row"><button class="btn ghost" data-act="${prefix}-plus" ${names.length >= MAX_SPIELER ? 'disabled' : ''}>+ Spieler</button>
  <button class="btn ghost" data-act="${prefix}-minus" ${names.length <= 1 ? 'disabled' : ''}>− Spieler</button></div>`;
}

function chipsHTML(name, options, current) {
  return `<div class="radio-grid">${options.map(([v, label]) =>
    `<label class="chip-radio"><input type="radio" name="${name}" value="${esc(v)}" ${String(v) === String(current) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>`;
}

function cleanNames(names) {
  return names.map((n, i) => (n || '').trim() || `Spieler ${i + 1}`);
}

function bindNames(root, settings) {
  root.addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-name]');
    if (inp) settings.names[+inp.dataset.name] = inp.value;
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.blur(); } });
}

function confetti() {
  const c = document.getElementById('fireworks');
  if (!c) return;
  c.hidden = false;
  startFireworks(c);
  setTimeout(() => { c.hidden = true; }, 6200);
}

/* ================================================================== Higher Lower */
const hl = {
  root: null,
  view: 'setup', // setup | game
  s: null, // Einstellungen
  game: null,
  pool: [],
  busy: false,
  rekord: {},

  init() {
    this.root = $('#screen-hl');
    this.s = {
      names: ['Spieler 1', 'Spieler 2'], art: 'serie', metrik: 'views', pool: 'alle', topN: 100, decadeN: 15, from: 1956, to: 2026,
      ...(store.get(KEY.hlSettings) || {}),
    };
    if (!Array.isArray(this.s.names) || !this.s.names.length) this.s.names = ['Spieler 1', 'Spieler 2'];
    if (!HL_ARTEN[this.s.art]) this.s.art = 'serie';
    if (!HL_METRIKEN[this.s.metrik]) this.s.metrik = 'views';
    if (!HL_POOLS.includes(this.s.pool)) this.s.pool = 'alle';
    this.rekord = store.get(KEY.hlRekord) || {};
    this.game = hlLade(store.get(KEY.hlState));
    if (!this.game) store.del(KEY.hlState);
    bindNames(this.root, this.s);
    this.root.addEventListener('click', (e) => this.klick(e));
    this.root.addEventListener('change', (e) => this.aenderung(e));
  },

  filter() {
    const s = this.s;
    return { mode: s.pool, topN: s.topN, decadeN: s.decadeN, from: s.from, to: s.to, countries: [] };
  },
  makePool() { return hlPool(SONGS, this.filter(), this.s.metrik); },

  show() {
    // Laufendes, nicht beendetes Spiel bleibt offen, sonst Setup
    this.view = this.game && !this.game.ende ? 'game' : (this.view === 'end' ? 'end' : 'setup');
    if (this.view === 'game') this.pool = this.makePool();
    this.render();
  },

  speichern() {
    if (this.game && !this.game.ende) store.set(KEY.hlState, this.game);
    else store.del(KEY.hlState);
  },

  aenderung(e) {
    const t = e.target;
    if (t.name === 'hl-art') this.s.art = t.value;
    else if (t.name === 'hl-metrik') this.s.metrik = t.value;
    else if (t.name === 'hl-pool') this.s.pool = t.value;
    else if (t.id === 'hl-topn') this.s.topN = Math.max(1, parseInt(t.value, 10) || 100);
    else if (t.id === 'hl-decade') this.s.decadeN = Math.max(1, parseInt(t.value, 10) || 15);
    else if (t.id === 'hl-from') this.s.from = parseInt(t.value, 10) || 1956;
    else if (t.id === 'hl-to') this.s.to = parseInt(t.value, 10) || 2026;
    else return;
    store.set(KEY.hlSettings, this.s);
    this.render();
  },

  klick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'hl-plus' && this.s.names.length < MAX_SPIELER) { this.s.names.push(`Spieler ${this.s.names.length + 1}`); this.render(); }
    else if (act === 'hl-minus' && this.s.names.length > 1) { this.s.names.pop(); this.render(); }
    else if (act === 'hl-start') this.start();
    else if (act === 'hl-resume') { this.pool = this.makePoolFromGame(); this.view = 'game'; this.render(); }
    else if (act === 'hl-discard') { this.game = null; this.speichern(); this.render(); }
    else if (act === 'hl-tipp') this.tipp(b.dataset.tipp);
    else if (act === 'hl-weiter') this.weiter();
    else if (act === 'hl-setup') { this.view = 'setup'; this.game = null; this.speichern(); this.render(); }
    else if (act === 'hl-nochmal') this.start();
    else if (act === 'hl-abbruch') {
      if (!confirm('Spiel wirklich abbrechen?')) return;
      this.game = null; this.speichern(); this.view = 'setup'; this.render();
    }
  },

  makePoolFromGame() {
    return hlPool(SONGS, this.game.filter, this.game.metrik);
  },

  start() {
    this.s.names = cleanNames(this.s.names);
    store.set(KEY.hlSettings, this.s);
    this.pool = this.makePool();
    if (this.pool.length < 6) { alert('In diesem Pool sind zu wenige Lieder. Bitte Auswahl oder Zeitraum erweitern.'); return; }
    this.game = hlStart({ art: this.s.art, metrik: this.s.metrik, filter: this.filter(), names: this.s.names }, this.pool);
    this.view = 'game';
    this.speichern();
    this.render();
  },

  tipp(t) {
    if (!this.game || this.game.phase !== 'tipp' || this.busy) return;
    hlTipp(this.game, t, byId);
    this.speichern();
    this.render();
    this.zaehle();
  },

  weiter() {
    if (!this.game || this.game.phase !== 'auf') return;
    hlWeiter(this.game, this.pool);
    if (this.game.ende) this.beenden();
    this.speichern();
    this.render();
  },

  beenden() {
    const g = this.game;
    if (g.art === 'teamwork') {
      const n = g.spieler.reduce((sum, p) => sum + p.serie, 0);
      const key = `${g.metrik}`;
      if (n > (this.rekord[key] || 0)) { this.rekord[key] = n; store.set(KEY.hlRekord, this.rekord); g.neuerRekord = true; }
    }
    this.view = 'end';
    store.del(KEY.hlState);
    confetti();
  },

  /** Aufrufe/Punkte zählen kurz hoch, wenn die rechte Karte aufgedeckt wird. */
  zaehle() {
    const el = $('#hl-reveal-val', this.root);
    if (!el || !this.game.letzte) return;
    const song = byId(this.game.letzte.rechts);
    const m = HL_METRIKEN[this.game.metrik];
    if (this.game.metrik === 'platz' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ziel = m.wert(song);
    const t0 = performance.now();
    const schritt = (t) => {
      const p = Math.min(1, (t - t0) / 700);
      const v = Math.round(ziel * (1 - (1 - p) ** 3));
      el.textContent = this.game.metrik === 'views' ? fmtViews(v) : `${v} Punkte`;
      if (p < 1 && el.isConnected) requestAnimationFrame(schritt);
      else if (el.isConnected) el.textContent = m.anzeige(song);
    };
    requestAnimationFrame(schritt);
  },

  render() {
    if (this.view === 'game' && this.game) this.root.innerHTML = this.spielHTML();
    else if (this.view === 'end' && this.game) this.root.innerHTML = this.endeHTML();
    else this.root.innerHTML = this.setupHTML();
    window.scrollTo(0, 0);
  },

  setupHTML() {
    const s = this.s;
    const n = this.makePool().length;
    const resume = this.game && !this.game.ende
      ? `<div class="panel resume"><div><strong>Gespeichertes Higher-Lower-Spiel gefunden</strong>
        <div class="muted">${esc(HL_ARTEN[this.game.art].label)} · ${esc(HL_METRIKEN[this.game.metrik].label)} · ${this.game.spieler.length} Spieler</div></div>
        <div class="row"><button class="btn primary" data-act="hl-resume">Fortsetzen</button><button class="btn ghost" data-act="hl-discard">Verwerfen</button></div></div>`
      : '';
    return `<div class="hero-sub modi-head"><h1>Higher <b>Lower</b></h1>
        <div class="muted">Liegt das nächste Lied höher oder niedriger? Aufrufe, Platzierung oder Punkte.</div></div>
      ${resume}
      <div class="panel"><h2>Spieler</h2>${namenHTML(s.names, 'hl')}</div>
      <div class="panel"><h2>Spielart</h2>
        ${chipsHTML('hl-art', Object.entries(HL_ARTEN).map(([k, v]) => [k, v.label]), s.art)}
        <div class="muted small hint">${esc(HL_ARTEN[s.art].info)}</div></div>
      <div class="panel"><h2>Vergleichen nach</h2>
        ${chipsHTML('hl-metrik', Object.entries(HL_METRIKEN).map(([k, v]) => [k, v.label]), s.metrik)}
        ${s.metrik === 'views' ? '' : '<div class="muted small hint">Nur Lieder aus dem Finale. Gleiche Werte werden nie gegeneinander gespielt.</div>'}</div>
      <div class="panel"><h2>Lieder-Pool</h2>
        <div class="radio-grid">${HL_POOLS.map((m) => {
    const extra = m === 'topn'
      ? `Top-<input type="number" id="hl-topn" value="${s.topN}" min="5" max="2000" step="5" aria-label="N" enterkeyhint="done"> bekannteste`
      : m === 'jahrzehnt'
        ? `Top-<input type="number" id="hl-decade" value="${s.decadeN}" min="1" max="200" aria-label="Lieder je Jahrzehnt" enterkeyhint="done"> je Jahrzehnt`
        : esc(POOL_LABELS[m]);
    return `<label class="chip-radio"><input type="radio" name="hl-pool" value="${m}" ${s.pool === m ? 'checked' : ''}><span>${extra}</span></label>`;
  }).join('')}</div>
        <h3>Zeitraum</h3>
        <div class="row years">
          <label class="field inline"><span>von</span><input type="number" id="hl-from" value="${s.from}" min="1956" max="2026" inputmode="numeric" enterkeyhint="done"></label>
          <label class="field inline"><span>bis</span><input type="number" id="hl-to" value="${s.to}" min="1956" max="2026" inputmode="numeric" enterkeyhint="done"></label>
        </div>
        <div class="muted small hint">${n} passende Lieder</div></div>
      <div class="row"><button class="btn primary big" data-act="hl-start" ${n < 6 ? 'disabled' : ''}>Spiel starten</button></div>`;
  },

  kartenHTML(song, m, { verdeckt = false, label = '' } = {}) {
    const inner = verdeckt
      ? '<div class="hl-wert hl-fragezeichen">?</div>'
      : `<div class="hl-wert" id="${label === 'rechts' ? 'hl-reveal-val' : ''}">${esc(m.anzeige(song))}</div>`;
    return `<div class="hl-card ${verdeckt ? 'verdeckt' : ''}">
      <div class="hl-year">${song.jahr}</div>
      <div class="hl-land">${flag(song.land_iso)}<span>${esc(song.land)}</span></div>
      <div class="hl-artist">${esc(song.interpret)}</div>
      <div class="hl-title">${esc(song.titel)}</div>
      ${inner}
    </div>`;
  },

  spielHTML() {
    const g = this.game;
    const m = HL_METRIKEN[g.metrik];
    const k = g.ketten[g.art === 'abwechseln' ? g.aktiv : 0];
    const links = byId(k.links);
    const rechts = byId(k.rechts);
    const aktiv = g.spieler[g.aktiv];
    const auf = g.phase === 'auf';
    const team = g.art === 'teamwork' ? g.spieler.reduce((n, p) => n + p.serie, 0) : null;
    const board = g.spieler.map((p, i) =>
      `<div class="mscore ${i === g.aktiv ? 'active' : ''} ${p.aus ? 'aus' : ''}"><span class="mname">${esc(p.name)}</span>${team === null ? `<span class="mval">${p.serie}</span>` : ''}</div>`).join('');
    let unten;
    if (!auf) {
      unten = `<div class="hl-frage">${esc(m.frage)}</div>
        <div class="hl-tasten">
          <button class="btn big hl-hoch" data-act="hl-tipp" data-tipp="hoch">▲ ${esc(m.hoch)}</button>
          <button class="btn big hl-tief" data-act="hl-tipp" data-tipp="tief">▼ ${esc(m.tief)}</button>
        </div>`;
    } else {
      const ok = g.letzte.ok;
      const letzter = !ok && (g.art === 'teamwork' || g.spieler.every((p, i) => p.aus || i === g.letzte.spieler));
      unten = `<div class="hl-ergebnis ${ok ? 'ok' : 'bad'}">${ok ? '✓ Richtig!' : '✗ Leider falsch'}
          <span class="muted small">${esc(aktiv.name)} · Serie ${aktiv.serie}</span></div>
        <div class="row center"><button class="btn primary big" data-act="hl-weiter">${ok ? 'Weiter' : (letzter ? 'Ergebnis' : 'Nächster Spieler')}</button></div>`;
    }
    return `<div class="hl-kopf">
        <div class="mscoreboard">${board}</div>
        <div class="hl-status"><span class="muted small">${esc(HL_ARTEN[g.art].label)} · ${esc(m.label)}${team !== null ? ` · Team-Serie ${team}${this.rekord[g.metrik] ? ` (Rekord ${this.rekord[g.metrik]})` : ''}` : ''}</span>
          <button class="btn small ghost" data-act="hl-abbruch">Abbrechen</button></div>
      </div>
      <div class="hl-turn"><b>${esc(aktiv.name)}</b> ist dran</div>
      <div class="hl-felder">
        ${this.kartenHTML(links, m, { label: 'links' })}
        <div class="hl-vs">VS</div>
        ${auf ? this.kartenHTML(rechts, m, { label: 'rechts' }) : this.kartenHTML(rechts, m, { verdeckt: true })}
      </div>
      <div class="hl-unten">${unten}</div>`;
  },

  endeHTML() {
    const g = this.game;
    const m = HL_METRIKEN[g.metrik];
    if (g.art === 'teamwork') {
      const n = g.spieler.reduce((sum, p) => sum + p.serie, 0);
      return `<div class="panel center hl-ende"><h2>Teamwork beendet</h2>
        <div class="hl-grossezahl">${n}</div>
        <div class="muted">${n === 1 ? 'richtiger Tipp' : 'richtige Tipps'} in Folge · ${esc(m.label)}</div>
        ${g.neuerRekord ? '<div class="hl-rekord">🏆 Neuer Rekord!</div>' : (this.rekord[g.metrik] ? `<div class="muted small">Rekord: ${this.rekord[g.metrik]}</div>` : '')}
        <div class="row center"><button class="btn primary big" data-act="hl-nochmal">Nochmal</button><button class="btn ghost" data-act="hl-setup">Zum Setup</button></div></div>`;
    }
    const r = hlRangliste(g);
    return `<div class="panel hl-ende"><h2 class="center">${r[0].platz === 1 && r.filter((x) => x.platz === 1).length > 1 ? 'Unentschieden' : `${esc(r[0].name)} gewinnt`}</h2>
      <ol class="rangliste">${r.map((x) => `<li class="${x.platz === 1 ? 'erster' : ''}"><span class="rp">${x.platz}.</span><span class="rn">${esc(x.name)}</span><span class="rs">Serie ${x.serie}</span></li>`).join('')}</ol>
      <div class="row center"><button class="btn primary big" data-act="hl-nochmal">Nochmal</button><button class="btn ghost" data-act="hl-setup">Zum Setup</button></div></div>`;
  },
};

/* ================================================================== Streaming ranken */
const st = {
  root: null,
  view: 'setup',
  s: null,
  game: null,
  spielt: null, // Id des Lieds, das als Hintergrundmusik geladen ist
  laeuft: false,

  init() {
    this.root = $('#screen-stream');
    audio.onStatus((an) => { this.laeuft = an; this.musikKnopf(); });
    this.s = { names: ['Spieler 1', 'Spieler 2'], ziel: 7, ...(store.get(KEY.stSettings) || {}) };
    if (!Array.isArray(this.s.names) || !this.s.names.length) this.s.names = ['Spieler 1', 'Spieler 2'];
    if (![5, 7, 10].includes(this.s.ziel)) this.s.ziel = 7;
    this.game = streamLade(store.get(KEY.stState));
    if (!this.game) store.del(KEY.stState);
    bindNames(this.root, this.s);
    this.root.addEventListener('click', (e) => this.klick(e));
    this.root.addEventListener('change', (e) => {
      if (e.target.name === 'st-ziel') { this.s.ziel = +e.target.value; store.set(KEY.stSettings, this.s); this.render(); }
    });
  },

  pool() { return streamPool(SONGS); },

  show() {
    this.view = this.game && !this.game.ende ? 'game' : (this.view === 'end' ? 'end' : 'setup');
    this.spielt = null; // nach dem Reiterwechsel ist die Musik aus, das aktuelle Lied startet neu
    this.render();
  },

  speichern() {
    if (this.game && !this.game.ende) store.set(KEY.stState, this.game);
    else store.del(KEY.stState);
  },

  klick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'st-plus' && this.s.names.length < MAX_SPIELER) { this.s.names.push(`Spieler ${this.s.names.length + 1}`); this.render(); }
    else if (act === 'st-minus' && this.s.names.length > 1) { this.s.names.pop(); this.render(); }
    else if (act === 'st-start') this.start();
    else if (act === 'st-resume') { this.view = 'game'; this.render(); }
    else if (act === 'st-discard') { this.game = null; this.speichern(); this.render(); }
    else if (act === 'st-gap') this.lege(+b.dataset.gap);
    else if (act === 'st-weiter') this.weiter();
    else if (act === 'st-musik') this.musikUmschalten();
    else if (act === 'st-player') audio.showPlayer();
    else if (act === 'st-setup') { this.view = 'setup'; this.game = null; this.speichern(); this.render(); }
    else if (act === 'st-nochmal') this.start();
    else if (act === 'st-abbruch') {
      if (!confirm('Spiel wirklich abbrechen?')) return;
      this.game = null; this.speichern(); this.view = 'setup'; this.render();
    }
  },

  start() {
    this.s.names = cleanNames(this.s.names);
    store.set(KEY.stSettings, this.s);
    const pool = this.pool();
    if (pool.length < this.s.names.length * this.s.ziel + 5) { alert('Zu wenige Lieder für diese Einstellung.'); return; }
    this.game = streamStart({ names: this.s.names, ziel: this.s.ziel }, pool);
    streamZiehe(this.game);
    this.view = 'game';
    this.speichern();
    this.render();
  },

  lege(gap) {
    if (!this.game || this.game.phase !== 'lege') return;
    streamLege(this.game, gap, byId);
    this.speichern();
    this.render();
  },

  weiter() {
    if (!this.game || this.game.phase !== 'auf') return;
    streamWeiter(this.game);
    if (this.game.ende) { this.view = 'end'; store.del(KEY.stState); confetti(); }
    this.speichern();
    this.render();
  },

  render() {
    if (this.view === 'game' && this.game) this.root.innerHTML = this.spielHTML();
    else if (this.view === 'end' && this.game) this.root.innerHTML = this.endeHTML();
    else this.root.innerHTML = this.setupHTML();
    this.musik();
    window.scrollTo(0, 0);
  },

  /** Hintergrundmusik: jede neue Karte startet ihr Lied ab dem Refrain, im Setup ist Ruhe. */
  musik() {
    if (this.view === 'end') return; // das letzte Lied läuft bei der Siegerehrung weiter
    const id = this.view === 'game' && this.game ? this.game.cur : null;
    if (!id) { this.spielt = null; audio.stop(); return; }
    if (id === this.spielt) { this.musikKnopf(); return; }
    this.spielt = id;
    if (this.s.musik === false) { audio.stop(); this.musikKnopf(); return; }
    audio.play(byId(id));
  },

  musikUmschalten() {
    if (this.laeuft) { audio.toggle(); this.s.musik = false; }
    else {
      this.s.musik = true;
      if (this.spielt) audio.play(byId(this.spielt));
    }
    store.set(KEY.stSettings, this.s);
  },

  musikKnopf() {
    const b = $('[data-act="st-musik"]', this.root);
    if (b) b.textContent = this.laeuft ? '⏸ Musik aus' : '▶ Musik an';
  },

  musikHTML() {
    return `<div class="st-musik">
      <button class="btn small ghost" data-act="st-musik">${this.laeuft ? '⏸ Musik aus' : '▶ Musik an'}</button>
      <label class="vol-row"><span aria-hidden="true">🔈</span><input type="range" class="vol" min="0" max="100" step="5" value="${audio.volume()}" aria-label="Lautstärke"><span aria-hidden="true">🔊</span></label>
      <button class="btn small ghost" data-act="st-player" title="Bei Werbung: Player einblenden und überspringen">📺 Player</button>
    </div>`;
  },

  setupHTML() {
    const s = this.s;
    const n = this.pool().length;
    const resume = this.game && !this.game.ende
      ? `<div class="panel resume"><div><strong>Gespeichertes Spiel gefunden</strong>
        <div class="muted">${this.game.spieler.length} Spieler · Ziel ${this.game.ziel} Karten</div></div>
        <div class="row"><button class="btn primary" data-act="st-resume">Fortsetzen</button><button class="btn ghost" data-act="st-discard">Verwerfen</button></div></div>`
      : '';
    return `<div class="hero-sub modi-head"><h1>Streaming <b>ranken</b></h1>
        <div class="muted">Wie Hitster, aber nach Aufrufen statt nach Jahren: Ordnet die Lieder von wenig nach viel.</div></div>
      ${resume}
      <div class="panel warn small">Demo: Verglichen werden <b>YouTube-Aufrufe</b> (Spotify bietet keine öffentlichen Streamzahlen). Dabei sind nur Beiträge ab ${STREAM_AB_JAHR} mit mindestens ${fmtViews(STREAM_MIN_VIEWS)} Aufrufen, also ${n} bekannte Lieder.</div>
      <div class="panel"><h2>Spieler</h2>${namenHTML(s.names, 'st')}</div>
      <div class="panel"><h2>Ziel: Karten in der Leiste</h2>
        ${chipsHTML('st-ziel', [[5, '5 Karten'], [7, '7 Karten'], [10, '10 Karten']], s.ziel)}
        <div class="muted small hint">Jeder startet mit einer Karte. Ihr seht Interpret und Titel und legt das Lied dorthin, wo es nach Aufrufen hingehört. Dazu läuft das Lied im Hintergrund, wenn möglich ab dem Refrain. Richtig: Die Karte bleibt. Falsch: Sie fliegt raus. Gewonnen hat, wer nach einer vollen Runde die meisten Karten hat.</div></div>
      <div class="row"><button class="btn primary big" data-act="st-start">Spiel starten</button></div>`;
  },

  leisteHTML(sp, zeigeLuecken, letzteId) {
    const karten = sp.leiste.map(byId);
    const gap = (i) => (zeigeLuecken ? `<button class="st-gap" data-act="st-gap" data-gap="${i}" aria-label="Hier einsortieren">＋</button>` : '');
    const parts = [];
    karten.forEach((s, i) => {
      parts.push(gap(i));
      parts.push(`<div class="st-card ${s.id === letzteId ? 'neu' : ''}">
        <div class="st-views">${fmtViews(s.yt_views)}</div>
        <div class="st-artist">${esc(s.interpret)}</div>
        <div class="st-title">${esc(s.titel)}</div>
        <div class="st-meta">${s.jahr} · ${esc(s.land)}</div></div>`);
    });
    parts.push(gap(karten.length));
    return `<div class="st-leiste"><div class="st-achse"><span>weniger Aufrufe</span><span>mehr Aufrufe</span></div><div class="st-reihe">${parts.join('')}</div></div>`;
  },

  spielHTML() {
    const g = this.game;
    const sp = g.spieler[g.aktiv];
    const song = byId(g.cur);
    const auf = g.phase === 'auf';
    const board = g.spieler.map((p, i) =>
      `<div class="mscore ${i === g.aktiv ? 'active' : ''}"><span class="mname">${esc(p.name)}</span><span class="mval">${p.leiste.length}/${g.ziel}</span></div>`).join('');
    const l = g.letzte;
    const ergebnis = auf
      ? `<div class="hl-ergebnis ${l.ok ? 'ok' : 'bad'}">${l.ok ? '✓ Richtig einsortiert!' : '✗ Falsch – die Karte fliegt raus'}
          <span class="muted small">${esc(song.interpret)} – ${esc(song.titel)}: <b>${fmtViews(song.yt_views)}</b> Aufrufe</span></div>
         <div class="row center"><button class="btn primary big" data-act="st-weiter">Weiter</button></div>`
      : '<div class="muted small center">Tippe auf ＋, wo das Lied in der Leiste hingehört.</div>';
    return `<div class="hl-kopf"><div class="mscoreboard">${board}</div>
        <div class="hl-status"><span class="muted small">Streaming ranken · Ziel ${g.ziel} Karten</span><button class="btn small ghost" data-act="st-abbruch">Abbrechen</button></div></div>
      <div class="hl-turn"><b>${esc(sp.name)}</b> ist dran</div>
      <div class="st-aktuell"><div class="hl-card ${auf ? '' : 'verdeckt'}">
        <div class="hl-year">${song.jahr}</div>
        <div class="hl-land">${flag(song.land_iso)}<span>${esc(song.land)}</span></div>
        <div class="hl-artist">${esc(song.interpret)}</div><div class="hl-title">${esc(song.titel)}</div>
        <div class="hl-wert ${auf ? '' : 'hl-fragezeichen'}">${auf ? fmtViews(song.yt_views) : '? Aufrufe'}</div></div></div>
      ${ergebnis}
      ${this.leisteHTML(sp, !auf, auf && l.ok ? l.id : null)}
      ${this.musikHTML()}`;
  },

  endeHTML() {
    const g = this.game;
    const r = streamRangliste(g);
    const gewinner = r.filter((x) => x.platz === 1);
    return `<div class="panel hl-ende"><h2 class="center">${gewinner.length > 1 ? 'Unentschieden' : `${esc(r[0].name)} gewinnt`}</h2>
      <ol class="rangliste">${r.map((x) => `<li class="${x.platz === 1 ? 'erster' : ''}"><span class="rp">${x.platz}.</span><span class="rn">${esc(x.name)}</span><span class="rs">${x.karten} Karten</span></li>`).join('')}</ol>
      <div class="row center"><button class="btn primary big" data-act="st-nochmal">Nochmal</button><button class="btn ghost" data-act="st-setup">Zum Setup</button></div></div>`;
  },
};

