// Community: the members' feed inside the app (Pro). Talks to /api/social. Plain DOM, no framework.
(() => {
  const root = document.getElementById('v-community'); if (!root) return;
  const $c = s => root.querySelector(s);
  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const MAX = 500;
  let ME = null, LOADED = false, ROUTE = { kind: 'feed', scope: 'all' }, NEXT = null, BUSY = false;

  async function api(a, params = {}, body) {
    const q = new URLSearchParams({ a, ...params }).toString();
    const r = await fetch('/api/social?' + q, body ? { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 401) { location.href = '/login?next=/'; throw new Error('Session expired'); }
    if (!r.ok) { const e = new Error(j.message || j.error || 'Something went wrong'); e.status = r.status; throw e; }
    return j;
  }

  /* ---------- formatting ---------- */
  function ago(t) {
    const s = (Date.now() - Date.parse(t)) / 1000;
    if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h';
    const d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  }
  function avatar(p, big) {
    const a = h('span', 'cm-av' + (big ? ' big' : ''));
    if (p.avatar && /^https:\/\//.test(p.avatar)) { const i = h('img'); i.src = p.avatar; i.alt = ''; i.referrerPolicy = 'no-referrer'; i.onerror = () => { i.remove(); a.textContent = (p.display_name || p.username || '?')[0].toUpperCase(); }; a.append(i); }
    else a.textContent = (p.display_name || p.username || '?')[0].toUpperCase();
    return a;
  }
  // Text with clickable $TICKERS and @usernames; everything else stays plain text.
  function richText(text) {
    const f = document.createDocumentFragment(), re = /(^|[^\w$@])(\$[A-Za-z]{1,5}(?:\.[A-Za-z])?|@[A-Za-z0-9_]{3,20})(?![\w.])/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      const start = m.index + m[1].length; f.append(text.slice(last, start));
      const tok = m[2], b = h('button', 'cm-tok', tok);
      b.onclick = e => { e.stopPropagation(); tok[0] === '$' ? go({ kind: 'ticker', arg: tok.slice(1).toUpperCase() }) : go({ kind: 'user', arg: tok.slice(1).toLowerCase() }); };
      f.append(b); last = start + tok.length;
    }
    f.append(text.slice(last)); return f;
  }
  const ICON = {
    reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-5-5-8 8.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  };
  const iconBtn = (cls, svg, label) => { const b = h('button', cls); b.innerHTML = svg; b.setAttribute('aria-label', label); b.title = label; return b; };
  function toast(msg, err) { const t = $c('.cm-toast'); t.textContent = msg; t.className = 'cm-toast on' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'cm-toast'), 3200); }

  /* ---------- a post ---------- */
  function postEl(p, { focus = false } = {}) {
    const art = h('article', 'cm-post' + (focus ? ' focus' : '')); art.tabIndex = 0;
    const who = h('button', 'cm-who'); who.append(avatar(p)); who.onclick = e => { e.stopPropagation(); go({ kind: 'user', arg: p.username }); };
    const body = h('div', 'cm-pbody');
    const head = h('div', 'cm-phead');
    const nm = h('button', 'cm-name', p.display_name || p.username); nm.onclick = who.onclick;
    const un = h('span', 'cm-un', '@' + p.username), dot = h('span', 'cm-dot', '·'), tm = h('time', 'cm-time', ago(p.created_at)); tm.dateTime = p.created_at; tm.title = new Date(p.created_at).toLocaleString();
    head.append(nm, un, dot, tm);
    body.append(head);
    if (p.reply_to && !focus) { const rt = h('div', 'cm-rt', 'Replying to '); const b = h('button', 'cm-tok', '@' + p.reply_to); b.onclick = e => { e.stopPropagation(); go({ kind: 'user', arg: p.reply_to }); }; rt.append(b); body.append(rt); }
    if (p.body) { const txt = h('p', 'cm-text'); txt.append(richText(p.body)); body.append(txt); }
    if (p.media && p.media.length) body.append(photos(p.media));
    const acts = h('div', 'cm-acts');
    const rep = iconBtn('cm-act', ICON.reply, 'Reply'); rep.append(h('span', null, p.replies ? String(p.replies) : ''));
    rep.onclick = e => { e.stopPropagation(); go({ kind: 'post', id: p.id, reply: true }); };
    const lk = iconBtn('cm-act like' + (p.liked ? ' on' : ''), ICON.like, p.liked ? 'Unlike' : 'Like'); const lc = h('span', null, p.likes ? String(p.likes) : ''); lk.append(lc);
    lk.onclick = async e => { e.stopPropagation(); const on = !lk.classList.contains('on'); lk.classList.toggle('on', on); lc.textContent = String(Math.max(0, (+lc.textContent || 0) + (on ? 1 : -1)) || '');
      try { const r = await api('like', {}, { id: p.id, on }); lk.classList.toggle('on', r.liked); lc.textContent = r.likes ? String(r.likes) : ''; lk.title = r.liked ? 'Unlike' : 'Like'; } catch (er) { lk.classList.toggle('on', !on); toast(er.message, true); } };
    const more = iconBtn('cm-act more', ICON.more, 'More');
    more.onclick = e => { e.stopPropagation(); menu(more, p, art); };
    acts.append(rep, lk, h('span', 'sp'), more); body.append(acts);
    art.append(who, body);
    if (!focus) { art.onclick = () => go({ kind: 'post', id: p.id }); art.onkeydown = e => { if (e.key === 'Enter' && e.target === art) go({ kind: 'post', id: p.id }); }; }
    return art;
  }
  function menu(anchor, p, art) {
    closeMenu(); const m = h('div', 'cm-menu'); m.setAttribute('role', 'menu');
    const item = (label, fn, danger) => { const b = h('button', danger ? 'danger' : '', label); b.setAttribute('role', 'menuitem'); b.onclick = e => { e.stopPropagation(); closeMenu(); fn(); }; m.append(b); };
    if (p.mine) item('Delete post', async () => { if (!confirmBox('Delete this post? This cannot be undone.')) return; try { await api('delete', {}, { id: p.id }); art.remove(); toast('Post deleted'); if (ROUTE.kind === 'post' && ROUTE.id === p.id) back(); } catch (er) { toast(er.message, true); } }, true);
    else item('Report post', () => reportBox(p));
    if (p.body) item('Copy text', () => { navigator.clipboard && navigator.clipboard.writeText(p.body).then(() => toast('Copied')); });
    anchor.parentElement.append(m); setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  }
  const closeMenu = () => root.querySelectorAll('.cm-menu').forEach(m => m.remove());
  const confirmBox = msg => window.confirm(msg);
  function reportBox(p) {
    const d = $c('#cmReport'); d.hidden = false; $c('#cmReportWho').textContent = '@' + p.username; const sel = $c('#cmReportReason'); sel.value = 'Spam';
    $c('#cmReportSend').onclick = async () => { try { await api('report', {}, { id: p.id, reason: sel.value }); d.hidden = true; toast('Thanks, we will review this post'); } catch (er) { toast(er.message, true); } };
    $c('#cmReportCancel').onclick = () => { d.hidden = true; };
  }

  /* ---------- composer ---------- */
  // Photos are resized and re-encoded in the browser (max 1600 px, JPEG): smaller uploads, and EXIF/GPS data is dropped.
  async function shrink(file) {
    if (!/^image\//.test(file.type)) throw new Error('Choose a photo (JPEG, PNG, WebP or HEIC).');
    let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('This photo format is not supported by your browser.'); }
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), hh = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, hh); cx.drawImage(bmp, 0, 0, w, hh); bmp.close && bmp.close();
    let q = 0.86, blob;
    do { blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q)); q -= 0.12; } while (blob && blob.size > 1400 * 1024 && q > 0.4);
    if (!blob || blob.size > 1500 * 1024) throw new Error('That photo is too large.');
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    return { data, mime: 'image/jpeg', width: w, height: hh, url: URL.createObjectURL(blob) };
  }
  function composer({ parentId = null, placeholder = "What's moving? Tag tickers like $NVDA", onDone, autofocus = false } = {}) {
    const box = h('div', 'cm-compose'); box.append(avatar(ME));
    const col = h('div', 'cm-ccol');
    const ta = h('textarea'); ta.placeholder = placeholder; ta.maxLength = MAX + 50; ta.rows = parentId ? 2 : 3; ta.setAttribute('aria-label', parentId ? 'Write a reply' : 'Write a post');
    const thumbs = h('div', 'cm-thumbs'); const media = []; // {id, url, busy, el}
    const foot = h('div', 'cm-cfoot'), cnt = h('span', 'cm-count'), send = h('button', 'btn dark cm-send', parentId ? 'Reply' : 'Post');
    const file = h('input'); file.type = 'file'; file.accept = 'image/*'; file.multiple = true; file.hidden = true;
    const pick = iconBtn('cm-act cm-pick', ICON.photo, 'Add photos'); pick.append(h('span', null, 'Photo')); pick.onclick = () => file.click();
    const upd = () => { const n = ta.value.trim().length, ready = media.length && media.every(m => m.id); cnt.textContent = n > MAX - 60 ? String(MAX - n) : ''; cnt.classList.toggle('over', n > MAX);
      send.disabled = (!n && !ready) || n > MAX || media.some(m => !m.id); pick.disabled = media.length >= 4; thumbs.hidden = !media.length;
      ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'; };
    async function add(files) {
      for (const f of [...files].slice(0, 4 - media.length)) {
        const m = { id: null, url: '', el: h('div', 'cm-thumb busy') }; media.push(m); thumbs.append(m.el);
        const x = iconBtn('cm-tx', ICON.x, 'Remove photo'); x.onclick = () => { media.splice(media.indexOf(m), 1); m.el.remove(); if (m.url) URL.revokeObjectURL(m.url); upd(); };
        m.el.append(x); upd();
        try { const r = await shrink(f); m.url = r.url; const img = h('img'); img.src = r.url; img.alt = ''; m.el.prepend(img);
          const u = await api('upload', {}, { data: r.data, mime: r.mime, width: r.width, height: r.height }); m.id = u.id; m.el.classList.remove('busy'); }
        catch (er) { toast(er.message, true); x.click(); }
        upd();
      }
      if (files.length > 4) toast('Up to 4 photos per post');
    }
    file.onchange = () => { add(file.files); file.value = ''; };
    ta.addEventListener('paste', e => { const fs = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); add(fs); } });
    box.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('drop'); add([...e.dataTransfer.files].filter(f => /^image\//.test(f.type))); });
    ta.oninput = upd; ta.onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !send.disabled) send.click(); };
    send.onclick = async () => { send.disabled = true;
      try { const r = await api('post', {}, { body: ta.value, parentId, mediaIds: media.map(m => m.id) }); ta.value = '';
        media.splice(0).forEach(m => { if (m.url) URL.revokeObjectURL(m.url); }); thumbs.replaceChildren(); upd(); onDone && onDone(r.post); toast(parentId ? 'Reply posted' : 'Posted'); }
      catch (er) { toast(er.message, true); upd(); } };
    foot.append(pick, file, h('span', 'cm-hint', 'Ctrl + Enter to post'), h('span', 'sp'), cnt, send); col.append(ta, thumbs, foot); box.append(col); upd();
    if (autofocus) setTimeout(() => ta.focus(), 30);
    return box;
  }
  // Photo grid in a post: 1 photo keeps its shape (up to a height), 2-4 photos share a grid.
  function photos(list) {
    const g = h('div', 'cm-photos n' + list.length);
    list.forEach((m, i) => { const b = h('button', 'cm-ph'); b.setAttribute('aria-label', `Open photo ${i + 1} of ${list.length}`);
      const img = h('img'); img.src = '/api/social?a=media&id=' + m.id; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      if (list.length === 1) b.style.aspectRatio = `${m.w} / ${m.h}`;
      b.append(img); b.onclick = e => { e.stopPropagation(); lightbox(list, i); }; g.append(b); });
    return g;
  }
  function lightbox(list, i) {
    const d = h('div', 'cm-lb'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Photo');
    const img = h('img'); const close = iconBtn('cm-lbx', ICON.x, 'Close');
    const prev = iconBtn('cm-lbn prev', ICON.back, 'Previous photo'), next = iconBtn('cm-lbn next', ICON.back, 'Next photo');
    const show = k => { i = (k + list.length) % list.length; img.src = '/api/social?a=media&id=' + list[i].id; prev.hidden = next.hidden = list.length < 2; };
    const done = () => { d.remove(); document.removeEventListener('keydown', key); };
    const key = e => { if (e.key === 'Escape') done(); if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); };
    prev.onclick = e => { e.stopPropagation(); show(i - 1); }; next.onclick = e => { e.stopPropagation(); show(i + 1); }; close.onclick = done; d.onclick = e => { if (e.target === d) done(); };
    d.append(img, prev, next, close); document.body.append(d); document.addEventListener('keydown', key); show(i); close.focus();
  }

  /* ---------- screens ---------- */
  const main = () => $c('#cmMain');
  function head(title, sub, withBack) {
    const hd = h('div', 'cm-head');
    if (withBack) { const b = iconBtn('cm-back', ICON.back, 'Back'); b.onclick = back; hd.append(b); }
    const t = h('div', 'cm-ht'); t.append(h('h2', null, title)); if (sub) t.append(h('span', 'cm-hsub', sub)); hd.append(t); return hd;
  }
  function list(posts, emptyText) {
    const l = h('div', 'cm-list');
    if (!posts.length) l.append(h('p', 'cm-empty', emptyText));
    posts.forEach(p => l.append(postEl(p)));
    return l;
  }
  function moreBtn(load) {
    const b = h('button', 'btn cm-more', 'Show more'); b.hidden = !NEXT;
    b.onclick = async () => { b.disabled = true; try { await load(b); } catch (er) { toast(er.message, true); } b.disabled = false; };
    return b;
  }

  // Filter bar: $TICKER shows posts about a stock, @username shows a member. Clear filter goes back to the full feed.
  function filterBar() {
    const active = ROUTE.kind === 'ticker' ? '$' + ROUTE.arg : ROUTE.kind === 'user' ? '@' + ROUTE.arg : '';
    const f = h('form', 'cm-filter'); f.setAttribute('role', 'search');
    const inp = h('input'); inp.placeholder = 'Filter by $ticker or @member'; inp.value = active; inp.setAttribute('aria-label', 'Filter posts'); inp.autocomplete = 'off'; inp.spellcheck = false;
    const clear = h('button', 'btn', 'Clear filter'); clear.type = 'button'; clear.disabled = !active;
    clear.onclick = () => { HIST.length = 0; go({ kind: 'feed', scope: 'all' }, true); };
    f.onsubmit = e => { e.preventDefault(); const v = inp.value.trim();
      if (!v) return clear.onclick();
      if (/^@?[A-Za-z0-9_]{3,20}$/.test(v) && v[0] === '@') return go({ kind: 'user', arg: v.slice(1).toLowerCase() });
      if (/^\$?[A-Za-z]{1,5}(\.[A-Za-z])?$/.test(v)) return go({ kind: 'ticker', arg: v.replace(/^\$/, '').toUpperCase() });
      if (/^[A-Za-z0-9_]{3,20}$/.test(v)) return go({ kind: 'user', arg: v.toLowerCase() });
      toast('Type a ticker like $NVDA or a member like @name', true); };
    const go1 = h('button', 'btn dark', 'Filter'); go1.type = 'submit';
    f.append(inp, go1, clear); return f;
  }
  async function showFeed() {
    const m = main(); m.replaceChildren();
    const tabs = h('div', 'cm-tabs'); tabs.setAttribute('role', 'tablist');
    for (const [k, label] of [['all', 'Everyone'], ['following', 'Following']]) { const b = h('button', ROUTE.scope === k ? 'on' : '', label); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(ROUTE.scope === k)); b.onclick = () => go({ kind: 'feed', scope: k }, true); tabs.append(b); }
    m.append(filterBar(), tabs, composer({ onDone: p => { const l = $c('.cm-list'); const e = $c('.cm-list .cm-empty'); if (e) e.remove(); l.prepend(postEl(p)); } }));
    const holder = h('div'); m.append(holder); holder.append(h('p', 'cm-load', 'Loading…'));
    const r = await api('feed', { scope: ROUTE.scope }); NEXT = r.next;
    const l = list(r.posts, ROUTE.scope === 'following' ? 'Posts from members you follow show here. Find people in Everyone and follow them.' : 'No posts yet. Start the conversation.');
    const more = moreBtn(async () => { const x = await api('feed', { scope: ROUTE.scope, before: NEXT }); x.posts.forEach(p => l.append(postEl(p))); NEXT = x.next; more.hidden = !NEXT; });
    holder.replaceChildren(l, more);
  }
  async function showTicker() {
    const m = main(); m.replaceChildren(); const t = ROUTE.arg;
    const hd = head('$' + t, 'Posts that mention ' + t, true);
    const open = h('button', 'btn', 'Open ' + t + ' chain'); open.onclick = () => window.OSApp && window.OSApp.openSymbol(t); hd.append(h('span', 'sp'), open);
    m.append(filterBar(), hd, composer({ placeholder: `Share your view on $${t}`, onDone: p => { if (p.tickers.includes(t)) $c('.cm-list').prepend(postEl(p)); } }));
    const r = await api('feed', { scope: 'ticker', arg: t }); NEXT = r.next;
    const l = list(r.posts, `No posts about $${t} yet.`);
    const more = moreBtn(async () => { const x = await api('feed', { scope: 'ticker', arg: t, before: NEXT }); x.posts.forEach(p => l.append(postEl(p))); NEXT = x.next; more.hidden = !NEXT; });
    m.append(l, more);
    const ta = m.querySelector('textarea'); if (ta && !ta.value) { ta.value = `$${t} `; ta.dispatchEvent(new Event('input')); }
  }
  async function showPost() {
    const m = main(); m.replaceChildren(head('Post', null, true));
    const r = await api('post', { id: ROUTE.id });
    if (r.parent) { const pe = postEl(r.parent); pe.classList.add('parent'); m.append(pe); }
    m.append(postEl(r.post, { focus: true }));
    m.append(composer({ parentId: r.post.id, placeholder: `Reply to @${r.post.username}`, autofocus: !!ROUTE.reply, onDone: p => { const e = $c('.cm-list .cm-empty'); if (e) e.remove(); $c('.cm-list').append(postEl(p)); } }));
    m.append(list(r.replies, 'No replies yet.'));
  }
  async function showUser() {
    const m = main(); m.replaceChildren(filterBar(), head('Profile', null, true));
    const r = await api('user', { u: ROUTE.arg }); const p = r.profile; NEXT = r.next;
    const card = h('section', 'cm-prof');
    const top = h('div', 'cm-ptop'); top.append(avatar(p, true));
    if (p.me) { const ed = h('button', 'btn', 'Edit profile'); ed.onclick = () => go({ kind: 'edit' }); top.append(h('span', 'sp'), ed); }
    else { const f = h('button', 'btn' + (p.followed ? '' : ' dark'), p.followed ? 'Following' : 'Follow');
      f.onclick = async () => { f.disabled = true; try { const x = await api('follow', {}, { username: p.username, on: !p.followed }); Object.assign(p, x.profile); f.textContent = p.followed ? 'Following' : 'Follow'; f.className = 'btn' + (p.followed ? '' : ' dark'); fl.textContent = String(p.followers); } catch (er) { toast(er.message, true); } f.disabled = false; };
      f.onmouseenter = () => { if (p.followed) f.textContent = 'Unfollow'; }; f.onmouseleave = () => { f.textContent = p.followed ? 'Following' : 'Follow'; };
      top.append(h('span', 'sp'), f); }
    card.append(top, h('h3', null, p.display_name || p.username), h('div', 'cm-un', '@' + p.username));
    if (p.bio) { const b = h('p', 'cm-bio'); b.append(richText(p.bio)); card.append(b); }
    const st = h('div', 'cm-stats'); const fl = h('b', null, String(p.followers));
    const stat = (b, l) => { const s = h('span'); s.append(b, ' ' + l); st.append(s); };
    stat(h('b', null, String(p.posts)), 'posts'); stat(fl, 'followers'); stat(h('b', null, String(p.following)), 'following');
    st.append(h('span', 'cm-joined', 'Joined ' + new Date(p.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })));
    card.append(st); m.append(card);
    const l = list(r.posts, p.me ? 'You have not posted yet.' : 'No posts yet.');
    const more = moreBtn(async () => { const x = await api('feed', { scope: 'user', arg: p.username, before: NEXT }); x.posts.forEach(q => l.append(postEl(q))); NEXT = x.next; more.hidden = !NEXT; });
    m.append(l, more);
  }
  function showEdit(first) {
    const m = main(); m.replaceChildren();
    if (!first) m.append(head('Edit profile', null, true));
    const f = h('form', 'cm-join');
    if (first) { f.append(h('h2', null, 'Join the community')); f.append(h('p', 'cm-lead', 'Talk options with other Pro members: share trades and flow you are watching, tag tickers like $NVDA, follow people and reply. Pick a username to start.')); }
    const row = (label, input, help) => { const l = h('label', 'cm-field'); l.append(h('span', null, label), input); if (help) l.append(help); f.append(l); return l; };
    const un = h('input'); un.name = 'username'; un.required = true; un.maxLength = 20; un.autocomplete = 'off'; un.spellcheck = false; un.placeholder = 'e.g. gammahunter'; un.value = ME ? ME.username : '';
    const unHelp = h('small', 'cm-help', '3 to 20 letters, numbers or underscores. This is how others mention you: @username');
    const wrapU = h('div', 'cm-at'); wrapU.append(h('span', null, '@'), un);
    row('Username', wrapU, unHelp);
    const dn = h('input'); dn.maxLength = 40; dn.placeholder = 'Your name or a nickname'; dn.value = ME ? ME.display_name : ''; row('Display name', dn);
    const bio = h('textarea'); bio.maxLength = 160; bio.rows = 3; bio.placeholder = 'What do you trade? (optional)'; bio.value = ME ? ME.bio : ''; row('Bio', bio);
    let t = null;
    un.oninput = () => { un.value = un.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); clearTimeout(t); unHelp.className = 'cm-help'; unHelp.textContent = 'Checking…';
      t = setTimeout(async () => { if (!un.value) return; try { const r = await api('check', { u: un.value }); unHelp.className = 'cm-help ' + (r.ok ? 'ok' : 'bad'); unHelp.textContent = r.ok ? `@${r.username} is available` : r.reason; } catch {} }, 350); };
    const save = h('button', 'btn dark', first ? 'Join' : 'Save'); save.type = 'submit';
    const acts = h('div', 'cm-factions'); acts.append(save);
    if (!first) { const c = h('button', 'btn', 'Cancel'); c.type = 'button'; c.onclick = back; acts.append(c); }
    f.append(acts, h('p', 'cm-fine', 'Be respectful. No spam, no personal attacks and no promises of returns. Posts are opinions, not investment advice. Members can report posts and moderators may remove them.'));
    f.onsubmit = async e => { e.preventDefault(); save.disabled = true;
      try { const r = await api('profile', {}, { username: un.value, displayName: dn.value, bio: bio.value }); ME = r.me; paintSide(); toast(first ? `Welcome, @${ME.username}` : 'Profile saved'); go({ kind: 'feed', scope: 'all' }, true); }
      catch (er) { unHelp.className = 'cm-help bad'; unHelp.textContent = er.message; save.disabled = false; } };
    m.append(f); setTimeout(() => un.focus(), 30);
  }
  function paintSide() {
    const s = $c('#cmSide'); s.replaceChildren(); if (!ME) return;
    const c = h('section', 'cm-me'); const top = h('button', 'cm-mebtn'); top.append(avatar(ME)); const t = h('span'); t.append(h('b', null, ME.display_name || ME.username), h('small', null, '@' + ME.username)); top.append(t);
    top.onclick = () => go({ kind: 'user', arg: ME.username });
    const st = h('div', 'cm-stats'); for (const [n, l] of [[ME.posts, 'posts'], [ME.followers, 'followers'], [ME.following, 'following']]) { const x = h('span'); x.append(h('b', null, String(n)), ' ' + l); st.append(x); }
    c.append(top, st); s.append(c);
    const tips = h('section', 'cm-tips'); tips.append(h('h3', null, 'How it works'));
    const ul = h('ul'); for (const x of ['Tag tickers with $, like $SPY, to show up on that ticker’s page.', 'Mention members with @username.', 'Follow members to build your Following feed.', 'Report anything that breaks the rules from the … menu on a post.']) ul.append(h('li', null, x));
    tips.append(ul); s.append(tips);
  }

  /* ---------- routing (inside the Community view) ---------- */
  const HIST = [];
  function go(r, replace) { if (!replace) HIST.push(ROUTE); ROUTE = r; render(); const mm = document.querySelector('.main'); if (mm) mm.scrollTop = 0; window.scrollTo(0, 0); }
  function back() { ROUTE = HIST.pop() || { kind: 'feed', scope: 'all' }; render(); }
  async function render() {
    if (BUSY) return; BUSY = true; closeMenu();
    try {
      if (!ME && ROUTE.kind !== 'edit') return showEdit(true);
      if (ROUTE.kind === 'feed') await showFeed();
      else if (ROUTE.kind === 'ticker') await showTicker();
      else if (ROUTE.kind === 'post') await showPost();
      else if (ROUTE.kind === 'user') await showUser();
      else if (ROUTE.kind === 'edit') showEdit(!ME);
    } catch (er) {
      const m = main(); m.replaceChildren(head('Community', null, HIST.length > 0));
      m.append(h('p', 'cm-empty', er.status === 404 ? er.message : 'Could not load the community: ' + er.message));
    } finally { BUSY = false; }
  }
  async function show(opts = {}) {
    if (opts.ticker) { if (LOADED) { go({ kind: 'ticker', arg: opts.ticker }); return; } ROUTE = { kind: 'ticker', arg: opts.ticker }; }
    if (LOADED && !opts.ticker) return;
    main().replaceChildren(h('p', 'cm-load', 'Loading…'));
    try { const r = await api('me'); ME = r.me; LOADED = true; paintSide(); render(); }
    catch (er) { if (er.status === 402) { main().replaceChildren(h('p', 'cm-empty', 'The community is part of Pro.')); return; } main().replaceChildren(h('p', 'cm-empty', 'Could not load the community: ' + er.message)); }
  }
  window.OSCommunity = { show, reset: () => { LOADED = false; } };
  if (document.body.classList.contains("v-community")) show();
})();
