(() => {
  const LEGAL_VERSION = '2026-11-19.2'; // must match lib/legal.js
  const q = new URLSearchParams(location.search);
  const next = q.get('next');
  const safe = n => n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
  const btn = document.getElementById('gbtn'), box = document.getElementById('agree'), mkt = document.getElementById('mkt'), msg = document.getElementById('msg');
  const href = () => '/api/auth/login?consent=' + LEGAL_VERSION + (mkt.checked ? '&mkt=1' : '') + (next ? '&next=' + encodeURIComponent(safe(next)) : '');
  const paint = () => { btn.setAttribute('aria-disabled', box.checked ? 'false' : 'true'); btn.href = box.checked ? href() : '/login'; btn.tabIndex = box.checked ? 0 : -1; };
  mkt.addEventListener('change', paint);
  box.addEventListener('change', () => { paint(); if (box.checked && msg.classList.contains('err')) { msg.textContent = ''; msg.className = 'msg'; } });
  paint();
  if (q.has('signedout') || q.has('cikis')) msg.textContent = 'You have signed out. See you soon.';
  if (q.has('deleted')) msg.textContent = 'Your account and its data have been deleted.';
  if (q.get('consent') === 'required') { msg.textContent = 'Please accept the terms to continue.'; msg.className = 'msg err'; }
  // Already signed in? Go straight to the app.
  fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' }).then(r => { if (r.ok) location.replace(safe(next)); }).catch(() => {});
})();
