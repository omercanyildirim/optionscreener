// Community: a small Twitter-like feed for Pro members, stored in Postgres (lib/db.js).
// Members pick a unique username; posts can mention $TICKERS, get likes and replies; members follow each other;
// anyone can report a post and admins moderate from the admin panel. Emails are never sent to the browser.
import { rows, one, exec, dbConfigured } from './db.js';

export const LIMITS = { body: 500, bio: 160, display: 40, postsPerHour: 30, reportsPerHour: 20, page: 30 };
const RESERVED = new Set(['admin', 'administrator', 'root', 'support', 'help', 'info', 'mod', 'moderator', 'staff', 'team',
  'optionscreener', 'options_screener', 'optionsscreener', 'official', 'system', 'null', 'undefined', 'anonymous', 'everyone', 'me', 'settings', 'api']);

const SCHEMA = [
  `create table if not exists sc_users (
     email text primary key, username text not null unique, display_name text not null default '', bio text not null default '',
     avatar text not null default '', muted boolean not null default false,
     created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
     constraint sc_username_ok check (username ~ '^[a-z0-9_]{3,20}$'))`,
  `create table if not exists sc_posts (
     id bigserial primary key, author text not null references sc_users(email) on delete cascade,
     body text not null check (char_length(body) between 1 and ${LIMITS.body}),
     parent_id bigint references sc_posts(id) on delete cascade, tickers text[] not null default '{}',
     created_at timestamptz not null default now(), deleted_at timestamptz, deleted_by text)`,
  `create index if not exists sc_posts_top on sc_posts (id desc) where deleted_at is null and parent_id is null`,
  `create index if not exists sc_posts_author on sc_posts (author, id desc)`,
  `create index if not exists sc_posts_parent on sc_posts (parent_id, id)`,
  `create index if not exists sc_posts_tickers on sc_posts using gin (tickers)`,
  `create table if not exists sc_likes (
     post_id bigint not null references sc_posts(id) on delete cascade, email text not null references sc_users(email) on delete cascade,
     created_at timestamptz not null default now(), primary key (post_id, email))`,
  `create table if not exists sc_follows (
     follower text not null references sc_users(email) on delete cascade, followee text not null references sc_users(email) on delete cascade,
     created_at timestamptz not null default now(), primary key (follower, followee), check (follower <> followee))`,
  `create index if not exists sc_follows_followee on sc_follows (followee)`,
  `create table if not exists sc_reports (
     id bigserial primary key, post_id bigint not null references sc_posts(id) on delete cascade, reporter text not null,
     reason text not null default '', created_at timestamptz not null default now(),
     resolved_at timestamptz, resolved_by text, action text, unique (post_id, reporter))`,
];
let ready = null;
export function ensureSchema() {
  if (!dbConfigured()) return Promise.reject(Object.assign(new Error('The community database is not connected'), { status: 503 }));
  return (ready ||= exec(SCHEMA).catch(e => { ready = null; throw e; }));
}
export const _resetSchema = () => { ready = null; };

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const lc = s => String(s || '').trim().toLowerCase();
const clean = (s, max) => String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

export function checkUsername(u) {
  u = lc(u).replace(/^@/, '');
  if (!/^[a-z0-9_]{3,20}$/.test(u)) return { ok: false, username: u, reason: 'Use 3 to 20 letters, numbers or underscores.' };
  if (RESERVED.has(u)) return { ok: false, username: u, reason: 'That username is reserved.' };
  return { ok: true, username: u };
}
// $NVDA, $BRK.B -> ['NVDA', 'BRK.B']; at most 10.
export function tickersIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(^|[^\w$])\$([A-Za-z]{1,5}(?:\.[A-Za-z])?)(?![\w.])/g)) { out.add(m[2].toUpperCase()); if (out.size >= 10) break; }
  return [...out];
}
const pgArray = list => '{' + list.map(t => '"' + t.replace(/["\\]/g, '') + '"').join(',') + '}';

/* ---------- profiles ---------- */
const PROFILE = `u.username, u.display_name, u.bio, u.avatar, u.created_at,
  (select count(*)::int from sc_follows f where f.followee = u.email) as followers,
  (select count(*)::int from sc_follows f where f.follower = u.email) as following,
  (select count(*)::int from sc_posts p where p.author = u.email and p.deleted_at is null) as posts`;

export async function getMe(email) {
  await ensureSchema();
  return one(`select ${PROFILE}, u.muted from sc_users u where u.email = $1`, [lc(email)]);
}
export async function usernameFree(username, email = '') {
  const c = checkUsername(username); if (!c.ok) return c;
  await ensureSchema();
  const r = await one(`select email from sc_users where username = $1`, [c.username]);
  return r && r.email !== lc(email) ? { ok: false, username: c.username, reason: 'That username is taken.' } : c;
}
export async function saveProfile(email, { username, displayName, bio }, avatar = '') {
  const c = await usernameFree(username, email); if (!c.ok) throw bad(c.reason, c.reason.includes('taken') ? 409 : 400);
  try {
    await rows(`insert into sc_users (email, username, display_name, bio, avatar) values ($1, $2, $3, $4, $5)
      on conflict (email) do update set username = excluded.username, display_name = excluded.display_name, bio = excluded.bio,
        avatar = case when excluded.avatar <> '' then excluded.avatar else sc_users.avatar end, updated_at = now()
      returning email`, [lc(email), c.username, clean(displayName, LIMITS.display), clean(bio, LIMITS.bio), String(avatar || '').slice(0, 500)]);
  } catch (e) { if (/unique|duplicate/i.test(e.message)) throw bad('That username is taken.', 409); throw e; }
  return getMe(email);
}
async function requireMember(email) {
  const me = await getMe(email);
  if (!me) throw bad('Pick a username first.', 409);
  return me;
}
export async function getProfile(viewer, username) {
  await ensureSchema();
  const p = await one(`select ${PROFILE}, (u.email = $2) as me,
      exists(select 1 from sc_follows f where f.follower = $2 and f.followee = u.email) as followed
    from sc_users u where u.username = $1 and (not u.muted or u.email = $2)`, [lc(username).replace(/^@/, ''), lc(viewer)]);
  if (!p) throw bad('No member with that username.', 404);
  return p;
}

/* ---------- posts ---------- */
const POST = `p.id, p.body, p.parent_id, p.tickers, p.created_at,
  u.username, u.display_name, u.avatar,
  (select count(*)::int from sc_likes l where l.post_id = p.id) as likes,
  (select count(*)::int from sc_posts c where c.parent_id = p.id and c.deleted_at is null) as replies,
  exists(select 1 from sc_likes l where l.post_id = p.id and l.email = $1) as liked,
  (p.author = $1) as mine,
  (select pu.username from sc_posts pp join sc_users pu on pu.email = pp.author where pp.id = p.parent_id) as reply_to`;
const VISIBLE = `p.deleted_at is null and (not u.muted or p.author = $1)`;

// scope: 'all' (top-level posts), 'following', 'ticker' (arg = symbol), 'user' (arg = username)
export async function feed(viewer, { scope = 'all', arg = '', before = null, limit = LIMITS.page } = {}) {
  await ensureSchema();
  const params = [lc(viewer)]; const where = [VISIBLE];
  if (scope === 'following') where.push(`p.parent_id is null and (p.author = $1 or p.author in (select followee from sc_follows where follower = $1))`);
  else if (scope === 'ticker') { params.push(String(arg).toUpperCase().replace(/^\$/, '')); where.push(`$${params.length} = any(p.tickers)`); }
  else if (scope === 'user') { params.push(lc(arg).replace(/^@/, '')); where.push(`u.username = $${params.length}`); }
  else where.push('p.parent_id is null');
  if (before) { params.push(Number(before)); where.push(`p.id < $${params.length}`); }
  params.push(Math.min(Math.max(Number(limit) || LIMITS.page, 1), 50));
  const list = await rows(`select ${POST} from sc_posts p join sc_users u on u.email = p.author
    where ${where.join(' and ')} order by p.id desc limit $${params.length}`, params);
  return { posts: list, next: list.length === params[params.length - 1] ? list[list.length - 1].id : null };
}
export async function thread(viewer, id) {
  await ensureSchema();
  const post = await one(`select ${POST} from sc_posts p join sc_users u on u.email = p.author where p.id = $2 and ${VISIBLE}`, [lc(viewer), Number(id)]);
  if (!post) throw bad('This post was removed or does not exist.', 404);
  const replies = await rows(`select ${POST} from sc_posts p join sc_users u on u.email = p.author
    where p.parent_id = $2 and ${VISIBLE} order by p.id asc limit 200`, [lc(viewer), Number(id)]);
  const parent = post.parent_id ? await one(`select ${POST} from sc_posts p join sc_users u on u.email = p.author where p.id = $2 and ${VISIBLE}`, [lc(viewer), post.parent_id]) : null;
  return { post, replies, parent };
}
export async function createPost(email, { body, parentId = null }) {
  const me = await requireMember(email);
  if (me.muted) throw bad('Your account cannot post right now.', 403);
  const text = clean(body, LIMITS.body + 1);
  if (!text) throw bad('Write something first.');
  if (text.length > LIMITS.body) throw bad(`Posts can be up to ${LIMITS.body} characters.`);
  const recent = await one(`select count(*)::int as n from sc_posts where author = $1 and created_at > now() - interval '1 hour'`, [lc(email)]);
  if (recent.n >= LIMITS.postsPerHour) throw bad('You are posting too fast. Try again in a little while.', 429);
  if (parentId) { const p = await one(`select id from sc_posts where id = $1 and deleted_at is null`, [Number(parentId)]); if (!p) throw bad('That post was removed.', 404); }
  const row = await one(`insert into sc_posts (author, body, parent_id, tickers) values ($1, $2, $3, $4::text[]) returning id`,
    [lc(email), text, parentId ? Number(parentId) : null, pgArray(tickersIn(text))]);
  return (await thread(email, row.id)).post;
}
export async function deletePost(email, id, { admin = false } = {}) {
  await ensureSchema();
  const r = await one(`update sc_posts set deleted_at = now(), deleted_by = $2 where id = $1 and deleted_at is null ${admin ? '' : 'and author = $2'} returning id`, [Number(id), lc(email)]);
  if (!r) throw bad('Post not found.', 404);
  return { ok: true };
}
export async function like(email, id, on) {
  await requireMember(email);
  if (on) await rows(`insert into sc_likes (post_id, email) select $1, $2 where exists (select 1 from sc_posts where id = $1 and deleted_at is null) on conflict do nothing returning post_id`, [Number(id), lc(email)]);
  else await rows(`delete from sc_likes where post_id = $1 and email = $2 returning post_id`, [Number(id), lc(email)]);
  return one(`select (select count(*)::int from sc_likes where post_id = $1) as likes, exists(select 1 from sc_likes where post_id = $1 and email = $2) as liked`, [Number(id), lc(email)]);
}
export async function follow(email, username, on) {
  await requireMember(email);
  const t = await one(`select email from sc_users where username = $1`, [lc(username).replace(/^@/, '')]);
  if (!t) throw bad('No member with that username.', 404);
  if (t.email === lc(email)) throw bad('You cannot follow yourself.');
  if (on) await rows(`insert into sc_follows (follower, followee) values ($1, $2) on conflict do nothing returning follower`, [lc(email), t.email]);
  else await rows(`delete from sc_follows where follower = $1 and followee = $2 returning follower`, [lc(email), t.email]);
  return getProfile(email, username);
}
export async function report(email, id, reason) {
  await requireMember(email);
  const n = await one(`select count(*)::int as n from sc_reports where reporter = $1 and created_at > now() - interval '1 hour'`, [lc(email)]);
  if (n.n >= LIMITS.reportsPerHour) throw bad('Too many reports. Try again later.', 429);
  const p = await one(`select id from sc_posts where id = $1 and deleted_at is null`, [Number(id)]);
  if (!p) throw bad('Post not found.', 404);
  await rows(`insert into sc_reports (post_id, reporter, reason) values ($1, $2, $3) on conflict (post_id, reporter) do update set reason = excluded.reason returning id`, [Number(id), lc(email), clean(reason, 300)]);
  return { ok: true };
}

/* ---------- admin ---------- */
export async function adminOverview() {
  await ensureSchema();
  const [stats, reports, recent, members] = await Promise.all([
    one(`select (select count(*)::int from sc_users) as members, (select count(*)::int from sc_posts where deleted_at is null) as posts,
      (select count(*)::int from sc_posts where deleted_at is null and created_at > now() - interval '1 day') as posts_today,
      (select count(*)::int from sc_reports where resolved_at is null) as open_reports, (select count(*)::int from sc_users where muted) as muted`),
    rows(`select r.post_id, count(*)::int as reports, max(r.created_at) as last_at, string_agg(nullif(r.reason, ''), ' | ') as reasons,
        p.body, p.created_at, p.deleted_at, u.username, u.email, u.muted
      from sc_reports r join sc_posts p on p.id = r.post_id join sc_users u on u.email = p.author
      where r.resolved_at is null group by r.post_id, p.body, p.created_at, p.deleted_at, u.username, u.email, u.muted
      order by count(*) desc, max(r.created_at) desc limit 100`),
    rows(`select p.id, p.body, p.created_at, p.parent_id, p.deleted_at, u.username, u.email, u.muted,
        (select count(*)::int from sc_likes l where l.post_id = p.id) as likes
      from sc_posts p join sc_users u on u.email = p.author order by p.id desc limit 100`),
    rows(`select u.username, u.email, u.display_name, u.muted, u.created_at,
        (select count(*)::int from sc_posts p where p.author = u.email and p.deleted_at is null) as posts,
        (select count(*)::int from sc_follows f where f.followee = u.email) as followers
      from sc_users u order by u.created_at desc limit 300`),
  ]);
  return { stats, reports, recent, members };
}
// action: 'delete' (remove the post) or 'dismiss' (keep it); both close the reports.
export async function resolveReports(adminEmail, postId, action) {
  await ensureSchema();
  if (!['delete', 'dismiss'].includes(action)) throw bad('Unknown action');
  if (action === 'delete') await rows(`update sc_posts set deleted_at = now(), deleted_by = $2 where id = $1 and deleted_at is null returning id`, [Number(postId), lc(adminEmail)]);
  await rows(`update sc_reports set resolved_at = now(), resolved_by = $2, action = $3 where post_id = $1 and resolved_at is null returning id`, [Number(postId), lc(adminEmail), action]);
  return { ok: true };
}
export async function setMuted(username, muted) {
  await ensureSchema();
  const r = await one(`update sc_users set muted = $2, updated_at = now() where username = $1 returning username, muted`, [lc(username).replace(/^@/, ''), !!muted]);
  if (!r) throw bad('No member with that username.', 404);
  return r;
}
