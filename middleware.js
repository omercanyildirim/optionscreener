// Routing Middleware: every page and API call requires a Google sign-in session.
// Public: the login page, privacy/terms pages and the sign-in routes themselves.
import { getSession, json } from './lib/session.js';

export const config = {
  matcher: ['/((?!api/auth/|api/paddle-webhook|login|js/login\\.js|privacy|terms|refund|unsubscribe|favicon\\.ico|robots\\.txt|\\.well-known/).*)'],
};

export default async function middleware(request) {
  const url = new URL(request.url);
  // Paddle's webhook: no session, verified by its signature inside the function.
  if (request.method === 'POST' && (url.pathname === '/api/paddle-webhook' || (url.pathname === '/api/billing' && url.searchParams.get('a') === 'webhook'))) return;
  // Cross-site request forgery: state-changing API calls must come from this site's own pages.
  if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    if ((origin && origin !== url.origin) || (site && !['same-origin', 'none'].includes(site))) {
      return json({ error: 'cross-site request blocked' }, 403);
    }
  }
  const session = await getSession(request, process.env);
  if (session) return; // continue to the page / function

  if (url.pathname.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
  const next = url.pathname + url.search;
  const to = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
  return Response.redirect(new URL(to, url), 302);
}
