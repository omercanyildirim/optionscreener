import { getSession, json, cookie, SESSION_COOKIE } from '../lib/session.js';
import { recordConsent, exportData, deleteAccount, setMarketing } from '../lib/legal.js';
import { checkUnsubscribe } from '../lib/mail.js';
import { storeConfigured, getUserData, setUserData, sanitizeUserData } from '../lib/store.js';
import { logEvent } from '../lib/activity.js';
import { POST as trackPOST } from '../lib/handlers/track.js';
import { dbConfigured } from '../lib/db.js';
import { CATEGORIES, MARKETING, getPrefs, setConsent, unsubscribeAll, runCheckins, verifyResendWebhook, onResendEvent } from '../lib/comms.js';
import { planFor } from '../lib/billing.js';
import { cmd } from '../lib/store.js';

// One-click unsubscribe from email links (/unsubscribe is rewritten here; no sign-in needed, the link is signed).
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, text, inner = '') => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#121417;color:#e4e6e9;font:15px/1.6 system-ui,sans-serif;padding:16px">
<div style="max-width:460px;width:100%"><h1 style="font-size:22px;font-weight:600;margin:0 0 8px">${title}</h1><p style="color:#878d96;margin:0 0 20px">${text}</p>${inner}
<a href="/" style="color:#e4e6e9">Open Options Screener</a></div></body>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

// /email-preferences: choose which emails to get. Works from the signed link in every email, or signed in.
async function whoForPrefs(request, form) {
  const q = new URL(request.url).searchParams;
  const e = (form && form.get('e')) || q.get('e'), t = (form && form.get('t')) || q.get('t');
  if (e || t) { const email = await checkUnsubscribe(e, t); return email ? { email, e, t } : null; }
  const s = await getSession(request); return s ? { email: s.email } : null;
}
function prefsForm(who, prefs, saved) {
  const boxes = MARKETING.map(c => `<label style="display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-top:1px solid #2a2e34;cursor:pointer">
<input type="checkbox" name="${c}" value="1"${prefs[c] ? ' checked' : ''} style="margin-top:4px;width:18px;height:18px;accent-color:#e4e6e9">
<span><b style="font-weight:600">${esc(CATEGORIES[c].label)}</b><br><span style="color:#878d96;font-size:14px">${esc(CATEGORIES[c].desc)}</span></span></label>`).join('');
  return `<form method="post" style="margin:0 0 24px">${who.e ? `<input type="hidden" name="e" value="${esc(who.e)}"><input type="hidden" name="t" value="${esc(who.t)}">` : ''}
${boxes}<div style="padding:14px 0;border-top:1px solid #2a2e34;color:#878d96;font-size:14px">Emails about your account and payments (welcome, receipts, failed payments) are always sent.</div>
<button style="margin-top:8px;background:#e4e6e9;color:#121417;border:0;border-radius:7px;padding:10px 18px;font:600 15px system-ui,sans-serif;cursor:pointer">Save preferences</button>
${saved ? '<span style="margin-left:12px;color:#7fcf9a">Saved</span>' : ''}</form>`;
}
async function prefsPage(request) {
  if (!dbConfigured()) return page('Email preferences', 'Email preferences are not available right now. Email info@optionscreener.org and we will update them for you.');
  const isPost = request.method === 'POST';
  const form = isPost ? new URLSearchParams(await request.text()) : null;
  const who = await whoForPrefs(request, form);
  // Without the signed link the change rides on the session cookie, so it must come from this site's own page.
  if (isPost && who && !who.t) { const o = request.headers.get('origin'), f = request.headers.get('sec-fetch-site'); if ((o && o !== new URL(request.url).origin) || (f && !['same-origin', 'none'].includes(f))) return page('Not saved', 'This request did not come from Options Screener.'); }
  if (!who) return page('Link not valid', 'This link is not valid. Open the latest email from us, or sign in and choose Email preferences in the account menu.');
  let prefs;
  try {
    if (isPost) {
      prefs = await setConsent(who.email, Object.fromEntries(MARKETING.map(c => [c, form.get(c) === '1'])),
        { source: 'email preferences page', ip: clientIp(request), ua: request.headers.get('user-agent') || '', textVersion: '2026-11-20.prefs' });
      if (prefs.changed) await logEvent(who.email, 'marketing', 'Email preferences: ' + MARKETING.map(c => `${c} ${prefs[c] ? 'on' : 'off'}`).join(', '));
    } else prefs = await getPrefs(who.email);
  } catch { return page('Something went wrong', 'Your preferences could not be loaded. Try again in a minute.'); }
  return page('Email preferences', `Choose the emails ${esc(who.email)} gets from Options Screener.`, prefsForm(who, prefs, isPost));
}

// Daily scheduled run (vercel.json crons): check-in emails. Safe to call by anyone: it runs at most once every 20 hours.
async function cron() {
  if (!dbConfigured() || !storeConfigured()) return json({ skipped: 'not configured' });
  const go = await cmd(['SET', 'os:cron:checkins', String(Date.now()), 'NX', 'EX', String(20 * 3600)]);
  if (go !== 'OK') return json({ skipped: 'already ran' });
  try { return json(await runCheckins(Date.now(), planFor)); } catch (e) { return json({ error: e.message }, 500); }
}
// Resend webhook (/api/mail-events): hard bounces and spam complaints stop all email to that address.
async function mailHook(request) {
  const raw = await request.text();
  if (raw.length > 100000) return json({ error: 'too large' }, 413);
  const h = n => request.headers.get(n) || '';
  if (!(await verifyResendWebhook(raw, { id: h('svix-id'), timestamp: h('svix-timestamp'), signature: h('svix-signature') }))) return json({ error: 'invalid signature' }, 401);
  let evt; try { evt = JSON.parse(raw); } catch { return json({ error: 'invalid JSON' }, 400); }
  try { return json({ ok: true, ...(await onResendEvent(evt)) }); } catch (e) { return json({ error: e.message }, 500); }
}
async function unsubscribe(request) {
  const q = new URL(request.url).searchParams;
  const email = await checkUnsubscribe(q.get('e'), q.get('t'));
  if (!email) return page('Link not valid', 'This unsubscribe link is not valid. You can turn off emails from the account menu in the app.');
  const meta = { ip: clientIp(request), how: 'unsubscribe link', source: 'unsubscribe link', ua: request.headers.get('user-agent') || '' };
  if (dbConfigured()) { try { await unsubscribeAll(email, meta); } catch { if (storeConfigured()) await setMarketing(email, false, meta); } }
  else if (storeConfigured()) await setMarketing(email, false, meta);
  if (storeConfigured()) await logEvent(email, 'marketing', 'Unsubscribed from all marketing emails (unsubscribe link)');
  const u = new URL(request.url).searchParams;
  return page('You are unsubscribed', 'You will no longer get market news or check-ins from Options Screener. Emails about your account and payments are still sent.',
    `<p style="margin:0 0 24px"><a href="/email-preferences?e=${encodeURIComponent(u.get('e'))}&t=${encodeURIComponent(u.get('t'))}" style="color:#e4e6e9">Change email preferences</a></p>`);
}

// POST = activity events from the app (/api/track is rewritten here in vercel.json), or one-click unsubscribe (RFC 8058).
export async function POST(request) {
  const a = action(request);
  if (a === 'unsub') return unsubscribe(request);
  if (a === 'prefs') return prefsPage(request);
  if (a === 'mailhook') return mailHook(request);
  return trackPOST(request);
}

const action = request => new URL(request.url).searchParams.get('a') || '';
const clientIp = request => (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || '';

// Each signed-in user's saved filters (presets), tracked contracts and watchlist.
// GET ?a=export downloads everything stored about the user (GDPR / KVKK access and portability).
export async function GET(request) {
  if (action(request) === 'unsub') return unsubscribe(request);
  if (action(request) === 'prefs') return prefsPage(request);
  if (action(request) === 'cron') return cron();
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!storeConfigured()) return json({ configured: false });
  if (action(request) === 'export') {
    try {
      const data = await exportData(s.email);
      await logEvent(s.email, 'data_export', 'downloaded own data');
      return new Response(JSON.stringify(data, null, 2), { headers: {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'content-disposition': 'attachment; filename="optionscreener-my-data.json"' } });
    } catch { return json({ error: 'Could not reach the database' }, 502); }
  }
  try {
    const data = await getUserData(s.email);
    return json({ configured: true, data: data || null });
  } catch (e) {
    return json({ configured: true, error: 'Could not reach the database' }, 502);
  }
}

// DELETE = erase the account and everything stored about it (GDPR / KVKK erasure), then sign out.
export async function DELETE(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!storeConfigured()) return json({ error: 'Database is not connected' }, 503);
  let r; try { r = await deleteAccount(s.email); } catch { return json({ error: 'Could not reach the database' }, 502); }
  if (r.error) return json({ error: r.error }, r.status || 400);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': cookie(SESSION_COOKIE, '', 0) } });
}

export async function PUT(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!storeConfigured()) return json({ error: 'Database is not connected' }, 503);
  // PUT ?a=consent: a signed-in user accepts the current Terms, Privacy and Refund Policy.
  if (action(request) === 'consent') {
    await recordConsent(s.email, { ip: clientIp(request), how: 'in-app' });
    if (new URL(request.url).searchParams.get('mkt') === '1') await setMarketing(s.email, true, { ip: clientIp(request), how: 'terms update dialog', ua: request.headers.get('user-agent') || '' });
    return json({ ok: true });
  }
  // PUT ?a=marketing&on=1|0: the email updates switch in the account menu.
  if (action(request) === 'marketing') {
    const on = new URL(request.url).searchParams.get('on') === '1';
    await setMarketing(s.email, on, { ip: clientIp(request), how: 'account menu', ua: request.headers.get('user-agent') || '' });
    return json({ ok: true, marketing: on });
  }
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 300000) return json({ error: 'Data is too large' }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  let clean;
  try { clean = sanitizeUserData(body); } catch (e) { return json({ error: e.message }, 400); }
  clean.updatedAt = Date.now();
  try {
    await setUserData(s.email, clean);
  } catch {
    return json({ error: 'Could not write to the database' }, 502);
  }
  await logEvent(s.email, 'settings_saved', `${clean.presets.length} filters, ${clean.tracked.length} watched contracts`);
  return json({ ok: true, data: clean });
}
