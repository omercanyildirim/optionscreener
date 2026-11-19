// Legal documents version and the user's acceptance of them (Terms, Privacy, Refund Policy).
// Bump LEGAL_VERSION when a document changes materially: every user is asked to accept again.
import { storeConfigured, cmd, pipe } from './store.js';
import { logEvent } from './activity.js';
import { getSubscription } from './billing.js';
import { adminEmails } from './session.js';

export const LEGAL_VERSION = '2026-11-19';

export async function recordConsent(email, { ip = '', how = 'login' } = {}) {
  if (!storeConfigured() || !email) return;
  email = String(email).toLowerCase();
  try {
    await pipe([['HSET', `os:u:${email}`, 'consentVersion', LEGAL_VERSION, 'consentAt', new Date().toISOString(), 'consentIp', String(ip).slice(0, 60), 'consentHow', how]]);
    await logEvent(email, 'consent', `Terms, Privacy and Refund Policy ${LEGAL_VERSION} (${how})`);
  } catch { /* never block sign-in */ }
}

export async function consentState(email) {
  if (!storeConfigured() || !email) return { version: LEGAL_VERSION, accepted: true };
  try {
    const v = await cmd(['HGET', `os:u:${String(email).toLowerCase()}`, 'consentVersion']);
    return { version: LEGAL_VERSION, accepted: v === LEGAL_VERSION };
  } catch { return { version: LEGAL_VERSION, accepted: true }; }
}

const parse = s => { try { return JSON.parse(s); } catch { return s; } };

// GDPR / KVKK right of access and portability: everything stored about the user, as JSON.
export async function exportData(email) {
  email = String(email).toLowerCase();
  const [profile, settings, events, sub] = await pipe([
    ['HGETALL', `os:u:${email}`], ['GET', `os:user:${email}`], ['LRANGE', `os:ev:${email}`, '0', '-1'], ['GET', `os:sub:${email}`],
  ]);
  const p = {}; for (let i = 0; i < (profile || []).length; i += 2) p[profile[i]] = profile[i + 1];
  return {
    exportedAt: new Date().toISOString(), site: 'optionscreener.org', email,
    profile: p, settings: settings ? parse(settings) : null, subscription: sub ? parse(sub) : null,
    activity: (events || []).map(parse),
    note: 'Card details are held by Paddle (our reseller) and are not stored on optionscreener.org.',
  };
}

// GDPR / KVKK right to erasure. An active paid subscription must be cancelled first (Paddle keeps billing otherwise).
export async function deleteAccount(email) {
  email = String(email).toLowerCase();
  const sub = await getSubscription(email);
  if (sub && ['active', 'trialing', 'past_due'].includes(sub.status) && !sub.cancelAt && !adminEmails().includes(email)) {
    return { error: 'Cancel your Pro subscription first (account menu, Manage subscription), then delete your account.', status: 409 };
  }
  // Remove this user's lines from the shared activity log too.
  const all = (await cmd(['LRANGE', 'os:events', '0', '-1'])) || [];
  const keep = all.filter(l => { const e = parse(l); return !(e && e.e === email); });
  const cmds = [
    ['DEL', `os:u:${email}`, `os:user:${email}`, `os:ev:${email}`, `os:sub:${email}`],
    ['ZREM', 'os:users', email],
  ];
  if (keep.length !== all.length) { cmds.push(['DEL', 'os:events']); if (keep.length) cmds.push(['RPUSH', 'os:events', ...keep]); }
  await pipe(cmds);
  return { ok: true };
}
