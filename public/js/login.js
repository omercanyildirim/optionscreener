(() => {
  const q = new URLSearchParams(location.search);
  const next = q.get('next');
  const safe = n => n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
  document.getElementById('gbtn').href = '/api/auth/login' + (next ? '?next=' + encodeURIComponent(safe(next)) : '');
  if ((q.has('signedout')||q.has('cikis'))) document.getElementById('msg').textContent = 'You have signed out. See you soon.';
  // Already signed in? Go straight to the app.
  fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' }).then(r => { if (r.ok) location.replace(safe(next)); }).catch(() => {});
})();
