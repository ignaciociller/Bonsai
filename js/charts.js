// ───────────── Bonsai · gráficos SVG ligeros, sin dependencias ─────────────

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function niceTicks(min, max, count = 3) {
  if (min === max) { const d = Math.abs(min) || 1; min -= d * 0.5; max += d * 0.5; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, ticks };
}

let tipTimer;
function makeTip(el) {
  let tip = el.querySelector('.tip');
  if (!tip) {
    tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; el.appendChild(tip);
    // En pantallas táctiles no existe "pointerleave": oculta el detalle al soltar.
    el.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') { clearTimeout(tipTimer); tipTimer = setTimeout(() => { el.querySelectorAll('.tip').forEach((t) => (t.hidden = true)); el.querySelectorAll('.hover').forEach((h) => h.setAttribute('visibility', 'hidden')); }, 1800); }
    });
  }
  return tip;
}

function xLabelsEvery(n, width) {
  const maxLabels = Math.max(2, Math.floor(width / 48));
  return Math.max(1, Math.ceil(n / maxLabels));
}

/**
 * Gráfico de línea con área suave y cruz de lectura.
 * opts: { labels, values, color, fmt, fmtAxis, height, tipLabels }
 */
export function lineChart(el, opts) {
  const { labels, values, fmt, fmtAxis, height = 170 } = opts;
  const color = opts.color || 'var(--accent)';
  const W = Math.max(240, el.clientWidth || 320);
  const H = height;
  const top = 14, bottom = 22, left = 0, right = 8;
  const pw = W - left - right, ph = H - top - bottom;
  const valid = values.filter((v) => v != null);
  if (!valid.length) { el.innerHTML = `<p class="muted" style="font-size:13px;margin:24px 0;text-align:center">Sin datos todavía</p>`; return; }
  let mn = Math.min(...valid), mx = Math.max(...valid);
  const pad = (mx - mn) * 0.12 || Math.abs(mx) * 0.1 || 1;
  const { lo, hi, ticks } = niceTicks(mn - pad, mx + pad, 3);
  const n = values.length;
  const X = (i) => left + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const Y = (v) => top + ph - ((v - lo) / (hi - lo)) * ph;

  let grid = '';
  ticks.forEach((t) => {
    const y = Y(t);
    if (y < top - 1 || y > top + ph + 1) return;
    grid += `<line class="grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/>`;
    grid += `<text x="0" y="${y - 4}">${esc(fmtAxis(t))}</text>`;
  });

  // segmentos (permite huecos con null)
  let d = '', area = '', first = null, last = null;
  values.forEach((v, i) => {
    if (v == null) return;
    const x = X(i), y = Y(v);
    d += (first == null || values[i - 1] == null ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    if (first == null) first = i;
    last = i;
  });
  if (first != null && first !== last) {
    area = `M${X(first)} ${top + ph} ` + d.replace(/M/g, 'L').replace(/^L/, 'L') + ` L${X(last)} ${top + ph}Z`;
  }

  const every = xLabelsEvery(n, W);
  let xl = '';
  labels.forEach((l, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    if (i !== n - 1 && n - 1 - i < every) return;
    const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    xl += `<text x="${X(i)}" y="${H - 5}" text-anchor="${anchor}">${esc(l)}</text>`;
  });

  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.aria || 'Gráfico de evolución')}">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    ${area ? `<path d="${area}" fill="url(#${gid})"/>` : ''}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${last != null ? `<circle cx="${X(last)}" cy="${Y(values[last])}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>` : ''}
    ${n === 1 ? `<circle cx="${X(0)}" cy="${Y(values[0])}" r="4" fill="${color}"/>` : ''}
    <g class="hover" visibility="hidden">
      <line class="hx" y1="${top}" y2="${top + ph}" stroke="var(--muted)" stroke-dasharray="2 3"/>
      <circle class="hc" r="5" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
    </g>
    ${xl}
  </svg>`;

  const svg = el.querySelector('svg');
  const hover = svg.querySelector('.hover');
  const hx = svg.querySelector('.hx');
  const hc = svg.querySelector('.hc');
  const tip = makeTip(el);
  const tipLabels = opts.tipLabels || labels;

  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    let i = n === 1 ? 0 : Math.round(((x - left) / pw) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    // salta huecos
    if (values[i] == null) {
      let k = 1;
      while (k < n && values[i - k] == null && values[i + k] == null) k++;
      i = values[i - k] != null ? i - k : i + k;
      if (values[i] == null) return;
    }
    const cx = X(i), cy = Y(values[i]);
    hover.setAttribute('visibility', 'visible');
    hx.setAttribute('x1', cx); hx.setAttribute('x2', cx);
    hc.setAttribute('cx', cx); hc.setAttribute('cy', cy);
    tip.hidden = false;
    tip.innerHTML = `${esc(tipLabels[i])} · <b>${esc(fmt(values[i]))}</b>`;
    const px = (cx / W) * r.width;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(tw / 2, Math.min(r.width - tw / 2, px)) + 'px';
    tip.style.top = (cy / H) * r.height + 'px';
  };
  const hide = () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
}

/**
 * Barras agrupadas (ingresos / gastos por periodo).
 * opts: { labels, tipLabels, series:[{name,color,values}], selected, onSelect, fmt, fmtAxis }
 */
export function barChart(el, opts) {
  const { labels, series, fmt, fmtAxis, height = 170 } = opts;
  const W = Math.max(240, el.clientWidth || 320);
  const H = height;
  const top = 14, bottom = 22;
  const ph = H - top - bottom;
  const n = labels.length, k = series.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const { hi, ticks } = niceTicks(0, max, 3);
  const Y = (v) => top + ph - (v / hi) * ph;
  const groupW = W / n;
  const inner = Math.min(groupW * 0.7, 44);
  const barW = Math.max(3, (inner - (k - 1) * 2) / k);
  const radius = Math.min(4, barW / 2);

  let g = '', gl = '';
  ticks.forEach((t) => {
    if (t === 0) return;
    const y = Y(t);
    g += `<line class="grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/>`;
    gl += `<text x="0" y="${y - 4}">${esc(fmtAxis(t))}</text>`;
  });

  let bars = '', hits = '', xl = '';
  const every = xLabelsEvery(n, W);
  for (let i = 0; i < n; i++) {
    const gx = i * groupW + (groupW - (barW * k + (k - 1) * 2)) / 2;
    const dim = opts.selected != null && opts.selected !== i ? ' opacity=".38"' : '';
    series.forEach((s, j) => {
      const v = s.values[i] || 0;
      if (v <= 0) return;
      const x = gx + j * (barW + 2);
      const y = Y(v), h = top + ph - y;
      const r = Math.min(radius, h);
      bars += `<path d="M${x} ${top + ph} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + barW - r} Q${x + barW} ${y} ${x + barW} ${y + r} V${top + ph}Z" fill="${s.color}"${dim}/>`;
    });
    hits += `<rect class="hit" data-i="${i}" x="${i * groupW}" y="0" width="${groupW}" height="${H}" fill="transparent"/>`;
    if (i % every === 0 || n <= 12) {
      const sel = opts.selected === i;
      xl += `<text x="${i * groupW + groupW / 2}" y="${H - 5}" text-anchor="middle"${sel ? ' style="fill:var(--text);font-weight:700"' : ''}>${esc(labels[i])}</text>`;
    }
  }

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.aria || 'Ingresos y gastos por periodo')}">
    ${g}<line class="baseline" x1="0" x2="${W}" y1="${top + ph}" y2="${top + ph}"/>
    ${bars}${gl}${xl}${hits}</svg>`;

  const svg = el.querySelector('svg');
  const tip = makeTip(el);
  const tipLabels = opts.tipLabels || labels;
  svg.querySelectorAll('.hit').forEach((h) => {
    const i = +h.dataset.i;
    const show = () => {
      const r = svg.getBoundingClientRect();
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(tipLabels[i])}</b><br>` + series.map((s) => `${esc(s.name)}: <b>${esc(fmt(s.values[i] || 0))}</b>`).join('<br>');
      const tw = tip.offsetWidth;
      const px = ((i * groupW + groupW / 2) / W) * r.width;
      tip.style.left = Math.max(tw / 2, Math.min(r.width - tw / 2, px)) + 'px';
      const ymax = Math.max(...series.map((s) => s.values[i] || 0));
      tip.style.top = Math.max(tip.offsetHeight + 4, (Y(ymax) / H) * r.height) + 'px';
    };
    h.addEventListener('pointerenter', show);
    h.addEventListener('click', () => opts.onSelect && opts.onSelect(i));
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
}

/** Donut de distribución. items: [{label, value, color}] */
export function donut(el, items, centerTop, centerBottom) {
  const S = 132, r = 54, sw = 16, C = 2 * Math.PI * r;
  const total = items.reduce((a, b) => a + b.value, 0);
  let off = 0, segs = '';
  const gap = items.length > 1 ? 2 : 0;
  items.forEach((it) => {
    const len = (it.value / total) * C;
    const vis = Math.max(0.5, len - gap);
    segs += `<circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${sw}"
      stroke-dasharray="${vis} ${C - vis}" stroke-dashoffset="${-off}" transform="rotate(-90 ${S / 2} ${S / 2})"><title>${esc(it.label)}</title></circle>`;
    off += len;
  });
  el.innerHTML = `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Distribución">
    <circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${sw}"/>
    ${segs}
    <text x="${S / 2}" y="${S / 2 - 2}" text-anchor="middle" style="font-family:var(--serif);font-size:20px;fill:var(--text)">${esc(centerTop)}</text>
    <text x="${S / 2}" y="${S / 2 + 15}" text-anchor="middle" style="font-size:10px;fill:var(--muted)">${esc(centerBottom)}</text>
  </svg>`;
}

/** Mini gráfico para listas. */
export function sparkline(values, color) {
  const W = 64, H = 26;
  const v = values.filter((x) => x != null);
  if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}"><line x1="2" x2="${W - 2}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)" stroke-width="2" stroke-linecap="round"/></svg>`;
  const mn = Math.min(...v), mx = Math.max(...v);
  const sp = mx - mn || 1;
  const pts = v.map((x, i) => `${(2 + (i * (W - 4)) / (v.length - 1)).toFixed(1)},${(H - 3 - ((x - mn) / sp) * (H - 6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
