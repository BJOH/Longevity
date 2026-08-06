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
    food: Array.isArray(e.food) && e.food.length ? e.food : null,
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
    food: Array.isArray(r.food) && r.food.length ? r.food : undefined,
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

/* ---------- Livsmedelsdatabas & matlogg ----------
   food_db är en snapshot av Livsmedelsverkets livsmedelsdatabas
   (2 606 livsmedel, värden per 100 g) som söks via en rankad RPC. */

export async function searchFood(q, maxRows = 30) {
  const { data, error } = await sb.rpc('search_food', { q, max_rows: maxRows });
  if (error) throw error;
  return data.map(r => ({
    id: r.id, namn: r.namn,
    kcal: num(r.kcal), fett: num(r.fett), kolh: num(r.kolh),
    protein: num(r.protein), fiber: num(r.fiber),
    socker: num(r.socker), mattat: num(r.mattat), salt: num(r.salt),
  }));
}
const num = v => (v === null || v === undefined) ? null : Number(v);

/* Egna livsmedel (privata per konto), värden per 100 g */
export async function listCustomFoods() {
  const { data, error } = await sb.from('custom_foods')
    .select('*').order('namn');
  if (error) throw error;
  return data;
}

export async function saveCustomFood(f) {
  const row = {
    ...(f.id ? { id: f.id } : {}),
    user_id: user.id,
    namn: f.namn, brand: f.brand || null, barcode: f.barcode || null,
    kcal: f.kcal ?? null, fett: f.fett ?? null, kolh: f.kolh ?? null,
    protein: f.protein ?? null, fiber: f.fiber ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from('custom_foods')
    .upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCustomFood(id) {
  const { error } = await sb.from('custom_foods').delete().eq('id', id);
  if (error) throw error;
}

/* Streckkod → produkt via Open Food Facts (öppet API, CORS-fritt).
   Returnerar värden per 100 g eller null om produkten saknas. */
export async function lookupBarcode(code) {
  const fields = 'product_name,brands,nutriments,serving_quantity';
  const r = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`,
    { headers: { Accept: 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Uppslag misslyckades (${r.status})`);
  const j = await r.json();
  if (!j.product) return null;
  const n = j.product.nutriments || {};
  const g = k => (typeof n[k] === 'number' ? n[k] : null);
  return {
    namn: j.product.product_name || `Produkt ${code}`,
    brand: (j.product.brands || '').split(',')[0].trim() || null,
    serving: Number(j.product.serving_quantity) || null,
    kcal: g('energy-kcal_100g'),
    fett: g('fat_100g'), kolh: g('carbohydrates_100g'),
    protein: g('proteins_100g'), fiber: g('fiber_100g'),
  };
}

/* AI-analys av matbild/beskrivning via Edge-funktionen analyze-food.
   Svar: {namn, gram, kcal, fett, kolh, protein, fiber, beskrivning, sakerhet}
   eller {error: 'saknar_nyckel' | ...}. */
export async function analyzeFood({ image, mediaType, text }) {
  const { data, error } = await sb.functions.invoke('analyze-food', {
    body: { image, mediaType, text },
  });
  if (error) throw new Error(error.message || 'Analysen misslyckades');
  return data;
}
