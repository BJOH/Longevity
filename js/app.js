import * as store from './store.js';
import * as cloud from './cloud.js';
import * as sync from './sync.js';
import { renderChart } from './charts.js';
import { parseAppleHealthXML, parseHealthAutoExport, parseLogURL } from './import.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let currentView = 'today';
let trendRange = Number(localStorage.getItem('longevity.range') || 30);

/* ---------- Tema ---------- */
function applyTheme() {
  const t = store.getGoals().theme || 'auto';
  document.documentElement.dataset.theme = t === 'auto' ? '' : t;
}

/* ---------- Navigering ---------- */
function show(view) {
  currentView = view;
  $$('.view').forEach(v => v.hidden = v.dataset.view !== view);
  $$('.tabbar button').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  if (view === 'today') renderToday();
  if (view === 'trends') renderTrends();
  if (view === 'meals') renderMeals();
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

/* Färgskala för måluppfyllnad: blå (0 mål) → grön (alla mål). */
function goalColor(frac) {
  const h = Math.round(212 + (120 - 212) * frac);
  const s = Math.round(66 + (86 - 66) * frac);
  const l = Math.round(50 + (34 - 50) * frac);
  return `hsl(${h} ${s}% ${l}%)`;
}

/* Regler: rader med "-" blir punkter, "--" underpunkter, övriga rubriker. */
function renderRulesInto(container, text) {
  container.textContent = '';
  let topUl = null, subUl = null;
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const sub = /^(--|––|—)\s*/.exec(line);
    const top = !sub && /^[-–]\s*/.exec(line);
    if (sub) {
      if (!topUl) { topUl = document.createElement('ul'); container.appendChild(topUl); }
      if (!subUl) {
        subUl = document.createElement('ul');
        (topUl.lastElementChild || topUl.appendChild(document.createElement('li'))).appendChild(subUl);
      }
      const li = document.createElement('li');
      li.textContent = line.slice(sub[0].length);
      subUl.appendChild(li);
    } else if (top) {
      if (!topUl) { topUl = document.createElement('ul'); container.appendChild(topUl); }
      const li = document.createElement('li');
      li.textContent = line.slice(top[0].length);
      topUl.appendChild(li);
      subUl = null;
    } else {
      const h = document.createElement('strong');
      h.className = 'rules-heading';
      h.textContent = line;
      container.appendChild(h);
      topUl = null; subUl = null;
    }
  }
}

/* ---------- Idag ---------- */
function renderToday() {
  const key = store.todayKey();
  const e = store.getEntry(key);
  const goals = store.goalStatus(key);
  const done = goals.filter(g => g.done).length;

  $('#today-date').textContent = new Date().toLocaleDateString('sv-SE', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  // Progressring — färgen går från blå till grön med antalet avklarade mål
  const pct = done / goals.length;
  const ring = $('#progress-ring-fg');
  const C = 2 * Math.PI * 52;
  ring.setAttribute('stroke-dasharray', `${(C * pct).toFixed(1)} ${C.toFixed(1)}`);
  ring.style.stroke = goalColor(pct);
  $('#progress-count').textContent = `${done}/${goals.length}`;
  const streak = store.streak();
  $('#streak').textContent = streak > 0
    ? `🔥 ${streak} ${streak === 1 ? 'dag' : 'dagar'} i rad — alla mål`
    : 'Bocka av dagens mål nedan';

  // Checklista
  const list = $('#goal-list');
  list.textContent = '';
  for (const g of goals) {
    const li = document.createElement('li');
    li.className = 'goal' + (g.done ? ' is-done' : '');
    const mark = document.createElement('span');
    mark.className = 'goal-mark';
    mark.textContent = g.done ? '✓' : '';
    const body = document.createElement('div');
    body.className = 'goal-body';
    const label = document.createElement('strong');
    label.textContent = `${g.icon} ${g.label}`;
    const detail = document.createElement('span');
    detail.className = 'goal-detail';
    detail.textContent = g.detail;
    body.append(label, detail);
    li.append(mark, body);
    list.appendChild(li);
  }

  // Formulärvärden (decimalfält visas med svenskt komma)
  const sv = v => (v === undefined || v === null) ? '' : String(v).replace('.', ',');
  $('#in-weight').value = sv(e.weight);
  $('#in-first-meal').value = e.firstMeal ?? '';
  $('#in-last-meal').value = e.lastMeal ?? '';
  $('#in-exercise').value = e.exerciseMin ?? '';
  $('#in-exercise-type').value = e.exerciseType ?? '';
  $('#in-sleep').value = sv(e.sleepHours);
  $('#in-steps').value = e.steps ?? '';
  $('#in-diet').checked = e.dietOk === true;
  $('#in-notes').value = e.notes ?? '';

  const fast = store.fastingHoursFor(e);
  $('#fasting-computed').textContent = fast !== null
    ? `= ${String(fast).replace('.', ',')} h fasta`
    : '';

  // Mina regler (skrivs under Mer, visas här)
  const rules = store.getGoals().rules || '';
  $('#today-rules-box').hidden = !rules.trim();
  if (rules.trim()) renderRulesInto($('#today-rules'), rules);
}

function bindTodayForm() {
  const key = () => store.todayKey();
  const num = el => { const v = parseFloat(el.value.replace(',', '.')); return isFinite(v) ? v : ''; };

  const save = patch => { store.updateEntry(key(), patch); renderToday(); };

  $('#in-weight').addEventListener('change', ev => save({ weight: num(ev.target) }));
  $('#in-first-meal').addEventListener('change', ev => save({ firstMeal: ev.target.value }));
  $('#in-last-meal').addEventListener('change', ev => save({ lastMeal: ev.target.value }));
  $('#in-exercise').addEventListener('change', ev => save({ exerciseMin: num(ev.target) }));
  $('#in-exercise-type').addEventListener('change', ev => save({ exerciseType: ev.target.value.trim() }));
  $('#in-sleep').addEventListener('change', ev => save({ sleepHours: num(ev.target) }));
  $('#in-steps').addEventListener('change', ev => save({ steps: num(ev.target) }));
  $('#in-diet').addEventListener('change', ev => save({ dietOk: ev.target.checked ? true : '' }));
  $('#in-notes').addEventListener('change', ev => save({ notes: ev.target.value.trim() }));
}

/* ---------- Trender ---------- */
const CHARTS = [
  { id: 'chart-weight', title: 'Vikt', metric: 'weight', type: 'line', unit: 'kg',
    color: '--chart-line', decimals: 1, goalKey: 'weightTarget', goalLabel: 'Målvikt' },
  { id: 'chart-sleep', title: 'Sömn', metric: 'sleepHours', type: 'line', unit: 'h',
    color: '--chart-line', decimals: 1, goalKey: 'sleepHours', goalLabel: 'Mål' },
  { id: 'chart-fasting', title: 'Fasta', metric: 'fastingHours', type: 'line', unit: 'h',
    color: '--chart-line', decimals: 1, goalKey: 'fastingHours', goalLabel: 'Mål' },
  { id: 'chart-exercise', title: 'Träning', metric: 'exerciseMin', type: 'column', unit: 'min',
    color: '--chart-line', decimals: 0, goalKey: 'exerciseMin', goalLabel: 'Mål' },
  { id: 'chart-steps', title: 'Steg', metric: 'steps', type: 'column', unit: 'steg',
    color: '--chart-line', decimals: 0, goalKey: 'steps', goalLabel: 'Mål' },
];

function renderTrends() {
  $$('#range-row button').forEach(b =>
    b.classList.toggle('is-active', Number(b.dataset.days) === trendRange));
  const goals = store.getGoals();
  for (const c of CHARTS) {
    const data = store.series(c.metric, trendRange);
    const card = $(`#${c.id}`);
    const latest = data.length ? data[data.length - 1].value : null;
    $('.card-value', card.closest('.card')).textContent = latest !== null
      ? `${latest.toLocaleString('sv-SE')} ${c.unit}` : '–';
    renderChart(card, {
      type: c.type, data, unit: c.unit, color: c.color, decimals: c.decimals,
      goal: typeof goals[c.goalKey] === 'number' ? goals[c.goalKey] : undefined,
      goalLabel: c.goalLabel, rangeDays: trendRange,
      ariaLabel: `${c.title}, senaste ${trendRange} dagarna`,
    });
  }
}

/* ---------- Måltider (delad veckoplan) ---------- */
const MEAL_TYPES = [
  { key: 'frukost', label: 'Frukost', icon: '🌅' },
  { key: 'lunch', label: 'Lunch', icon: '🥪' },
  { key: 'middag', label: 'Middag', icon: '🍲' },
];
const DAY_NAMES = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];

let weekStart = mondayOf(new Date());

function mondayOf(d) {
  const out = new Date(d);
  out.setHours(12, 0, 0, 0);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

function isoWeek(d) {
  const t = new Date(d);
  t.setHours(12, 0, 0, 0);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); // torsdag i samma vecka
  const jan4 = new Date(t.getFullYear(), 0, 4, 12);
  return 1 + Math.round((t - mondayOf(jan4)) / (7 * 86400000));
}

async function renderMeals() {
  const loggedIn = cloud.cloudAvailable() && cloud.currentUser();
  $('#meals-login-hint').hidden = !!loggedIn;
  const container = $('#meals-week');
  const status = $('#meals-status');
  container.textContent = '';
  status.textContent = '';

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push(d);
  }
  const fmtShort = d => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  $('#week-label').textContent =
    `Vecka ${isoWeek(weekStart)} · ${fmtShort(days[0])} – ${fmtShort(days[6])}`;
  if (!loggedIn) return;

  status.textContent = 'Hämtar …';
  let meals = [], profiles = [];
  try {
    [meals, profiles] = await Promise.all([
      cloud.listMeals(store.todayKey(days[0]), store.todayKey(days[6])),
      cloud.listProfiles(),
    ]);
    status.textContent = '';
  } catch (err) {
    status.textContent = 'Kunde inte hämta måltidsplanen — kontrollera nätet.';
    return;
  }
  const nameOf = id => profiles.find(p => p.id === id)?.display_name || '';
  const mealAt = (dateKey, type) =>
    meals.find(m => m.date === dateKey && m.meal_type === type);

  const todayK = store.todayKey();
  for (const d of days) {
    const dateKey = store.todayKey(d);
    const card = document.createElement('div');
    card.className = 'card meal-day' + (dateKey === todayK ? ' is-today' : '');
    const head = document.createElement('div');
    head.className = 'meal-day-head';
    const name = document.createElement('strong');
    name.textContent = DAY_NAMES[(d.getDay() + 6) % 7];
    const date = document.createElement('span');
    date.textContent = fmtShort(d);
    head.append(name, date);
    card.appendChild(head);

    for (const mt of MEAL_TYPES) {
      const meal = mealAt(dateKey, mt.key);
      const row = document.createElement('label');
      row.className = 'meal-row';
      const lbl = document.createElement('span');
      lbl.className = 'meal-type';
      lbl.textContent = `${mt.icon} ${mt.label}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '–';
      input.value = meal?.title || '';
      input.addEventListener('change', async () => {
        const title = input.value.trim();
        try {
          if (title) await cloud.upsertMeal(dateKey, mt.key, title);
          else if (meal) await cloud.deleteMeal(dateKey, mt.key);
          toast('Måltidsplan sparad ✓');
        } catch { toast('Kunde inte spara — kontrollera nätet.', true); }
      });
      const by = document.createElement('span');
      by.className = 'meal-by';
      by.textContent = meal?.created_by ? nameOf(meal.created_by) : '';
      row.append(lbl, input, by);
      card.appendChild(row);
    }
    container.appendChild(card);
  }
}

function bindMeals() {
  $('#week-prev').addEventListener('click', () => {
    weekStart.setDate(weekStart.getDate() - 7);
    renderMeals();
  });
  $('#week-next').addEventListener('click', () => {
    weekStart.setDate(weekStart.getDate() + 7);
    renderMeals();
  });
}

/* ---------- Kalender (måluppfyllnad per dag) ---------- */
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const label = calMonth.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
  $('#cal-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);
  const grid = $('#calendar');
  grid.textContent = '';

  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // måndag först
  const todayK = store.todayKey();

  for (let i = 0; i < offset; i++) grid.appendChild(document.createElement('span'));

  for (let day = 1; day <= daysInMonth; day++) {
    const key = store.todayKey(new Date(y, m, day, 12));
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    if (key === todayK) cell.classList.add('is-today');
    if (key > todayK) cell.classList.add('is-future');
    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = day;
    const dot = document.createElement('span');
    dot.className = 'cal-dot';
    const frac = key <= todayK ? store.goalFraction(key) : null;
    if (frac) {
      const pct = frac.done / frac.total;
      const col = goalColor(pct);
      if (frac.done === frac.total) {
        // Alla mål klara → helt fylld cirkel
        dot.classList.add('is-full');
        dot.style.background = col;
      } else {
        // Donut: färgad båge på ljusgrå ring
        dot.classList.add('is-ring');
        dot.style.background =
          `conic-gradient(${col} 0turn ${pct}turn, var(--field) ${pct}turn 1turn)`;
      }
      cell.addEventListener('click', () =>
        toast(`${day} ${label.split(' ')[0]}: ${frac.done}/${frac.total} mål avklarade`));
    } else {
      dot.classList.add('is-empty');
    }
    cell.append(num, dot);
    grid.appendChild(cell);
  }
}

function bindCalendar() {
  $('#cal-prev').addEventListener('click', () => {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
    renderCalendar();
  });
}

/* ---------- Historik ---------- */
function renderHistory() {
  renderCalendar();
  const tbody = $('#history-body');
  tbody.textContent = '';
  const rows = store.allEntriesSorted().slice(0, 90);
  $('#history-empty').hidden = rows.length > 0;
  for (const r of rows) {
    const tr = document.createElement('tr');
    const fast = store.fastingHoursFor(r);
    const cells = [
      r.date.slice(5).replace('-', '/'),
      r.weight != null ? r.weight.toLocaleString('sv-SE') : '',
      fast != null ? fast.toLocaleString('sv-SE') : '',
      r.exerciseMin != null ? r.exerciseMin : '',
      r.steps != null ? r.steps.toLocaleString('sv-SE') : '',
      r.sleepHours != null ? r.sleepHours.toLocaleString('sv-SE') : '',
      r.dietOk ? '✓' : '',
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

/* ---------- Inloggningsgrind ----------
   Appen visas bara inloggad; annars är inloggningen förstasidan.
   Sessionen sparas i webbläsaren så man hålls inloggad på enheten. */
function updateGate() {
  const user = cloud.cloudAvailable() ? cloud.currentUser() : null;
  const authed = !!user;
  $('#auth-screen').hidden = authed;
  $('main').hidden = !authed;
  $('.tabbar').hidden = !authed;
  $('#auth-offline').hidden = cloud.cloudAvailable();
  document.getElementById('today-date').hidden = !authed;
}

/* ---------- Inställningar ---------- */
function renderAccount() {
  const user = cloud.cloudAvailable() ? cloud.currentUser() : null;
  if (user) {
    const name = user.user_metadata?.display_name;
    $('#acc-who').textContent = name ? `${name} (${user.email})` : user.email;
  }
}

function bindAccount() {
  $('#btn-signin').addEventListener('click', async () => {
    const email = $('#acc-email').value.trim();
    const password = $('#acc-password').value;
    if (!email || !password) { toast('Fyll i e-post och lösenord.', true); return; }
    try {
      await cloud.signIn(email, password);
      toast('Inloggad ✓ — synkar …');
    } catch (err) { toast(`Inloggningen misslyckades: ${err.message}`, true); }
  });

  $('#btn-signup').addEventListener('click', async () => {
    const email = $('#acc-email').value.trim();
    const password = $('#acc-password').value;
    const name = $('#acc-name').value.trim();
    if (!email || password.length < 8) {
      toast('Ange e-post och ett lösenord på minst 8 tecken.', true);
      return;
    }
    try {
      await cloud.signUp(email, password, name || email.split('@')[0]);
      toast('Konto skapat! Kolla din e-post och klicka på bekräftelselänken.');
    } catch (err) { toast(`Kunde inte skapa konto: ${err.message}`, true); }
  });

  $('#btn-signout').addEventListener('click', async () => {
    try { await cloud.signOut(); } catch {}
    toast('Utloggad.');
  });

  sync.onSyncState(state => {
    const el = $('#sync-status');
    const texts = {
      syncing: 'Synk: pågår …',
      ok: 'Synk: allt uppdaterat ✓',
      pending: 'Synk: ändringar väntar (skickas när nätet är tillbaka)',
      error: 'Synk: misslyckades — försöker igen senare',
      offline: 'Synk: offline-läge',
    };
    if (el) el.textContent = texts[state] || 'Synk: –';
  });
}

function renderSettings() {
  renderAccount();
  const g = store.getGoals();
  const sv = v => (v === undefined || v === null) ? '' : String(v).replace('.', ',');
  $('#goal-weight').value = sv(g.weightTarget);
  $('#goal-fasting').value = sv(g.fastingHours);
  $('#goal-exercise').value = g.exerciseMin;
  $('#goal-sleep').value = sv(g.sleepHours);
  $('#goal-steps').value = g.steps;
  $('#rules-input').value = g.rules || '';
  $('#theme-select').value = g.theme || 'auto';
}

function bindSettings() {
  const num = el => { const v = parseFloat(el.value.replace(',', '.')); return isFinite(v) ? v : null; };
  $('#goal-weight').addEventListener('change', ev => store.setGoals({ weightTarget: num(ev.target) }));
  $('#goal-fasting').addEventListener('change', ev => store.setGoals({ fastingHours: num(ev.target) ?? 16 }));
  $('#goal-exercise').addEventListener('change', ev => store.setGoals({ exerciseMin: num(ev.target) ?? 30 }));
  $('#goal-sleep').addEventListener('change', ev => store.setGoals({ sleepHours: num(ev.target) ?? 7.5 }));
  $('#goal-steps').addEventListener('change', ev => store.setGoals({ steps: num(ev.target) ?? 8000 }));
  $('#rules-input').addEventListener('change', ev => {
    store.setGoals({ rules: ev.target.value });
    toast('Regler sparade ✓');
  });
  $('#theme-select').addEventListener('change', ev => { store.setGoals({ theme: ev.target.value }); applyTheme(); });

  // Backup
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `longevity-backup-${store.todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#file-restore').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      store.importJSON(await file.text());
      toast('Backup återställd ✓');
      applyTheme();
    } catch (err) { toast(`Kunde inte läsa filen: ${err.message}`, true); }
    ev.target.value = '';
  });

  // Apple Health
  $('#file-apple-xml').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    const status = $('#import-status');
    status.textContent = 'Läser export.xml … 0 %';
    try {
      const data = await parseAppleHealthXML(file, p => {
        status.textContent = `Läser export.xml … ${Math.round(p * 100)} %`;
      });
      const n = store.mergeImported(data);
      status.textContent = '';
      toast(`Import klar: ${Object.keys(data).length} dagar, ${n} värden ✓`);
      sync.pushDates(Object.keys(data));
    } catch (err) {
      status.textContent = '';
      toast(`Importen misslyckades: ${err.message}`, true);
    }
    ev.target.value = '';
  });

  $('#file-hae-json').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = parseHealthAutoExport(await file.text());
      const n = store.mergeImported(data);
      toast(`Import klar: ${Object.keys(data).length} dagar, ${n} värden ✓`);
      sync.pushDates(Object.keys(data));
    } catch (err) { toast(`Importen misslyckades: ${err.message}`, true); }
    ev.target.value = '';
  });

  $('#btn-clear').addEventListener('click', () => {
    if (confirm('Radera ALL sparad data? Detta går inte att ångra.')) {
      store.clearAll();
      applyTheme();
      toast('All data raderad');
      show('today');
    }
  });
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('is-error', isError);
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 3500);
}

/* ---------- Snabbloggning via URL (iOS-genväg) ---------- */
function handleLogURL() {
  const parsed = parseLogURL(location.hash);
  if (!parsed) return;
  const date = parsed.date || store.todayKey();
  if (Object.keys(parsed.patch).length) {
    store.updateEntry(date, parsed.patch);
    toast(`Loggat via genväg för ${date} ✓`);
  }
  history.replaceState(null, '', location.pathname + location.search);
}

/* ---------- Start ---------- */
function init() {
  applyTheme();
  handleLogURL();
  bindTodayForm();
  bindSettings();
  bindAccount();
  bindMeals();
  bindCalendar();

  // Inloggningsläget avgörs direkt (sparad session), full synk går i bakgrunden
  sync.initSync(() => {
    updateGate();
    if (cloud.cloudAvailable() && cloud.currentUser()) {
      renderAccount();
      show(currentView);
    }
  });

  $$('.tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  $$('#range-row button').forEach(b => b.addEventListener('click', () => {
    trendRange = Number(b.dataset.days);
    localStorage.setItem('longevity.range', String(trendRange));
    renderTrends();
  }));
  window.addEventListener('hashchange', () => { handleLogURL(); if (currentView === 'today') renderToday(); });

  show('today');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
