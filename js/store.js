// ───────────── Bonsai · almacenamiento local (opcionalmente cifrado) ─────────────
// Los datos viven sólo en este dispositivo (localStorage). Si se activa un PIN,
// se cifran con AES-GCM 256 usando una clave derivada del PIN (PBKDF2-SHA256).

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
      startMonth: start,
      incomeCats: [
        { id: uid(), name: 'Nómina', def: 0 },
        { id: uid(), name: 'Extra / freelance', def: 0 },
        { id: uid(), name: 'Otros ingresos', def: 0 },
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
    months: {},   // 'AAAA-MM' → { inc: {catId: n}, exp: {catId: n}, note, upd }
    assets: [],   // { id, name, type, hist: [{ d:'AAAA-MM-DD', v, c }] }
    log: [],      // { t, m }
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
  if (!raw) persist();
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

/** Aplica un cambio, registra en el historial y guarda. */
export function update(fn, logMsg) {
  fn(state);
  if (logMsg) {
    state.log.unshift({ t: Date.now(), m: logMsg });
    if (state.log.length > 500) state.log.length = 500;
  }
  persist();
  listeners.forEach((l) => l(state));
}

export function replaceState(next, logMsg) {
  state = migrate(next);
  update(() => {}, logMsg);
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
  return JSON.stringify({ app: 'bonsai', exported: new Date().toISOString(), data: state }, null, 2);
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
  return d;
}
