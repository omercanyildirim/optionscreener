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
| `ALLOWED_EMAILS` | Girebilecek Google hesapları, virgülle |
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
