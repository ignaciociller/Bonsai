// ───────────── Bonsai · almacenamiento local (opcionalmente cifrado) ─────────────
// Los datos viven en este dispositivo (localStorage). Si se activa un PIN,
// se cifran con AES-GCM 256 usando una clave derivada del PIN (PBKDF2-SHA256).
// `device` guarda datos propios de este dispositivo (sesión de la nube) y nunca se sincroniza ni exporta.

const KEY = 'bonsai.data.v1';
const THEME_KEY = 'bonsai.theme';
const PBKDF2_ITER = 310000;

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function defaultState() {
  const now = new Date();
  const start = `${now.getFullYear()}-01`;
  return {
    v: 1,
    settings: {
      currency: 'EUR',
      theme: 'system',
      initialBalance: 0,
      initialInvested: 0,
      startMonth: start,
      incomeCats: [
        { id: uid(), name: 'Nómina', def: 0 },
        { id: uid(), name: 'Extra / freelance', def: 0 },
        { id: uid(), name: 'Otros ingresos', def: 0 },
      ],
      investCats: [
        { id: uid(), name: 'Fondos indexados', def: 0 },
        { id: uid(), name: 'Plan de pensiones', def: 0 },
        { id: uid(), name: 'Otras inversiones', def: 0 },
      ],
      expenseCats: [
        { id: uid(), name: 'Alquiler', def: 0 },
        { id: uid(), name: 'Supermercado', def: 0 },
        { id: uid(), name: 'Suministros', def: 0 },
        { id: uid(), name: 'Suscripciones', def: 0 },
        { id: uid(), name: 'Transporte', def: 0 },
        { id: uid(), name: 'Restaurantes', def: 0 },
        { id: uid(), name: 'Ocio', def: 0 },
        { id: uid(), name: 'Ropa', def: 0 },
        { id: uid(), name: 'Salud', def: 0 },
        { id: uid(), name: 'Otros', def: 0 },
      ],
    },
    months: {},   // 'AAAA-MM' → { inc: {catId: n}, exp: {catId: n}, inv: {catId: n}, note, upd }
    assets: [],   // { id, name, type, hist: [{ d:'AAAA-MM-DD', v, c }] }
    log: [],      // { t, m }
    tomb: {},     // borrados para sincronizar: 'm:AAAA-MM' | 'a:id' → marca de tiempo
    upd: 0,       // última modificación de los datos
    device: {},   // sólo de este dispositivo (p. ej. sesión de la nube)
  };
}

let state = null;
let cryptoKey = null;   // CryptoKey en memoria mientras la app está desbloqueada
let salt = null;
let pinLen = 0;
let saveChain = Promise.resolve();
const listeners = new Set();

export const getState = () => state;
export const onChange = (fn) => listeners.add(fn);

// ───────────── utilidades de codificación ─────────────
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pin, saltBytes) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptJSON(obj, key, saltBytes, len) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { enc: true, len, iter: PBKDF2_ITER, salt: b64(saltBytes), iv: b64(iv), ct: b64(ct) };
}

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeRaw(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    console.error('No se pudo guardar', e);
    return false;
  }
}

// ───────────── API pública ─────────────

/** Devuelve 'locked' si hay que pedir PIN, o 'ready' si los datos ya están cargados. */
export function boot() {
  const raw = readRaw();
  if (raw && raw.enc) return 'locked';
  state = raw && raw.data ? migrate(raw.data) : defaultState();
  persist();   // guarda también las migraciones (p. ej. etiquetas de inversión nuevas)
  return 'ready';
}

export const isEncrypted = () => !!(readRaw() || {}).enc;
export const storedPinLength = () => (readRaw() || {}).len || 0;

export async function unlock(pin) {
  const raw = readRaw();
  if (!raw || !raw.enc) return true;
  try {
    salt = unb64(raw.salt);
    pinLen = raw.len || pin.length;
    const key = await deriveKey(pin, salt);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(raw.iv) }, key, unb64(raw.ct));
    cryptoKey = key;
    state = migrate(JSON.parse(dec.decode(pt)));
    persist();
    return true;
  } catch {
    cryptoKey = null;
    return false;
  }
}

/** Olvida los datos y la clave de la memoria (bloqueo). */
export async function lockNow() {
  await saveChain;
  state = null;
  cryptoKey = null;
}

export async function setPin(pin) {
  salt = crypto.getRandomValues(new Uint8Array(16));
  pinLen = pin.length;
  cryptoKey = await deriveKey(pin, salt);
  await persist();
}

export async function removePin() {
  cryptoKey = null;
  salt = null;
  await persist();
}

export function persist() {
  const snapshot = state;
  const key = cryptoKey, saltBytes = salt, len = pinLen;   // capturados ahora, no al ejecutar
  saveChain = saveChain.then(async () => {
    if (!snapshot) return;
    const payload = key ? await encryptJSON(snapshot, key, saltBytes, len) : { enc: false, data: snapshot };
    writeRaw(payload);
  }).catch((e) => console.error('Error al guardar', e));
  return saveChain;
}

function fingerprint(s) {
  const strip = (o) => JSON.stringify({ ...o, upd: 0 });
  return {
    set: strip(s.settings),
    m: Object.fromEntries(Object.entries(s.months).map(([k, v]) => [k, strip(v)])),
    a: Object.fromEntries(s.assets.map((a) => [a.id, strip(a)])),
  };
}

/** Aplica un cambio, registra en el historial y guarda. Anota qué cambió para poder sincronizar. */
export function update(fn, logMsg) {
  const before = fingerprint(state);
  fn(state);
  const after = fingerprint(state);
  const now = Date.now();
  let changed = false;
  if (before.set !== after.set) { state.settings.upd = now; changed = true; }
  for (const k of Object.keys(after.m)) if (before.m[k] !== after.m[k]) { state.months[k].upd = now; changed = true; }
  for (const k of Object.keys(before.m)) if (!(k in after.m)) { state.tomb['m:' + k] = now; changed = true; }
  for (const a of state.assets) if (before.a[a.id] !== after.a[a.id]) { a.upd = now; changed = true; }
  for (const id of Object.keys(before.a)) if (!(id in after.a)) { state.tomb['a:' + id] = now; changed = true; }
  if (logMsg) {
    state.log.unshift({ t: now, m: logMsg });
    if (state.log.length > 500) state.log.length = 500;
    changed = true;
  }
  if (changed) {
    state.upd = now;
    if (state.device.cloud) state.device.cloud.dirty = true;
  }
  persist();
  listeners.forEach((l) => l(state));
}

/** Cambia datos propios del dispositivo (no cuenta como cambio a sincronizar). */
export function updateDevice(fn) {
  if (!state) return;
  fn(state.device);
  persist();
}

/** Sustituye los datos por los recibidos de la nube, conservando lo propio del dispositivo. */
export function applyRemote(data, { dirty = false } = {}) {
  if (!state) return;
  const device = state.device;
  state = migrate(JSON.parse(JSON.stringify(data)));
  state.device = device;
  if (dirty) state.upd = Date.now();
  persist();
}

/** Lo que se sube a la nube (sin datos del dispositivo). */
export function syncable(s = state) {
  return { v: 1, settings: s.settings, months: s.months, assets: s.assets, log: s.log, tomb: s.tomb, upd: s.upd };
}

export function replaceState(next, logMsg) {
  const device = state.device;
  const incoming = migrate(next);
  // pasa por update() para que todo cuente como cambiado (y se sincronice)
  update((d) => {
    d.settings = incoming.settings; d.months = incoming.months; d.assets = incoming.assets;
    d.log = incoming.log.length ? incoming.log : d.log;
  }, logMsg);
  state.device = device;
  persist();
}

export function resetAll() {
  state = defaultState();
  cryptoKey = null;
  salt = null;
  try { localStorage.removeItem(KEY); } catch {}
  persist();
  listeners.forEach((l) => l(state));
}

export function exportJSON() {
  return JSON.stringify({ app: 'bonsai', exported: new Date().toISOString(), data: syncable() }, null, 2);
}

export function parseImport(text) {
  const obj = JSON.parse(text);
  const data = obj && obj.app === 'bonsai' ? obj.data : obj;
  if (!data || !data.settings || !data.months) throw new Error('Formato no válido');
  return data;
}

export function saveThemePref(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}

function migrate(d) {
  const base = defaultState();
  d.v = 1;
  d.settings = Object.assign({}, base.settings, d.settings || {});
  d.months = d.months || {};
  d.assets = d.assets || [];
  d.log = d.log || [];
  d.tomb = d.tomb || {};
  d.upd = d.upd || 0;
  d.device = d.device || {};
  return d;
}
