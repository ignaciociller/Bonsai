// ───────────── Bonsai · cuenta y sincronización (Supabase) ─────────────
//
// Cifrado de extremo a extremo: Supabase sólo guarda texto ilegible.
//  · Con tu contraseña se derivan DOS secretos distintos en el dispositivo:
//      - el "secreto de acceso" que se envía a Supabase para iniciar sesión,
//      - la clave que abre tu "clave de datos". La contraseña en sí nunca sale del dispositivo.
//  · Los datos se cifran con una clave de datos aleatoria (AES-GCM 256). Esa clave se guarda
//    en la nube envuelta dos veces: con tu contraseña y con tu código de recuperación.
//  · Cada dispositivo guarda su sesión y la clave de datos dentro del almacenamiento local
//    (que a su vez se cifra si activas el PIN).

import * as S from './store.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));

export const APP_URL = new URL('./', location.href).href;
const ITER = 310000;       // contraseña → clave que envuelve la clave de datos
const AUTH_ITER = 200000;  // contraseña → secreto de acceso
const RC_ITER = 150000;    // código de recuperación → clave que envuelve

// ───────────── estado ─────────────
let access = null;
let accessExp = 0;
let refreshing = null;
let running = null;
let again = false;
let onRemote = () => {};
let status = { state: 'idle', msg: '' };
const statusListeners = new Set();

export const onStatus = (fn) => statusListeners.add(fn);
export const getStatus = () => status;
function setStatus(state, msg = '') {
  status = { state, msg };
  statusListeners.forEach((f) => f(status));
}

const cloud = () => { const s = S.getState(); return (s && s.device && s.device.cloud) || null; };
export const account = () => cloud();
export const isLoggedIn = () => { const c = cloud(); return !!(c && c.rt && c.dk); };

export class CloudError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

/** Traduce los errores de Supabase a mensajes comprensibles. */
export function esMsg(e) {
  const m = String((e && e.message) || e || '');
  const c = String((e && e.code) || '');
  if (c === 'offline') return 'Sin conexión. Inténtalo cuando tengas internet.';
  if (/invalid_credentials|Invalid login credentials/i.test(m + c)) return 'Email o contraseña incorrectos.';
  if (/email_not_confirmed|not confirmed/i.test(m + c)) return 'Aún no has confirmado tu email. Revisa tu correo (y la carpeta de spam).';
  if (/user_already_exists|already registered/i.test(m + c)) return 'Ya existe una cuenta con ese email.';
  if (/rate|429|too many/i.test(m + c)) return 'Demasiados intentos seguidos. Espera unos minutos.';
  if (/signup_disabled|Signups not allowed/i.test(m + c)) return 'Los registros nuevos están desactivados.';
  if (/weak_password|Password should/i.test(m + c)) return 'La contraseña no cumple los requisitos.';
  if (/email_address_invalid|invalid.*email|Unable to validate email/i.test(m + c)) return 'Ese email no es válido.';
  if (c === 'expired') return 'La sesión ha caducado. Vuelve a entrar.';
  return m || 'Ha ocurrido un error.';
}

// ───────────── red ─────────────
async function api(path, opts = {}) {
  try {
    return await apiOnce(path, opts);
  } catch (e) {
    // el servidor dio por caducado el acceso antes de tiempo: renueva y reintenta una vez
    if (e.status === 401 && opts.auth !== false && !opts.token && cloud() && cloud().rt) {
      access = null;
      return apiOnce(path, opts);
    }
    throw e;
  }
}

async function apiOnce(path, { method = 'GET', body, auth = true, token, headers = {} } = {}) {
  const h = { apikey: SUPABASE_KEY, ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const t = token || (auth ? await getAccess() : SUPABASE_KEY);
  h.Authorization = 'Bearer ' + t;
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new CloudError('Sin conexión', 'offline');
  }
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* respuesta vacía */ }
  if (!res.ok) {
    const msg = (json && (json.msg || json.error_description || json.message || json.error)) || `Error ${res.status}`;
    const err = new CloudError(msg, (json && (json.error_code || json.code)) || res.status);
    err.status = res.status;
    throw err;
  }
  return json;
}

function setSession(res) {
  access = res.access_token;
  accessExp = Date.now() + (res.expires_in || 3600) * 1000;
  S.updateDevice((d) => { if (d.cloud) { d.cloud.rt = res.refresh_token; d.cloud.expired = false; } });
}

async function getAccess() {
  if (access && Date.now() < accessExp - 60000) return access;
  const c = cloud();
  if (!c || !c.rt) throw new CloudError('Sin sesión', 'expired');
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: c.rt } });
        setSession(res);
      } catch (e) {
        if (e.code !== 'offline') S.updateDevice((d) => { if (d.cloud) d.cloud.expired = true; });
        throw e.code === 'offline' ? e : new CloudError('Sesión caducada', 'expired');
      } finally { refreshing = null; }
    })();
  }
  await refreshing;
  return access;
}

// ───────────── criptografía ─────────────
async function pbkdf2(secret, saltBytes, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, base, 256));
}
const aes = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function seal(rawKey, bytes) {
  const iv = rnd(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(rawKey), bytes);
  return { iv: b64(iv), ct: b64(ct) };
}
async function unseal(rawKey, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await aes(rawKey), unb64(box.ct)));
}

/** Secreto de acceso a Supabase: derivado de la contraseña, distinto de la clave de cifrado. */
async function authSecret(email, password) {
  const bits = await pbkdf2(password, enc.encode('bonsai-auth|' + email.trim().toLowerCase()), AUTH_ITER);
  return 'Bn!' + hex(bits);
}
async function wrap(secret, dk, iterations) {
  const s = rnd(16);
  const box = await seal(await pbkdf2(secret, s, iterations), dk);
  return { s: b64(s), i: iterations, ...box };
}
async function unwrapKey(secret, w) {
  return unseal(await pbkdf2(secret, unb64(w.s), w.i), w);
}

const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRecoveryCodeText() {
  const b = rnd(20);
  const chars = [...b].map((x) => RC_ALPHABET[x & 31]).join('');
  return chars.match(/.{4}/g).join('-');
}
export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function encryptPayload(dk, wraps) {
  const d = await seal(dk, enc.encode(JSON.stringify(S.syncable())));
  return JSON.stringify({ v: 1, pw: wraps.pw, rc: wraps.rc, d });
}
async function decryptPayload(dk, payloadText) {
  const p = JSON.parse(payloadText);
  const data = JSON.parse(dec.decode(await unseal(dk, p.d)));
  return { data, wraps: { pw: p.pw, rc: p.rc } };
}

// ───────────── fusión de cambios entre dispositivos ─────────────
export function merge(local, remote) {
  const tomb = { ...(remote.tomb || {}) };
  for (const [k, t] of Object.entries(local.tomb || {})) tomb[k] = Math.max(tomb[k] || 0, t);
  const newer = (a, b) => (!a ? b : !b ? a : (b.upd || 0) > (a.upd || 0) ? b : a);
  const alive = (key, rec) => !(tomb[key] && tomb[key] >= (rec.upd || 0));

  const months = {};
  for (const k of new Set([...Object.keys(local.months || {}), ...Object.keys(remote.months || {})])) {
    const rec = newer(local.months[k], remote.months[k]);
    if (alive('m:' + k, rec)) months[k] = rec;
  }
  const la = Object.fromEntries((local.assets || []).map((a) => [a.id, a]));
  const ra = Object.fromEntries((remote.assets || []).map((a) => [a.id, a]));
  const assets = [];
  for (const id of new Set([...Object.keys(la), ...Object.keys(ra)])) {
    const a = newer(la[id], ra[id]);
    if (alive('a:' + id, a)) assets.push(a);
  }
  const useRemote = (remote.settings.upd || 0) >= (local.settings.upd || 0);
  const settings = JSON.parse(JSON.stringify(useRemote ? remote.settings : local.settings));
  const other = useRemote ? local.settings : remote.settings;
  // conserva etiquetas del otro lado que sigan usándose en algún mes
  const used = new Set();
  Object.values(months).forEach((m) => ['inc', 'exp', 'inv'].forEach((k) => Object.keys(m[k] || {}).forEach((id) => used.add(id))));
  for (const list of ['incomeCats', 'expenseCats', 'investCats']) {
    settings[list] = settings[list] || [];
    const have = new Set(settings[list].map((c) => c.id));
    for (const c of other[list] || []) if (!have.has(c.id) && used.has(c.id)) settings[list].push(c);
  }
  const seen = new Set();
  const log = [...(local.log || []), ...(remote.log || [])]
    .filter((l) => { const k = l.t + '|' + l.m; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.t - a.t).slice(0, 500);
  return { v: 1, settings, months, assets, log, tomb, upd: Math.max(local.upd || 0, remote.upd || 0) };
}

const isEmpty = (s) => !Object.keys(s.months).length && !s.assets.length;

// ───────────── bóveda ─────────────
const vaultPath = (uid, extra = '') => `/rest/v1/vaults?user_id=eq.${encodeURIComponent(uid)}${extra}`;

/** Vuelve a crear la fila en la nube con la clave y envolturas actuales (si se borró a mano). */
async function recreateVault() {
  const c = cloud();
  const payload = await encryptPayload(unb64(c.dk), c.w);
  const rows = await api('/rest/v1/vaults?select=rev', {
    method: 'POST', body: { user_id: c.uid, payload, rev: 1 }, headers: { Prefer: 'return=representation' },
  });
  S.updateDevice((d) => Object.assign(d.cloud, { rev: (rows && rows[0] && rows[0].rev) || 1, dirty: false, last: Date.now() }));
}

/** Sube los cambios si nadie más ha subido antes. Devuelve false si hay conflicto. */
async function push() {
  const c = cloud();
  const mark = S.getState().upd;
  const payload = await encryptPayload(unb64(c.dk), c.w);
  const rows = await api(vaultPath(c.uid, `&rev=eq.${c.rev}&select=rev`), {
    method: 'PATCH', body: { payload, rev: c.rev + 1, updated_at: new Date().toISOString() }, headers: { Prefer: 'return=representation' },
  });
  if (!rows || !rows.length) return false;
  S.updateDevice((d) => {
    d.cloud.rev = rows[0].rev;
    d.cloud.last = Date.now();
    if (S.getState().upd === mark) d.cloud.dirty = false;
  });
  return true;
}

async function pullAndApply() {
  const c = cloud();
  const rows = await api(vaultPath(c.uid, '&select=rev,payload'));
  if (!rows || !rows.length) return null;
  const { data, wraps } = await decryptPayload(unb64(c.dk), rows[0].payload);
  const dirty = !!c.dirty;
  S.applyRemote(dirty ? merge(S.getState(), data) : data, { dirty });
  S.updateDevice((d) => { d.cloud.rev = rows[0].rev; d.cloud.w = wraps; d.cloud.last = Date.now(); d.cloud.dirty = dirty; });
  onRemote();
  return rows[0].rev;
}

// ───────────── sincronización ─────────────
export function init(opts = {}) {
  onRemote = opts.onRemote || onRemote;
  if (isLoggedIn()) syncNow();
}

let soonTimer = null;
export function syncSoon(ms = 1500) {
  if (!isLoggedIn()) return;
  clearTimeout(soonTimer);
  soonTimer = setTimeout(syncNow, ms);
}

export function syncNow() {
  if (!isLoggedIn() || cloud().expired) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    setStatus('syncing');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const c = cloud();
        if (!c) return;
        const head = await api(vaultPath(c.uid, '&select=rev'));
        if (!head || !head.length) { await recreateVault(); break; }   // la fila no existe: se vuelve a crear
        if (head[0].rev > c.rev) await pullAndApply();
        if (!cloud().dirty) break;
        if (await push()) break;            // si otro dispositivo subió antes, se repite: baja, fusiona y sube
      }
      setStatus('ok');
    } catch (e) {
      setStatus(e.code === 'offline' ? 'offline' : 'error', esMsg(e));
    } finally {
      running = null;
      if (again) { again = false; syncNow(); }
    }
  })();
  return running;
}

// ───────────── cuenta ─────────────
async function startSession(email, uid, res, password) {
  S.updateDevice((d) => { d.cloud = { email: email.trim(), uid, rt: res.refresh_token, rev: 0, dirty: true, last: 0 }; });
  setSession(res);
  const rows = await api(vaultPath(uid, '&select=rev,payload'));
  if (!rows || !rows.length) return { created: true };   // primera vez: se crea con los datos de este dispositivo
  const p = JSON.parse(rows[0].payload);
  let dk;
  try { dk = await unwrapKey(password, p.pw); }
  catch { throw new CloudError('No se han podido descifrar los datos con esa contraseña.', 'decrypt'); }
  const { data, wraps } = await decryptPayload(dk, rows[0].payload);
  const local = S.getState();
  const mergeNeeded = !isEmpty(local);
  S.applyRemote(mergeNeeded ? merge(local, data) : data, { dirty: mergeNeeded });
  S.updateDevice((d) => Object.assign(d.cloud, { dk: b64(dk), w: wraps, rev: rows[0].rev, dirty: mergeNeeded, last: Date.now() }));
  onRemote();
  if (mergeNeeded) await syncNow();
  return { created: false, merged: mergeNeeded };
}

/** Inicia sesión. Si es la primera vez, devuelve { code } con el código de recuperación. */
export async function signIn(email, password) {
  const secret = await authSecret(email, password);
  const res = await api('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: email.trim(), password: secret } });
  try {
    const r = await startSession(email, res.user.id, res, password);
    if (r.created) {
      const code = await createVault(password);
      setStatus('ok');
      return { code };
    }
    setStatus('ok');
    return r;
  } catch (e) {
    S.updateDevice((d) => { delete d.cloud; });
    access = null;
    throw e;
  }
}

/** Primera vez: genera la clave de datos y el código de recuperación y sube los datos cifrados. */
async function createVault(password) {
  const c = cloud();
  const dk = rnd(32);
  const code = newRecoveryCodeText();
  const wraps = { pw: await wrap(password, dk, ITER), rc: await wrap(normalizeCode(code), dk, RC_ITER) };
  S.updateDevice((d) => { d.cloud.dk = b64(dk); d.cloud.w = wraps; });
  const payload = await encryptPayload(dk, wraps);
  const rows = await api('/rest/v1/vaults?select=rev', {
    method: 'POST', body: { user_id: c.uid, payload, rev: 1 }, headers: { Prefer: 'return=representation' },
  });
  S.updateDevice((d) => Object.assign(d.cloud, { rev: (rows && rows[0] && rows[0].rev) || 1, dirty: false, last: Date.now() }));
  return code;
}

/** Crea la cuenta. Devuelve { confirm: true } si hay que confirmar el email. */
export async function signUp(email, password) {
  const secret = await authSecret(email, password);
  const res = await api(`/auth/v1/signup?redirect_to=${encodeURIComponent(APP_URL)}`, {
    method: 'POST', auth: false, body: { email: email.trim(), password: secret },
  });
  if (res && res.access_token) return signIn(email, password);
  return { confirm: true };
}

export async function requestReset(email) {
  await api(`/auth/v1/recover?redirect_to=${encodeURIComponent(APP_URL)}`, { method: 'POST', auth: false, body: { email: email.trim() } });
}

/** Tras abrir el enlace de "olvidé mi contraseña": código de recuperación + contraseña nueva. */
export async function completeRecovery(tokens, code, newPassword) {
  const user = await api('/auth/v1/user', { token: tokens.access_token });
  const rows = await api(vaultPath(user.id, '&select=rev,payload'), { token: tokens.access_token });
  const newSecret = await authSecret(user.email, newPassword);
  if (!rows || !rows.length) {
    await api('/auth/v1/user', { method: 'PUT', token: tokens.access_token, body: { password: newSecret } });
    return signIn(user.email, newPassword);
  }
  const p = JSON.parse(rows[0].payload);
  let dk;
  try { dk = await unwrapKey(normalizeCode(code), p.rc); }
  catch { throw new CloudError('El código de recuperación no es correcto.', 'code'); }
  const { data } = await decryptPayload(dk, rows[0].payload);
  const wraps = { pw: await wrap(newPassword, dk, ITER), rc: p.rc };
  // 1) guarda la nueva envoltura en la nube, 2) cambia el secreto de acceso
  S.updateDevice((d) => { d.cloud = { email: user.email, uid: user.id, rt: tokens.refresh_token, dk: b64(dk), w: wraps, rev: rows[0].rev, dirty: true, last: 0 }; });
  access = tokens.access_token;
  accessExp = Date.now() + (Number(tokens.expires_in) || 3600) * 1000;
  const local = S.getState();
  S.applyRemote(isEmpty(local) ? data : merge(local, data), { dirty: true });
  if (!(await push())) { await pullAndApply(); await push(); }
  await api('/auth/v1/user', { method: 'PUT', body: { password: newSecret } });
  onRemote();
  setStatus('ok');
  return { email: user.email };
}

async function verifyPassword(password) {
  const c = cloud();
  try { await unwrapKey(password, c.w.pw); return true; } catch { return false; }
}

export async function changePassword(current, next) {
  if (!(await verifyPassword(current))) throw new CloudError('La contraseña actual no es correcta.', 'code');
  await syncNow();
  const c = cloud();
  const old = c.w.pw;
  const newWrap = await wrap(next, unb64(c.dk), ITER);
  S.updateDevice((d) => { d.cloud.w.pw = newWrap; d.cloud.dirty = true; });
  if (!(await push())) { S.updateDevice((d) => { d.cloud.w.pw = old; }); throw new CloudError('Otro dispositivo está sincronizando. Inténtalo de nuevo.', 'conflict'); }
  try {
    await api('/auth/v1/user', { method: 'PUT', body: { password: await authSecret(c.email, next) } });
  } catch (e) {
    S.updateDevice((d) => { d.cloud.w.pw = old; d.cloud.dirty = true; });
    await push().catch(() => {});
    throw e;
  }
}

export async function regenerateRecoveryCode(current) {
  if (!(await verifyPassword(current))) throw new CloudError('La contraseña no es correcta.', 'code');
  await syncNow();
  const code = newRecoveryCodeText();
  const rc = await wrap(normalizeCode(code), unb64(cloud().dk), RC_ITER);
  const old = cloud().w.rc;
  S.updateDevice((d) => { d.cloud.w.rc = rc; d.cloud.dirty = true; });
  if (!(await push())) { S.updateDevice((d) => { d.cloud.w.rc = old; }); throw new CloudError('Otro dispositivo está sincronizando. Inténtalo de nuevo.', 'conflict'); }
  return code;
}

/** Cierra la sesión (sube antes los cambios pendientes). Devuelve false si quedaron cambios sin subir. */
export async function signOut() {
  let synced = true;
  if (isLoggedIn() && cloud().dirty) { await syncNow(); synced = !cloud().dirty; }
  try { if (cloud() && !cloud().expired) await api('/auth/v1/logout', { method: 'POST' }); } catch { /* da igual */ }
  access = null;
  S.updateDevice((d) => { delete d.cloud; });
  setStatus('idle');
  return synced;
}

/** Cuando la sesión caduca: vuelve a entrar con la contraseña sin perder la clave. */
export async function reauth(password) {
  const c = cloud();
  return signIn(c.email, password);
}

