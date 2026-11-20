// Feature carousel on the home page: arrow buttons scroll one card at a time and disable at the ends.
(() => {
  for (const fc of document.querySelectorAll('.fc')) {
    const t = fc.querySelector('.fc-track'), [prev, next] = fc.querySelectorAll('.fc-b');
    const step = () => { const c = t.querySelector('.fcard'); return c ? c.getBoundingClientRect().width + 20 : t.clientWidth; };
    const sync = () => { prev.disabled = t.scrollLeft < 4; next.disabled = t.scrollLeft + t.clientWidth > t.scrollWidth - 4; };
    prev.onclick = () => t.scrollBy({ left: -step() });
    next.onclick = () => t.scrollBy({ left: step() });
    t.addEventListener('scroll', sync, { passive: true }); addEventListener('resize', sync); sync();
    t.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); next.click(); } if (e.key === 'ArrowLeft') { e.preventDefault(); prev.click(); } });
  }
})();
