/* Datalager: allt sparas lokalt i webbläsaren (localStorage). */
const STORAGE_KEY = 'longevity.v1';

export const DEFAULT_GOALS = {
  weightTarget: null,   // kg (valfritt)
  fastingHours: 16,     // timmar fasta per dygn
  exerciseMin: 30,      // minuter träning per dag
  sleepHours: 7.5,      // timmar sömn per natt
  steps: 8000,          // steg per dag
  rules: '',            // egna regler i punktform (- och --), synkas med målen
  /* Per måltidsplats: show = syns i min veckoplan, shared = delas i hushållet
     (annars privat och osynlig för partnern). Synkas med målen. */
  mealPrefs: {
    frukost: { show: true, shared: true },
    mellanmal_fm: { show: false, shared: false },
    lunch: { show: true, shared: true },
    mellanmal_em: { show: false, shared: false },
    middag: { show: true, shared: true },
    mellanmal_kvall: { show: false, shared: false },
  },
  theme: 'auto',        // auto | light | dark
};

/* En dagspost:
   { weight, firstMeal:"HH:MM", lastMeal:"HH:MM", fastingHours,
     exerciseMin, exerciseType, sleepHours, steps, dietOk, notes } */

let state = load();

/* Synk-krokar: sätts av sync.js så att lokala ändringar skrivs till molnet.
   Import/molnhämtning går via mergeImported/applyCloudGoals och triggar inte. */
let syncHandler = null;
export function setSyncHandler(handler) { syncHandler = handler; }

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        goals: { ...DEFAULT_GOALS, ...(parsed.goals || {}) },
        entries: parsed.entries || {},
      };
    }
  } catch (e) {
    console.error('Kunde inte läsa sparad data', e);
  }
  return { goals: { ...DEFAULT_GOALS }, entries: {} };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getGoals() {
  // Djupmerga mealPrefs så nya platser får standardvärden
  return {
    ...state.goals,
    mealPrefs: { ...DEFAULT_GOALS.mealPrefs, ...(state.goals.mealPrefs || {}) },
  };
}

export function setGoals(patch) {
  state.goals = { ...state.goals, ...patch };
  persist();
  if (syncHandler) syncHandler.goals();
}

/* Mål hämtade från molnet — sparas lokalt utan att trigga ny uppladdning. */
export function applyCloudGoals(goals) {
  state.goals = { ...state.goals, ...goals };
  persist();
}

export function getEntry(dateKey) {
  return state.entries[dateKey] ? { ...state.entries[dateKey] } : {};
}

export function updateEntry(dateKey, patch) {
  const cur = state.entries[dateKey] || {};
  const next = { ...cur, ...patch };
  // Rensa tomma fält så exporten hålls ren
  for (const k of Object.keys(next)) {
    if (next[k] === '' || next[k] === null || next[k] === undefined ||
        (typeof next[k] === 'number' && Number.isNaN(next[k]))) {
      delete next[k];
    }
  }
  if (Object.keys(next).length === 0) delete state.entries[dateKey];
  else state.entries[dateKey] = next;
  persist();
  if (syncHandler) syncHandler.entry(dateKey);
  return getEntry(dateKey);
}

/* Slår ihop importerad data utan att skriva över manuellt ifyllda värden. */
export function mergeImported(entriesByDate, { overwrite = false } = {}) {
  let changed = 0;
  for (const [dateKey, patch] of Object.entries(entriesByDate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    const cur = state.entries[dateKey] || {};
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) continue;
      if (overwrite || cur[k] === undefined) {
        next[k] = v;
        changed++;
      }
    }
    state.entries[dateKey] = next;
  }
  if (changed) persist();
  return changed;
}

/* Fastetimmar: angivna direkt, annars beräknade ur ätfönstret (24h - fönster). */
export function fastingHoursFor(entry) {
  if (typeof entry.fastingHours === 'number') return entry.fastingHours;
  if (entry.firstMeal && entry.lastMeal) {
    const [fh, fm] = entry.firstMeal.split(':').map(Number);
    const [lh, lm] = entry.lastMeal.split(':').map(Number);
    let windowMin = (lh * 60 + lm) - (fh * 60 + fm);
    if (windowMin < 0) windowMin += 24 * 60; // ätfönster över midnatt
    return Math.round((24 - windowMin / 60) * 10) / 10;
  }
  return null;
}

/* Serie [{date, value}] för ett mätvärde, senaste `days` dagarna, stigande datum. */
export function series(metric, days) {
  const out = [];
  const end = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const key = todayKey(d);
    const e = state.entries[key];
    if (!e) continue;
    let v = null;
    if (metric === 'fastingHours') v = fastingHoursFor(e);
    else if (typeof e[metric] === 'number') v = e[metric];
    if (v !== null && isFinite(v)) out.push({ date: key, value: v });
  }
  return out;
}

export function allEntriesSorted() {
  return Object.keys(state.entries).sort().reverse()
    .map(k => ({ date: k, ...state.entries[k] }));
}

/* Målstatus för en dag → [{key, label, done, detail}] */
export function goalStatus(dateKey) {
  const g = state.goals;
  const e = getEntry(dateKey);
  const fast = fastingHoursFor(e);
  const sv = n => n.toLocaleString('sv-SE');
  return [
    {
      key: 'weight', label: 'Väg dig', icon: '⚖️',
      done: typeof e.weight === 'number',
      detail: typeof e.weight === 'number' ? `${sv(e.weight)} kg` : 'Ej loggat',
    },
    {
      key: 'fasting', label: `Fasta ${sv(g.fastingHours)} h`, icon: '⏳',
      done: fast !== null && fast >= g.fastingHours,
      detail: fast !== null ? `${sv(fast)} h fasta` : 'Ej loggat',
    },
    {
      key: 'exercise', label: `Träna ${g.exerciseMin} min`, icon: '🏃',
      done: typeof e.exerciseMin === 'number' && e.exerciseMin >= g.exerciseMin,
      detail: typeof e.exerciseMin === 'number' ? `${e.exerciseMin} min` : 'Ej loggat',
    },
    {
      key: 'steps', label: `Gå ${sv(g.steps)} steg`, icon: '👣',
      done: typeof e.steps === 'number' && e.steps >= g.steps,
      detail: typeof e.steps === 'number' ? `${sv(e.steps)} steg` : 'Ej loggat',
    },
    {
      key: 'sleep', label: `Sov ${sv(g.sleepHours)} h`, icon: '😴',
      done: typeof e.sleepHours === 'number' && e.sleepHours >= g.sleepHours,
      detail: typeof e.sleepHours === 'number' ? `${sv(e.sleepHours)} h sömn` : 'Ej loggat',
    },
    {
      key: 'diet', label: 'Ät enligt plan', icon: '🥗',
      done: e.dietOk === true,
      detail: e.dietOk === true ? 'Klart' : 'Ej avbockat',
    },
  ];
}

/* Andel avklarade mål för en dag, eller null om inget alls är loggat. */
export function goalFraction(dateKey) {
  if (!state.entries[dateKey]) return null;
  const st = goalStatus(dateKey);
  return { done: st.filter(s => s.done).length, total: st.length };
}

/* Antal dagar i rad (bakåt från idag) där alla mål är uppfyllda. */
export function streak() {
  let n = 0;
  const d = new Date();
  // Idag räknas bara om alla mål redan är klara
  for (;;) {
    const st = goalStatus(todayKey(d));
    const all = st.every(s => s.done);
    if (!all) {
      if (n === 0 && todayKey(d) === todayKey()) { d.setDate(d.getDate() - 1); continue; }
      break;
    }
    n++;
    d.setDate(d.getDate() - 1);
    if (n > 3650) break;
  }
  return n;
}

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !parsed.entries) {
    throw new Error('Filen ser inte ut som en Longevity-backup.');
  }
  state = {
    goals: { ...DEFAULT_GOALS, ...(parsed.goals || {}) },
    entries: parsed.entries,
  };
  persist();
}

export function clearAll() {
  state = { goals: { ...DEFAULT_GOALS }, entries: {} };
  persist();
}
