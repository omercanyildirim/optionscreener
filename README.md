# Options Screener

Massive (eski adıyla Polygon.io) verisiyle çalışan, Google ile giriş yapılan opsiyon tarayıcısı. Vercel'de çalışır.

- **Zincir:** Seçili vade için call/put tablosu, birkaç saniyede bir otomatik yenilenir.
- **Tarayıcı:** DTE, delta, OI, hacim, spread, IV ve olağandışı hacim filtreleri.
- **Takip:** ☆ ile işaretlenen kontratlar hisse bazında gruplanır ve sürekli güncellenir (en fazla 50).
- **Hisseler:** İzleme listesindeki ABD hisselerinin anlık fiyatları.
- **Grafikler:** IV eğrisi, strike bazında açık pozisyon ve hacim.

Massive API anahtarı yalnızca sunucuda (Vercel ortam değişkeni) durur; tarayıcıya hiç gönderilmez. Siteye sadece `ALLOWED_EMAILS` listesindeki Google hesapları girebilir.

## Yapı

| Dosya | Görev |
|---|---|
| `public/index.html` | Arayüz (derleme adımı yok) |
| `middleware.js` | Her sayfa ve API isteğinde oturum kontrolü |
| `api/auth/*` | Google ile giriş, çıkış |
| `api/massive.js` | Massive'e sunucu tarafı proxy (yalnız izinli uç noktalar) |
| `api/tracked.js` | Takip edilen kontratların anlık verisi |
| `api/config.js` | Oturum bilgisi ve yenileme aralığı |
| `lib/` | Oturum imzalama, Massive yardımcıları |

Bağımlılık yok; `npm test` ile sunucu testleri çalışır.

## Kurulum

### 1. Google OAuth istemcisi

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID** → *Web application*.
2. **Authorized redirect URIs** alanına ekle: `https://<site-adresin>/api/auth/callback`
   (Örn. `https://optionscreener.vercel.app/api/auth/callback`.)
3. Çıkan **Client ID** ve **Client secret** değerlerini bir sonraki adımda kullan.

### 2. Vercel ortam değişkenleri

Vercel → Project → Settings → Environment Variables (Production):

| Değişken | Değer |
|---|---|
| `MASSIVE_API_KEY` | massive.com/dashboard/keys sayfasındaki anahtar |
| `GOOGLE_CLIENT_ID` | 1. adımdan |
| `GOOGLE_CLIENT_SECRET` | 1. adımdan |
| `SESSION_SECRET` | En az 32 karakter rastgele değer (`openssl rand -base64 48`) |
| `ALLOWED_EMAILS` | Girebilecek Google hesapları, virgülle. `*` ise Google hesabı olan herkes girebilir |
| `APP_URL` | Sitenin kalıcı adresi, Google'a girdiğin yönlendirme adresiyle aynı alan adı |
| `POLL_MS` | İsteğe bağlı, yenileme aralığı (ms). Varsayılan 2000 |

Değişkenleri ekledikten sonra yeniden deploy et.

### 3. Deploy

Repo Vercel'e bağlıysa `main` dalına her push otomatik deploy olur. Ayar gerekmez: `vercel.json` statik dosyaları `public/` klasöründen, fonksiyonları `api/` klasöründen alır.

## Veri gecikmesi

Opsiyon zinciri anlık görüntüsü Options Starter/Developer planlarında 15 dk gecikmeli, Options Advanced'ta gerçek zamanlıdır. Hisse fiyatları için ayrıca Stocks planı gerekir. Sayfa, gelen verinin gecikmeli olup olmadığını üst köşede gösterir.

Vercel fonksiyonları kalıcı WebSocket bağlantısı tutamadığı için veri sunucu üzerinden `POLL_MS` aralığında yenilenir. Sekme arka plandayken yenileme durur.

## Yerelde önizleme

`public/index.html` dosyasını doğrudan tarayıcıda açınca (ya da sonuna `?demo` ekleyince) sahte veriyle demo modunda çalışır.

## Kullanıcı verileri (kayıtlı filtreler, takip listesi)

Her kullanıcının kayıtlı filtreleri, takip ettiği kontratlar ve izleme listesi Upstash Redis'te `os:user:<e-posta>` anahtarında saklanır (`api/userdata.js`). Vercel → Storage → **Upstash for Redis** ile bir veritabanı oluşturup bu projeye bağlamak yeterli; Vercel `KV_REST_API_URL` ve `KV_REST_API_TOKEN` değişkenlerini otomatik ekler. Veritabanı bağlı değilse site çalışmaya devam eder, kayıtlar o tarayıcıda tutulur.

## Akış (flow) verisi

- `DEMO_DATA=true` iken akış örnek veriyle üretilir.
- Canlı modda akış, izleme listesindeki hisselerin zincirlerindeki hacim artışlarından türetilir (yaklaşık). Gerçek sweep/split/block sınıflandırması için işlem (trade) verisi gerekir: Massive Options Developer veya Advanced planı ve sürekli çalışan ayrı bir dinleyici servis.

## Haberler ve içgörü drawer'ı (Exa)

Akışta, zincirde, tarayıcıda, takip listesinde ya da hisseler sayfasında bir satıra tıklayınca sağdan içgörü drawer'ı açılır: hesaplanan içgörüler, vade sonu kâr/zarar grafiği, o kontrattaki işlemler ve ilgili haberler. Haberler `api/news.js` üzerinden [Exa](https://exa.ai) ile çekilir (`category: news`, son 14 gün) ve kısa bir Türkçe özet için Exa `/answer` kullanılır. Sonuçlar sembol başına 15 dk önbelleğe alınır.

Kurulum: Vercel → Marketplace → **Exa** ile projeye bağla (faturalama Vercel üzerinden). Projede `EXA_API_KEY` ortam değişkeni bulunmalı; yoksa Exa panelinden alınan anahtarı bu adla ekle.

## Market data: Alpaca (recommended)

Add these in Vercel → Settings → Environment Variables, then redeploy:

| Variable | Value |
|---|---|
| `ALPACA_KEY_ID` | API key ID from your Alpaca dashboard (a free paper account is enough) |
| `ALPACA_SECRET_KEY` | API secret |
| `ALPACA_STOCK_FEED` | optional: `iex` (free Basic plan, default) or `sip` (Algo Trader Plus) |
| `ALPACA_OPTIONS_FEED` | optional: `indicative` (free) or `opra` (paid); by default Alpaca picks per account |
| `ALPACA_TRADING_URL` | optional: `https://paper-api.alpaca.markets` (default) or `https://api.alpaca.markets` for live keys |

When Alpaca keys are present they are used instead of Massive, and `DEMO_DATA` is ignored.
What you get: every listed US stock/ETF (Stocks → All stocks, refreshed every 90 s), full option chains (all expiries and
strikes) with greeks/IV and open interest, and a flow built from each contract's latest print (sweeps from OPRA ISO
conditions S/b/d, multi-leg from f–t, blocks by size/premium). The free plan allows 200 requests/min, stocks come from IEX
only and option trades from the indicative feed (about 15 minutes delayed).

## Admin portal (`/admin`)

`https://optionscreener.org/admin` shows who signs in and what they do (searches, views, insights, saved filters, watched
contracts), per user and as a live feed.

- Access: Google sign-in with an address listed in `ADMIN_EMAILS` (comma-separated, set in Vercel) **and** a Google
  Authenticator code (asked again every 12 hours, 5 wrong codes lock it for 15 minutes, a code cannot be reused).
- First visit: scan the QR code with Google Authenticator and confirm a code. With the database connected the key is
  stored there; without it, the page asks you to save it as `ADMIN_TOTP_SECRET` in Vercel.
- Activity is stored in Upstash Redis (Vercel → Storage). Without it the portal opens but has nothing to show.

## Security

- **Access:** Google sign-in only (`ALLOWED_EMAILS`), admin portal needs `ADMIN_EMAILS` + Google Authenticator.
- **Headers (vercel.json):** strict Content-Security-Policy (no inline scripts; scripts only from this site and two pinned
  cdnjs files), HSTS (2 years, includeSubDomains, preload), X-Frame-Options DENY, nosniff, Referrer-Policy,
  Permissions-Policy, COOP/CORP, `noindex` on `/admin` and `/api`, `robots.txt` disallows everything.
- **App:** cross-site POST/PUT/DELETE to `/api/*` are rejected (Origin / Sec-Fetch-Site), HttpOnly+Secure cookies,
  admin cookie `SameSite=Strict`, keys only on the server, per-user limits on activity logging and news.
- **Vercel Firewall (dashboard → Firewall):** deny common scanner paths (`.env`, `.git`, `wp-*`, `.php`…), rate limit
  `/api/*` to 600 requests/min per IP, Bot Protection = Challenge, AI crawlers and assistants = Deny.
  The Hobby plan allows two custom rules; OWASP managed rules need Enterprise.
- `*.vercel.app` deployment URLs require a Vercel login (only optionscreener.org is public).
