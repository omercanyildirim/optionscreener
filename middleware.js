// Routing Middleware: the app and every API call require a Google sign-in session.
// Public (for visitors and search engines): the home page, guides, legal pages, sign-in, and static assets.
// "/" shows the app to signed-in users and the public home page (home.html) to everyone else.
import { getSession, json } from './lib/session.js';

export const config = {
  matcher: ['/((?!api/auth/|api/paddle-webhook|login|js/login\\.js|privacy|terms|refund|unsubscribe|home|options-flow|options-screener|option-chain|unusual-options-activity|css/|og\\.png|icon-|apple-touch-icon|site\\.webmanifest|sitemap\\.xml|favicon|robots\\.txt|\\.well-known/).*)'],
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
  // Visitors and crawlers get the public home page at "/" (same URL, so it can rank as the site's home page).
  if (url.pathname === '/') return new Response(null, { headers: { 'x-middleware-rewrite': new URL('/home', url).toString() } });
  const next = url.pathname + url.search;
  const to = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
  return Response.redirect(new URL(to, url), 302);
}
