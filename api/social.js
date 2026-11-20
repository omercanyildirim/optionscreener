// Community API for Pro members. GET reads, POST writes. Every call needs a signed-in Pro member.
//   GET  ?a=me | ?a=check&u= | ?a=feed&scope=all|following|ticker|user&arg=&before= | ?a=post&id= | ?a=user&u=
//   POST ?a=profile {username, displayName, bio} | ?a=post {body, parentId} | ?a=delete {id} | ?a=like {id, on}
//        ?a=follow {username, on} | ?a=report {id, reason}
import { getSession, json } from '../lib/session.js';
import { planFor, paywallOn } from '../lib/billing.js';
import { storeConfigured, cmd } from '../lib/store.js';
import { logEvent } from '../lib/activity.js';
import * as S from '../lib/social.js';

async function member(request) {
  const s = await getSession(request);
  if (!s) return { res: json({ error: 'unauthorized' }, 401) };
  if (paywallOn()) {
    const p = await planFor(s.email);
    if (p.plan !== 'pro') return { res: json({ error: 'pro_required', message: 'The community is part of Pro.' }, 402) };
  }
  return { s };
}
const fail = e => json({ error: e.message || 'Something went wrong' }, e.status && e.status < 600 ? e.status : 500);

export async function GET(request) {
  const { s, res } = await member(request); if (res) return res;
  const q = new URL(request.url).searchParams, a = q.get('a') || '';
  try {
    if (a === 'me') return json({ me: await S.getMe(s.email), limits: S.LIMITS });
    if (a === 'check') return json(await S.usernameFree(q.get('u'), s.email));
    if (a === 'feed') return json(await S.feed(s.email, { scope: q.get('scope') || 'all', arg: q.get('arg') || '', before: q.get('before') }));
    if (a === 'post') return json(await S.thread(s.email, q.get('id')));
    if (a === 'user') {
      const profile = await S.getProfile(s.email, q.get('u'));
      return json({ profile, ...(await S.feed(s.email, { scope: 'user', arg: profile.username, before: q.get('before') })) });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) { return fail(e); }
}

export async function POST(request) {
  const { s, res } = await member(request); if (res) return res;
  const a = new URL(request.url).searchParams.get('a') || '';
  let b = {}; try { b = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  try {
    if (a === 'profile') {
      let avatar = '';
      if (storeConfigured()) { try { avatar = (await cmd(['HGET', `os:u:${String(s.email).toLowerCase()}`, 'picture'])) || ''; } catch {} }
      const before = await S.getMe(s.email);
      const me = await S.saveProfile(s.email, { username: b.username, displayName: b.displayName, bio: b.bio }, avatar);
      if (!before || before.username !== me.username) await logEvent(s.email, 'community', before ? `Username changed to @${me.username}` : `Joined the community as @${me.username}`);
      return json({ me });
    }
    if (a === 'post') {
      const post = await S.createPost(s.email, { body: b.body, parentId: b.parentId || null });
      await logEvent(s.email, 'community', `${post.parent_id ? 'Replied' : 'Posted'}: ${post.body.slice(0, 80)}`);
      return json({ post });
    }
    if (a === 'delete') return json(await S.deletePost(s.email, b.id));
    if (a === 'like') return json(await S.like(s.email, b.id, !!b.on));
    if (a === 'follow') return json({ profile: await S.follow(s.email, b.username, !!b.on) });
    if (a === 'report') { const r = await S.report(s.email, b.id, b.reason); await logEvent(s.email, 'community', `Reported post #${b.id}`); return json(r); }
    return json({ error: 'unknown action' }, 400);
  } catch (e) { return fail(e); }
}
