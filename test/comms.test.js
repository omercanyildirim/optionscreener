import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as shim from './support/neon-shim.js';

const SECRET = 'x'.repeat(40);
const skip = !shim.available() && 'Postgres 16 is not installed here';
const { sign, SESSION_COOKIE } = await import('../lib/session.js');
const M = await import('../lib/comms.js');
const db = await import('../lib/db.js');
const mail = await import('../lib/mail.js');
const legal = await import('../lib/legal.js');
const billing = await import('../lib/billing.js');
const ud = await import('../api/userdata.js');
const bapi = await import('../api/billing.js');

let R = {}, SENT = [], RESEND_FAIL = false;
function redis([c, k, ...a]) {
  const C = String(c).toUpperCase(), h = () => (R[k] ||= {});
  if (C === 'GET') return R[k] ?? null;
  if (C === 'SET') { if (a.includes('NX') && R[k] != null) return null; R[k] = a[0]; return 'OK'; }
  if (C === 'DEL') { delete R[k]; return 1; }
  if (C === 'HGET') return (R[k] || {})[a[0]] ?? null;
  if (C === 'HMGET') return a.map(f => (R[k] || {})[f] ?? null);
  if (C === 'HSET') { for (let i = 0; i < a.length; i += 2) h()[a[i]] = a[i + 1]; return 1; }
  if (C === 'HSETNX') { if (h()[a[0]] == null) h()[a[0]] = a[1]; return 1; }
  if (C === 'SADD') { (R[k] ||= new Set()).add(a[0]); return 1; }
  if (C === 'SREM') { R[k] && R[k].delete && R[k].delete(a[0]); return 1; }
  if (C === 'ZADD') { (R[k] ||= new Map()).set(a[1], +a[0]); return 1; }
  if (C === 'ZRANGE' || C === 'ZREVRANGE') return R[k] ? [...R[k].keys()] : [];
  if (C === 'LRANGE') return [];
  return 1;
}
const realFetch = globalThis.fetch;

before(async () => { if (!skip) await shim.start(); });
after(() => shim.stop());
beforeEach(async () => {
  R = {}; SENT = []; RESEND_FAIL = false;
  Object.assign(process.env, { SESSION_SECRET: SECRET, ALLOWED_EMAILS: '*', ADMIN_EMAILS: 'admin@example.com', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't',
    RESEND_API_KEY: 're_test', MAIL_FROM: 'Options Screener <info@example.com>', APP_URL: 'https://os.example.com', MAIL_POSTAL_ADDRESS: 'PO Box 1, Example City',
    PADDLE_ENV: 'sandbox', PADDLE_CLIENT_TOKEN: 'tok', PADDLE_PRICE_ID: 'pri_1', DATABASE_URL: 'postgresql://u:p@ep-test-pooler.example.neon.tech/db' });
  delete process.env.IYS_REGISTERED; delete process.env.RESEND_WEBHOOK_SECRET;
  globalThis.fetch = async (u, init) => {
    u = String(u);
    if (u.startsWith('https://kv.example')) {
      const body = JSON.parse(init.body);
      if (u.endsWith('/pipeline')) return new Response(JSON.stringify(body.map(c => ({ result: redis(c) }))));
      return new Response(JSON.stringify({ result: redis(body) }));
    }
    if (u.startsWith('https://api.resend.com')) {
      if (RESEND_FAIL) return new Response(JSON.stringify({ message: 'down' }), { status: 500 });
      const b = JSON.parse(init.body); const list = Array.isArray(b) ? b : [b];
      list.forEach(m => SENT.push(m));
      return new Response(JSON.stringify(Array.isArray(b) ? { data: list.map((_, i) => ({ id: 'b' + SENT.length + '_' + i })) } : { id: 'm' + SENT.length }));
    }
    return realFetch(u, init);
  };
  if (!skip) { process.env.DB_HTTP_URL = await shim.start(); M._resetMail(); db._resetEndpoint(); }
});
const user = (email, o = {}) => { R[`os:u:${email}`] = { first: String(Date.now() - 200 * 864e5), last: String(Date.now()), givenName: 'Sam', ...o }; redis(['ZADD', 'os:users', '1', email]); };
const sends = async (email) => db.rows('select kind, status, error from em_sends where email = $1 order by id', [email]);

test('earlier Redis choices move into the ledger once', { skip }, async () => {
  user('a@x.com', { marketing: '1', marketingAt: '2026-11-10T10:00:00.000Z', marketingIp: '1.2.3.4', marketingHow: 'sign-in checkbox' });
  user('b@x.com', { marketing: '0', marketingAt: '2026-11-11T10:00:00.000Z', marketingHow: 'account menu' });
  user('c@x.com');
  await M.ensureMail();
  assert.deepEqual((await M.getPrefs('a@x.com')).news, true);
  assert.deepEqual((await M.getPrefs('b@x.com')).checkin, false);
  const c = await db.rows(`select email, granted, ip, text_version from em_consents order by email, category`);
  assert.equal(c.length, 4);
  assert.equal(c[0].ip, '1.2.3.4'); assert.equal(c[0].text_version, 'legacy-2026-11');
  M._resetMail(); await M.ensureMail(); // second time does nothing
  assert.equal((await db.rows('select id from em_consents')).length, 4);
});

test('consent changes are recorded with wording, IP and browser; only real changes', { skip }, async () => {
  user('a@x.com');
  await legal.setMarketing('a@x.com', true, { ip: '9.9.9.9', how: 'sign-in checkbox', ua: 'UA1' });
  let p = await M.getPrefs('a@x.com'); assert.equal(p.news, true); assert.equal(p.checkin, true);
  assert.equal(R['os:u:a@x.com'].marketing, '1');
  await M.setConsent('a@x.com', { news: true, checkin: false }, { source: 'email preferences page', textVersion: '2026-11-20.prefs' });
  const c = await db.rows(`select category, granted, source, ip, user_agent, text_version from em_consents where email = 'a@x.com' order by id`);
  assert.equal(c.length, 3); // news on, checkin on, checkin off (news unchanged is not recorded again)
  assert.deepEqual(c.map(x => [x.category, x.granted]), [['news', true], ['checkin', true], ['checkin', false]]);
  assert.equal(c[0].ip, '9.9.9.9'); assert.equal(c[0].user_agent, 'UA1'); assert.equal(c[2].text_version, '2026-11-20.prefs');
  const t = await db.one(`select text from em_consent_texts where version = '2026-11-20'`);
  assert.match(t.text, /market news, product updates and occasional check-ins/);
});

test('unsubscribe link withdraws everything; preferences page shows and saves choices', { skip }, async () => {
  user('a@x.com');
  await M.setConsent('a@x.com', { news: true, checkin: true }, { source: 'test' });
  const url = new URL(await mail.unsubscribeUrl('a@x.com'));
  let r = await ud.GET(new Request('https://os.example.com/api/userdata?a=unsub&' + url.searchParams));
  assert.match(await r.text(), /You are unsubscribed/);
  let p = await M.getPrefs('a@x.com'); assert.equal(p.news, false); assert.equal(p.suppressed, 'unsubscribed');
  // preferences page via the signed link
  const purl = new URL(await M.prefsUrl('a@x.com'));
  assert.equal(purl.pathname, '/email-preferences');
  r = await ud.GET(new Request('https://os.example.com/api/userdata?a=prefs&' + purl.searchParams));
  const html = await r.text();
  assert.match(html, /Market news and product updates/); assert.doesNotMatch(html, /checked/);
  const form = new URLSearchParams({ e: purl.searchParams.get('e'), t: purl.searchParams.get('t'), news: '1' });
  r = await ud.POST(new Request('https://os.example.com/api/userdata?a=prefs', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
  assert.match(await r.text(), /Saved/);
  p = await M.getPrefs('a@x.com'); assert.equal(p.news, true); assert.equal(p.checkin, false); assert.equal(p.suppressed, null);
  // a forged token is refused
  r = await ud.GET(new Request('https://os.example.com/api/userdata?a=prefs&e=a%40x.com&t=00'));
  assert.match(await r.text(), /Link not valid/);
});

test('welcome goes once; payment-failed once per period; neither needs marketing consent', { skip }, async () => {
  user('a@x.com');
  assert.equal((await M.sendWelcome('a@x.com')).sent, true);
  assert.equal((await M.sendWelcome('a@x.com')).skipped, 'already sent');
  assert.equal(SENT.length, 1); assert.equal(SENT[0].subject, 'Welcome to Options Screener');
  assert.match(SENT[0].html, /email-preferences/); assert.equal(SENT[0].headers, undefined);
  await M.sendPaymentFailed('a@x.com', 'sub_1', '2026-12-01T00:00:00Z');
  await M.sendPaymentFailed('a@x.com', 'sub_1', '2026-12-01T00:00:00Z');
  await M.sendPaymentFailed('a@x.com', 'sub_1', '2027-01-01T00:00:00Z');
  assert.equal(SENT.length, 3);
  assert.match(SENT[1].text, /api\/billing\?a=portal/);
  // a failed send frees the key so a retry can send
  RESEND_FAIL = true; await assert.rejects(M.sendPaymentFailed('a@x.com', 'sub_2', 'x'));
  RESEND_FAIL = false; assert.equal((await M.sendPaymentFailed('a@x.com', 'sub_2', 'x')).sent, true);
  // a hard bounce stops even account emails
  await M.suppress('a@x.com', 'bounced', 'mailbox does not exist');
  assert.equal((await M.sendPaymentFailed('a@x.com', 'sub_3', 'x')).skipped, 'bounced');
});

test('Paddle past_due webhook sends the payment-failed email once', { skip }, async () => {
  user('a@x.com');
  process.env.PADDLE_WEBHOOK_SECRET = 'whsec';
  const custom = { email: 'a@x.com', sig: await billing.signAccount('a@x.com') };
  const hook = async (status, at) => {
    const raw = JSON.stringify({ event_type: 'subscription.updated', data: { id: 'sub_9', status, customer_id: 'ctm_1', updated_at: at, next_billed_at: '2026-12-20T00:00:00Z', custom_data: custom, items: [] } });
    const ts = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const h1 = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${raw}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
    return bapi.POST(new Request('https://os.example.com/api/billing?a=webhook', { method: 'POST', body: raw, headers: { 'paddle-signature': `ts=${ts};h1=${h1}` } }));
  };
  assert.equal((await hook('active', '2026-11-20T00:00:00Z')).status, 200);
  assert.equal((await hook('past_due', '2026-11-20T01:00:00Z')).status, 200);
  assert.equal((await hook('past_due', '2026-11-20T02:00:00Z')).status, 200);
  assert.deepEqual((await sends('a@x.com')).map(s => s.kind), ['payment_failed']);
});

test('marketing needs consent, a postal address, and IYS for Türkiye', { skip }, async () => {
  user('a@x.com'); user('tr@x.com', { country: 'TR' }); user('no@x.com');
  await M.setConsent('a@x.com', { news: true }, { source: 't' });
  await M.setConsent('tr@x.com', { news: true }, { source: 't' });
  assert.equal(await M.blockReason('no@x.com', 'news'), 'no consent');
  assert.equal(await M.blockReason('tr@x.com', 'news'), 'IYS registration needed for Türkiye');
  assert.equal(await M.blockReason('a@x.com', 'news'), null);
  delete process.env.MAIL_POSTAL_ADDRESS;
  assert.equal(await M.blockReason('a@x.com', 'news'), 'postal address not set');
  process.env.MAIL_POSTAL_ADDRESS = 'PO Box 1'; process.env.IYS_REGISTERED = 'true';
  assert.equal(await M.blockReason('tr@x.com', 'news'), null);
});

test('news campaign: draft, test, send once to the right people with unsubscribe headers', { skip }, async () => {
  for (const e of ['a@x.com', 'b@x.com', 'tr@x.com', 'off@x.com', 'gone@x.com']) user(e, e === 'tr@x.com' ? { country: 'TR' } : {});
  for (const e of ['a@x.com', 'b@x.com', 'tr@x.com', 'gone@x.com']) await M.setConsent(e, { news: true }, { source: 't' });
  await M.setConsent('off@x.com', { news: false, checkin: true }, { source: 't' });
  await M.suppress('gone@x.com', 'complained');
  const c = await M.saveCampaign({ subject: 'NVDA flow', body: 'Big calls today.\n\n- $NVDA 150C\n- See https://os.example.com/flow' }, 'admin@example.com');
  assert.equal(c.status, 'draft');
  await M.sendTest(c.id, 'admin@example.com');
  assert.equal(SENT[0].subject, '[Test] NVDA flow');
  const done = await M.sendCampaign(c.id, 'admin@example.com');
  assert.equal(done.status, 'sent'); assert.equal(done.sent, 2); assert.equal(done.skipped, 1);
  const got = SENT.slice(1).map(m => m.to[0]).sort();
  assert.deepEqual(got, ['a@x.com', 'b@x.com']);
  const m = SENT[1];
  assert.match(m.headers['List-Unsubscribe'], /^<https:\/\/os\.example\.com\/unsubscribe\?e=/);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(m.html, /<li[^>]*>\$NVDA 150C<\/li>/); assert.match(m.html, /PO Box 1, Example City/); assert.match(m.html, /<a href="https:\/\/os\.example\.com\/flow"/);
  await assert.rejects(M.sendCampaign(c.id), /already sent/);
  await assert.rejects(M.saveCampaign({ id: c.id, subject: 'x', body: 'y' }), /Only drafts/);
  assert.equal((await sends('tr@x.com'))[0].error, 'IYS registration needed for Türkiye');
});

test('check-ins: cancelled or inactive 90+ days, every 90 days, at most 4, never to Pro', { skip }, async () => {
  const day = 864e5, now = Date.now();
  user('cancel@x.com', { last: String(now - 5 * day) }); R['os:sub:cancel@x.com'] = JSON.stringify({ status: 'canceled', updatedAt: new Date(now - 100 * day).toISOString() });
  user('recentcancel@x.com', { last: String(now - 5 * day) }); R['os:sub:recentcancel@x.com'] = JSON.stringify({ status: 'canceled', updatedAt: new Date(now - 10 * day).toISOString() });
  user('idle@x.com', { last: String(now - 120 * day) });
  user('active@x.com', { last: String(now - 1 * day) });
  user('noconsent@x.com', { last: String(now - 120 * day) });
  user('pro@x.com', { last: String(now - 120 * day) }); await billing.setComp('pro@x.com', true, { by: 't' });
  user('new@x.com', { first: String(now - 10 * day), last: String(now - 10 * day) });
  for (const e of ['cancel@x.com', 'recentcancel@x.com', 'idle@x.com', 'active@x.com', 'pro@x.com', 'new@x.com']) await M.setConsent(e, { checkin: true }, { source: 't' });
  const due = await M.dueCheckins(now, billing.planFor);
  assert.deepEqual(due.map(d => [d.email, d.reason]).sort(), [['cancel@x.com', 'cancelled'], ['idle@x.com', 'inactive']]);
  const r = await M.runCheckins(now, billing.planFor);
  assert.equal(r.sent, 2);
  assert.match(SENT.find(m => m.to[0] === 'cancel@x.com').text, /since you left Pro/);
  assert.ok(SENT.every(m => !/discount|% off|coupon/i.test(m.html)));
  assert.equal((await M.dueCheckins(now, billing.planFor)).length, 0); // not again within 90 days
  // 91 days later: due again; after 4 in total: never again
  await db.exec([`update em_sends set at = at - interval '91 days' where kind = 'checkin'`]);
  assert.equal((await M.dueCheckins(now, billing.planFor)).length, 2);
  await db.exec([`insert into em_sends (email, kind, category, status, at) select 'idle@x.com', 'checkin', 'checkin', 'sent', now() - interval '400 days' from generate_series(1, 3)`]);
  assert.deepEqual((await M.dueCheckins(now, billing.planFor)).map(d => d.email), ['cancel@x.com']);
  await M.setCheckins(false);
  assert.equal((await M.runCheckins(now, billing.planFor)).off, true);
});

test('daily run guard, Resend bounce webhook, export and delete', { skip }, async () => {
  user('a@x.com');
  let r = await ud.GET(new Request('https://os.example.com/api/userdata?a=cron'));
  assert.equal(r.status, 200);
  r = await ud.GET(new Request('https://os.example.com/api/userdata?a=cron'));
  assert.equal((await r.json()).skipped, 'already ran');
  // signed webhook
  const secretBytes = crypto.getRandomValues(new Uint8Array(24));
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + btoa(String.fromCharCode(...secretBytes));
  const raw = JSON.stringify({ type: 'email.complained', data: { to: ['a@x.com'] } });
  const id = 'msg_1', ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${raw}`)))));
  await M.setConsent('a@x.com', { news: true }, { source: 't' });
  r = await ud.POST(new Request('https://os.example.com/api/userdata?a=mailhook', { method: 'POST', body: raw, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': 'v1,' + sig } }));
  assert.equal(r.status, 200);
  const p = await M.getPrefs('a@x.com'); assert.equal(p.news, false); assert.equal(p.suppressed, 'complained');
  r = await ud.POST(new Request('https://os.example.com/api/userdata?a=mailhook', { method: 'POST', body: raw, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': 'v1,AAAA' } }));
  assert.equal(r.status, 401);
  // export has the consent history with wording; delete clears it (keeps the complaint block)
  await M.sendWelcome('a@x.com');
  const x = await M.exportMail('a@x.com');
  assert.ok(x.consentHistory.length >= 2); assert.ok(x.consentHistory[0].wording);
  await M.deleteMail('a@x.com');
  assert.equal((await M.exportMail('a@x.com')).consentHistory.length, 0);
  assert.equal((await M.getPrefs('a@x.com')).suppressed, 'complained');
});

test('session-only preferences POST must come from this site', { skip }, async () => {
  user('a@x.com');
  const t = await sign({ email: 'a@x.com', name: 'N', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const mk = site => new Request('https://os.example.com/api/userdata?a=prefs', { method: 'POST', body: 'news=1', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}`, 'sec-fetch-site': site } });
  assert.match(await (await ud.POST(mk('cross-site'))).text(), /Not saved/);
  assert.match(await (await ud.POST(mk('same-origin'))).text(), /Saved/);
  assert.equal((await M.getPrefs('a@x.com')).news, true);
});
