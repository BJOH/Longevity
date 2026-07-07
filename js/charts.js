/* Handritade SVG-diagram: linje (trend över tid) och stapel (mängd per dag).
   Följer mark-specarna: 2px linjer, 8px ändpunkter med ytring, hårfina
   gridlinjer, direktetikett på sista värdet, korshår + tooltip. */

const SVGNS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function shortDate(key) {
  const [, m, d] = key.split('-');
  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun',
                  'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

function fmt(v, decimals = 1) {
  const r = Math.round(v * 10 ** decimals) / 10 ** decimals;
  return r.toLocaleString('sv-SE');
}

/* Skala x utifrån verkliga datum så att luckor i loggningen syns i avståndet. */
function dayNumber(dateKey) {
  return Math.round(new Date(dateKey + 'T12:00:00').getTime() / 86400000);
}

/**
 * Ritar ett diagram i `container`.
 * opts: { type: 'line'|'column', data: [{date, value}], goal, goalLabel,
 *         unit, color (css-varnamn t.ex. '--c-weight'), decimals, rangeDays }
 */
export function renderChart(container, opts) {
  container.textContent = '';
  const { type, data, goal, unit = '', decimals = 1, rangeDays } = opts;
  const colorVar = `var(${opts.color})`;

  if (!data.length) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'Ingen data i perioden ännu — logga under Idag.';
    container.appendChild(empty);
    return;
  }

  const W = 680, H = 220;
  const M = { top: 14, right: 52, bottom: 26, left: 40 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;

  const values = data.map(d => d.value);
  let vMin = Math.min(...values, goal ?? Infinity);
  let vMax = Math.max(...values, goal ?? -Infinity);
  if (type === 'column') vMin = 0;
  else {
    const pad = (vMax - vMin) * 0.15 || vMax * 0.05 || 1;
    vMin -= pad; vMax += pad;
  }
  const ticks = niceTicks(vMin, vMax, 4);
  vMin = ticks[0]; vMax = ticks[ticks.length - 1];

  const dayEnd = dayNumber(data[data.length - 1].date);
  const dayStart = rangeDays ? dayEnd - (rangeDays - 1) : dayNumber(data[0].date);
  const daySpan = Math.max(dayEnd - dayStart, 1);

  const x = key => M.left + ((dayNumber(key) - dayStart) / daySpan) * iw;
  const y = v => M.top + ih - ((v - vMin) / (vMax - vMin)) * ih;

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': opts.ariaLabel || 'Diagram',
  });

  // Gridlinjer + y-etiketter (hårfina, tillbakadragna)
  for (const t of ticks) {
    svg.appendChild(el('line', {
      x1: M.left, x2: M.left + iw, y1: y(t), y2: y(t),
      class: t === ticks[0] ? 'chart-baseline' : 'chart-grid',
    }));
    const lbl = el('text', { x: M.left - 6, y: y(t) + 3.5, class: 'chart-tick', 'text-anchor': 'end' });
    lbl.textContent = fmt(t, decimals >= 1 && t % 1 !== 0 ? 1 : 0);
    svg.appendChild(lbl);
  }

  // X-etiketter: första och sista datum i perioden
  const xl1 = el('text', { x: M.left, y: H - 6, class: 'chart-tick', 'text-anchor': 'start' });
  xl1.textContent = shortDate(data[0].date);
  const xl2 = el('text', { x: M.left + iw, y: H - 6, class: 'chart-tick', 'text-anchor': 'end' });
  xl2.textContent = shortDate(data[data.length - 1].date);
  svg.appendChild(xl1);
  if (data.length > 1) svg.appendChild(xl2);

  // Mållinje (referens, inte gridlinje)
  if (typeof goal === 'number' && goal >= vMin && goal <= vMax) {
    svg.appendChild(el('line', {
      x1: M.left, x2: M.left + iw, y1: y(goal), y2: y(goal), class: 'chart-goal',
    }));
    const gl = el('text', {
      x: M.left + iw + 4, y: y(goal) + 3.5, class: 'chart-goal-label', 'text-anchor': 'start',
    });
    gl.textContent = opts.goalLabel || 'Mål';
    svg.appendChild(gl);
  }

  const hoverTargets = []; // {cx, item, markEl}

  if (type === 'line') {
    const pts = data.map(d => [x(d.date), y(d.value)]);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    // Ytfyllnad ~10 %
    svg.appendChild(el('path', {
      d: `${path}L${pts[pts.length - 1][0].toFixed(1)},${y(vMin)}L${pts[0][0].toFixed(1)},${y(vMin)}Z`,
      fill: colorVar, opacity: '0.1', stroke: 'none',
    }));
    svg.appendChild(el('path', {
      d: path, fill: 'none', stroke: colorVar,
      'stroke-width': '2.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    // Öppna punkter (ytfyllda med färgad ring) när serien är gles nog
    if (pts.length <= 16) {
      for (const [px, py] of pts) {
        svg.appendChild(el('circle', {
          cx: px, cy: py, r: 4, class: 'chart-open-dot', stroke: colorVar,
        }));
      }
    }
    // Ändpunkt + direktetikett för sista värdet
    const [ex, ey] = pts[pts.length - 1];
    svg.appendChild(el('circle', { cx: ex, cy: ey, r: 6.5, class: 'chart-surface-ring' }));
    svg.appendChild(el('circle', {
      cx: ex, cy: ey, r: 4.5, class: 'chart-open-dot', stroke: colorVar,
    }));
    const endLbl = el('text', {
      x: ex + 9, y: ey + 4, class: 'chart-end-label', 'text-anchor': 'start',
    });
    endLbl.textContent = fmt(data[data.length - 1].value, decimals);
    // Undvik krock med mållinje-etiketten
    if (typeof goal === 'number' && Math.abs(y(goal) - ey) < 14) {
      endLbl.setAttribute('y', ey + (ey > y(goal) ? 16 : -8));
    }
    svg.appendChild(endLbl);
    data.forEach((d, i) => hoverTargets.push({ cx: pts[i][0], cy: pts[i][1], item: d }));
  } else {
    // Kolumner: max 24px breda, 4px rundad topp, rak bas, 2px luft emellan
    const slot = iw / (daySpan + 1);
    const bw = Math.max(3, Math.min(24, slot - 2));
    for (const d of data) {
      const cx = x(d.date);
      const top = y(d.value), base = y(0);
      const h = Math.max(base - top, 1);
      const r = Math.min(4, bw / 2, h);
      const left = cx - bw / 2;
      const bar = el('path', {
        d: `M${left},${base} L${left},${top + r} Q${left},${top} ${left + r},${top}` +
           ` L${left + bw - r},${top} Q${left + bw},${top} ${left + bw},${top + r}` +
           ` L${left + bw},${base} Z`,
        fill: colorVar, class: 'chart-bar',
      });
      svg.appendChild(bar);
      hoverTargets.push({ cx, cy: top, item: d, markEl: bar });
    }
  }

  // Korshår + tooltip
  const cross = el('line', { y1: M.top, y2: M.top + ih, class: 'chart-crosshair', visibility: 'hidden' });
  svg.appendChild(cross);
  const hoverDot = type === 'line'
    ? el('circle', { r: 5, fill: colorVar, class: 'chart-hover-dot', visibility: 'hidden' })
    : null;
  if (hoverDot) {
    const ring = el('circle', { r: 7, class: 'chart-surface-ring', visibility: 'hidden' });
    svg.appendChild(ring);
    hoverDot._ring = ring;
    svg.appendChild(hoverDot);
  }

  const tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  tip.hidden = true;
  const tipValue = document.createElement('strong');
  const tipLabel = document.createElement('span');
  tip.append(tipValue, document.createElement('br'), tipLabel);

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  wrap.append(svg, tip);
  container.appendChild(wrap);

  let activeBar = null;
  function showAt(target) {
    cross.setAttribute('x1', target.cx);
    cross.setAttribute('x2', target.cx);
    cross.setAttribute('visibility', 'visible');
    if (hoverDot) {
      hoverDot.setAttribute('cx', target.cx); hoverDot.setAttribute('cy', target.cy);
      hoverDot.setAttribute('visibility', 'visible');
      hoverDot._ring.setAttribute('cx', target.cx); hoverDot._ring.setAttribute('cy', target.cy);
      hoverDot._ring.setAttribute('visibility', 'visible');
    }
    if (activeBar) activeBar.classList.remove('is-hover');
    if (target.markEl) { target.markEl.classList.add('is-hover'); activeBar = target.markEl; }
    tipValue.textContent = `${fmt(target.item.value, decimals)} ${unit}`.trim();
    tipLabel.textContent = shortDate(target.item.date);
    tip.hidden = false;
    const rect = wrap.getBoundingClientRect();
    const px = (target.cx / W) * rect.width;
    tip.style.left = `${Math.min(Math.max(px, 44), rect.width - 44)}px`;
  }
  function hide() {
    cross.setAttribute('visibility', 'hidden');
    if (hoverDot) { hoverDot.setAttribute('visibility', 'hidden'); hoverDot._ring.setAttribute('visibility', 'hidden'); }
    if (activeBar) { activeBar.classList.remove('is-hover'); activeBar = null; }
    tip.hidden = true;
  }

  svg.addEventListener('pointermove', ev => {
    const rect = svg.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * W;
    let best = null, bestDist = Infinity;
    for (const t of hoverTargets) {
      const dist = Math.abs(t.cx - mx);
      if (dist < bestDist) { bestDist = dist; best = t; }
    }
    if (best) showAt(best);
  });
  svg.addEventListener('pointerleave', hide);
}
