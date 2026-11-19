// Time-based one-time passwords (RFC 6238) as used by Google Authenticator: SHA-1, 6 digits, 30 s.
const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPH[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const s = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of s) {
    const i = ALPH.indexOf(ch); if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
export const newSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

export async function totpAt(secret, counter) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8); let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
// Returns the matching time step (so it can't be reused) or null. Allows one step of clock drift.
export async function verifyTotp(secret, code, now = Date.now()) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) if (await totpAt(secret, step + d) === code) return step + d;
  return null;
}
export const otpauthUri = (secret, account, issuer = 'Options Screener') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
