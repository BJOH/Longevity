/* Matloggning under Måltider: dagvy med kalorimätare, makrokort och
   loggning per måltidsplats, plus fullskärmsark för att lägga till mat via
   sökning (Livsmedelsverkets databas), streckkod (Open Food Facts),
   AI-foto/fritext (Claude via Edge-funktion) och egna livsmedel. */
import * as store from './store.js';
import * as cloud from './cloud.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toast = () => {};
let onLogged = () => {};

const MACROS = [
  { key: 'kolh', label: 'Kolhydrater', target: 'kolhTarget', cls: 'macro-kolh' },
  { key: 'protein', label: 'Protein', target: 'proteinTarget', cls: 'macro-protein' },
  { key: 'fett', label: 'Fett', target: 'fettTarget', cls: 'macro-fett' },
  { key: 'fiber', label: 'Fiber', target: 'fiberTarget', cls: 'macro-fiber' },
];

const SRC_LABEL = { slv: 'Livsmedelsverket', off: 'Streckkod', ai: 'AI-foto', snabb: 'AI-text', egen: 'Eget' };

const svNum = (v, dec = 0) => (v ?? 0).toLocaleString('sv-SE', {
  minimumFractionDigits: 0, maximumFractionDigits: dec,
});

const addDays = (k, n) => {
  const d = new Date(k + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return store.todayKey(d);
};

/* ---------- Dagvyn under Måltider ---------- */
let dayKey = store.todayKey();
let fastingTimer = null;

/* Kaloribudget per synlig måltidsplats: dagens mål fördelat efter vikterna
   i MEAL_TYPES (frukost 3, lunch 4, middag 4, mellanmål 1). */
function slotBudgets(visible, kcalTarget) {
  if (typeof kcalTarget !== 'number' || !visible.length) return {};
  const total = visible.reduce((s, mt) => s + mt.weight, 0);
  const out = {};
  for (const mt of visible) {
    out[mt.key] = Math.round(kcalTarget * mt.weight / total / 10) * 10;
  }
  return out;
}

function gaugeArc(pct) {
  // Halvcirkelbåge 200×116: från (16,104) över toppen till (184,104)
  const a = Math.PI * (1 - Math.max(0, Math.min(1, pct)));
  const x = 100 + 84 * Math.cos(a);
  const y = 104 - 84 * Math.sin(a);
  const large = pct > 0.5 ? 1 : 0;
  return `M 16 104 A 84 84 0 ${large} 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
}

export function renderFoodDay() {
  const todayK = store.todayKey();
  const e = store.getEntry(dayKey);
  const totals = store.foodTotals(dayKey);
  const g = store.getGoals();

  // Dagsnavigering
  const d = new Date(dayKey + 'T12:00:00');
  $('#day-label').textContent = dayKey === todayK ? 'Idag'
    : d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' });
  $('#day-next').disabled = dayKey >= todayK;

  // Kalorimätare
  const target = g.kcalTarget;
  const hasTarget = typeof target === 'number' && target > 0;
  $('#gauge-track').setAttribute('d', gaugeArc(1));
  const pct = hasTarget ? totals.kcal / target : 0;
  $('#gauge-fill').setAttribute('d', totals.kcal > 0 && hasTarget ? gaugeArc(pct) : '');
  $('#gauge-fill').classList.toggle('is-over', hasTarget && pct > 1);
  $('#gauge-big').textContent = hasTarget
    ? svNum(Math.max(0, Math.round(target - totals.kcal)))
    : svNum(totals.kcal);
  $('#gauge-sub').textContent = hasTarget
    ? (totals.kcal > target ? 'kcal över målet' : 'kcal kvar')
    : 'kcal loggat';
  $('#gauge-eaten').textContent = svNum(totals.kcal);
  $('#gauge-goal').textContent = hasTarget ? svNum(target) : '–';
  $('#gauge-hint').hidden = hasTarget;

  // Makrokort med staplar
  const cards = $('#macro-cards');
  cards.textContent = '';
  for (const m of MACROS) {
    const t = g[m.target];
    const hasT = typeof t === 'number' && t > 0;
    const val = totals[m.key];
    const card = document.createElement('div');
    card.className = `card macro-card ${m.cls}`;
    const name = document.createElement('strong');
    name.textContent = m.label;
    const nums = document.createElement('span');
    nums.className = 'macro-nums';
    nums.textContent = hasT ? `${svNum(val, 1)} / ${svNum(t)} g` : `${svNum(val, 1)} g`;
    const bar = document.createElement('span');
    bar.className = 'macro-bar';
    const fill = document.createElement('span');
    fill.className = 'macro-bar-fill';
    const p = hasT ? Math.min(val / t, 1) : 0;
    fill.style.width = `${(p * 100).toFixed(1)}%`;
    if (hasT && val > t) fill.classList.add('is-over');
    bar.appendChild(fill);
    card.append(name, nums, bar);
    cards.appendChild(card);
  }

  // Måltidsplatser med loggade livsmedel
  const prefs = g.mealPrefs;
  const visible = store.MEAL_TYPES.filter(mt => prefs[mt.key]?.show);
  const budgets = slotBudgets(visible, target);
  const items = e.food || [];
  const box = $('#meal-slots');
  box.textContent = '';

  const renderSlot = (mt, slotItems, budget) => {
    const card = document.createElement('div');
    card.className = 'card meal-slot';
    const head = document.createElement('div');
    head.className = 'meal-slot-head';
    const info = document.createElement('div');
    info.className = 'meal-slot-info';
    const name = document.createElement('strong');
    name.textContent = `${mt.icon} ${mt.label}`;
    const sub = document.createElement('span');
    sub.className = 'meal-slot-sub';
    const eaten = slotItems.reduce((s, f) => s + (f.kcal || 0), 0);
    sub.textContent = budget
      ? `${svNum(eaten)} / ${svNum(budget)} kcal`
      : `${svNum(eaten)} kcal`;
    info.append(name, sub);
    head.appendChild(info);
    if (mt.key !== 'ovrigt') {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'meal-slot-add';
      add.setAttribute('aria-label', `Lägg till mat: ${mt.label}`);
      add.textContent = '+';
      add.addEventListener('click', () => openSheet({ date: dayKey, meal: mt.key, label: mt.label }));
      head.appendChild(add);
    }
    card.appendChild(head);
    if (slotItems.length) {
      const ul = document.createElement('ul');
      ul.className = 'food-log-list';
      for (const f of slotItems) {
        const li = document.createElement('li');
        li.className = 'food-item';
        const body = document.createElement('div');
        body.className = 'food-item-body';
        const nm = document.createElement('strong');
        nm.textContent = f.namn;
        const s2 = document.createElement('span');
        s2.className = 'food-item-sub';
        const bits = [];
        if (typeof f.gram === 'number') bits.push(`${svNum(f.gram)} g`);
        if (f.src && SRC_LABEL[f.src]) bits.push(SRC_LABEL[f.src]);
        s2.textContent = bits.join(' · ');
        body.append(nm, s2);
        const kc = document.createElement('span');
        kc.className = 'food-item-kcal';
        kc.textContent = `${svNum(f.kcal)} kcal`;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'food-item-del';
        del.setAttribute('aria-label', `Ta bort ${f.namn}`);
        del.textContent = '✕';
        del.addEventListener('click', () => {
          store.removeFood(dayKey, f.id);
          renderFoodDay();
          onLogged();
        });
        li.append(body, kc, del);
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }
    box.appendChild(card);
  };

  const visibleKeys = new Set(visible.map(mt => mt.key));
  for (const mt of visible) {
    renderSlot(mt, items.filter(f => f.meal === mt.key), budgets[mt.key]);
  }
  const rest = items.filter(f => !f.meal || !visibleKeys.has(f.meal));
  if (rest.length) renderSlot({ key: 'ovrigt', label: 'Övrigt', icon: '🍽' }, rest, null);

  renderFasting();
}

/* Fastestatus: från gårdagens (eller dagens) sista måltid tills första
   måltiden loggas idag. Ketos-markering efter 12 h. Visas bara för idag. */
function renderFasting() {
  const card = $('#fasting-card');
  clearInterval(fastingTimer);
  fastingTimer = null;
  if (dayKey !== store.todayKey()) { card.hidden = true; return; }

  const eToday = store.getEntry(dayKey);
  const eY = store.getEntry(addDays(dayKey, -1));

  const update = () => {
    if (!eToday.firstMeal && eY.lastMeal) {
      const start = new Date(`${addDays(dayKey, -1)}T${eY.lastMeal}`);
      const h = (Date.now() - start.getTime()) / 3600000;
      if (h > 0 && h < 48) {
        card.hidden = false;
        $('#fasting-title').textContent = h >= 12 ? '⚡ Du fastar — ketos-zon!' : 'Du fastar';
        const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
        $('#fasting-elapsed').textContent = `${hh} h ${String(mm).padStart(2, '0')} min`;
        $('#fasting-sub').textContent =
          `Sedan sista måltiden igår kl ${eY.lastMeal}. Mål: ${svNum(store.getGoals().fastingHours)} h.`;
        return;
      }
    }
    if (eToday.firstMeal) {
      const fast = store.fastingHoursFor(eY.lastMeal ? {
        firstMeal: eToday.firstMeal, lastMeal: eY.lastMeal,
      } : eToday);
      card.hidden = false;
      $('#fasting-title').textContent = 'Fastan bruten';
      $('#fasting-elapsed').textContent = '';
      $('#fasting-sub').textContent = fast !== null
        ? `Första måltid kl ${eToday.firstMeal} — ${String(fast).replace('.', ',')} h fasta. Bra jobbat!`
        : `Första måltid kl ${eToday.firstMeal}.`;
      return;
    }
    card.hidden = true;
  };
  update();
  if (!card.hidden && !eToday.firstMeal) fastingTimer = setInterval(update, 60000);
}

export function bindFoodDay(opts) {
  toast = opts.toast;
  onLogged = opts.onChange || (() => {});
  $('#day-prev').addEventListener('click', () => { dayKey = addDays(dayKey, -1); renderFoodDay(); });
  $('#day-next').addEventListener('click', () => {
    if (dayKey < store.todayKey()) { dayKey = addDays(dayKey, 1); renderFoodDay(); }
  });
  bindSheet();
}

/* ---------- Arket ---------- */
let sheetOpen = false;
let sheetTarget = { date: null, meal: null };
let scanControls = null;   // ZXing-kontroller när kameran är igång

function openSheet(target) {
  sheetTarget = target;
  sheetOpen = true;
  $('#food-sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  const d = new Date(target.date + 'T12:00:00');
  const dayTxt = target.date === store.todayKey() ? 'idag'
    : d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' });
  $('#food-sheet-date').textContent = `${target.label} · ${dayTxt}`;
  switchTab('search');
  setTimeout(() => $('#food-search-input').focus(), 50);
}

function closeSheet() {
  sheetOpen = false;
  stopScanner();
  $('#food-sheet').hidden = true;
  document.body.style.overflow = '';
  hideConfirm();
}

function switchTab(tab) {
  $$('#food-tabs button').forEach(b =>
    b.classList.toggle('is-active', b.dataset.tab === tab));
  $$('.food-panel').forEach(p => p.hidden = p.dataset.tab !== tab);
  hideConfirm();
  if (tab !== 'scan') stopScanner();
  if (tab === 'mine') renderMyFoods();
  if (tab === 'scan') $('#scan-status').textContent = '';
}

/* ---------- Bekräftelsepanel ----------
   per100-läge: gramfältet räknar om värdena från per-100g-data.
   absolut läge (AI): värdena är portionstotaler och redigeras direkt. */
let confirmCtx = null; // { per100, src, brand }

function showConfirm({ namn, gram, per100, values, src, brand, note }) {
  confirmCtx = { per100: per100 || null, src, brand: brand || null };
  const panel = $('#food-confirm');
  panel.hidden = false;
  $('#confirm-name').value = namn || '';
  $('#confirm-gram').value = gram ?? 100;
  $('#confirm-note').textContent = note || '';
  $('#confirm-note').hidden = !note;
  if (per100) recomputeFromGram();
  else {
    for (const k of ['kcal', 'fett', 'kolh', 'protein', 'fiber']) {
      $(`#confirm-${k}`).value = values?.[k] != null ? String(Math.round(values[k] * 10) / 10).replace('.', ',') : '';
    }
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideConfirm() {
  $('#food-confirm').hidden = true;
  confirmCtx = null;
}

function recomputeFromGram() {
  if (!confirmCtx?.per100) return;
  const gram = parseFloat($('#confirm-gram').value.replace(',', '.'));
  if (!isFinite(gram)) return;
  for (const k of ['kcal', 'fett', 'kolh', 'protein', 'fiber']) {
    const per = confirmCtx.per100[k];
    $(`#confirm-${k}`).value = per != null
      ? String(Math.round(per * gram / 100 * 10) / 10).replace('.', ',')
      : '';
  }
}

function saveConfirm() {
  const namn = $('#confirm-name').value.trim();
  if (!namn) { toast('Ange ett namn på livsmedlet.', true); return; }
  const num = id => {
    const v = parseFloat($(id).value.replace(',', '.'));
    return isFinite(v) ? v : undefined;
  };
  const item = {
    namn: confirmCtx?.brand ? `${namn} (${confirmCtx.brand})` : namn,
    gram: num('#confirm-gram'),
    kcal: num('#confirm-kcal') ?? 0,
    fett: num('#confirm-fett'),
    kolh: num('#confirm-kolh'),
    protein: num('#confirm-protein'),
    fiber: num('#confirm-fiber'),
    src: confirmCtx?.src,
    meal: sheetTarget.meal || undefined,
  };
  store.addFood(sheetTarget.date || store.todayKey(), item);
  toast(`${namn} loggad ✓`);
  closeSheet();
  renderFoodDay();
  onLogged();
}

/* ---------- Sök (Livsmedelsverket + egna) ---------- */
let searchTimer = null;
let customCache = null;

async function getCustomFoods(force = false) {
  if (customCache && !force) return customCache;
  try {
    customCache = await cloud.listCustomFoods();
    localStorage.setItem('longevity.customFoods', JSON.stringify(customCache));
  } catch {
    try { customCache = JSON.parse(localStorage.getItem('longevity.customFoods')) || []; }
    catch { customCache = []; }
  }
  return customCache;
}

function foodRow({ title, sub, onAdd }) {
  const li = document.createElement('li');
  li.className = 'food-result';
  const body = document.createElement('div');
  body.className = 'food-item-body';
  const name = document.createElement('strong');
  name.textContent = title;
  const info = document.createElement('span');
  info.className = 'food-item-sub';
  info.textContent = sub;
  body.append(name, info);
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'food-add-btn';
  add.setAttribute('aria-label', `Lägg till ${title}`);
  add.textContent = '+';
  li.append(body, add);
  li.addEventListener('click', onAdd);
  return li;
}

async function runSearch(q) {
  const list = $('#food-search-results');
  const status = $('#food-search-status');
  list.textContent = '';
  if (q.length < 2) { status.textContent = ''; return; }
  status.textContent = 'Söker …';
  let rows = [], custom = [];
  try {
    [rows, custom] = await Promise.all([
      cloud.searchFood(q),
      getCustomFoods(),
    ]);
    status.textContent = '';
  } catch {
    status.textContent = 'Sökningen misslyckades — kontrollera nätet.';
    return;
  }
  if ($('#food-search-input').value.trim() !== q) return; // hann skrivas om
  const ql = q.toLowerCase();
  for (const f of custom.filter(c => c.namn.toLowerCase().includes(ql)).slice(0, 5)) {
    list.appendChild(foodRow({
      title: `⭐ ${f.namn}`,
      sub: `${svNum(Number(f.kcal))} kcal · 100 g · eget`,
      onAdd: () => showConfirm({
        namn: f.namn, gram: 100, per100: normPer100(f), src: 'egen', brand: f.brand,
      }),
    }));
  }
  for (const f of rows) {
    list.appendChild(foodRow({
      title: f.namn,
      sub: `${svNum(f.kcal)} kcal · 100 g`,
      onAdd: () => showConfirm({ namn: f.namn, gram: 100, per100: f, src: 'slv' }),
    }));
  }
  if (!list.children.length) {
    status.textContent = 'Inget hittades — prova ett annat ord, eller lägg upp det under Mina.';
  }
}

const normPer100 = f => ({
  kcal: f.kcal != null ? Number(f.kcal) : null,
  fett: f.fett != null ? Number(f.fett) : null,
  kolh: f.kolh != null ? Number(f.kolh) : null,
  protein: f.protein != null ? Number(f.protein) : null,
  fiber: f.fiber != null ? Number(f.fiber) : null,
});

/* ---------- Streckkod ---------- */
async function startScanner() {
  const status = $('#scan-status');
  status.textContent = 'Startar kameran …';
  $('#btn-scan-start').hidden = true;
  try {
    const zx = await import('./vendor/zxing.js');
    const hints = new Map([
      [zx.DecodeHintType.POSSIBLE_FORMATS, [
        zx.BarcodeFormat.EAN_13, zx.BarcodeFormat.EAN_8,
        zx.BarcodeFormat.UPC_A, zx.BarcodeFormat.UPC_E,
      ]],
      // Avkoda mer noggrant — hjälper suddiga/små koder på håll
      [zx.DecodeHintType.TRY_HARDER, true],
    ]);
    const reader = new zx.BrowserMultiFormatReader(hints);
    const video = $('#scan-video');
    video.hidden = false;
    // Hög upplösning gör att koden kan läsas på längre avstånd
    scanControls = await reader.decodeFromConstraints({
      audio: false,
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    }, video, (result) => {
      if (result) handleBarcode(result.getText());
    });
    status.textContent = 'Rikta kameran mot streckkoden.';
    tuneCamera(video);
  } catch (err) {
    status.textContent = err?.name === 'NotAllowedError'
      ? 'Kameran nekades — tillåt kameraåtkomst i webbläsarens inställningar.'
      : 'Kunde inte starta kameran.';
    $('#btn-scan-start').hidden = false;
  }
}

/* Kontinuerlig autofokus + zoomknappar när kameran stödjer det.
   Zoom är rätt verktyg nära: mobilkameror kan inte fokusera under ~10 cm,
   men 2–3× zoom ger samma effekt på lite längre (skarpt) avstånd. */
function tuneCamera(video) {
  const track = video.srcObject?.getVideoTracks?.()[0];
  const zoomRow = $('#scan-zoom');
  zoomRow.hidden = true;
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities();
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }
  if (caps.zoom && caps.zoom.max > 1) {
    zoomRow.hidden = false;
    $$('#scan-zoom button').forEach(b => {
      const z = Number(b.dataset.zoom);
      b.hidden = z > caps.zoom.max;
      b.onclick = () => {
        track.applyConstraints({ advanced: [{ zoom: Math.min(z, caps.zoom.max) }] }).catch(() => {});
        $$('#scan-zoom button').forEach(x => x.classList.toggle('is-active', x === b));
      };
    });
  }
}

function stopScanner() {
  if (scanControls) { try { scanControls.stop(); } catch {} scanControls = null; }
  const video = $('#scan-video');
  if (video) { video.hidden = true; }
  const zoomRow = $('#scan-zoom');
  if (zoomRow) zoomRow.hidden = true;
  const btn = $('#btn-scan-start');
  if (btn) btn.hidden = false;
}

let lastCode = null;
async function handleBarcode(code) {
  if (code === lastCode) return; // samma kod flera bildrutor i rad
  lastCode = code;
  stopScanner();
  const status = $('#scan-status');
  status.textContent = `Kod ${code} — slår upp …`;

  // Egna livsmedel med samma streckkod vinner
  const custom = (await getCustomFoods()).find(f => f.barcode === code);
  if (custom) {
    status.textContent = '';
    showConfirm({ namn: custom.namn, gram: 100, per100: normPer100(custom), src: 'egen', brand: custom.brand });
    return;
  }
  try {
    const p = await cloud.lookupBarcode(code);
    if (p && p.kcal != null) {
      status.textContent = '';
      showConfirm({
        namn: p.namn, brand: p.brand, gram: p.serving || 100,
        per100: p, src: 'off',
        note: p.serving ? `Portionsstorlek från förpackningen: ${p.serving} g` : null,
      });
      return;
    }
    status.textContent = 'Produkten finns inte i databasen.';
  } catch {
    status.textContent = 'Uppslaget misslyckades — kontrollera nätet.';
  }
  // Inte hittad → erbjud att skapa eget livsmedel med koden förifylld
  const btn = $('#btn-scan-create');
  btn.hidden = false;
  btn.onclick = () => {
    btn.hidden = true;
    switchTab('mine');
    openMyFoodForm({ barcode: code });
  };
}

/* ---------- Foto & Snabbt (AI) ---------- */
const AI_ERRORS = {
  saknar_nyckel: 'AI-analysen är inte aktiverad ännu — en Anthropic API-nyckel ' +
    'behöver läggas in som hemlighet i Supabase (se README).',
  nyckel_ogiltig: 'API-nyckeln verkar ogiltig — kontrollera den i Supabase.',
  for_manga_anrop: 'För många anrop just nu — vänta en stund och försök igen.',
};

async function fileToResizedBase64(file, maxSide = 1100) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
  return dataUrl.split(',')[1];
}

async function analyzeAndConfirm(payload, statusEl, src) {
  statusEl.textContent = 'Analyserar med AI … (några sekunder)';
  let res;
  try {
    res = await cloud.analyzeFood(payload);
  } catch {
    statusEl.textContent = 'Analysen misslyckades — kontrollera nätet.';
    return;
  }
  if (res.error) {
    statusEl.textContent = AI_ERRORS[res.error] || `Analysen misslyckades (${res.error}).`;
    return;
  }
  statusEl.textContent = '';
  const noteBits = [];
  if (res.beskrivning) noteBits.push(res.beskrivning);
  if (res.sakerhet) noteBits.push(`Säkerhet: ${res.sakerhet}. Justera gärna värdena.`);
  showConfirm({
    namn: res.namn, gram: res.gram,
    values: { kcal: res.kcal, fett: res.fett, kolh: res.kolh, protein: res.protein, fiber: res.fiber },
    src, note: noteBits.join(' — '),
  });
}

/* ---------- Mina livsmedel ---------- */
async function renderMyFoods() {
  const list = $('#myfoods-list');
  const status = $('#myfoods-status');
  list.textContent = '';
  status.textContent = 'Hämtar …';
  const foods = await getCustomFoods(true);
  status.textContent = foods.length ? '' : 'Inga egna livsmedel ännu.';
  for (const f of foods) {
    const li = foodRow({
      title: f.namn + (f.brand ? ` (${f.brand})` : ''),
      sub: `${svNum(Number(f.kcal))} kcal · 100 g${f.barcode ? ' · 🏷 ' + f.barcode : ''}`,
      onAdd: () => showConfirm({
        namn: f.namn, gram: 100, per100: normPer100(f), src: 'egen', brand: f.brand,
      }),
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'food-edit-btn';
    edit.setAttribute('aria-label', `Redigera ${f.namn}`);
    edit.textContent = '✎';
    edit.addEventListener('click', ev => { ev.stopPropagation(); openMyFoodForm(f); });
    li.insertBefore(edit, li.lastElementChild);
    list.appendChild(li);
  }
}

function openMyFoodForm(f = {}) {
  const form = $('#myfood-form');
  form.hidden = false;
  form.dataset.id = f.id || '';
  $('#myfood-name').value = f.namn || '';
  $('#myfood-brand').value = f.brand || '';
  $('#myfood-barcode').value = f.barcode || '';
  const sv = v => v != null ? String(Number(v)).replace('.', ',') : '';
  $('#myfood-kcal').value = sv(f.kcal);
  $('#myfood-fett').value = sv(f.fett);
  $('#myfood-kolh').value = sv(f.kolh);
  $('#myfood-protein').value = sv(f.protein);
  $('#myfood-fiber').value = sv(f.fiber);
  $('#btn-myfood-delete').hidden = !f.id;
  $('#myfood-name').focus();
}

async function saveMyFood() {
  const num = id => {
    const v = parseFloat($(id).value.replace(',', '.'));
    return isFinite(v) ? v : null;
  };
  const f = {
    id: $('#myfood-form').dataset.id || undefined,
    namn: $('#myfood-name').value.trim(),
    brand: $('#myfood-brand').value.trim(),
    barcode: $('#myfood-barcode').value.trim(),
    kcal: num('#myfood-kcal'),
    fett: num('#myfood-fett'), kolh: num('#myfood-kolh'),
    protein: num('#myfood-protein'), fiber: num('#myfood-fiber'),
  };
  if (!f.namn) { toast('Ange ett namn.', true); return; }
  if (f.kcal === null) { toast('Ange kcal per 100 g.', true); return; }
  try {
    await cloud.saveCustomFood(f);
    customCache = null;
    $('#myfood-form').hidden = true;
    toast('Livsmedel sparat ✓');
    renderMyFoods();
  } catch {
    toast('Kunde inte spara — kontrollera nätet.', true);
  }
}

/* ---------- Arkets händelser ---------- */
function bindSheet() {
  $('#food-sheet-close').addEventListener('click', closeSheet);
  $$('#food-tabs button').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Sök
  $('#food-search-input').addEventListener('input', ev => {
    clearTimeout(searchTimer);
    const q = ev.target.value.trim();
    searchTimer = setTimeout(() => runSearch(q), 250);
  });

  // Streckkod
  $('#btn-scan-start').addEventListener('click', () => { lastCode = null; startScanner(); });

  // Foto: ta ny bild eller välj från biblioteket — samma analys
  const handlePhoto = async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const status = $('#photo-status');
    try {
      status.textContent = 'Förbereder bilden …';
      const base64 = await fileToResizedBase64(file);
      $('#photo-preview').src = `data:image/jpeg;base64,${base64}`;
      $('#photo-preview').hidden = false;
      await analyzeAndConfirm({ image: base64, mediaType: 'image/jpeg' }, status, 'ai');
    } catch {
      status.textContent = 'Kunde inte läsa bilden.';
    }
  };
  $('#photo-input').addEventListener('change', handlePhoto);
  $('#photo-pick').addEventListener('change', handlePhoto);

  // Snabbt (fritext)
  $('#btn-quick-analyze').addEventListener('click', () => {
    const text = $('#quick-input').value.trim();
    if (!text) { toast('Beskriv vad du åt först.', true); return; }
    analyzeAndConfirm({ text }, $('#quick-status'), 'snabb');
  });

  // Bekräftelse
  $('#confirm-gram').addEventListener('input', recomputeFromGram);
  $('#btn-confirm-save').addEventListener('click', saveConfirm);
  $('#btn-confirm-cancel').addEventListener('click', hideConfirm);

  // Mina livsmedel
  $('#btn-myfood-new').addEventListener('click', () => openMyFoodForm());
  $('#btn-myfood-save').addEventListener('click', saveMyFood);
  $('#btn-myfood-cancel').addEventListener('click', () => { $('#myfood-form').hidden = true; });
  $('#btn-myfood-delete').addEventListener('click', async () => {
    const id = $('#myfood-form').dataset.id;
    if (!id || !confirm('Ta bort livsmedlet?')) return;
    try {
      await cloud.deleteCustomFood(id);
      customCache = null;
      $('#myfood-form').hidden = true;
      renderMyFoods();
      toast('Borttaget.');
    } catch { toast('Kunde inte ta bort — kontrollera nätet.', true); }
  });

  // Stäng med Escape (praktiskt på desktop)
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && sheetOpen) closeSheet();
  });
}
