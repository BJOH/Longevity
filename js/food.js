/* Matloggning: dagskort med näringsringar + fullskärmsark för att lägga
   till mat via sökning (Livsmedelsverkets databas), streckkod (Open Food
   Facts), AI-foto/fritext (Claude via Edge-funktion) och egna livsmedel. */
import * as store from './store.js';
import * as cloud from './cloud.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toast = () => {};
let onLogged = () => {};

const MACROS = [
  { key: 'fett', label: 'Fett', target: 'fettTarget', cls: 'macro-fett' },
  { key: 'kolh', label: 'Kolh', target: 'kolhTarget', cls: 'macro-kolh' },
  { key: 'protein', label: 'Protein', target: 'proteinTarget', cls: 'macro-protein' },
  { key: 'fiber', label: 'Fiber', target: 'fiberTarget', cls: 'macro-fiber' },
];

const SRC_LABEL = { slv: 'Livsmedelsverket', off: 'Streckkod', ai: 'AI-foto', snabb: 'AI-text', egen: 'Eget' };

const svNum = (v, dec = 0) => (v ?? 0).toLocaleString('sv-SE', {
  minimumFractionDigits: 0, maximumFractionDigits: dec,
});

/* ---------- Dagskortet på Idag ---------- */
export function renderFoodCard() {
  const key = store.todayKey();
  const e = store.getEntry(key);
  const totals = store.foodTotals(key);
  const g = store.getGoals();

  const kcalEl = $('#food-kcal');
  kcalEl.textContent = svNum(totals.kcal);
  $('#food-kcal-target').textContent =
    typeof g.kcalTarget === 'number' ? ` / ${svNum(g.kcalTarget)} kcal` : ' kcal';

  const rings = $('#food-rings');
  rings.textContent = '';
  for (const m of MACROS) {
    const target = g[m.target];
    const val = totals[m.key];
    const pct = typeof target === 'number' && target > 0
      ? Math.min(val / target, 1) : 0;
    const ring = document.createElement('div');
    ring.className = `food-ring ${m.cls}`;
    const donut = document.createElement('span');
    donut.className = 'food-donut';
    donut.style.setProperty('--pct', `${pct}turn`);
    const num = document.createElement('span');
    num.className = 'food-donut-num';
    num.textContent = svNum(val);
    donut.appendChild(num);
    const lbl = document.createElement('span');
    lbl.className = 'food-ring-label';
    lbl.textContent = typeof target === 'number'
      ? `${m.label} /${svNum(target)} g` : `${m.label} g`;
    ring.append(donut, lbl);
    rings.appendChild(ring);
  }

  const list = $('#food-log-list');
  list.textContent = '';
  for (const f of e.food || []) {
    const li = document.createElement('li');
    li.className = 'food-item';
    const body = document.createElement('div');
    body.className = 'food-item-body';
    const name = document.createElement('strong');
    name.textContent = f.namn;
    const sub = document.createElement('span');
    sub.className = 'food-item-sub';
    const bits = [];
    if (typeof f.gram === 'number') bits.push(`${svNum(f.gram)} g`);
    if (f.src && SRC_LABEL[f.src]) bits.push(SRC_LABEL[f.src]);
    sub.textContent = bits.join(' · ');
    body.append(name, sub);
    const kcal = document.createElement('span');
    kcal.className = 'food-item-kcal';
    kcal.textContent = `${svNum(f.kcal)} kcal`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'food-item-del';
    del.setAttribute('aria-label', `Ta bort ${f.namn}`);
    del.textContent = '✕';
    del.addEventListener('click', () => {
      store.removeFood(key, f.id);
      renderFoodCard();
      onLogged();
    });
    li.append(body, kcal, del);
    list.appendChild(li);
  }
  $('#food-empty').hidden = (e.food || []).length > 0;
}

/* ---------- Arket ---------- */
let sheetOpen = false;
let scanControls = null;   // ZXing-kontroller när kameran är igång
let photoData = null;      // {base64, mediaType}

function openSheet() {
  sheetOpen = true;
  $('#food-sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#food-sheet-date').textContent = new Date().toLocaleDateString('sv-SE', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
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
  photoData = null;
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
  };
  store.addFood(store.todayKey(), item);
  toast(`${namn} loggad ✓`);
  closeSheet();
  renderFoodCard();
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
    const hints = new Map([[zx.DecodeHintType.POSSIBLE_FORMATS, [
      zx.BarcodeFormat.EAN_13, zx.BarcodeFormat.EAN_8,
      zx.BarcodeFormat.UPC_A, zx.BarcodeFormat.UPC_E,
    ]]]);
    const reader = new zx.BrowserMultiFormatReader(hints);
    const video = $('#scan-video');
    video.hidden = false;
    scanControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
      if (result) handleBarcode(result.getText());
    });
    status.textContent = 'Rikta kameran mot streckkoden.';
  } catch (err) {
    status.textContent = err?.name === 'NotAllowedError'
      ? 'Kameran nekades — tillåt kameraåtkomst i webbläsarens inställningar.'
      : 'Kunde inte starta kameran.';
    $('#btn-scan-start').hidden = false;
  }
}

function stopScanner() {
  if (scanControls) { try { scanControls.stop(); } catch {} scanControls = null; }
  const video = $('#scan-video');
  if (video) { video.hidden = true; }
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
    'behöver läggas in som hemlighet i Supabase (se instruktion under Mer).',
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

/* ---------- Init ---------- */
export function initFood(opts) {
  toast = opts.toast;
  onLogged = opts.onChange || (() => {});

  $('#btn-food-add').addEventListener('click', openSheet);
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

  // Foto
  $('#photo-input').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const status = $('#photo-status');
    try {
      status.textContent = 'Förbereder bilden …';
      const base64 = await fileToResizedBase64(file);
      photoData = { image: base64, mediaType: 'image/jpeg' };
      $('#photo-preview').src = `data:image/jpeg;base64,${base64}`;
      $('#photo-preview').hidden = false;
      await analyzeAndConfirm(photoData, status, 'ai');
    } catch {
      status.textContent = 'Kunde inte läsa bilden.';
    }
  });

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
