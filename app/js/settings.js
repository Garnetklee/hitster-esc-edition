// Spielregeln, fertige Modi und Migration gespeicherter Stände (ohne DOM)

export const SETTINGS_VERSION = 2;
export const BONUS_TARGETS = [3, 4, 5, 6, 8, 10];
export const TIME_LIMITS = [0, 15, 20, 30, 45, 60];

export const DEFAULT_RULES = {
  steal: false,
  country: 'off', // off | choice | free
  place: 'off', // off | neighbor | free
  exact: 0, // Bonuspunkte für das genaue Jahr: 0 | 1 | 2
  bonus: 'tokens', // tokens | count | convert
  convertAt: 5,
  timeLimit: 0, // Sekunden, 0 = aus
};

export const PRESETS = [
  {
    id: 'entspannt', name: 'Entspannt',
    desc: 'Nur die Zeitleiste, ohne Zeitdruck.',
    rules: { ...DEFAULT_RULES },
  },
  {
    id: 'klassisch', name: 'Klassisch',
    desc: 'Wie das Original: Genaues Jahr bringt Tokens.',
    rules: { ...DEFAULT_RULES, exact: 1 },
  },
  {
    id: 'party', name: 'Party',
    desc: 'Land und Platzierung raten, Bonus zählen, 30 s pro Lied.',
    rules: { ...DEFAULT_RULES, country: 'choice', place: 'neighbor', exact: 1, bonus: 'count', timeLimit: 30 },
  },
  {
    id: 'profi', name: 'ESC-Profi',
    desc: 'Alles frei eingeben, 5 Bonus = 1 Karte, 20 s pro Lied.',
    rules: { ...DEFAULT_RULES, country: 'free', place: 'free', exact: 2, bonus: 'convert', convertAt: 5, timeLimit: 20 },
  },
];
export const DEFAULT_PRESET = 'klassisch';
export const presetById = (id) => PRESETS.find((p) => p.id === id);

/** Gleiche Regeln? convertAt zählt nur, wenn wirklich umgewandelt wird. */
export function rulesEqual(a, b) {
  for (const k of Object.keys(DEFAULT_RULES)) {
    if (k === 'convertAt' && a.bonus !== 'convert') continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** Alte gespeicherte Einstellungen: 2020 einmalig an, Regeln zurück auf den Standardmodus. */
export function migrateSettings(st) {
  if (!st) return null;
  if (st.v >= SETTINGS_VERSION) return st;
  const { modes, ...rest } = st;
  return {
    ...rest,
    v: SETTINGS_VERSION,
    filter: { ...(st.filter || {}), incl2020: true },
    rules: { ...presetById(DEFAULT_PRESET).rules },
  };
}

/** Laufendes Spiel aus der alten Version: bisherige Regeln übernehmen, neue Felder ergänzen. */
export function migrateState(saved) {
  const set = saved.settings;
  if (!set.rules) {
    const m = set.modes || {};
    set.rules = {
      ...DEFAULT_RULES,
      steal: true,
      country: m.country ? 'choice' : 'off',
      place: m.place ? 'neighbor' : 'off',
    };
    delete set.modes;
  }
  for (const p of saved.players) p.bonus = p.bonus || 0;
  const c = saved.cur;
  if (c) {
    c.exact = c.exact ?? '';
    c.heard = c.heard || 0;
    c.timeUp = !!c.timeUp;
    c.released = !!c.released;
    c.country = { text: '', ...c.country };
    c.place = { free: '', hf: false, ...c.place };
  }
  return saved;
}
