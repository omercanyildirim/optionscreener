// Signed session cookies using Web Crypto (works in Node functions and Routing Middleware).
const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_COOKIE = 'os_session';
export const STATE_COOKIE = 'os_state';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign(payload, secret) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verify(token, secret) {
  if (!token || !secret || secret.length < 32) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const okSig = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!okSig) return null;
    const data = JSON.parse(dec.decode(fromB64url(body)));
    if (!data.exp || data.exp * 1000 < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function allowedEmails(env) {
  return (env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ALLOWED_EMAILS="*" lets any verified Google account in; otherwise only the listed emails.
export function isAllowed(email, env = process.env) {
  const list = allowedEmails(env);
  const e = String(email).toLowerCase();
  return list.includes('*') || list.includes(e) || adminEmails(env).includes(e);
}

// Admins of the /admin portal come from ADMIN_EMAILS (comma-separated). They can always sign in.
export function adminEmails(env = process.env) {
  return (env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s.includes('@'));
}

// Returns the session payload ({email, name, exp}) or null.
export async function getSession(request, env = process.env) {
  const data = await verify(readCookie(request.headers.get('cookie'), SESSION_COOKIE), env.SESSION_SECRET);
  if (!data) return null;
  // Re-check the allow-list on every request so removing an email takes effect immediately.
  if (!isAllowed(data.email, env)) return null;
  return data;
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', ...headers },
  });
}
