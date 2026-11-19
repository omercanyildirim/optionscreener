import { json, allowedEmails, adminEmails } from '../../lib/session.js';
import { getVerifiedAdmin } from '../../lib/admin.js';
import { storeConfigured } from '../../lib/store.js';
import { overview, userDetail } from '../../lib/activity.js';
import { alpacaConfigured } from '../../lib/alpaca.js';

// GET /api/admin/overview          -> users + latest activity
// GET /api/admin/overview?email=x  -> one user's activity, saved filters and watched contracts
export async function GET(request) {
  if (!(await getVerifiedAdmin(request))) return json({ error: 'forbidden' }, 403);
  const list = allowedEmails(process.env);
  const site = {
    access: list.includes('*') ? 'Any Google account' : `${list.length} listed account(s)`,
    admins: adminEmails().length,
    provider: alpacaConfigured() ? 'Alpaca' : process.env.MASSIVE_API_KEY ? 'Massive' : 'none',
  };
  if (!storeConfigured()) return json({ store: false, site, users: [], events: [] });
  const email = new URL(request.url).searchParams.get('email');
  try {
    if (email) return json({ store: true, ...(await userDetail(email)) });
    return json({ store: true, site, ...(await overview()) });
  } catch {
    return json({ error: 'Could not read the database' }, 502);
  }
}
