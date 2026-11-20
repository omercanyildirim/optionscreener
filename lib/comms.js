// User emails and the consent behind them, stored in Postgres (lib/db.js).
//
// Kinds of email:
//   account   welcome, payment received, payment failed. Part of the service: sent without marketing consent,
//             but never to an address that bounced or complained.
//   news      market news and product updates written in the admin panel. Only to people who agreed to "news".
//   checkin   a short note, no discount, to people who cancelled Pro or have not used the site for 3 months.
//             Only to people who agreed to "checkin"; at most once every 90 days and at most 4 times in total.
//
// Everything is recorded: every agreement and withdrawal (with time, IP, browser, where it was given and the exact
// wording shown), the current preferences, every email sent (or skipped, or failed), suppressed addresses and campaigns.
//
// Env: MAIL_POSTAL_ADDRESS  postal address printed in marketing emails (US CAN-SPAM). Marketing emails are paused until set.
//      IYS_REGISTERED       true once the sender is registered in Türkiye's IYS; until then marketing skips users in TR.
//      RESEND_WEBHOOK_SECRET Resend webhook signing secret (whsec_...) for bounces and complaints.
import { rows, one, exec, dbConfigured } from './db.js';
import { storeConfigured, cmd, pipe } from './store.js';
import { sendMail, sendBatch, mailConfigured, unsubscribeUrl, checkUnsubscribe, layout, esc, site } from './mail.js';

export const CATEGORIES = {
  news: { label: 'Market news and product updates', desc: 'Notable options flow, market moves and new features. A few emails a month at most.' },
  checkin: { label: 'Check-ins', desc: 'A short note if you cancel Pro or have not used Options Screener for a while. At most once every 3 months.' },
};
export const MARKETING = Object.keys(CATEGORIES);
// The exact wording a person agreed to. A new version gets a new key; old versions stay so every agreement can be proven.
export const TEXTS = {
  '2026-11-20': 'Email me market news, product updates and occasional check-ins (optional). I can unsubscribe at any time.',
  '2026-11-20.prefs': 'Email preferences page: ' + MARKETING.map(k => `${CATEGORIES[k].label} (${CATEGORIES[k].desc})`).join('; '),
  'legacy-2026-11': 'Email me product updates and offers (optional). I can unsubscribe at any time.',
};
export const TEXT_VERSION = '2026-11-20';
export const CHECKIN = { everyDays: 90, max: 4, perRun: 200 };

const SCHEMA = [
  `create table if not exists em_consent_texts (version text primary key, text text not null, created_at timestamptz not null default now())`,
  `create table if not exists em_consents (
     id bigserial primary key, email text not null, category text not null, granted boolean not null,
     source text not null, ip text not null default '', user_agent text not null default '',
     text_version text references em_consent_texts(version), at timestamptz not null default now())`,
  `create index if not exists em_consents_email on em_consents (email, at desc)`,
  `create table if not exists em_prefs (
     email text primary key, news boolean not null default false, checkin boolean not null default false,
     updated_at timestamptz not null default now())`,
  `create table if not exists em_suppressions (email text primary key, reason text not null, detail text not null default '', at timestamptz not null default now())`,
  `create table if not exists em_campaigns (
     id bigserial primary key, category text not null default 'news', subject text not null, body text not null,
     status text not null default 'draft', created_by text not null default '', created_at timestamptz not null default now(),
     updated_at timestamptz not null default now(), sent_at timestamptz, sent_by text,
     recipients int not null default 0, sent int not null default 0, failed int not null default 0, skipped int not null default 0)`,
  `create table if not exists em_sends (
     id bigserial primary key, email text not null, kind text not null, category text not null, subject text not null default '',
     campaign_id bigint references em_campaigns(id) on delete set null, dedupe text unique, provider_id text,
     status text not null, error text not null default '', at timestamptz not null default now())`,
  `create index if not exists em_sends_email on em_sends (email, at desc)`,
  `create index if not exists em_sends_kind on em_sends (kind, at desc)`,
  `create table if not exists em_meta (k text primary key, v text not null, at timestamptz not null default now())`,
];

const lc = s => String(s || '').trim().toLowerCase();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
export const postalAddress = () => String(process.env.MAIL_POSTAL_ADDRESS || '').trim();
export const iysRegistered = () => process.env.IYS_REGISTERED === 'true';

let ready = null;
export function ensureMail() {
  if (!dbConfigured()) return Promise.reject(bad('The email database is not connected', 503));
  return (ready ||= (async () => {
    await exec([...SCHEMA, ...Object.entries(TEXTS).map(([v, t]) => ({ query: 'insert into em_consent_texts (version, text) values ($1, $2) on conflict (version) do nothing', params: [v, t] }))]);
    await migrateRedis();
  })().catch(e => { ready = null; throw e; }));
}
export const _resetMail = () => { ready = null; };

// One time: copy the email choices recorded in Redis before this module existed into the ledger.
async function migrateRedis() {
  if (!storeConfigured()) return;
  const done = await one(`select v from em_meta where k = 'redis_migrated'`);
  if (done) return;
  const users = (await cmd(['ZRANGE', 'os:users', '0', '-1'])) || [];
  const res = users.length ? await pipe(users.map(e => ['HMGET', `os:u:${e}`, 'marketing', 'marketingAt', 'marketingIp', 'marketingHow'])) : [];
  const q = [];
  users.forEach((email, i) => {
    const [m, at, ip, how] = res[i] || [];
    if (m !== '1' && m !== '0') return;
    const on = m === '1', when = at && !isNaN(Date.parse(at)) ? at : new Date().toISOString();
    for (const c of MARKETING) q.push({ query: `insert into em_consents (email, category, granted, source, ip, text_version, at) values ($1, $2, $3, $4, $5, 'legacy-2026-11', $6)`,
      params: [lc(email), c, on, `${how || 'unknown'} (moved from earlier records)`, ip || '', when] });
    q.push({ query: `insert into em_prefs (email, news, checkin, updated_at) values ($1, $2, $2, $3) on conflict (email) do nothing`, params: [lc(email), on, when] });
  });
  q.push({ query: `insert into em_meta (k, v) values ('redis_migrated', $1) on conflict (k) do nothing`, params: [String(q.length)] });
  await exec(q);
}

/* ---------- consent ---------- */
// choices: { news: true|false, checkin: true|false }; only the categories given are changed, and only real changes are recorded.
export async function setConsent(email, choices, { source = '', ip = '', ua = '', textVersion = TEXT_VERSION } = {}) {
  email = lc(email);
  if (!validEmail(email)) throw bad('Invalid email');
  await ensureMail();
  const cur = (await one('select news, checkin from em_prefs where email = $1', [email])) || { news: false, checkin: false };
  const next = { ...cur }, q = [];
  for (const c of MARKETING) {
    if (!(c in choices)) continue;
    const on = !!choices[c];
    const known = await one('select 1 as x from em_consents where email = $1 and category = $2 limit 1', [email, c]);
    if (on === !!cur[c] && known) continue;
    next[c] = on;
    q.push({ query: `insert into em_consents (email, category, granted, source, ip, user_agent, text_version) values ($1, $2, $3, $4, $5, $6, $7)`,
      params: [email, c, on, String(source).slice(0, 80), String(ip).slice(0, 60), String(ua).slice(0, 300), TEXTS[textVersion] ? textVersion : TEXT_VERSION] });
  }
  if (!q.length) return { ...next, changed: false };
  q.push({ query: `insert into em_prefs (email, news, checkin) values ($1, $2, $3)
    on conflict (email) do update set news = excluded.news, checkin = excluded.checkin, updated_at = now()`, params: [email, next.news, next.checkin] });
  // Agreeing again lifts an earlier unsubscribe (not a bounce or complaint).
  if (MARKETING.some(c => next[c])) q.push({ query: `delete from em_suppressions where email = $1 and reason = 'unsubscribed'`, params: [email] });
  await exec(q);
  // Keep the quick flag the rest of the site and the admin users table read.
  if (storeConfigured()) {
    const any = MARKETING.some(c => next[c]);
    try { await pipe([['HSET', `os:u:${email}`, 'marketing', any ? '1' : '0', 'marketingAt', new Date().toISOString(), 'marketingIp', String(ip).slice(0, 60), 'marketingHow', String(source).slice(0, 80)],
      any ? ['SADD', 'os:mkt', email] : ['SREM', 'os:mkt', email]]); } catch { /* the ledger above is the record */ }
  }
  return { ...next, changed: true };
}
export async function getPrefs(email) {
  email = lc(email);
  await ensureMail();
  const p = await one('select news, checkin, updated_at from em_prefs where email = $1', [email]);
  const s = await one('select reason, at from em_suppressions where email = $1', [email]);
  return { news: !!(p && p.news), checkin: !!(p && p.checkin), updatedAt: p ? p.updated_at : null, suppressed: s ? s.reason : null };
}
export async function suppress(email, reason, detail = '') {
  email = lc(email); if (!validEmail(email)) return;
  await ensureMail();
  await exec([{ query: `insert into em_suppressions (email, reason, detail) values ($1, $2, $3)
    on conflict (email) do update set reason = case when em_suppressions.reason = 'unsubscribed' then excluded.reason else em_suppressions.reason end, detail = excluded.detail, at = now()`,
    params: [email, reason, String(detail).slice(0, 300)] }]);
}
// One-click unsubscribe: withdraws every marketing category.
export async function unsubscribeAll(email, meta = {}) {
  const r = await setConsent(email, Object.fromEntries(MARKETING.map(c => [c, false])), meta);
  await suppress(email, 'unsubscribed', meta.source || '');
  return r;
}

/* ---------- links ---------- */
export async function prefsUrl(email) {
  const u = new URL(await unsubscribeUrl(email));
  return `${site()}/email-preferences${u.search}`;
}
export { checkUnsubscribe };

/* ---------- templates ---------- */
const btn = (href, label) => `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:#1d2026;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:7px">${esc(label)}</a></p>`;
const p = t => `<p style="margin:0 0 12px">${t}</p>`;
const hi = name => (name ? `Hi ${esc(String(name).split(' ')[0])},` : 'Hi,');
const firstName = name => (name ? String(name).split(' ')[0] : '');
const legalLinks = () => `<a href="${site()}/terms" style="color:#7a808a">Terms</a> · <a href="${site()}/privacy" style="color:#7a808a">Privacy</a>`;

async function accountFoot(email, why) {
  return { html: `${esc(why)} Questions? Just reply to this email. <a href="${esc(await prefsUrl(email))}" style="color:#7a808a">Email preferences</a> · ${legalLinks()}`,
    text: `${why}\nEmail preferences: ${await prefsUrl(email)}` };
}
async function marketingFoot(email, category) {
  const un = await unsubscribeUrl(email), pr = await prefsUrl(email), addr = postalAddress();
  return { html: `You get this because you agreed to ${esc(CATEGORIES[category].label.toLowerCase())} from Options Screener. <a href="${esc(un)}" style="color:#7a808a">Unsubscribe</a> · <a href="${esc(pr)}" style="color:#7a808a">Email preferences</a> · ${legalLinks()}<br>Options Screener, ${esc(addr)}`,
    text: `You get this because you agreed to ${CATEGORIES[category].label.toLowerCase()} from Options Screener.\nUnsubscribe: ${un}\nEmail preferences: ${pr}\nOptions Screener, ${addr}`, un };
}

export async function welcomeEmail(email, name) {
  const f = await accountFoot(email, 'You are receiving this email because you just created an Options Screener account.');
  const items = [
    ['Options flow', 'Live sweeps, blocks and big prints across every US stock, with filters you can save.'],
    ['Option chains', 'Every strike and expiry with Greeks, open interest and volume, centred on the money.'],
    ['Unusual activity', 'Contracts trading far above their open interest, flagged as they happen.'],
    ['Watchlist and alerts', 'Star contracts to follow them and keep your filters for next time.'],
  ];
  const html = layout('Welcome to Options Screener', `${p(hi(name))}${p('Your account is ready. Here is where to start:')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px">${items.map(([k, v]) => `<tr><td style="padding:8px 0;border-top:1px solid #e3e5e9;font-size:14px"><b>${esc(k)}</b><br><span style="color:#6b717c">${esc(v)}</span></td></tr>`).join('')}</table>
${btn(site() + '/', 'Open Options Screener')}${p('<span style="color:#6b717c;font-size:13px">Tip: type any ticker in the search box, then switch between Flow, Chain and Unusual.</span>')}`, f.html);
  const text = `${hi(name)}\n\nYour account is ready. Here is where to start:\n\n${items.map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\nOpen Options Screener: ${site()}/\n\n${f.text}`;
  return { subject: 'Welcome to Options Screener', html, text };
}
export async function paymentFailedEmail(email, name) {
  const f = await accountFoot(email, 'You are receiving this email because you have an Options Screener Pro subscription.');
  const url = `${site()}/api/billing?a=portal`;
  const html = layout('Your payment did not go through', `${p(hi(name))}${p('We could not take this month\'s payment for Options Screener Pro. This usually means the card expired or the bank declined it.')}
${p('Pro stays on while Paddle, our reseller, retries the card over the next few days. To keep it without a break, update your card:')}${btn(url, 'Update card')}
${p('<span style="color:#6b717c;font-size:13px">You will be asked to sign in first. If you meant to cancel, you can ignore this email.</span>')}`, f.html);
  const text = `${hi(name)}\n\nWe could not take this month's payment for Options Screener Pro. This usually means the card expired or the bank declined it.\n\nPro stays on while Paddle, our reseller, retries the card over the next few days. To keep it without a break, update your card: ${url}\n\nIf you meant to cancel, you can ignore this email.\n\n${f.text}`;
  return { subject: 'Action needed: your Options Screener payment did not go through', html, text };
}
export async function checkinEmail(email, name, reason) {
  const f = await marketingFoot(email, 'checkin');
  const lead = reason === 'cancelled'
    ? 'It has been a while since you left Pro, so here is a quick look at what Options Screener does today.'
    : 'It has been a while since you last opened Options Screener, so here is a quick look at what it does today.';
  const items = ['Live options flow for every US stock, with saved filters', 'Full option chains with Greeks, centred on the money', 'Unusual activity flagged as it happens', 'A community where Pro members share trade ideas'];
  const html = layout('A quick check-in', `${p(hi(name))}${p(esc(lead))}<ul style="margin:0 0 12px;padding-left:20px">${items.map(i => `<li style="margin:0 0 6px">${esc(i)}</li>`).join('')}</ul>
${btn(site() + '/', 'Open Options Screener')}${p('If something was missing or did not work for you, reply to this email. We read every reply.')}`, f.html);
  const text = `${hi(name)}\n\n${lead}\n\n${items.map(i => '- ' + i).join('\n')}\n\nOpen Options Screener: ${site()}/\n\nIf something was missing or did not work for you, reply to this email. We read every reply.\n\n${f.text}`;
  return { subject: firstName(name) ? `${firstName(name)}, a quick check-in from Options Screener` : 'A quick check-in from Options Screener', html, text, unsub: f.un };
}
// Campaign body: plain text. Blank line = new paragraph, "- " = bullet, URLs become links.
export function renderBody(body) {
  const link = s => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, u => `<a href="${u}" style="color:#1d2026">${u}</a>`);
  return String(body).replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) return `<ul style="margin:0 0 12px;padding-left:20px">${lines.map(l => `<li style="margin:0 0 6px">${link(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    return p(lines.map(link).join('<br>'));
  }).join('');
}
export async function campaignEmail(email, name, c) {
  const f = await marketingFoot(email, c.category || 'news');
  const html = layout(c.subject, `${p(hi(name))}${renderBody(c.body)}${btn(site() + '/', 'Open Options Screener')}`, f.html);
  const text = `${hi(name).replace(/&#39;/g, "'")}\n\n${String(c.body).trim()}\n\nOpen Options Screener: ${site()}/\n\n${f.text}`;
  return { subject: c.subject, html, text, unsub: f.un };
}
const unsubHeaders = un => ({ 'List-Unsubscribe': `<${un}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

/* ---------- sending ---------- */
const nameOf = async email => { if (!storeConfigured()) return ''; try { const [g, n] = await pipe([['HGET', `os:u:${email}`, 'givenName'], ['HGET', `os:u:${email}`, 'name']]); return g || n || ''; } catch { return ''; } };
const countryOf = async email => { if (!storeConfigured()) return ''; try { return (await cmd(['HGET', `os:u:${email}`, 'country'])) || ''; } catch { return ''; } };

// Why an email to this person in this category may not go out (null = it may).
export async function blockReason(email, category) {
  if (!mailConfigured()) return 'mail not configured';
  const pr = await getPrefs(email);
  if (pr.suppressed && pr.suppressed !== 'unsubscribed') return pr.suppressed; // bounced or complained: nothing at all
  if (category === 'account') return null;
  if (pr.suppressed === 'unsubscribed' || !pr[category]) return 'no consent';
  if (!postalAddress()) return 'postal address not set';
  if (!iysRegistered() && (await countryOf(email)) === 'TR') return 'IYS registration needed for Türkiye';
  return null;
}
// Logs an email sent elsewhere (payment receipts).
export async function recordSend(email, { kind, category = 'account', subject = '', dedupe = null, providerId = null, status = 'sent', error = '' }) {
  if (!dbConfigured()) return;
  try {
    await ensureMail();
    await exec([{ query: `insert into em_sends (email, kind, category, subject, dedupe, provider_id, status, error) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (dedupe) do nothing`,
      params: [lc(email), kind, category, subject, dedupe, providerId, status, String(error).slice(0, 300)] }]);
  } catch { /* logging must never break a payment webhook */ }
}
// Sends one email at most once per dedupe key, and records the outcome.
export async function deliver(email, { kind, category, dedupe, campaignId = null, build }) {
  email = lc(email);
  await ensureMail();
  const why = await blockReason(email, category);
  if (why) { await exec([{ query: `insert into em_sends (email, kind, category, status, error, campaign_id) values ($1, $2, $3, 'skipped', $4, $5)`, params: [email, kind, category, why, campaignId] }]); return { skipped: why }; }
  const row = await one(`insert into em_sends (email, kind, category, dedupe, campaign_id, status) values ($1, $2, $3, $4, $5, 'sending') on conflict (dedupe) do nothing returning id`, [email, kind, category, dedupe, campaignId]);
  if (!row) return { skipped: 'already sent' };
  try {
    const m = await build(email, await nameOf(email));
    const r = await sendMail({ to: email, subject: m.subject, html: m.html, text: m.text, headers: m.unsub ? unsubHeaders(m.unsub) : undefined });
    await exec([{ query: `update em_sends set status = 'sent', subject = $2, provider_id = $3 where id = $1`, params: [row.id, m.subject, r.id || null] }]);
    return { sent: true, id: r.id };
  } catch (e) {
    // Free the dedupe key so a retry can send it.
    await exec([{ query: `update em_sends set status = 'failed', error = $2, dedupe = null where id = $1`, params: [row.id, String(e.message).slice(0, 300)] }]);
    throw e;
  }
}

export const sendWelcome = email => deliver(email, { kind: 'welcome', category: 'account', dedupe: `welcome:${lc(email)}`, build: welcomeEmail });
export const sendPaymentFailed = (email, subId, period) =>
  deliver(email, { kind: 'payment_failed', category: 'account', dedupe: `pastdue:${subId}:${String(period || '').slice(0, 10)}`, build: paymentFailedEmail });

/* ---------- check-ins ---------- */
export async function checkinsOn() { await ensureMail(); const m = await one(`select v from em_meta where k = 'checkins'`); return !m || m.v !== 'off'; }
export async function setCheckins(on) { await ensureMail(); await exec([{ query: `insert into em_meta (k, v) values ('checkins', $1) on conflict (k) do update set v = excluded.v, at = now()`, params: [on ? 'on' : 'off'] }]); return on; }

// People due a check-in: agreed to check-ins, not on Pro, cancelled or inactive for 90+ days,
// no check-in in the last 90 days and fewer than 4 so far.
export async function dueCheckins(now = Date.now(), planFor) {
  await ensureMail();
  const day = 864e5, cutoff = now - CHECKIN.everyDays * day;
  const people = await rows(`select p.email,
      (select max(at) from em_sends s where s.email = p.email and s.kind = 'checkin' and s.status = 'sent') as last_checkin,
      (select count(*) from em_sends s where s.email = p.email and s.kind = 'checkin' and s.status = 'sent')::int as checkins
    from em_prefs p where p.checkin and not exists (select 1 from em_suppressions x where x.email = p.email)`);
  const out = [];
  for (const r of people) {
    if (r.checkins >= CHECKIN.max || (r.last_checkin && Date.parse(r.last_checkin) > cutoff)) continue;
    let u = {}, sub = null;
    if (storeConfigured()) {
      const [h, s] = await pipe([['HMGET', `os:u:${r.email}`, 'first', 'last'], ['GET', `os:sub:${r.email}`]]);
      u = { first: +(h && h[0]) || 0, last: +(h && h[1]) || 0 }; try { sub = s ? JSON.parse(s) : null; } catch { sub = null; }
    }
    if (!u.first || u.first > cutoff) continue; // account younger than 90 days
    if (planFor && (await planFor(r.email)).plan === 'pro') continue;
    const endedAt = sub && (sub.status === 'canceled' ? Date.parse(sub.updatedAt) : sub.cancelAt && Date.parse(sub.cancelAt) < now ? Date.parse(sub.cancelAt) : 0);
    const reason = endedAt && endedAt <= cutoff ? 'cancelled' : u.last && u.last <= cutoff ? 'inactive' : null;
    if (reason) out.push({ email: r.email, reason, checkins: r.checkins });
    if (out.length >= CHECKIN.perRun) break;
  }
  return out;
}
export async function runCheckins(now = Date.now(), planFor) {
  if (!(await checkinsOn())) return { off: true };
  const due = await dueCheckins(now, planFor);
  const res = { due: due.length, sent: 0, skipped: 0, failed: 0 };
  for (const d of due) {
    try {
      const r = await deliver(d.email, { kind: 'checkin', category: 'checkin', dedupe: `checkin:${d.email}:${d.checkins + 1}`, build: (e, n) => checkinEmail(e, n, d.reason) });
      if (r.sent) res.sent++; else res.skipped++;
    } catch { res.failed++; }
  }
  return res;
}

/* ---------- campaigns (news) ---------- */
const LIM = { subject: 140, body: 8000 };
export async function saveCampaign({ id = null, subject, body }, by = '') {
  await ensureMail();
  subject = String(subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, LIM.subject);
  body = String(body || '').replace(/\r\n?/g, '\n').trim().slice(0, LIM.body);
  if (!subject) throw bad('Write a subject');
  if (!body) throw bad('Write the email');
  if (id) {
    const c = await one(`update em_campaigns set subject = $2, body = $3, updated_at = now() where id = $1 and status = 'draft' returning *`, [+id, subject, body]);
    if (!c) throw bad('Only drafts can be edited', 409);
    return c;
  }
  return one(`insert into em_campaigns (category, subject, body, created_by) values ('news', $1, $2, $3) returning *`, [subject, body, by]);
}
export async function deleteCampaign(id) { await ensureMail(); const c = await one(`delete from em_campaigns where id = $1 and status = 'draft' returning id`, [+id]); if (!c) throw bad('Only drafts can be deleted', 409); return { ok: true }; }
// Who a news email would go to, and who is left out and why.
export async function audience() {
  await ensureMail();
  const list = await rows(`select p.email from em_prefs p where p.news and not exists (select 1 from em_suppressions x where x.email = p.email) order by p.email`);
  const out = { send: [], tr: [] };
  for (const r of list) ((!iysRegistered() && (await countryOf(r.email)) === 'TR') ? out.tr : out.send).push(r.email);
  return out;
}
export async function sendTest(id, to) {
  await ensureMail();
  const c = await one('select * from em_campaigns where id = $1', [+id]);
  if (!c) throw bad('Email not found', 404);
  if (!mailConfigured()) throw bad('Email sending is not configured', 503);
  const m = await campaignEmail(to, await nameOf(to), c);
  const r = await sendMail({ to, subject: '[Test] ' + m.subject, html: m.html, text: m.text });
  await recordSend(to, { kind: 'news_test', category: 'news', subject: '[Test] ' + m.subject, providerId: r.id || null });
  return { ok: true, to };
}
export async function sendCampaign(id, by = '') {
  await ensureMail();
  if (!mailConfigured()) throw bad('Email sending is not configured', 503);
  if (!postalAddress()) throw bad('Add MAIL_POSTAL_ADDRESS in Vercel first: marketing emails must show a postal address.', 409);
  const c = await one(`update em_campaigns set status = 'sending', sent_by = $2 where id = $1 and status = 'draft' returning *`, [+id, by]);
  if (!c) throw bad('This email was already sent', 409);
  const a = await audience();
  let sent = 0, failed = 0;
  const skipped = a.tr.length;
  if (a.tr.length) await exec(a.tr.map(e => ({ query: `insert into em_sends (email, kind, category, subject, campaign_id, status, error) values ($1, 'news', 'news', $2, $3, 'skipped', 'IYS registration needed for Türkiye')`, params: [e, c.subject, c.id] })));
  for (let i = 0; i < a.send.length; i += 100) {
    const chunk = a.send.slice(i, i + 100);
    const ids = await rows(`insert into em_sends (email, kind, category, subject, campaign_id, dedupe, status)
      select e, 'news', 'news', $1::text, $2::bigint, 'camp:' || $2::text || ':' || e, 'sending' from unnest($3::text[]) as e on conflict (dedupe) do nothing returning id, email`,
      [c.subject, c.id, '{' + chunk.map(e => '"' + e.replace(/["\\]/g, '') + '"').join(',') + '}']);
    if (!ids.length) continue;
    const msgs = [];
    for (const r of ids) { const m = await campaignEmail(r.email, await nameOf(r.email), c); msgs.push({ to: r.email, subject: m.subject, html: m.html, text: m.text, headers: unsubHeaders(m.unsub) }); }
    try {
      const out = await sendBatch(msgs);
      await exec(ids.map((r, k) => ({ query: `update em_sends set status = 'sent', provider_id = $2 where id = $1`, params: [r.id, (out[k] && out[k].id) || null] })));
      sent += ids.length;
    } catch (e) {
      await exec(ids.map(r => ({ query: `update em_sends set status = 'failed', error = $2 where id = $1`, params: [r.id, String(e.message).slice(0, 300)] })));
      failed += ids.length;
    }
  }
  return one(`update em_campaigns set status = 'sent', sent_at = now(), recipients = $2, sent = $3, failed = $4, skipped = $5 where id = $1 returning *`,
    [c.id, a.send.length + a.tr.length, sent, failed, skipped]);
}

/* ---------- bounces and complaints (Resend webhook, signed the Svix way) ---------- */
export async function verifyResendWebhook(raw, h, secret = process.env.RESEND_WEBHOOK_SECRET, now = Date.now()) {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  if (Math.abs(now / 1000 - Number(h.timestamp)) > 300) return false;
  const keyBytes = Uint8Array.from(atob(String(secret).replace(/^whsec_/, '')), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h.id}.${h.timestamp}.${raw}`)));
  const want = btoa(String.fromCharCode(...sig));
  return String(h.signature).split(' ').some(s => s.split(',')[1] === want);
}
export async function onResendEvent(evt) {
  const t = String(evt && evt.type || ''), d = (evt && evt.data) || {};
  const to = [].concat(d.to || []).map(lc).filter(validEmail);
  if (t === 'email.bounced') {
    const hard = !d.bounce || !/transient|soft/i.test(String(d.bounce.type || ''));
    if (hard) for (const e of to) await suppress(e, 'bounced', (d.bounce && d.bounce.message) || '');
    return { suppressed: hard ? to.length : 0 };
  }
  if (t === 'email.complained') {
    for (const e of to) { await setConsent(e, Object.fromEntries(MARKETING.map(c => [c, false])), { source: 'spam complaint' }); await suppress(e, 'complained', 'Marked as spam'); }
    return { suppressed: to.length };
  }
  return { ignored: t };
}

/* ---------- the person's own data, and the admin view ---------- */
export async function exportMail(email) {
  if (!dbConfigured()) return null;
  email = lc(email); await ensureMail();
  return {
    preferences: await getPrefs(email),
    consentHistory: await rows(`select c.category, c.granted, c.source, c.ip, c.text_version, t.text as wording, c.at from em_consents c left join em_consent_texts t on t.version = c.text_version where c.email = $1 order by c.at`, [email]),
    emailsSent: await rows(`select kind, category, subject, status, at from em_sends where email = $1 order by at`, [email]),
  };
}
export async function deleteMail(email) {
  if (!dbConfigured()) return;
  email = lc(email); await ensureMail();
  const q = sql => ({ query: sql, params: [email] });
  await exec([q('delete from em_consents where email = $1'), q('delete from em_prefs where email = $1'), q('delete from em_sends where email = $1'),
    q(`delete from em_suppressions where email = $1 and reason = 'unsubscribed'`)]);
}
export async function userMail(email) {
  if (!dbConfigured()) return null;
  email = lc(email); await ensureMail();
  return {
    prefs: await getPrefs(email),
    consents: await rows(`select category, granted, source, ip, text_version, at from em_consents where email = $1 order by at desc limit 20`, [email]),
    sends: await rows(`select kind, subject, status, error, at from em_sends where email = $1 order by at desc limit 20`, [email]),
  };
}
export async function mailOverview(planFor) {
  await ensureMail();
  const s = await one(`select
      (select count(*) from em_prefs p where p.news and not exists (select 1 from em_suppressions x where x.email = p.email))::int as news,
      (select count(*) from em_prefs p where p.checkin and not exists (select 1 from em_suppressions x where x.email = p.email))::int as checkin,
      (select count(*) from em_suppressions)::int as suppressed,
      (select count(*) from em_sends where status = 'sent' and at > now() - interval '30 days')::int as sent30,
      (select count(*) from em_sends where status = 'failed' and at > now() - interval '30 days')::int as failed30,
      (select count(*) from em_consents)::int as consent_events`);
  const a = await audience();
  return {
    config: { mail: mailConfigured(), postal: !!postalAddress(), iys: iysRegistered(), bounces: !!process.env.RESEND_WEBHOOK_SECRET },
    stats: s, audience: { send: a.send.length, tr: a.tr.length },
    checkins: { on: await checkinsOn(), due: (await dueCheckins(Date.now(), planFor)).length, everyDays: CHECKIN.everyDays, max: CHECKIN.max },
    categories: CATEGORIES,
    campaigns: await rows(`select id, subject, body, status, created_by, created_at, updated_at, sent_at, recipients, sent, failed, skipped from em_campaigns order by id desc limit 50`),
    recent: await rows(`select email, kind, category, subject, status, error, at from em_sends order by id desc limit 100`),
    suppressions: await rows(`select email, reason, detail, at from em_suppressions order by at desc limit 100`),
  };
}
