// Per-user storage in Redis (Upstash, added from the Vercel Marketplace).
// Uses Upstash's REST API directly, so no extra package is needed.
// Vercel sets KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*) when the store is connected.

const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeConfigured = () => !!(url() && token());
const key = email => `os:user:${String(email).toLowerCase()}`;

async function cmd(args) {
  const res = await fetch(url(), {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  let j = {};
  try { j = await res.json(); } catch {}
  if (!res.ok || j.error) throw new Error(j.error || `Redis HTTP ${res.status}`);
  return j.result;
}

export async function getUserData(email) {
  const v = await cmd(['GET', key(email)]);
  return v ? JSON.parse(v) : null;
}

export async function setUserData(email, data) {
  await cmd(['SET', key(email), JSON.stringify(data)]);
}

// ---------- validation ----------
export const LIMITS = { presets: 50, presetBytes: 12000, tracked: 50, watchChars: 400, totalBytes: 256000 };
const OPT = /^O:[A-Z.]{1,6}\d{6}[CP]\d{8}$/;

function plainObject(o) {
  return o && typeof o === 'object' && !Array.isArray(o);
}

export function sanitizeUserData(input) {
  if (!plainObject(input)) throw new Error('Geçersiz veri');
  const out = { presets: [], tracked: [], watch: '', defaultPreset: null };

  if (input.presets !== undefined) {
    if (!Array.isArray(input.presets)) throw new Error('presets bir liste olmalı');
    if (input.presets.length > LIMITS.presets) throw new Error(`En fazla ${LIMITS.presets} filtre kaydedilebilir`);
    const ids = new Set();
    for (const p of input.presets) {
      if (!plainObject(p)) throw new Error('Geçersiz filtre');
      const id = String(p.id || '').slice(0, 40);
      const name = String(p.name || '').trim().slice(0, 60);
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || ids.has(id)) throw new Error('Geçersiz filtre kimliği');
      if (!name) throw new Error('Filtre adı boş olamaz');
      const flow = plainObject(p.flow) ? p.flow : {};
      const screener = plainObject(p.screener) ? p.screener : {};
      if (JSON.stringify({ flow, screener }).length > LIMITS.presetBytes) throw new Error(`"${name}" filtresi çok büyük`);
      ids.add(id);
      out.presets.push({ id, name, flow, screener, updatedAt: Number(p.updatedAt) || Date.now() });
    }
  }
  if (input.tracked !== undefined) {
    if (!Array.isArray(input.tracked)) throw new Error('tracked bir liste olmalı');
    out.tracked = [...new Set(input.tracked.map(String).filter(t => OPT.test(t)))].slice(0, LIMITS.tracked);
  }
  if (input.watch !== undefined) out.watch = String(input.watch).toUpperCase().replace(/[^A-Z0-9., ]/g, '').slice(0, LIMITS.watchChars);
  if (input.defaultPreset != null) {
    const d = String(input.defaultPreset);
    out.defaultPreset = out.presets.some(p => p.id === d) ? d : null;
  }
  if (JSON.stringify(out).length > LIMITS.totalBytes) throw new Error('Veri çok büyük');
  return out;
}
