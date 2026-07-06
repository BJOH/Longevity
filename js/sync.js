/* Synk-orkestrering: lokalt är alltid källan för UI:t (offline-first);
   inloggad användare får allt skrivet vidare till molnet. Misslyckade
   skrivningar köas i localStorage och skickas när nätet är tillbaka. */
import * as store from './store.js';
import * as cloud from './cloud.js';

const PENDING_KEY = 'longevity.pending';

function pending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || { entries: {}, goals: false }; }
  catch { return { entries: {}, goals: false }; }
}
function savePending(p) { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); }

let syncStateListener = null;
export function onSyncState(fn) { syncStateListener = fn; }
function notify(state) { if (syncStateListener) syncStateListener(state); }

async function pushEntrySafe(dateKey) {
  if (!cloud.currentUser()) return;
  try {
    await cloud.pushEntry(dateKey, store.getEntry(dateKey));
    notify('ok');
  } catch (err) {
    const p = pending();
    p.entries[dateKey] = true;
    savePending(p);
    notify('pending');
  }
}

async function pushGoalsSafe() {
  if (!cloud.currentUser()) return;
  try {
    const { theme, ...goals } = store.getGoals(); // tema är per enhet
    await cloud.pushGoals(goals);
    notify('ok');
  } catch {
    const p = pending();
    p.goals = true;
    savePending(p);
    notify('pending');
  }
}

export async function flushPending() {
  if (!cloud.currentUser()) return;
  const p = pending();
  const dates = Object.keys(p.entries);
  if (!dates.length && !p.goals) return;
  for (const d of dates) {
    await cloud.pushEntry(d, store.getEntry(d));
    delete p.entries[d];
    savePending(p);
  }
  if (p.goals) {
    const { theme, ...goals } = store.getGoals();
    await cloud.pushGoals(goals);
    p.goals = false;
    savePending(p);
  }
  notify('ok');
}

/* Full synk vid inloggning/appstart:
   1. Hämta molnets poster.
   2. Ladda upp lokala dagar som molnet saknar (t.ex. loggat innan kontot fanns).
   3. Låt molnets värden vinna lokalt (senast sparade sanningen).
   4. Mål: molnets vinner om de finns, annars laddas lokala upp. */
export async function fullSync() {
  if (!cloud.currentUser()) return;
  notify('syncing');
  try {
    const cloudEntries = await cloud.pullEntries();
    const localDates = store.allEntriesSorted().map(e => e.date);
    for (const d of localDates) {
      if (!cloudEntries[d]) await cloud.pushEntry(d, store.getEntry(d));
    }
    store.mergeImported(cloudEntries, { overwrite: true });

    const profile = await cloud.pullProfile();
    if (profile.goals && Object.keys(profile.goals).length) {
      store.applyCloudGoals(profile.goals);
    } else {
      const { theme, ...goals } = store.getGoals();
      await cloud.pushGoals(goals);
    }
    await flushPending();
    notify('ok');
  } catch (err) {
    console.warn('Synk misslyckades:', err);
    notify('error');
  }
}

/* Efter en import: ladda upp alla berörda dagar i batch. */
export async function pushDates(dateKeys) {
  if (!cloud.currentUser() || !dateKeys.length) return;
  try {
    const map = {};
    for (const d of dateKeys) map[d] = store.getEntry(d);
    await cloud.pushEntriesBulk(map);
    notify('ok');
  } catch {
    const p = pending();
    for (const d of dateKeys) p.entries[d] = true;
    savePending(p);
    notify('pending');
  }
}

/* onChange anropas direkt när inloggningsläget är känt (snabbt — läser bara
   sparad session) och igen efter varje in-/utloggning och avslutad fullsynk,
   så att UI:t kan visa rätt vy utan att vänta på nätverket. */
export async function initSync(onChange) {
  const ok = await cloud.initCloud();
  if (!ok) {
    notify('offline');
    if (onChange) onChange();
    return;
  }

  store.setSyncHandler({ entry: pushEntrySafe, goals: pushGoalsSafe });
  cloud.onAuthChange(async (user) => {
    if (onChange) onChange();
    if (user) {
      await fullSync();
      if (onChange) onChange();
    }
  });
  window.addEventListener('online', () => flushPending().catch(() => {}));

  if (onChange) onChange();
  if (cloud.currentUser()) {
    fullSync().then(() => { if (onChange) onChange(); });
  }
}
