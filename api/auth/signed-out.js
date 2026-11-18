export function GET() {
  return new Response(null, { status: 302, headers: { location: '/login?signedout=1', 'cache-control': 'no-store' } });
}
