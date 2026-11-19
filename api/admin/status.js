import { getSession, json } from '../../lib/session.js';
import { isAdminEmail, getVerifiedAdmin, getTotpSecret } from '../../lib/admin.js';
import { storeConfigured } from '../../lib/store.js';

// What the admin page shows: no access / set up the authenticator / enter a code / dashboard.
export async function GET(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!isAdminEmail(s.email)) return json({ admin: false, email: s.email });
  const t = await getTotpSecret(s.email);
  return json({
    admin: true, email: s.email, name: s.name || '',
    totpConfigured: !!t, totpSource: t ? t.source : null,
    verified: !!(await getVerifiedAdmin(request)),
    store: storeConfigured(),
  });
}
