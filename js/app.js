// ───────────── Bonsai · aplicación ─────────────
import * as S from './store.js';
import { lineChart, barChart, donut, sparkline } from './charts.js';

const APP_VERSION = '1.0.0';

// ───────────── utilidades ─────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const st = () => S.getState();

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MSHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const pad2 = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const curMonthKey = () => todayISO().slice(0, 7);
const mk = (y, m) => `${y}-${pad2(m)}`;                // m: 1..12
const parseMK = (k) => { const [y, m] = k.split('-').map(Number); return { y, m }; };
const addMonths = (k, n) => { const { y, m } = parseMK(k); const d = new Date(y, m - 1 + n, 1); return mk(d.getFullYear(), d.getMonth() + 1); };
const monthLabel = (k) => { const { y, m } = parseMK(k); return `${cap(MONTHS[m - 1])} ${y}`; };
const monthEnd = (k) => { const { y, m } = parseMK(k); return `${k}-${pad2(new Date(y, m, 0).getDate())}`; };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const dayLabel = (iso) => { const d = new Date(iso + 'T12:00:00'); return `${d.getDate()} ${MSHORT[d.getMonth()]}`; };
const dayLabelY = (iso) => { const d = new Date(iso + 'T12:00:00'); return `${d.getDate()} ${MSHORT[d.getMonth()]} ${d.getFullYear()}`; };

let nf = null, nf0 = null, nfc = null;
function buildFormatters() {
  const cur = st().settings.currency || 'EUR';
  const base = { style: 'currency', currency: cur };
  try {
    nf = new Intl.NumberFormat('es-ES', { ...base, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
    nf0 = new Intl.NumberFormat('es-ES', { ...base, maximumFractionDigits: 0, useGrouping: 'always' });
  } catch {
    nf = new Intl.NumberFormat('es-ES', { ...base, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    nf0 = new Intl.NumberFormat('es-ES', { ...base, maximumFractionDigits: 0 });
  }
  nfc = new Intl.NumberFormat('es-ES', { ...base, notation: 'compact', maximumFractionDigits: 1 });
}
const money = (n) => nf.format(n || 0);
const money0 = (n) => nf0.format(Math.round(n || 0));
const moneyC = (n) => nfc.format(n || 0);
const signed = (n, f = money) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n));
const pct = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';
const curSymbol = () => {
  try { return nf.formatToParts(0).find((p) => p.type === 'currency').value; } catch { return '€'; }
};

/** Acepta "1.234,56", "1234.5", "45+30,5-10" … devuelve número o null si vacío. */
function parseAmount(raw) {
  let s = String(raw ?? '').replace(/[\s€$£]/g, '');
  if (!s) return null;
  if (!/^[\d.,+\-]+$/.test(s)) return NaN;
  const parts = s.match(/[+\-]?[^+\-]+/g) || [];
  let total = 0;
  for (let p of parts) {
    let sign = 1;
    if (p[0] === '-') { sign = -1; p = p.slice(1); } else if (p[0] === '+') p = p.slice(1);
    if (p.includes(',')) p = p.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(p)) p = p.replace(/\./g, '');
    const v = Number(p);
    if (!isFinite(v)) return NaN;
    total += sign * v;
  }
  return Math.round(total * 100) / 100;
}
const numInput = (n) => (n ? String(n).replace('.', ',') : '');

// ───────────── cálculos ─────────────
const sumObj = (o) => Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0);
function monthTotals(rec) {
  const inc = sumObj(rec && rec.inc), exp = sumObj(rec && rec.exp);
  return { inc, exp, net: inc - exp };
}
const monthKeys = () => Object.keys(st().months).sort();
function allCats() { const s = st().settings; return [...s.incomeCats, ...s.expenseCats]; }
const catName = (id) => (allCats().find((c) => c.id === id) || {}).name || 'Sin categoría';

function cumulativeNetUntil(key) {
  let t = 0;
  for (const [k, rec] of Object.entries(st().months)) if (k <= key) t += monthTotals(rec).net;
  return t;
}
function entryAt(asset, iso) {
  let e = null;
  for (const h of asset.hist) { if (h.d <= iso) e = h; else break; }
  return e;
}
const sortHist = (a) => a.hist.sort((x, y) => (x.d < y.d ? -1 : 1));
function investAt(iso) {
  let value = 0, contrib = 0;
  for (const a of st().assets) {
    const e = entryAt(a, iso);
    if (e) { value += e.v; contrib += e.c; }
  }
  return { value, contrib, gain: value - contrib };
}
const netWorthAt = (key) => (+st().settings.initialBalance || 0) + cumulativeNetUntil(key) + investAt(monthEnd(key)).gain;
function netWorthNow() {
  return (+st().settings.initialBalance || 0) + cumulativeNetUntil('9999-12') + investAt(todayISO()).gain;
}
function firstDataMonth() {
  const ks = monthKeys();
  let first = ks[0] || null;
  for (const a of st().assets) if (a.hist[0]) { const k = a.hist[0].d.slice(0, 7); if (!first || k < first) first = k; }
  return first;
}

// ───────────── UI: toast, hojas, confirmación ─────────────
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function openSheet(title, html, onMount, onClose) {
  const root = $('#sheetRoot');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `<div class="grabber"></div><div class="sheet-head"><h2>${esc(title)}</h2>
    <button class="icon-btn" data-close aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="sheet-body">${html}</div>`;
  root.append(scrim, sheet);
  requestAnimationFrame(() => { scrim.classList.add('show'); sheet.classList.add('show'); });
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    scrim.classList.remove('show'); sheet.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
    setTimeout(() => { scrim.remove(); sheet.remove(); }, 280);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', close);
  sheet.querySelector('[data-close]').addEventListener('click', close);
  onMount && onMount(sheet.querySelector('.sheet-body'), close);
  return close;
}

function confirmSheet(title, text, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    let result = false;
    openSheet(title, `<p style="margin:0 0 18px;color:var(--text-2)">${esc(text)}</p>
      <div class="actions"><button class="btn" data-no>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`,
      (body, close) => {
        body.querySelector('[data-no]').onclick = () => { result = false; close(); };
        body.querySelector('[data-yes]').onclick = () => { result = true; close(); };
      },
      () => resolve(result));
  });
}

const ICON = {
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
};
const BONSAI_SVG = `<svg viewBox="0 0 512 512" aria-hidden="true"><g fill="var(--accent)"><ellipse cx="248" cy="138" rx="92" ry="40"/><ellipse cx="300" cy="118" rx="58" ry="30"/><ellipse cx="146" cy="214" rx="74" ry="32"/><ellipse cx="190" cy="198" rx="50" ry="26"/><ellipse cx="362" cy="236" rx="70" ry="30"/><ellipse cx="330" cy="222" rx="44" ry="24"/><path d="M222 384 C228 336 292 318 268 268 C252 236 286 210 258 168 L272 162 C306 210 270 236 286 268 C312 322 258 344 262 384 Z"/><path d="M262 214 C224 210 198 214 168 222 L170 232 C204 226 232 226 262 230 Z"/><path d="M284 272 C306 256 320 248 344 242 L348 252 C326 258 310 268 292 284 Z"/><rect x="136" y="380" width="240" height="18" rx="2"/><path d="M154 398 H358 L342 436 H170 Z"/></g></svg>`;

// ───────────── navegación ─────────────
const ui = {
  tab: 'charts',
  gran: 'M',             // M | Q | S | Y
  year: new Date().getFullYear(),
  sel: null,             // índice de periodo seleccionado
  dist: 'exp',
  addMonth: null,
  range: '1M',
};

function showTab(tab) {
  ui.tab = tab;
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== tab; });
  window.scrollTo({ top: 0 });
  render();
}

function render() {
  if (!st()) return;
  if (ui.tab === 'charts') renderCharts();
  else if (ui.tab === 'add') renderAdd();
  else renderAssets();
}

// ───────────── Pestaña: Resumen / gráficos ─────────────
function periodsFor(gran, year) {
  if (gran === 'M') return MSHORT.map((s, i) => ({ label: s, tip: `${cap(MONTHS[i])} ${year}`, months: [mk(year, i + 1)] }));
  if (gran === 'Q') return [0, 1, 2, 3].map((q) => ({ label: `T${q + 1}`, tip: `T${q + 1} ${year}`, months: [1, 2, 3].map((m) => mk(year, q * 3 + m)) }));
  if (gran === 'S') return [0, 1].map((s) => ({ label: `S${s + 1}`, tip: `${s ? '2.º' : '1.er'} semestre ${year}`, months: [1, 2, 3, 4, 5, 6].map((m) => mk(year, s * 6 + m)) }));
  const ys = yearsWithData();
  return ys.map((y) => ({ label: String(y), tip: String(y), months: Array.from({ length: 12 }, (_, i) => mk(y, i + 1)) }));
}
function yearsWithData() {
  const now = new Date().getFullYear();
  const f = firstDataMonth();
  const start = f ? Math.min(parseMK(f).y, now) : now;
  const ys = [];
  for (let y = start; y <= now; y++) ys.push(y);
  return ys;
}
function aggregate(months) {
  const res = { inc: 0, exp: 0, incBy: {}, expBy: {}, count: 0 };
  for (const k of months) {
    const r = st().months[k];
    if (!r) continue;
    res.count++;
    for (const [id, v] of Object.entries(r.inc || {})) { res.inc += v; res.incBy[id] = (res.incBy[id] || 0) + v; }
    for (const [id, v] of Object.entries(r.exp || {})) { res.exp += v; res.expBy[id] = (res.expBy[id] || 0) + v; }
  }
  return res;
}

function renderCharts() {
  const v = $('#view-charts');
  const s = st();
  const hasData = monthKeys().length || s.assets.length;
  if (!hasData) {
    v.innerHTML = `<div class="empty">${BONSAI_SVG}<h2>Planta tu primer mes</h2>
      <p>Registra tus ingresos y gastos de cada mes y aquí verás cómo crece tu patrimonio.</p>
      <button class="btn primary" id="goAdd">${ICON.plus} Registrar un mes</button>
      <p class="note" style="margin-top:18px">Consejo: ajusta tus categorías e ingresos habituales en la rueda de arriba.</p></div>`;
    $('#goAdd').onclick = () => showTab('add');
    return;
  }

  const years = yearsWithData();
  if (!years.includes(ui.year)) ui.year = years[years.length - 1];
  const periods = periodsFor(ui.gran, ui.year);
  const aggs = periods.map((p) => aggregate(p.months));
  const cur = curMonthKey();
  if (ui.sel == null || ui.sel >= periods.length) {
    let idx = -1;
    aggs.forEach((a, i) => { if (a.count) idx = i; });
    if (idx < 0) idx = periods.findIndex((p) => p.months.includes(cur));
    ui.sel = idx < 0 ? periods.length - 1 : idx;
  }

  // Patrimonio
  const nw = netWorthNow();
  const thisYear = new Date().getFullYear();
  const yStart = netWorthAt(mk(thisYear - 1, 12));
  const first = firstDataMonth();
  const nwSeries = periods.map((p) => {
    const startK = p.months[0];
    let endK = p.months[p.months.length - 1];
    if (startK > cur) return null;
    if (endK > cur) endK = cur;
    if (first && endK < first) return null;
    return netWorthAt(endK);
  });
  const ytdDelta = nw - yStart;
  const investGain = investAt(todayISO()).gain;

  const selP = periods[ui.sel];
  const a = aggs[ui.sel];
  const net = a.inc - a.exp;
  const rate = a.inc > 0 ? Math.max(0, Math.min(100, (net / a.inc) * 100)) : 0;

  const yearNav = ui.gran === 'Y' ? '' : `<div class="stepper">
      <button id="yPrev" aria-label="Año anterior" ${ui.year <= years[0] ? 'disabled' : ''}>${ICON.left}</button>
      <div class="label">${ui.year}</div>
      <button id="yNext" aria-label="Año siguiente" ${ui.year >= years[years.length - 1] ? 'disabled' : ''}>${ICON.right}</button></div>`;

  v.innerHTML = `
    <div class="hero">
      <div class="hero-label">Patrimonio</div>
      <div class="hero-value">${money0(nw)}</div>
      <div class="delta ${ytdDelta >= 0 ? 'up' : 'down'}">${signed(ytdDelta, money0)} <span class="muted">en lo que va de ${thisYear}</span></div>
      ${s.assets.length ? `<div class="note" style="margin:4px 0 0">Incluye ${signed(investGain, money0)} de rentabilidad de inversiones</div>` : ''}
    </div>

    <div class="filters">
      <div class="seg" id="granSeg">
        ${[['M', 'Mes'], ['Q', 'Trimestre'], ['S', 'Semestre'], ['Y', 'Año']].map(([k, l]) => `<button data-g="${k}" aria-pressed="${ui.gran === k}">${l}</button>`).join('')}
      </div>
      ${yearNav}
    </div>

    <div class="card">
      <div class="card-head"><h3 class="card-title">Evolución del patrimonio</h3><span class="card-sub">${ui.gran === 'Y' ? 'por año' : ui.year}</span></div>
      <div class="chart" id="nwChart"></div>
    </div>

    <div class="card">
      <div class="card-head"><h3 class="card-title">Ingresos y gastos</h3>
        <div class="legend"><span><i class="swatch" style="background:var(--income)"></i>Ingresos</span><span><i class="swatch" style="background:var(--expense)"></i>Gastos</span></div></div>
      <div class="chart" id="barChart"></div>
      <p class="note" style="margin-top:2px">Toca una barra para ver ese periodo.</p>
    </div>

    <div class="card">
      <div class="card-head"><h3 class="card-title">${esc(selP.tip)}</h3>${a.count ? `<span class="card-sub">${a.count} ${a.count === 1 ? 'mes' : 'meses'}</span>` : '<span class="badge neutral">Sin registrar</span>'}</div>
      <div class="kpis">
        <div class="kpi"><div class="k">Ingresos</div><div class="v inc">${money0(a.inc)}</div></div>
        <div class="kpi"><div class="k">Gastos</div><div class="v exp">${money0(a.exp)}</div></div>
        <div class="kpi"><div class="k">Ahorro</div><div class="v">${signed(net, money0)}</div></div>
      </div>
      <div class="rate"><div class="rate-row"><span>Tasa de ahorro</span><b style="color:var(--text)">${a.inc > 0 ? Math.round((net / a.inc) * 100) + ' %' : '—'}</b></div>
        <div class="rate-bar"><span style="width:${rate}%"></span></div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3 class="card-title">Distribución</h3>
        <div class="seg small" id="distSeg"><button data-d="exp" aria-pressed="${ui.dist === 'exp'}">Gastos</button><button data-d="inc" aria-pressed="${ui.dist === 'inc'}">Ingresos</button></div></div>
      <div id="dist"></div>
    </div>

    <div class="card">
      <div class="card-head"><h3 class="card-title">Meses registrados · ${ui.year}</h3></div>
      <ul class="list" id="monthList"></ul>
    </div>`;

  // filtros
  $$('#granSeg button', v).forEach((b) => b.onclick = () => { ui.gran = b.dataset.g; ui.sel = null; renderCharts(); });
  $$('#distSeg button', v).forEach((b) => b.onclick = () => { ui.dist = b.dataset.d; renderCharts(); });
  const yp = $('#yPrev', v), yn = $('#yNext', v);
  if (yp) yp.onclick = () => { ui.year--; ui.sel = null; renderCharts(); };
  if (yn) yn.onclick = () => { ui.year++; ui.sel = null; renderCharts(); };

  // gráficos
  lineChart($('#nwChart'), {
    labels: periods.map((p) => p.label), tipLabels: periods.map((p) => p.tip),
    values: nwSeries, fmt: money0, fmtAxis: moneyC, aria: 'Evolución del patrimonio',
  });
  barChart($('#barChart'), {
    labels: periods.map((p) => p.label), tipLabels: periods.map((p) => p.tip),
    series: [
      { name: 'Ingresos', color: 'var(--income)', values: aggs.map((x) => x.inc) },
      { name: 'Gastos', color: 'var(--expense)', values: aggs.map((x) => x.exp) },
    ],
    selected: ui.sel, fmt: money0, fmtAxis: moneyC,
    onSelect: (i) => { ui.sel = i; renderCharts(); },
  });

  // distribución
  const by = ui.dist === 'exp' ? a.expBy : a.incBy;
  const total = ui.dist === 'exp' ? a.exp : a.inc;
  const dist = $('#dist');
  const items = Object.entries(by).filter(([, val]) => val > 0).map(([id, val]) => ({ id, label: catName(id), value: val })).sort((x, y) => y.value - x.value);
  if (!items.length) {
    dist.innerHTML = `<p class="muted" style="font-size:13px;margin:6px 0">No hay ${ui.dist === 'exp' ? 'gastos' : 'ingresos'} registrados en este periodo.</p>`;
  } else {
    let shown = items.slice(0, 7);
    if (items.length > 7) shown.push({ id: '_otros', label: 'Resto', value: items.slice(7).reduce((x, y) => x + y.value, 0) });
    shown = shown.map((it, i) => ({ ...it, color: it.id === '_otros' ? 'var(--c8)' : `var(--c${i + 1})` }));
    const perMonth = a.count > 1;
    dist.innerHTML = `<div class="donut-wrap"><div id="donut"></div><ul class="list">${shown.map((it) => `
      <li class="row" style="padding:7px 0"><i class="swatch" style="background:${it.color}"></i>
        <div class="grow"><div class="title" style="font-weight:500;font-size:14px">${esc(it.label)}</div>${perMonth ? `<div class="sub">${money0(it.value / a.count)}/mes</div>` : ''}</div>
        <div style="text-align:right"><div class="amt" style="font-size:14px">${money0(it.value)}</div><div class="sub">${Math.round((it.value / total) * 100)} %</div></div></li>`).join('')}</ul></div>`;
    donut($('#donut'), shown, moneyC(total), ui.dist === 'exp' ? 'gastos' : 'ingresos');
  }

  // lista de meses del año
  const ml = $('#monthList');
  const ks = monthKeys().filter((k) => k.startsWith(ui.year + '-')).reverse();
  ml.innerHTML = ks.length ? ks.map((k) => {
    const t = monthTotals(s.months[k]);
    return `<li class="row tap" data-k="${k}"><div class="grow"><div class="title">${monthLabel(k)}</div>
      <div class="sub">Ingresos ${money0(t.inc)} · Gastos ${money0(t.exp)}</div></div>
      <div class="amt" style="color:${t.net >= 0 ? 'var(--income)' : 'var(--expense)'}">${signed(t.net, money0)}</div>${ICON.chev}</li>`;
  }).join('') : `<li class="row"><span class="muted" style="font-size:13px">Aún no hay meses registrados este año.</span></li>`;
  $$('.row[data-k]', ml).forEach((r) => r.onclick = () => { ui.addMonth = r.dataset.k; showTab('add'); });
}

// ───────────── Pestaña: Registrar mes ─────────────
function defaultAddMonth() {
  const prev = addMonths(curMonthKey(), -1);
  return st().months[prev] ? curMonthKey() : prev;
}

function renderAdd() {
  const v = $('#view-add');
  const s = st();
  if (!ui.addMonth) ui.addMonth = defaultAddMonth();
  const key = ui.addMonth;
  const rec = s.months[key];
  const sym = curSymbol();

  const valFor = (kind, cat) => {
    if (rec) return (rec[kind] || {})[cat.id];
    return cat.def > 0 ? cat.def : undefined;
  };
  const catsFor = (kind) => {
    const list = kind === 'inc' ? s.settings.incomeCats : s.settings.expenseCats;
    return list.filter((c) => !c.archived || (rec && (rec[kind] || {})[c.id]));
  };
  const rows = (kind) => catsFor(kind).map((c) => {
    const val = valFor(kind, c);
    return `<div class="money-row"><label for="f-${c.id}">${esc(c.name)}${c.archived ? ' <span class="badge neutral">archivada</span>' : ''}</label>
      <div class="money"><input id="f-${c.id}" data-kind="${kind}" data-id="${c.id}" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(numInput(val))}"><span class="cur">${esc(sym)}</span></div></div>`;
  }).join('');

  v.innerHTML = `
    <div class="view-title"><h1>${rec ? 'Editar mes' : 'Cerrar el mes'}</h1>${rec ? '<span class="badge">Integrado</span>' : '<span class="badge neutral">Nuevo</span>'}</div>
    <div class="card" style="padding:10px">
      <div class="stepper">
        <button id="mPrev" aria-label="Mes anterior">${ICON.left}</button>
        <div class="label"><small>Mes</small>${monthLabel(key)}</div>
        <button id="mNext" aria-label="Mes siguiente" ${key >= curMonthKey() ? 'disabled' : ''}>${ICON.right}</button>
      </div>
    </div>
    <form id="monthForm" autocomplete="off">
      <div class="card">
        <div class="card-head"><h3 class="card-title">Ingresos</h3>${rec ? '' : '<span class="card-sub">valores por defecto</span>'}</div>
        ${rows('inc') || '<p class="muted" style="font-size:13px">Añade categorías de ingreso en Ajustes.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><h3 class="card-title">Gastos</h3><span class="card-sub">puedes sumar: 45+30</span></div>
        ${rows('exp') || '<p class="muted" style="font-size:13px">Añade categorías de gasto en Ajustes.</p>'}
      </div>
      <div class="card">
        <div class="field" style="margin:0"><label for="fNote">Nota (opcional)</label>
        <textarea class="input" id="fNote" rows="2" placeholder="Algo a recordar de este mes">${esc(rec ? rec.note || '' : '')}</textarea></div>
      </div>
      <div class="sticky-total">
        <div class="totals"><div class="inc">Ingresos<b id="tInc">0</b></div><div class="exp">Gastos<b id="tExp">0</b></div><div style="text-align:right">Ahorro<b id="tNet">0</b></div></div>
        <button class="btn primary block" type="submit">${rec ? 'Guardar cambios' : 'Integrar en el mes'}</button>
      </div>
      ${rec ? `<button type="button" class="btn ghost danger block" id="delMonth" style="margin-top:10px">${ICON.trash} Eliminar este mes</button>` : ''}
    </form>`;

  const form = $('#monthForm');
  const readForm = () => {
    const out = { inc: {}, exp: {}, bad: [] };
    $$('input[data-kind]', form).forEach((i) => {
      const n = parseAmount(i.value);
      if (n === null) return;
      if (Number.isNaN(n) || n < 0) { out.bad.push(i); return; }
      if (n > 0) out[i.dataset.kind][i.dataset.id] = n;
    });
    return out;
  };
  const updateTotals = () => {
    const f = readForm();
    const inc = sumObj(f.inc), exp = sumObj(f.exp);
    $('#tInc').textContent = money0(inc);
    $('#tExp').textContent = money0(exp);
    $('#tNet').textContent = signed(inc - exp, money0);
    $('#tNet').style.color = inc - exp >= 0 ? 'var(--income)' : 'var(--expense)';
  };
  form.addEventListener('input', updateTotals);
  // al salir de un campo con una suma, muestra el resultado
  form.addEventListener('focusout', (e) => {
    const i = e.target;
    if (!i.dataset || !i.dataset.kind) return;
    const n = parseAmount(i.value);
    if (n !== null && !Number.isNaN(n) && /[+\-]/.test(i.value.replace(/^-/, ''))) i.value = numInput(n);
  });
  updateTotals();

  $('#mPrev').onclick = () => { ui.addMonth = addMonths(key, -1); renderAdd(); };
  $('#mNext').onclick = () => { ui.addMonth = addMonths(key, 1); renderAdd(); };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = readForm();
    if (f.bad.length) { f.bad[0].focus(); toast('Revisa el importe marcado'); return; }
    if (!Object.keys(f.inc).length && !Object.keys(f.exp).length) { toast('Introduce al menos un importe'); return; }
    const existed = !!st().months[key];
    const note = $('#fNote').value.trim();
    const t = { inc: sumObj(f.inc), exp: sumObj(f.exp) };
    S.update((d) => { d.months[key] = { inc: f.inc, exp: f.exp, note, upd: Date.now() }; },
      `${existed ? 'Modificado' : 'Integrado'} ${monthLabel(key).toLowerCase()} · ingresos ${money0(t.inc)}, gastos ${money0(t.exp)}`);
    toast(existed ? 'Cambios guardados' : 'Mes integrado');
    const { y, m } = parseMK(key);
    ui.year = y; ui.gran = 'M'; ui.sel = m - 1;
    ui.addMonth = null;
    showTab('charts');
  });

  const del = $('#delMonth');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet('Eliminar mes', `Se borrarán los datos de ${monthLabel(key).toLowerCase()}.`, 'Eliminar', true))) return;
    S.update((d) => { delete d.months[key]; }, `Eliminado ${monthLabel(key).toLowerCase()}`);
    toast('Mes eliminado');
    renderAdd();
  };
}

// ───────────── Pestaña: Inversiones ─────────────
const ASSET_TYPES = ['Fondo indexado', 'Fondo de inversión', 'ETF', 'Acción', 'Cripto', 'Plan de pensiones', 'Depósito', 'Cuenta remunerada', 'Otro'];
const RANGES = [['1S', 7], ['1M', 30], ['3M', 91], ['1A', 365], ['Todo', null]];

function rangeStartISO() {
  const r = RANGES.find(([k]) => k === ui.range);
  if (!r || r[1] == null) {
    const all = st().assets.flatMap((a) => a.hist.map((h) => h.d)).sort();
    return all[0] || todayISO();
  }
  return addDays(todayISO(), -r[1]);
}
function assetValueAt(a, iso) { const e = entryAt(a, iso); return e ? e.v : 0; }
function assetGainAt(a, iso) { const e = entryAt(a, iso); return e ? e.v - e.c : 0; }

/** Rendimiento entre dos fechas, excluyendo aportaciones. */
function perf(assets, fromISO, toISO) {
  let g0 = 0, g1 = 0, v0 = 0, c0 = 0, c1 = 0;
  for (const a of assets) {
    const e0 = entryAt(a, fromISO), e1 = entryAt(a, toISO);
    if (e0) { g0 += e0.v - e0.c; v0 += e0.v; c0 += e0.c; }
    if (e1) { g1 += e1.v - e1.c; c1 += e1.c; }
  }
  const diff = g1 - g0;
  const basis = v0 + (c1 - c0) || c1 || 1;
  return { diff, pct: (diff / basis) * 100 };
}

function renderAssets() {
  const v = $('#view-assets');
  const s = st();
  s.assets.forEach(sortHist);
  if (!s.assets.length) {
    v.innerHTML = `<div class="view-title"><h1>Inversiones</h1></div>
      <div class="empty">${BONSAI_SVG}<h2>Sin activos aún</h2>
      <p>Añade tus fondos, acciones o depósitos y registra su valor para ver cómo evolucionan día a día.</p>
      <button class="btn primary" id="addAsset">${ICON.plus} Añadir activo</button></div>`;
    $('#addAsset').onclick = () => assetForm();
    return;
  }

  const today = todayISO();
  const now = investAt(today);
  // variación diaria: última fecha registrada vs la anterior
  const dates = [...new Set(s.assets.flatMap((a) => a.hist.map((h) => h.d)))].sort();
  const lastD = dates[dates.length - 1];
  const prevD = dates.length > 1 ? dates[dates.length - 2] : null;
  const daily = prevD ? perf(s.assets, prevD, lastD) : null;

  const from = rangeStartISO();
  const rp = perf(s.assets, from, today);
  // serie del total en el rango
  const inRange = dates.filter((d) => d > from);
  const pts = [from, ...inRange];
  if (pts[pts.length - 1] !== today) pts.push(today);
  const series = pts.map((d) => s.assets.reduce((t, a) => t + assetValueAt(a, d), 0));
  const rangeName = { '1S': 'la última semana', '1M': 'el último mes', '3M': 'los últimos 3 meses', '1A': 'el último año', Todo: 'total' }[ui.range];

  v.innerHTML = `
    <div class="hero">
      <div class="hero-label">Valor de la cartera</div>
      <div class="hero-value">${money0(now.value)}</div>
      ${daily ? `<div class="delta ${daily.diff >= 0 ? 'up' : 'down'}">${signed(daily.diff)} (${pct(daily.pct)}) <span class="muted">desde ${dayLabel(prevD)}</span></div>` : '<div class="delta muted">Actualiza el valor otro día para ver la variación</div>'}
    </div>
    <div class="card">
      <div class="seg small" id="rangeSeg" style="margin-bottom:12px">${RANGES.map(([k]) => `<button data-r="${k}" aria-pressed="${ui.range === k}">${k}</button>`).join('')}</div>
      <div class="readout"><b class="${rp.diff >= 0 ? 'pct up' : 'pct down'}" style="font-size:13px">${signed(rp.diff)} (${pct(rp.pct)})</b> rendimiento en ${rangeName}</div>
      <div class="chart" id="pfChart"></div>
    </div>
    <div class="card">
      <div class="kpis">
        <div class="kpi"><div class="k">Aportado</div><div class="v">${money0(now.contrib)}</div></div>
        <div class="kpi"><div class="k">Valor</div><div class="v">${money0(now.value)}</div></div>
        <div class="kpi"><div class="k">Ganancia</div><div class="v ${now.gain >= 0 ? 'inc' : 'exp'}">${signed(now.gain, money0)}</div></div>
      </div>
      ${now.contrib > 0 ? `<p class="note" style="margin-top:10px">Rentabilidad total ${pct((now.gain / now.contrib) * 100)} sobre lo aportado.</p>` : ''}
    </div>
    <div class="actions" style="margin-bottom:12px">
      <button class="btn primary" id="bulk">${ICON.refresh} Actualizar</button>
      <button class="btn" id="addAsset">${ICON.plus} Activo</button>
    </div>
    <div class="card" style="padding-top:6px;padding-bottom:6px">
      <ul class="list">${s.assets.map((a) => {
        const e = entryAt(a, today) || a.hist[a.hist.length - 1];
        const p = perf([a], from, today);
        const sv = [from, ...a.hist.filter((h) => h.d > from).map((h) => h.d)].map((d) => entryAt(a, d) ? assetValueAt(a, d) : null);
        const age = e ? Math.round((new Date(today) - new Date(e.d)) / 864e5) : null;
        return `<li class="row tap asset-row" data-id="${a.id}">
          <div class="grow"><div class="title">${esc(a.name)}</div><div class="sub">${esc(a.type)} · ${age === 0 ? 'hoy' : age === 1 ? 'ayer' : `hace ${age} días`}</div></div>
          ${sparkline(sv, p.diff >= 0 ? 'var(--income)' : 'var(--expense)')}
          <div style="text-align:right;min-width:86px"><div class="amt">${money0(e ? e.v : 0)}</div><div class="pct ${p.diff >= 0 ? 'up' : 'down'}">${pct(p.pct)}</div></div>
        </li>`;
      }).join('')}</ul>
    </div>
    <p class="note">Los porcentajes muestran el rendimiento en el periodo elegido sin contar nuevas aportaciones.</p>`;

  $$('#rangeSeg button', v).forEach((b) => b.onclick = () => { ui.range = b.dataset.r; renderAssets(); });
  lineChart($('#pfChart'), { labels: pts.map(dayLabel), tipLabels: pts.map(dayLabelY), values: series, fmt: money, fmtAxis: moneyC, aria: 'Valor de la cartera' });
  $('#bulk').onclick = bulkUpdate;
  $('#addAsset').onclick = () => assetForm();
  $$('.asset-row', v).forEach((r) => r.onclick = () => assetDetail(r.dataset.id));
}

function assetForm(existing) {
  const sym = curSymbol();
  const last = existing ? existing.hist[existing.hist.length - 1] : null;
  openSheet(existing ? 'Editar activo' : 'Nuevo activo', `
    <form id="af" autocomplete="off">
      <div class="field"><label for="aName">Nombre</label><input class="input" id="aName" required maxlength="60" placeholder="p. ej. MSCI World" value="${esc(existing ? existing.name : '')}"></div>
      <div class="field"><label for="aType">Tipo</label><select class="input" id="aType">${ASSET_TYPES.map((t) => `<option ${existing && existing.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      ${existing ? '' : `<div class="field-row">
        <div class="field"><label for="aVal">Valor actual (${esc(sym)})</label><input class="input" id="aVal" inputmode="decimal" required placeholder="0"></div>
        <div class="field"><label for="aCon">Aportado (${esc(sym)})</label><input class="input" id="aCon" inputmode="decimal" placeholder="= valor"></div></div>
      <div class="field"><label for="aDate">Fecha</label><input class="input" type="date" id="aDate" value="${todayISO()}" max="${todayISO()}"></div>`}
      <button class="btn primary block" type="submit">${existing ? 'Guardar' : 'Añadir activo'}</button>
      ${existing ? `<button type="button" class="btn ghost danger block" id="aDel" style="margin-top:8px">${ICON.trash} Eliminar activo</button>` : ''}
    </form>`, (body, close) => {
    $('#af', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#aName', body).value.trim();
      const type = $('#aType', body).value;
      if (!name) return;
      if (existing) {
        S.update((d) => { const a = d.assets.find((x) => x.id === existing.id); a.name = name; a.type = type; }, `Activo editado: ${name}`);
        close(); render(); return;
      }
      const val = parseAmount($('#aVal', body).value);
      let con = parseAmount($('#aCon', body).value);
      if (val == null || Number.isNaN(val) || val < 0) { $('#aVal', body).focus(); toast('Valor no válido'); return; }
      if (con == null) con = val;
      if (Number.isNaN(con) || con < 0) { $('#aCon', body).focus(); toast('Aportado no válido'); return; }
      const date = $('#aDate', body).value || todayISO();
      S.update((d) => { d.assets.push({ id: S.uid(), name, type, hist: [{ d: date, v: val, c: con }] }); }, `Nuevo activo: ${name} (${money(val)})`);
      close(); toast('Activo añadido'); render();
    });
    const del = $('#aDel', body);
    if (del) del.onclick = async () => {
      close();
      if (!(await confirmSheet('Eliminar activo', `Se borrará «${existing.name}» y todo su historial.`, 'Eliminar', true))) return;
      S.update((d) => { d.assets = d.assets.filter((x) => x.id !== existing.id); }, `Activo eliminado: ${existing.name}`);
      toast('Activo eliminado'); render();
    };
    void last;
  });
}

function assetDetail(id) {
  const a = st().assets.find((x) => x.id === id);
  if (!a) return;
  sortHist(a);
  const last = a.hist[a.hist.length - 1];
  const gain = last.v - last.c;
  const rows = [...a.hist].reverse().map((h, i, arr) => {
    const prev = arr[i + 1];
    const ch = prev ? (h.v - h.c) - (prev.v - prev.c) : null;
    return `<li class="row" style="padding:8px 0"><div class="grow"><div class="title" style="font-weight:500">${dayLabelY(h.d)}</div><div class="sub">Aportado ${money0(h.c)}</div></div>
      <div style="text-align:right"><div class="amt">${money(h.v)}</div>${ch != null ? `<div class="pct ${ch >= 0 ? 'up' : 'down'}">${signed(ch)}</div>` : ''}</div>
      <button class="icon-btn" data-del="${h.d}" aria-label="Borrar registro" style="width:32px;height:32px;color:var(--muted)">${ICON.trash}</button></li>`;
  }).join('');

  openSheet(a.name, `
    <div style="margin:-6px 0 10px" class="muted">${esc(a.type)}</div>
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k">Valor</div><div class="v">${money0(last.v)}</div></div>
      <div class="kpi"><div class="k">Aportado</div><div class="v">${money0(last.c)}</div></div>
      <div class="kpi"><div class="k">Ganancia</div><div class="v ${gain >= 0 ? 'inc' : 'exp'}">${signed(gain, money0)}</div></div>
    </div>
    <div class="chart" id="adChart"></div>
    <form id="upd" class="card" style="margin:14px 0;background:var(--surface-2)" autocomplete="off">
      <div class="card-head" style="margin-bottom:8px"><h3 class="card-title">Registrar valor</h3></div>
      <div class="field-row">
        <div class="field"><label for="uVal">Valor</label><input class="input" id="uVal" inputmode="decimal" required placeholder="${esc(numInput(last.v))}"></div>
        <div class="field"><label for="uCon">Aportado total</label><input class="input" id="uCon" inputmode="decimal" value="${esc(numInput(last.c))}"></div>
      </div>
      <div class="field"><label for="uDate">Fecha</label><input class="input" type="date" id="uDate" value="${todayISO()}" max="${todayISO()}"></div>
      <button class="btn primary block" type="submit">Guardar valor</button>
    </form>
    <div class="section-h" style="margin-top:4px">Historial</div>
    <ul class="list">${rows}</ul>
    <div class="actions" style="margin-top:14px"><button class="btn" id="edit">Editar</button></div>`,
  (body, close) => {
    lineChart($('#adChart', body), { labels: a.hist.map((h) => dayLabel(h.d)), tipLabels: a.hist.map((h) => dayLabelY(h.d)), values: a.hist.map((h) => h.v), fmt: money, fmtAxis: moneyC, height: 150 });
    $('#upd', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const val = parseAmount($('#uVal', body).value);
      const con = parseAmount($('#uCon', body).value);
      if (val == null || Number.isNaN(val) || val < 0) { toast('Valor no válido'); return; }
      const d0 = $('#uDate', body).value || todayISO();
      S.update((d) => {
        const x = d.assets.find((q) => q.id === id);
        const c = con == null || Number.isNaN(con) ? (entryAt(x, d0) || last).c : con;
        x.hist = x.hist.filter((h) => h.d !== d0);
        x.hist.push({ d: d0, v: val, c });
        sortHist(x);
      }, `${a.name}: valor ${money(val)} el ${dayLabelY(d0)}`);
      close(); toast('Valor registrado'); render();
    });
    $$('[data-del]', body).forEach((b) => b.onclick = async () => {
      const dd = b.dataset.del;
      if (a.hist.length === 1) { toast('Es el único registro; elimina el activo si quieres'); return; }
      close();
      if (!(await confirmSheet('Borrar registro', `Se borrará el valor del ${dayLabelY(dd)}.`, 'Borrar', true))) { assetDetail(id); return; }
      S.update((d) => { const x = d.assets.find((q) => q.id === id); x.hist = x.hist.filter((h) => h.d !== dd); }, `${a.name}: borrado registro del ${dayLabelY(dd)}`);
      render(); assetDetail(id);
    });
    $('#edit', body).onclick = () => { close(); assetForm(a); };
  });
}

function bulkUpdate() {
  const s = st();
  const sym = curSymbol();
  openSheet('Actualizar valores', `
    <form id="bu" autocomplete="off">
      <div class="field"><label for="bDate">Fecha</label><input class="input" type="date" id="bDate" value="${todayISO()}" max="${todayISO()}"></div>
      <div class="card" style="padding:4px 12px">
      ${s.assets.map((a) => { const l = a.hist[a.hist.length - 1]; return `<div class="money-row"><label for="b-${a.id}">${esc(a.name)}<div class="sub muted" style="font-size:12px">Último: ${money(l.v)}</div></label>
        <div class="money"><input id="b-${a.id}" data-id="${a.id}" inputmode="decimal" placeholder="${esc(numInput(l.v))}"><span class="cur">${esc(sym)}</span></div></div>`; }).join('')}
      </div>
      <p class="note" style="margin:-4px 2px 14px">Deja en blanco los que no hayan cambiado.</p>
      <button class="btn primary block" type="submit">Guardar</button>
    </form>`, (body, close) => {
    $('#bu', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const d0 = $('#bDate', body).value || todayISO();
      const ups = [];
      for (const i of $$('input[data-id]', body)) {
        const n = parseAmount(i.value);
        if (n == null) continue;
        if (Number.isNaN(n) || n < 0) { i.focus(); toast('Revisa el importe marcado'); return; }
        ups.push([i.dataset.id, n]);
      }
      if (!ups.length) { close(); return; }
      S.update((d) => {
        for (const [id, val] of ups) {
          const x = d.assets.find((q) => q.id === id);
          sortHist(x);
          const prev = entryAt(x, d0) || x.hist[0];
          x.hist = x.hist.filter((h) => h.d !== d0);
          x.hist.push({ d: d0, v: val, c: prev.c });
          sortHist(x);
        }
      }, `Valores actualizados (${ups.length}) el ${dayLabelY(d0)}`);
      close(); toast('Valores actualizados'); render();
    });
  });
}

// ───────────── Ajustes ─────────────
const CURRENCIES = [['EUR', 'Euro (€)'], ['USD', 'Dólar ($)'], ['GBP', 'Libra (£)'], ['MXN', 'Peso mexicano'], ['ARS', 'Peso argentino'], ['COP', 'Peso colombiano'], ['CLP', 'Peso chileno'], ['CHF', 'Franco suizo']];
let showAllLog = false;

function openSettings() {
  const p = $('#settingsPage');
  renderSettings();
  p.setAttribute('aria-hidden', 'false');
  p.classList.add('show');
  history.pushState({ settings: true }, '');
}
function closeSettings(fromPop) {
  const p = $('#settingsPage');
  p.classList.remove('show');
  p.setAttribute('aria-hidden', 'true');
  if (!fromPop && history.state && history.state.settings) history.back();
  render();
}
window.addEventListener('popstate', () => { if ($('#settingsPage').classList.contains('show')) closeSettings(true); });

function catRows(kind) {
  const s = st().settings;
  const list = (kind === 'inc' ? s.incomeCats : s.expenseCats).filter((c) => !c.archived);
  const sym = curSymbol();
  return list.map((c) => `<div class="cat-row" data-id="${c.id}">
    <div class="name"><input value="${esc(c.name)}" maxlength="40" data-f="name" aria-label="Nombre"></div>
    <div class="def"><input value="${esc(numInput(c.def))}" inputmode="decimal" placeholder="—" data-f="def" aria-label="Importe por defecto"><span class="cur">${esc(sym)}</span></div>
    <button class="icon-btn" data-f="del" aria-label="Eliminar ${esc(c.name)}">${ICON.trash}</button></div>`).join('');
}

function renderSettings() {
  const p = $('#settingsPage');
  const s = st().settings;
  const enc = S.isEncrypted();
  const log = st().log;
  const logShown = showAllLog ? log : log.slice(0, 12);
  const dtf = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

  p.innerHTML = `
    <header class="app-header">
      <button class="icon-btn" id="sBack" aria-label="Volver">${ICON.back}</button>
      <span class="page-title">Ajustes</span>
      <span style="width:40px"></span>
    </header>
    <main>
      <div class="section-h">General</div>
      <div class="card" style="padding-top:4px;padding-bottom:4px">
        <div class="setting"><div><div class="t">Tema</div></div>
          <div class="seg small" id="themeSeg">${[['system', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, l]) => `<button data-t="${k}" aria-pressed="${s.theme === k}">${l}</button>`).join('')}</div></div>
        <div class="setting"><div><div class="t">Moneda</div></div>
          <select class="input" id="curSel" style="width:auto;padding:8px 34px 8px 10px;font-size:14px">${CURRENCIES.map(([k, l]) => `<option value="${k}" ${s.currency === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="setting" style="display:block">
          <div class="field" style="margin:0"><label for="initBal">Patrimonio inicial</label>
          <input class="input" id="initBal" inputmode="decimal" value="${esc(numInput(s.initialBalance))}" placeholder="0"></div>
          <p class="note" style="margin:6px 0 0">Lo que tenías al empezar a usar Bonsai (cuentas + inversiones). Cada mes se le suma el ahorro y la rentabilidad de tus inversiones.</p>
        </div>
      </div>

      <div class="section-h">Ingresos por defecto</div>
      <div class="card" style="padding-top:4px;padding-bottom:4px" id="incCats">${catRows('inc')}</div>
      <button class="btn sm" data-add="inc">${ICON.plus} Nueva etiqueta de ingreso</button>
      <p class="note">El importe se rellena automáticamente al cerrar cada mes; puedes cambiarlo en el formulario.</p>

      <div class="section-h">Etiquetas de gasto</div>
      <div class="card" style="padding-top:4px;padding-bottom:4px" id="expCats">${catRows('exp')}</div>
      <button class="btn sm" data-add="exp">${ICON.plus} Nueva etiqueta de gasto</button>
      <p class="note">Pon un importe sólo en gastos fijos (alquiler, suscripciones…) para que aparezcan ya rellenos.</p>

      <div class="section-h">Seguridad</div>
      <div class="card" style="padding-top:4px;padding-bottom:4px">
        <div class="setting"><div><div class="t">Bloqueo con PIN</div><div class="d">${enc ? 'Activado · datos cifrados (AES-256)' : 'Desactivado'}</div></div>
          <div class="actions">${enc ? '<button class="btn sm" id="pinChange">Cambiar</button><button class="btn sm danger" id="pinOff">Quitar</button>' : '<button class="btn sm primary" id="pinOn">Activar</button>'}</div></div>
      </div>
      <p class="note">Tus datos sólo se guardan en este dispositivo y nunca se envían a ningún servidor. Con PIN se cifran y la app se bloquea al minuto de dejarla en segundo plano. Si olvidas el PIN no hay forma de recuperarlos: exporta copias de vez en cuando.</p>

      <div class="section-h">Datos</div>
      <div class="card" style="padding-top:4px;padding-bottom:4px">
        <div class="setting"><div><div class="t">Exportar copia</div><div class="d">Archivo .json con todos tus datos</div></div><button class="btn sm" id="exp">Exportar</button></div>
        <div class="setting"><div><div class="t">Importar copia</div><div class="d">Sustituye los datos actuales</div></div><button class="btn sm" id="imp">Importar</button><input type="file" id="impFile" accept="application/json,.json" hidden></div>
        <div class="setting"><div><div class="t">Borrar todo</div><div class="d">Vuelve a empezar desde cero</div></div><button class="btn sm danger" id="wipe">Borrar</button></div>
      </div>

      <div class="section-h">Historial de cambios</div>
      <div class="card" style="padding-top:4px;padding-bottom:4px">
        ${logShown.length ? logShown.map((l) => `<div class="log-item"><time>${dtf.format(new Date(l.t))}</time>${esc(l.m)}</div>`).join('') : '<div class="log-item muted">Sin cambios todavía.</div>'}
      </div>
      ${log.length > 12 ? `<button class="btn sm ghost" id="logMore">${showAllLog ? 'Ver menos' : `Ver todo (${log.length})`}</button>` : ''}

      <p class="note" style="text-align:center;margin-top:28px">Bonsai ${APP_VERSION} · hecho para crecer despacio</p>
    </main>`;

  $('#sBack').onclick = () => closeSettings();

  $$('#themeSeg button', p).forEach((b) => b.onclick = () => {
    const t = b.dataset.t;
    S.update((d) => { d.settings.theme = t; }, `Tema: ${b.textContent}`);
    applyTheme(); renderSettings();
  });
  $('#curSel').onchange = (e) => {
    const c = e.target.value;
    S.update((d) => { d.settings.currency = c; }, `Moneda: ${c}`);
    buildFormatters(); renderSettings();
  };
  $('#initBal').onchange = (e) => {
    const n = parseAmount(e.target.value);
    if (Number.isNaN(n)) { toast('Importe no válido'); return; }
    S.update((d) => { d.settings.initialBalance = n || 0; }, `Patrimonio inicial: ${money(n || 0)}`);
    toast('Guardado');
  };

  // categorías
  const bindCats = (kind, boxId) => {
    const box = $('#' + boxId, p);
    const listKey = kind === 'inc' ? 'incomeCats' : 'expenseCats';
    box.addEventListener('change', (e) => {
      const row = e.target.closest('.cat-row'); if (!row) return;
      const id = row.dataset.id;
      const c = st().settings[listKey].find((x) => x.id === id);
      if (e.target.dataset.f === 'name') {
        const nv = e.target.value.trim();
        if (!nv) { e.target.value = c.name; return; }
        const old = c.name;
        S.update((d) => { d.settings[listKey].find((x) => x.id === id).name = nv; }, `Etiqueta renombrada: ${old} → ${nv}`);
      } else if (e.target.dataset.f === 'def') {
        const n = parseAmount(e.target.value);
        if (Number.isNaN(n) || n < 0) { toast('Importe no válido'); e.target.value = numInput(c.def); return; }
        S.update((d) => { d.settings[listKey].find((x) => x.id === id).def = n || 0; }, `${c.name}: importe por defecto ${n ? money(n) : 'ninguno'}`);
      }
    });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-f="del"]'); if (!b) return;
      const id = b.closest('.cat-row').dataset.id;
      const c = st().settings[listKey].find((x) => x.id === id);
      const used = Object.values(st().months).some((m) => (m[kind] || {})[id]);
      const ok = await confirmSheet('Eliminar etiqueta', used
        ? `«${c.name}» tiene importes registrados. Se ocultará del formulario pero tus datos y gráficos se conservan.`
        : `Se eliminará «${c.name}».`, 'Eliminar', true);
      if (!ok) return;
      S.update((d) => {
        const l = d.settings[listKey];
        if (used) l.find((x) => x.id === id).archived = true;
        else d.settings[listKey] = l.filter((x) => x.id !== id);
      }, `Etiqueta eliminada: ${c.name}`);
      renderSettings();
    });
  };
  bindCats('inc', 'incCats');
  bindCats('exp', 'expCats');
  $$('[data-add]', p).forEach((b) => b.onclick = () => {
    const kind = b.dataset.add;
    const listKey = kind === 'inc' ? 'incomeCats' : 'expenseCats';
    openSheet(kind === 'inc' ? 'Nuevo ingreso' : 'Nuevo gasto', `
      <form id="nc" autocomplete="off">
        <div class="field"><label for="ncName">Nombre</label><input class="input" id="ncName" maxlength="40" required placeholder="${kind === 'inc' ? 'p. ej. Alquiler cobrado' : 'p. ej. Gimnasio'}"></div>
        <div class="field"><label for="ncDef">Importe por defecto (opcional)</label><input class="input" id="ncDef" inputmode="decimal" placeholder="—"></div>
        <button class="btn primary block" type="submit">Añadir</button>
      </form>`, (body, close) => {
      setTimeout(() => $('#ncName', body).focus(), 300);
      $('#nc', body).addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('#ncName', body).value.trim();
        const def = parseAmount($('#ncDef', body).value);
        if (!name) return;
        if (Number.isNaN(def) || def < 0) { toast('Importe no válido'); return; }
        S.update((d) => { d.settings[listKey].push({ id: S.uid(), name, def: def || 0 }); }, `Nueva etiqueta de ${kind === 'inc' ? 'ingreso' : 'gasto'}: ${name}`);
        close(); renderSettings();
      });
    });
  });

  // seguridad
  const pinOn = $('#pinOn'), pinChange = $('#pinChange'), pinOff = $('#pinOff');
  if (pinOn) pinOn.onclick = () => pinSetup(false);
  if (pinChange) pinChange.onclick = () => pinSetup(true);
  if (pinOff) pinOff.onclick = async () => {
    if (!(await confirmSheet('Quitar PIN', 'Tus datos dejarán de estar cifrados en este dispositivo.', 'Quitar PIN', true))) return;
    await S.removePin();
    S.update(() => {}, 'PIN desactivado');
    toast('PIN desactivado'); renderSettings();
  };

  // datos
  $('#exp').onclick = () => {
    const blob = new Blob([S.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `bonsai-copia-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    S.update(() => {}, 'Copia exportada');
    toast('Copia exportada');
  };
  $('#imp').onclick = () => $('#impFile').click();
  $('#impFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = S.parseImport(await f.text());
      const n = Object.keys(data.months).length;
      if (!(await confirmSheet('Importar copia', `Se sustituirán tus datos actuales por la copia (${n} meses, ${(data.assets || []).length} activos).`, 'Importar', true))) return;
      S.replaceState(data, `Copia importada (${n} meses)`);
      buildFormatters(); applyTheme(); renderSettings(); toast('Copia importada');
    } catch { toast('El archivo no es una copia válida de Bonsai'); }
    e.target.value = '';
  };
  $('#wipe').onclick = async () => {
    if (!(await confirmSheet('Borrar todo', 'Se eliminarán todos tus meses, activos, ajustes y el PIN. Esta acción no se puede deshacer.', 'Borrar todo', true))) return;
    S.resetAll(); buildFormatters(); applyTheme(); ui.sel = null; ui.addMonth = null;
    renderSettings(); toast('Datos borrados');
  };
  const more = $('#logMore');
  if (more) more.onclick = () => { showAllLog = !showAllLog; renderSettings(); };
}

function pinSetup(isChange) {
  openSheet(isChange ? 'Cambiar PIN' : 'Activar PIN', `
    <form id="pf" autocomplete="off">
      <div class="field"><label for="p1">Nuevo PIN (4–8 cifras)</label><input class="input" id="p1" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" required autocomplete="new-password"></div>
      <div class="field"><label for="p2">Repite el PIN</label><input class="input" id="p2" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" required autocomplete="new-password"></div>
      <p class="note" style="margin:-2px 2px 14px">Recomendado: 6 cifras o más. Si lo olvidas no podrás recuperar los datos.</p>
      <button class="btn primary block" type="submit">Guardar PIN</button>
    </form>`, (body, close) => {
    setTimeout(() => $('#p1', body).focus(), 300);
    $('#pf', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = $('#p1', body).value, b = $('#p2', body).value;
      if (!/^\d{4,8}$/.test(a)) { toast('El PIN debe tener entre 4 y 8 cifras'); return; }
      if (a !== b) { toast('Los PIN no coinciden'); return; }
      await S.setPin(a);
      S.update(() => {}, isChange ? 'PIN cambiado' : 'PIN activado · datos cifrados');
      close(); toast(isChange ? 'PIN cambiado' : 'PIN activado'); renderSettings();
    });
  });
}

// ───────────── Tema ─────────────
function applyTheme() {
  const t = st() ? st().settings.theme : 'system';
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  S.saveThemePref(t);
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    $('#themeColor').setAttribute('content', bg);
  });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); render(); });

// ───────────── Bloqueo ─────────────
let hiddenAt = 0;
const LOCK_AFTER_MS = 60 * 1000;

function showLock() {
  const lock = $('#lock');
  const len = S.storedPinLength() || 4;
  let pin = '';
  let busy = false;
  let fails = 0;
  lock.hidden = false;
  lock.innerHTML = `<div class="logo"><img src="icons/icon.svg" alt="" width="72" height="72"></div>
    <h1>Bonsai</h1><p>Introduce tu PIN</p>
    <div class="dots" id="dots">${'<i></i>'.repeat(len)}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-n="${n}">${n}</button>`).join('')}
      <button class="flat" data-x="forgot">¿Olvidado?</button><button data-n="0">0</button><button class="flat" data-x="del">Borrar</button></div>`;
  const dots = $('#dots', lock);
  const paint = () => $$('i', dots).forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const tryPin = async () => {
    busy = true;
    const ok = await S.unlock(pin);
    if (ok) { lock.hidden = true; lock.innerHTML = ''; startApp(); return; }
    fails++;
    dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
    pin = ''; paint();
    // espera creciente tras varios fallos
    const wait = fails >= 5 ? Math.min(30000, 2000 * (fails - 4)) : 0;
    if (wait) { $('p', lock).textContent = `PIN incorrecto. Espera ${Math.round(wait / 1000)} s`; await new Promise((r) => setTimeout(r, wait)); }
    $('p', lock).textContent = 'PIN incorrecto';
    busy = false;
  };
  const press = (n) => {
    if (busy || pin.length >= len) return;
    pin += n; paint();
    if (pin.length === len) tryPin();
  };
  lock.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.n != null) press(b.dataset.n);
    else if (b.dataset.x === 'del') { pin = pin.slice(0, -1); paint(); }
    else if (b.dataset.x === 'forgot') {
      if (!(await confirmSheet('¿Olvidaste el PIN?', 'Sin el PIN no se pueden descifrar los datos. Puedes borrarlo todo y empezar de nuevo (o importar una copia después).', 'Borrar y empezar', true))) return;
      S.resetAll(); lock.hidden = true; lock.innerHTML = ''; startApp();
    }
  };
  lock.onkeydown = null;
  document.onkeydown = (e) => {
    if (lock.hidden) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); }
  };
}

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (S.isEncrypted() && st() && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) {
    await S.lockNow();
    // retira los datos del DOM
    $$('.view').forEach((v) => (v.innerHTML = ''));
    $('#settingsPage').classList.remove('show');
    $('#settingsPage').innerHTML = '';
    $('#sheetRoot').innerHTML = '';
    showLock();
  }
});

// ───────────── Arranque ─────────────
let started = false;
function startApp() {
  buildFormatters();
  applyTheme();
  if (!started) {
    started = true;
    $$('.tab').forEach((t) => t.onclick = () => { if (t.dataset.tab === 'add') ui.addMonth = null; showTab(t.dataset.tab); });
    $('#openSettings').onclick = openSettings;
    let lastW = window.innerWidth;
    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; render(); } }, 150);
    });
    S.requestPersistence();
  }
  showTab(ui.tab);
}

if (S.boot() === 'locked') showLock();
else startApp();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
