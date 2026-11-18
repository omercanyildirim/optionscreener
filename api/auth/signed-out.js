export function GET() {
  return new Response(null, { status: 302, headers: { location: '/login?cikis=1', 'cache-control': 'no-store' } });
}
