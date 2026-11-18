// Routing Middleware: every page and API call requires a Google sign-in session.
// Public: the login page, privacy/terms pages and the sign-in routes themselves.
import { getSession, json } from './lib/session.js';

export const config = {
  matcher: ['/((?!api/auth/|login|privacy|terms|favicon\\.ico).*)'],
};

export default async function middleware(request) {
  const session = await getSession(request, process.env);
  if (session) return; // continue to the page / function

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
  const next = url.pathname + url.search;
  const to = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
  return Response.redirect(new URL(to, url), 302);
}
