export function GET() {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Çıkış yapıldı</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#1a1a1a">
<h1 style="font-size:18px;font-weight:600">Çıkış yapıldı</h1><p><a href="/api/auth/login">Google ile tekrar giriş yap</a></p></body>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
