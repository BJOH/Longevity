import * as store from './store.js';
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
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
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

  // Progressring
  const pct = done / goals.length;
  const ring = $('#progress-ring-fg');
  const C = 2 * Math.PI * 52;
  ring.setAttribute('stroke-dasharray', `${(C * pct).toFixed(1)} ${C.toFixed(1)}`);
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

  // Formulärvärden
  $('#in-weight').value = e.weight ?? '';
  $('#in-first-meal').value = e.firstMeal ?? '';
  $('#in-last-meal').value = e.lastMeal ?? '';
  $('#in-exercise').value = e.exerciseMin ?? '';
  $('#in-exercise-type').value = e.exerciseType ?? '';
  $('#in-sleep').value = e.sleepHours ?? '';
  $('#in-steps').value = e.steps ?? '';
  $('#in-diet').checked = e.dietOk === true;
  $('#in-notes').value = e.notes ?? '';

  const fast = store.fastingHoursFor(e);
  $('#fasting-computed').textContent = fast !== null
    ? `= ${String(fast).replace('.', ',')} h fasta`
    : '';
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
    color: '--c-weight', decimals: 1, goalKey: 'weightTarget', goalLabel: 'Målvikt' },
  { id: 'chart-sleep', title: 'Sömn', metric: 'sleepHours', type: 'line', unit: 'h',
    color: '--c-sleep', decimals: 1, goalKey: 'sleepHours', goalLabel: 'Mål' },
  { id: 'chart-fasting', title: 'Fasta', metric: 'fastingHours', type: 'line', unit: 'h',
    color: '--c-fasting', decimals: 1, goalKey: 'fastingHours', goalLabel: 'Mål' },
  { id: 'chart-exercise', title: 'Träning', metric: 'exerciseMin', type: 'column', unit: 'min',
    color: '--c-exercise', decimals: 0, goalKey: 'exerciseMin', goalLabel: 'Mål' },
  { id: 'chart-steps', title: 'Steg', metric: 'steps', type: 'column', unit: 'steg',
    color: '--c-steps', decimals: 0, goalKey: 'steps', goalLabel: 'Mål' },
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

/* ---------- Historik ---------- */
function renderHistory() {
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

/* ---------- Inställningar ---------- */
function renderSettings() {
  const g = store.getGoals();
  $('#goal-weight').value = g.weightTarget ?? '';
  $('#goal-fasting').value = g.fastingHours;
  $('#goal-exercise').value = g.exerciseMin;
  $('#goal-sleep').value = g.sleepHours;
  $('#goal-steps').value = g.steps;
  $('#theme-select').value = g.theme || 'auto';
}

function bindSettings() {
  const num = el => { const v = parseFloat(el.value.replace(',', '.')); return isFinite(v) ? v : null; };
  $('#goal-weight').addEventListener('change', ev => store.setGoals({ weightTarget: num(ev.target) }));
  $('#goal-fasting').addEventListener('change', ev => store.setGoals({ fastingHours: num(ev.target) ?? 16 }));
  $('#goal-exercise').addEventListener('change', ev => store.setGoals({ exerciseMin: num(ev.target) ?? 30 }));
  $('#goal-sleep').addEventListener('change', ev => store.setGoals({ sleepHours: num(ev.target) ?? 7.5 }));
  $('#goal-steps').addEventListener('change', ev => store.setGoals({ steps: num(ev.target) ?? 8000 }));
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
