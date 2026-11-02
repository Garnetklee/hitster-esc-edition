// Spielregeln, fertige Modi und Migration gespeicherter Stände (ohne DOM)

export const SETTINGS_VERSION = 4;
export const CONVERT_TARGETS = [3, 4, 5, 6, 8, 10];
export const TIME_LIMITS = [0, 15, 20, 30, 45, 60];
export const TARGET_CHOICES = [3, 5, 7, 10, 15];

export const DEFAULT_RULES = {
  steal: false,
  country: 'off', // off | choice | free
  place: 'off', // off | neighbor | free
  exact: 0, // genaues Jahr raten: 0 | 1
  artist: false,
  title: false,
  suggest: false, // Autovervollständigung für Interpret und Titel
  convert: false, // Tokens in Bonuskarten umwandeln
  convertAt: 5,
  timeLimit: 0, // Sekunden, 0 = aus
  renew: 'free', // Weiterhören: free = immer gratis | paid = einmal gratis, danach ½ Token
};

const CLASSIC = { ...DEFAULT_RULES, exact: 1, artist: true, title: true };

export const PRESETS = [
  {
    id: 'entspannt', name: 'Entspannt',
    desc: 'Nur die Zeitleiste, ohne Zeitdruck.',
    rules: { ...DEFAULT_RULES },
  },
  {
    id: 'klassisch', name: 'Klassisch',
    desc: 'Wie das Original: Interpret, Titel und Jahr bringen Tokens.',
    rules: { ...CLASSIC },
  },
  {
    id: 'edition', name: 'ESC Edition', sub: 'einfacher Modus',
    desc: '20 s pro Lied, beliebig oft verlängerbar, mit Vorschlägen beim Tippen.',
    rules: { ...CLASSIC, suggest: true, timeLimit: 20 },
    toggles: { country: 'choice', place: 'neighbor' },
  },
  {
    id: 'esc', name: 'ESC Modus', sub: 'schwerer Modus',
    desc: '20 s pro Lied, einmal gratis verlängern, danach kostet es ½ Token.',
    rules: { ...CLASSIC, timeLimit: 20, renew: 'paid' },
    toggles: { country: 'free', place: 'free' },
  },
];
export const DEFAULT_PRESET = 'klassisch';
export const presetById = (id) => PRESETS.find((p) => p.id === id);

/** Gleiche Regeln? convertAt zählt nur beim Umwandeln, renew nur mit Zeitlimit. */
export function rulesEqual(a, b) {
  for (const k of Object.keys(DEFAULT_RULES)) {
    if (k === 'convertAt' && !a.convert) continue;
    if (k === 'renew' && !a.timeLimit) continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** Passen die Regeln zum Modus? Die Regler dürfen dabei aus oder auf dem Wert des Modus stehen. */
export function presetMatches(r, p) {
  const t = p.toggles || {};
  const fixed = { ...r };
  for (const k of Object.keys(t)) {
    if (r[k] !== 'off' && r[k] !== t[k]) return false;
    fixed[k] = p.rules[k];
  }
  return rulesEqual(fixed, p.rules);
}

export const matchingPreset = (r) => PRESETS.find((p) => presetMatches(r, p));

// Party und ESC-Profi gibt es seit Version 4 nicht mehr
const OLD_PARTY = { country: 'choice', place: 'neighbor', exact: 1, bonus: 'count', timeLimit: 30 };
const OLD_PROFI = { country: 'free', place: 'free', exact: 2, bonus: 'convert', timeLimit: 20 };
const isOld = (r, old) => !r.steal && Object.keys(old).every((k) => r[k] === old[k]);

/** Regeln vor Version 4: Bonus wird zu Tokens, Punktlandung nur noch an oder aus. */
function upgradeRules(old) {
  const { bonus, ...rest } = old;
  return { ...DEFAULT_RULES, ...rest, exact: old.exact ? 1 : 0, convert: old.convert ?? bonus === 'convert' };
}

/** Alte gespeicherte Einstellungen: Party und ESC-Profi werden zu Klassisch, eigene Regeln bleiben erhalten. */
export function migrateSettings(st) {
  if (!st) return null;
  if (st.v >= SETTINGS_VERSION) return st;
  const { modes, ...rest } = st;
  const old = st.rules;
  const classic = !old || (st.v || 0) < 2 || isOld(old, OLD_PARTY) || isOld(old, OLD_PROFI);
  return {
    ...rest,
    v: SETTINGS_VERSION,
    rules: classic ? { ...presetById(DEFAULT_PRESET).rules } : upgradeRules(old),
  };
}

/** Laufendes Spiel aus einer alten Version: bisherige Regeln übernehmen, neue Felder ergänzen. */
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
  const oldBonus = set.rules.bonus;
  set.rules = upgradeRules(set.rules);
  saved.first = saved.first ?? 0;
  for (const p of saved.players) {
    const bonus = p.bonus || 0;
    delete p.bonus;
    if (oldBonus === 'convert') {
      p.bonusCards = Math.floor(bonus / set.rules.convertAt);
      p.tokens += bonus % set.rules.convertAt;
    } else p.tokens += bonus;
    p.bonusCards = p.bonusCards || 0;
    p.freeSkips = p.freeSkips ?? 1;
    p.wrong = p.wrong || [];
  }
  const c = saved.cur;
  if (c) {
    c.exact = c.exact ?? '';
    c.artistTip = c.artistTip ?? '';
    c.titleTip = c.titleTip ?? '';
    c.heard = c.heard || 0;
    c.timeUp = !!c.timeUp;
    c.released = !!c.released;
    c.renewals = c.renewals || 0;
    c.country = { text: '', ...c.country };
    c.place = { free: '', hf: false, ...c.place };
  }
  return saved;
}
