/* Site-styled dropdowns: every <select> gets a button + listbox; the hidden native select keeps
   the value, so existing code (value, options, change/input listeners) works unchanged. */
(() => {
  const VD = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const ID = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  let cur = null; // { sel, btn, list, items, act }
  function enhance(sel) {
    if (sel._dd || sel.multiple || sel.size > 1) return;
    const wrap = document.createElement('div'); wrap.className = 'dd';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd-btn';
    btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    const lab = sel.getAttribute('aria-label') || sel.title; if (lab) btn.title = lab;
    if (sel.id) { const l = document.querySelector(`label[for="${sel.id}"]`); if (l) l.htmlFor = ''; }
    sel.parentNode.insertBefore(wrap, sel); wrap.append(sel, btn);
    sel.classList.add('dd-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    const sync = () => { const o = sel.options[sel.selectedIndex]; btn.textContent = o ? o.text : '';
      if (lab) btn.setAttribute('aria-label', `${lab}: ${btn.textContent}`); btn.disabled = sel.disabled; };
    sel._dd = { btn, sync };
    Object.defineProperty(sel, 'value', { configurable: true, get() { return VD.get.call(this); }, set(v) { VD.set.call(this, v); sync(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return ID.get.call(this); }, set(v) { ID.set.call(this, v); sync(); } });
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, characterData: true });
    sel.addEventListener('change', sync);
    // a <label> wrapping the select would focus the hidden select; send it to the button instead
    const pl = wrap.closest('label'); if (pl) pl.addEventListener('click', e => { if (!wrap.contains(e.target)) { e.preventDefault(); btn.focus(); } });
    btn.addEventListener('click', () => (cur && cur.sel === sel) ? close() : open(sel));
    btn.addEventListener('keydown', e => {
      if (cur && cur.sel === sel) return listKey(e);
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(sel); }
    });
    sync();
  }
  function open(sel) {
    close(); const btn = sel._dd.btn; if (btn.disabled) return;
    const list = document.createElement('div'); list.className = 'dd-list'; list.setAttribute('role', 'listbox');
    const items = [];
    for (const node of sel.children) {
      const opts = node.tagName === 'OPTGROUP' ? (list.appendChild(Object.assign(document.createElement('div'), { className: 'dd-grp', textContent: node.label })), [...node.children]) : [node];
      for (const o of opts) {
        const it = document.createElement('div'); it.className = 'dd-opt'; it.setAttribute('role', 'option'); it.textContent = o.text;
        it.setAttribute('aria-selected', String(o.selected)); if (o.disabled) it.setAttribute('aria-disabled', 'true');
        const idx = o.index; it.addEventListener('mousedown', e => e.preventDefault());
        it.addEventListener('click', () => { if (!o.disabled) choose(idx); });
        it.addEventListener('mousemove', () => setAct(items.indexOf(it)));
        list.appendChild(it); items.push(it);
      }
    }
    document.body.appendChild(list);
    const r = btn.getBoundingClientRect(), w = Math.max(r.width, list.offsetWidth);
    list.style.minWidth = r.width + 'px';
    list.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    const below = innerHeight - r.bottom - 8, above = r.top - 8, h = Math.min(list.scrollHeight, 320);
    if (h > below && above > below) { list.classList.add('up'); list.style.bottom = (innerHeight - r.top + 4) + 'px'; list.style.maxHeight = Math.min(320, above) + 'px'; }
    else { list.style.top = (r.bottom + 4) + 'px'; list.style.maxHeight = Math.min(320, below) + 'px'; }
    btn.setAttribute('aria-expanded', 'true');
    cur = { sel, btn, list, items, act: -1 };
    setAct(Math.max(0, sel.selectedIndex), true);
    requestAnimationFrame(() => list.classList.add('on'));
  }
  function setAct(i, scroll) { if (!cur || i < 0 || i >= cur.items.length) return;
    if (cur.items[cur.act]) cur.items[cur.act].classList.remove('act'); cur.act = i; cur.items[i].classList.add('act');
    if (scroll) cur.items[i].scrollIntoView({ block: 'nearest' }); }
  function choose(i) { const { sel, btn } = cur; close(); btn.focus();
    if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); } }
  function close() { if (!cur) return; cur.btn.setAttribute('aria-expanded', 'false'); cur.list.remove(); cur = null; }
  let typed = '', typedT = 0;
  function listKey(e) {
    const n = cur.items.length, step = d => { let i = cur.act; for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (cur.items[i].getAttribute('aria-disabled') !== 'true') return setAct(i, true); } };
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setAct(0, true); }
    else if (e.key === 'End') { e.preventDefault(); setAct(n - 1, true); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (cur.items[cur.act] && cur.items[cur.act].getAttribute('aria-disabled') !== 'true') choose(cur.act); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
    else if (e.key.length === 1) { const now = Date.now(); typed = (now - typedT > 700 ? '' : typed) + e.key.toLowerCase(); typedT = now;
      const i = cur.items.findIndex(it => it.textContent.toLowerCase().startsWith(typed)); if (i >= 0) setAct(i, true); }
  }
  document.addEventListener('mousedown', e => { if (cur && !cur.list.contains(e.target) && e.target !== cur.btn) close(); }, true);
  addEventListener('resize', close);
  document.addEventListener('scroll', e => { if (cur && !cur.list.contains(e.target)) close(); }, true);
  const scan = root => root.querySelectorAll && root.querySelectorAll('select').forEach(enhance);
  scan(document);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) { if (n.tagName === 'SELECT') enhance(n); else scan(n); } })
    .observe(document.body, { childList: true, subtree: true });
})();
