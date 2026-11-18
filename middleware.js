// Routing Middleware: every page and API call requires a Google sign-in session,
// except the sign-in routes themselves.
import { getSession, json } from './lib/session.js';

export const config = {
  matcher: ['/((?!api/auth/|favicon\\.ico).*)'],
};

export default async function middleware(request) {
  const session = await getSession(request, process.env);
  if (session) return; // continue to the page / function

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
  const next = url.pathname + url.search;
  return Response.redirect(new URL(`/api/auth/login?next=${encodeURIComponent(next)}`, url), 302);
}
