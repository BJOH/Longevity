/* Molnlager mot Supabase: konton, synk av dagliga poster och mål, samt den
   delade måltidsplanen. supabase-js är inbundlad (js/vendor/) så appen har
   inga CDN-beroenden och fungerar offline. */
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { createClient } from './vendor/supabase-js.js';

let sb = null;
let user = null;
const authListeners = new Set();

export async function initCloud() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await sb.auth.getSession();
    user = data.session?.user ?? null;
    sb.auth.onAuthStateChange((_event, session) => {
      const prevId = user?.id;
      user = session?.user ?? null;
      if (prevId !== user?.id) authListeners.forEach(fn => fn(user));
    });
    return true;
  } catch (err) {
    console.warn('Molnsynk otillgänglig (offline?):', err);
    return false;
  }
}

export const cloudAvailable = () => sb !== null;
export const currentUser = () => user;
export const onAuthChange = (fn) => authListeners.add(fn);

/* ---------- Konto ---------- */

export async function signUp(email, password, displayName) {
  const { error } = await sb.auth.signUp({
    email, password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: location.origin + location.pathname,
    },
  });
  if (error) throw error;
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

/* ---------- Dagliga poster ---------- */

const hhmm = t => (t ? t.slice(0, 5) : undefined);

function toRow(dateKey, e) {
  return {
    user_id: user.id,
    date: dateKey,
    weight: e.weight ?? null,
    first_meal: e.firstMeal || null,
    last_meal: e.lastMeal || null,
    fasting_hours: e.fastingHours ?? null,
    exercise_min: e.exerciseMin ?? null,
    exercise_type: e.exerciseType || null,
    sleep_hours: e.sleepHours ?? null,
    steps: e.steps ?? null,
    diet_ok: e.dietOk ?? null,
    notes: e.notes || null,
    updated_at: new Date().toISOString(),
  };
}

function fromRow(r) {
  const e = {
    weight: r.weight === null ? undefined : Number(r.weight),
    firstMeal: hhmm(r.first_meal),
    lastMeal: hhmm(r.last_meal),
    fastingHours: r.fasting_hours === null ? undefined : Number(r.fasting_hours),
    exerciseMin: r.exercise_min ?? undefined,
    exerciseType: r.exercise_type ?? undefined,
    sleepHours: r.sleep_hours === null ? undefined : Number(r.sleep_hours),
    steps: r.steps ?? undefined,
    dietOk: r.diet_ok ?? undefined,
    notes: r.notes ?? undefined,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

export async function pushEntry(dateKey, entry) {
  const { error } = await sb.from('entries').upsert(toRow(dateKey, entry));
  if (error) throw error;
}

/* Batch-uppladdning (Apple Hälsa-import kan gälla hundratals dagar). */
export async function pushEntriesBulk(entriesByDate) {
  const rows = Object.entries(entriesByDate).map(([d, e]) => toRow(d, e));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('entries').upsert(rows.slice(i, i + 500));
    if (error) throw error;
  }
}

export async function pullEntries() {
  const { data, error } = await sb.from('entries').select('*');
  if (error) throw error;
  const out = {};
  for (const row of data) out[row.date] = fromRow(row);
  return out;
}

/* ---------- Profil & mål ---------- */

export async function pullProfile() {
  const { data, error } = await sb.from('profiles')
    .select('display_name, goals').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

export async function pushGoals(goals) {
  const { error } = await sb.from('profiles')
    .update({ goals, updated_at: new Date().toISOString() }).eq('id', user.id);
  if (error) throw error;
}

export async function listProfiles() {
  const { data, error } = await sb.from('profiles').select('id, display_name');
  if (error) throw error;
  return data;
}

/* ---------- Måltidsplan ----------
   owner_key: noll-uuid = delad i hushållet, annars ägarens id (privat). */

const SHARED_KEY = '00000000-0000-0000-0000-000000000000';

export async function listMeals(fromDate, toDate) {
  const { data, error } = await sb.from('meal_plans')
    .select('date, meal_type, title, notes, created_by, owner_key')
    .gte('date', fromDate).lte('date', toDate);
  if (error) throw error;
  return data;
}

export const isSharedMeal = (row) => row.owner_key === SHARED_KEY;

export async function upsertMeal(dateKey, mealType, title, shared) {
  const { error } = await sb.from('meal_plans').upsert({
    date: dateKey, meal_type: mealType, title,
    owner_key: shared ? SHARED_KEY : user.id,
    created_by: user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'date,meal_type,owner_key' });
  if (error) throw error;
}

export async function deleteMeal(dateKey, mealType, shared) {
  const { error } = await sb.from('meal_plans')
    .delete().eq('date', dateKey).eq('meal_type', mealType)
    .eq('owner_key', shared ? SHARED_KEY : user.id);
  if (error) throw error;
}
