import { getSession, json, cookie, SESSION_COOKIE } from '../lib/session.js';
import { recordConsent, exportData, deleteAccount, setMarketing } from '../lib/legal.js';
import { checkUnsubscribe } from '../lib/mail.js';
import { storeConfigured, getUserData, setUserData, sanitizeUserData } from '../lib/store.js';
import { logEvent } from '../lib/activity.js';
import { POST as trackPOST } from '../lib/handlers/track.js';

// One-click unsubscribe from email links (/unsubscribe is rewritten here; no sign-in needed, the link is signed).
const page = (title, text) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#121417;color:#e4e6e9;font:15px/1.6 system-ui,sans-serif;padding:16px">
<div style="max-width:420px"><h1 style="font-size:22px;font-weight:600;margin:0 0 8px">${title}</h1><p style="color:#878d96;margin:0 0 20px">${text}</p>
<a href="/" style="color:#e4e6e9">Open Options Screener</a></div></body>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
async function unsubscribe(request) {
  const q = new URL(request.url).searchParams;
  const email = await checkUnsubscribe(q.get('e'), q.get('t'));
  if (!email) return page('Link not valid', 'This unsubscribe link is not valid. You can turn off emails from the account menu in the app.');
  if (storeConfigured()) await setMarketing(email, false, { ip: clientIp(request), how: 'unsubscribe link' });
  return page('You are unsubscribed', 'You will no longer receive product emails from Options Screener. Emails about your payments and account will still be sent.');
}

// POST = activity events from the app (/api/track is rewritten here in vercel.json), or one-click unsubscribe (RFC 8058).
export async function POST(request) {
  if (action(request) === 'unsub') return unsubscribe(request);
  return trackPOST(request);
}

const action = request => new URL(request.url).searchParams.get('a') || '';
const clientIp = request => (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || '';

// Each signed-in user's saved filters (presets), tracked contracts and watchlist.
// GET ?a=export downloads everything stored about the user (GDPR / KVKK access and portability).
export async function GET(request) {
  if (action(request) === 'unsub') return unsubscribe(request);
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
    if (new URL(request.url).searchParams.get('mkt') === '1') await setMarketing(s.email, true, { ip: clientIp(request), how: 'terms update dialog' });
    return json({ ok: true });
  }
  // PUT ?a=marketing&on=1|0: the email updates switch in the account menu.
  if (action(request) === 'marketing') {
    const on = new URL(request.url).searchParams.get('on') === '1';
    await setMarketing(s.email, on, { ip: clientIp(request), how: 'account menu' });
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
