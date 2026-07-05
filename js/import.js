/* Import av hälsodata:
   1. Apple Health-export (export.xml från Hälsa-appen) — läses i bitar så
      även stora filer (100+ MB) fungerar i mobilen.
   2. Health Auto Export-appens JSON-format.
   3. Snabbloggning via URL (#log?...) från en iOS-genväg.
   Allt normaliseras till { "YYYY-MM-DD": { weight, sleepHours, steps, exerciseMin } }. */

const LB_PER_KG = 2.2046226218;

function dateKeyOf(str) {
  // "2026-07-01 07:00:00 +0200" eller ISO — vi vill ha lokal-datumdelen som den står
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function round1(v) { return Math.round(v * 10) / 10; }

/* ---------- Apple Health export.xml ---------- */

const RECORD_TYPES = {
  'HKQuantityTypeIdentifierBodyMass': 'weight',
  'HKQuantityTypeIdentifierStepCount': 'steps',
  'HKQuantityTypeIdentifierAppleExerciseTime': 'exercise',
  'HKCategoryTypeIdentifierSleepAnalysis': 'sleep',
};

export async function parseAppleHealthXML(file, onProgress) {
  const weightByDay = {};                 // sista mätningen per dag
  const sumBySource = { steps: {}, exercise: {} }; // day -> source -> summa
  const sleepIntervals = {};              // uppvakningsdag -> [{s,e} ms]

  const CHUNK = 8 * 1024 * 1024;
  let offset = 0, remainder = '';
  const decoder = new TextDecoder();
  const attrRe = (name) => new RegExp(`${name}="([^"]*)"`);

  while (offset < file.size) {
    const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
    offset += CHUNK;
    const text = remainder + decoder.decode(buf, { stream: offset < file.size });
    const lastNl = text.lastIndexOf('\n');
    const usable = lastNl === -1 ? '' : text.slice(0, lastNl);
    remainder = lastNl === -1 ? text : text.slice(lastNl + 1);
    if (onProgress) onProgress(Math.min(offset / file.size, 1));

    for (const line of usable.split('\n')) {
      if (!line.includes('<Record ')) continue;
      const typeMatch = /type="([^"]+)"/.exec(line);
      const kind = typeMatch && RECORD_TYPES[typeMatch[1]];
      if (!kind) continue;

      const start = attrRe('startDate').exec(line)?.[1];
      if (!start) continue;

      if (kind === 'weight') {
        const day = dateKeyOf(start);
        const value = parseFloat(attrRe('value').exec(line)?.[1]);
        if (!day || !isFinite(value)) continue;
        const unit = attrRe('unit').exec(line)?.[1] || 'kg';
        const kg = unit === 'lb' ? value / LB_PER_KG : value;
        // Raderna kommer i kronologisk ordning — sista vinner
        weightByDay[day] = round1(kg);
      } else if (kind === 'sleep') {
        const value = attrRe('value').exec(line)?.[1] || '';
        if (!value.includes('Asleep')) continue; // hoppa InBed/Awake
        const end = attrRe('endDate').exec(line)?.[1];
        if (!end) continue;
        const day = dateKeyOf(end); // natten tillhör uppvakningsdagen
        const s = Date.parse(start.replace(' ', 'T').replace(' ', ''));
        const e = Date.parse(end.replace(' ', 'T').replace(' ', ''));
        if (!day || !isFinite(s) || !isFinite(e) || e <= s) continue;
        (sleepIntervals[day] ||= []).push({ s, e });
      } else {
        // steps / exercise: summera per källa och dag, ta sedan största källan
        // (iPhone + klocka registrerar samma steg — att slå ihop dubbelräknar)
        const day = dateKeyOf(start);
        const value = parseFloat(attrRe('value').exec(line)?.[1]);
        if (!day || !isFinite(value)) continue;
        const source = attrRe('sourceName').exec(line)?.[1] || '?';
        const daySources = (sumBySource[kind][day] ||= {});
        daySources[source] = (daySources[source] || 0) + value;
      }
    }
  }

  const out = {};
  const put = (day, field, value) => { (out[day] ||= {})[field] = value; };

  for (const [day, kg] of Object.entries(weightByDay)) put(day, 'weight', kg);
  for (const [day, intervals] of Object.entries(sleepIntervals)) {
    put(day, 'sleepHours', round1(mergedDurationHours(intervals)));
  }
  for (const [kind, field] of [['steps', 'steps'], ['exercise', 'exerciseMin']]) {
    for (const [day, sources] of Object.entries(sumBySource[kind])) {
      const best = Math.max(...Object.values(sources));
      put(day, field, Math.round(best));
    }
  }
  return out;
}

/* Slår ihop överlappande sömnintervall (klocka + telefon loggar samma natt). */
function mergedDurationHours(intervals) {
  intervals.sort((a, b) => a.s - b.s);
  let total = 0, curS = intervals[0].s, curE = intervals[0].e;
  for (const { s, e } of intervals.slice(1)) {
    if (s <= curE) curE = Math.max(curE, e);
    else { total += curE - curS; curS = s; curE = e; }
  }
  total += curE - curS;
  return total / 3600000;
}

/* ---------- Health Auto Export (JSON) ---------- */

export function parseHealthAutoExport(text) {
  const parsed = JSON.parse(text);
  const metrics = parsed?.data?.metrics;
  if (!Array.isArray(metrics)) throw new Error('Hittade inga mätvärden i filen (väntade data.metrics).');

  const out = {};
  const put = (day, field, value) => {
    if (day && isFinite(value)) (out[day] ||= {})[field] = value;
  };

  for (const metric of metrics) {
    const name = (metric.name || '').toLowerCase();
    const rows = metric.data || [];
    if (name.includes('body_mass') || name === 'weight') {
      const toKg = (metric.units || 'kg').toLowerCase() === 'lb' ? 1 / LB_PER_KG : 1;
      for (const r of rows) put(dateKeyOf(r.date), 'weight', round1(r.qty * toKg));
    } else if (name.includes('sleep')) {
      for (const r of rows) {
        const h = r.asleep ?? r.totalSleep ??
          ((r.core ?? 0) + (r.deep ?? 0) + (r.rem ?? 0) || undefined);
        put(dateKeyOf(r.sleepEnd || r.date), 'sleepHours', round1(h));
      }
    } else if (name.includes('step_count') || name === 'steps') {
      for (const r of rows) put(dateKeyOf(r.date), 'steps', Math.round(r.qty));
    } else if (name.includes('exercise_time')) {
      for (const r of rows) put(dateKeyOf(r.date), 'exerciseMin', Math.round(r.qty));
    }
  }
  return out;
}

/* ---------- Snabbloggning via URL (iOS-genväg) ----------
   Format: index.html#log?date=2026-07-05&weight=82.4&sleep=7.5&steps=9200&exercise=35&fasting=16.5&diet=1
   Alla parametrar är valfria; date default = idag. */

export function parseLogURL(hash) {
  if (!hash.startsWith('#log')) return null;
  const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(q);
  const num = (k) => {
    const v = parseFloat((params.get(k) || '').replace(',', '.'));
    return isFinite(v) ? v : undefined;
  };
  const patch = {
    weight: num('weight'),
    sleepHours: num('sleep'),
    steps: num('steps') !== undefined ? Math.round(num('steps')) : undefined,
    exerciseMin: num('exercise') !== undefined ? Math.round(num('exercise')) : undefined,
    fastingHours: num('fasting'),
    dietOk: params.get('diet') === '1' ? true : undefined,
  };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
  const dateRaw = params.get('date') || '';
  const date = dateKeyOf(dateRaw) || null;
  return { date, patch };
}
