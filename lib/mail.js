// Emails sent by the site, through Resend (https://resend.com).
// Env: RESEND_API_KEY  API key from Resend (secret)
//      MAIL_FROM       "Options Screener <info@optionscreener.org>" (domain verified in Resend)
//      MAIL_REPLY_TO   info@optionscreener.org
//      APP_URL         https://optionscreener.org (links in emails)
// Payment emails are transactional (no marketing consent needed). Marketing emails must only go to users who opted in.
import { storeConfigured, cmd } from './store.js';

export const mailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
const site = () => (process.env.APP_URL || 'https://optionscreener.org').replace(/\/$/, '');
const enc = new TextEncoder();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function hmac(msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode((process.env.SESSION_SECRET || '') + ':unsub'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}
// One-click unsubscribe link that works without signing in.
export async function unsubscribeUrl(email) {
  email = String(email).toLowerCase();
  return `${site()}/unsubscribe?e=${encodeURIComponent(email)}&t=${await hmac(email)}`;
}
export async function checkUnsubscribe(email, token) {
  email = String(email || '').toLowerCase();
  if (!email || !token) return null;
  const good = await hmac(email);
  return good.length === String(token).length && good === String(token) ? email : null;
}

export async function sendMail({ to, subject, html, text, headers, attachments }) {
  if (!mailConfigured()) return { skipped: 'mail not configured' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html, text, headers, attachments, reply_to: process.env.MAIL_REPLY_TO || undefined }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message || `Resend HTTP ${res.status}`);
  return { id: j.id };
}

function layout(title, bodyHtml, footHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px 12px;font:15px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d2026">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;border:1px solid #e3e5e9">
<tr><td style="padding:28px 32px 8px;font-weight:600;font-size:15px">Options Screener</td></tr>
<tr><td style="padding:8px 32px 28px"><h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;font-weight:600">${esc(title)}</h1>${bodyHtml}</td></tr>
</table>
<p style="max-width:520px;color:#7a808a;font-size:12px;line-height:1.5;margin:16px auto 0">${footHtml}</p>
</td></tr></table></body></html>`;
}
const fmtMoney = (v, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).format(v || 0);
const fmtDate = d => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// "Your monthly payment was received" - sent once per paid transaction.
export function paymentReceivedEmail({ name, amount, tax, currency, paidAt, nextBill, invoice, method, renewal, invoiceAttached }) {
  const hi = name ? `Hi ${esc(String(name).split(' ')[0])},` : 'Hi,';
  const rows = [
    ['Plan', 'Options Screener Pro, monthly'],
    ['Amount paid', fmtMoney(amount, currency) + (tax ? ` (includes ${fmtMoney(tax, currency)} tax)` : '')],
    ['Paid on', fmtDate(paidAt)],
    method ? ['Payment method', method] : null,
    invoice ? ['Invoice number', invoice] : null,
    nextBill ? ['Next payment', fmtDate(nextBill)] : null,
  ].filter(Boolean);
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3e5e9;margin:18px 0">${rows.map(([k, v]) =>
    `<tr><td style="padding:9px 0;border-bottom:1px solid #e3e5e9;color:#6b717c;font-size:14px">${esc(k)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid #e3e5e9;font-size:14px">${esc(v)}</td></tr>`).join('')}</table>`;
  const lead = renewal ? 'Your monthly payment for Options Screener Pro was received. Thank you for staying with us.' : 'Your payment was received and Options Screener Pro is now active. Thank you for subscribing.';
  const html = layout(renewal ? 'Monthly payment received' : 'Welcome to Pro: payment received', `
<p style="margin:0 0 10px">${hi}</p><p style="margin:0">${lead}</p>${table}
<p style="margin:0 0 20px"><a href="${site()}/" style="display:inline-block;background:#1d2026;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:7px">Open Options Screener</a></p>
<p style="margin:0;color:#6b717c;font-size:13px">${invoiceAttached ? 'Your invoice from Paddle, our reseller, is attached as a PDF.' : 'Paddle, our reseller, emails your official receipt and invoice separately.'} To update your card, download past invoices or cancel, open the account menu in the app and choose Manage subscription and card.</p>`,
  `You are receiving this email because you have an Options Screener Pro subscription. Payments are processed by Paddle.com, our reseller and merchant of record. Questions? Just reply to this email. <a href="${site()}/terms" style="color:#7a808a">Terms</a> · <a href="${site()}/privacy" style="color:#7a808a">Privacy</a> · <a href="${site()}/refund" style="color:#7a808a">Refunds</a>`);
  const text = `${hi}\n\n${lead}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nOpen Options Screener: ${site()}/\n\n${invoiceAttached ? 'Your invoice from Paddle, our reseller, is attached as a PDF.' : 'Paddle, our reseller, emails your official receipt and invoice separately.'} Manage your card or cancel from the account menu in the app (Manage subscription and card).`;
  return { subject: renewal ? 'Your Options Screener payment was received' : 'Welcome to Options Screener Pro: payment received', html, text };
}

// Send the payment email once per transaction (Paddle may deliver the same webhook more than once).
// getInvoice: async () => ({ filename, content(base64) }) or null; the email goes out without it if Paddle has no PDF yet.
export async function sendPaymentEmailOnce(txnId, to, data, getInvoice) {
  if (!mailConfigured() || !storeConfigured() || !to) return { skipped: true };
  const first = await cmd(['SET', `os:mail:txn:${txnId}`, '1', 'NX', 'EX', String(60 * 60 * 24 * 60)]);
  if (first !== 'OK') return { skipped: 'already sent' };
  let inv = null;
  if (getInvoice) { try { inv = await getInvoice(); } catch { inv = null; } }
  try {
    const r = await sendMail({ to, ...paymentReceivedEmail({ ...data, invoiceAttached: !!inv }), attachments: inv ? [inv] : undefined });
    return { ...r, invoice: !!inv };
  }
  catch (e) { await cmd(['DEL', `os:mail:txn:${txnId}`]); throw e; } // let Paddle's retry try again
}
