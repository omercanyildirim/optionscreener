// Routing Middleware: the app and every API call require a Google sign-in session.
// Public (for visitors and search engines): the home page, guides, legal pages, sign-in, and static assets.
// "/" shows the app to signed-in users and the public home page (home.html) to everyone else.
import { getSession, json } from './lib/session.js';

export const config = {
  matcher: ['/((?!api/auth/|api/paddle-webhook|login|js/login\\.js|js/feats\\.js|privacy|terms|refund|pricing|unsubscribe|home|options-flow|options-screener|option-chain|unusual-options-activity|0dte-options|put-call-ratio|open-interest-vs-volume|implied-volatility|css/|og\\.png|icon-|apple-touch-icon|site\\.webmanifest|sitemap\\.xml|favicon|robots\\.txt|[0-9a-f]{32}\\.txt|\\.well-known/).*)'],
};

// Probes for files and admin panels this site does not have (also blocked at the edge by the Vercel Firewall).
const SCANNER = /(\.(php|asp|aspx|jsp|cgi|env|git|svn|htaccess|htpasswd|bak|sql|ini|log|DS_Store)(\/|$)|\/wp-|\/wordpress|\/phpmyadmin|\/xmlrpc|\/cgi-bin|\/\.aws|\/\.ssh|\/\.git|\/vendor\/|\/actuator|\/server-status|\/owa\/|\/autodiscover|\/boaform|\/HNAP1)/i;

export default async function middleware(request) {
  const url = new URL(request.url);
  if (SCANNER.test(url.pathname)) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=3600' } });
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
