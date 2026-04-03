/* YouTube VOICEVOX LP – script.js */

/* ── Wave bars generator ─────────────────────────────────── */
(function () {
  const container = document.getElementById('waveContainer');
  if (!container) return;

  const count = Math.min(120, Math.floor(window.innerWidth / 10));
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < count; i++) {
    const bar = document.createElement('div');
    bar.className = 'wave-bar';
    const hLow  = 10  + Math.random() * 30;
    const hHigh = 40  + Math.random() * 140;
    const dur   = 0.7 + Math.random() * 1.4;
    const delay = (Math.random() * 2).toFixed(2);
    bar.style.setProperty('--h-low',  hLow  + 'px');
    bar.style.setProperty('--h-high', hHigh + 'px');
    bar.style.setProperty('--dur',    dur   + 's');
    bar.style.setProperty('--delay',  delay + 's');
    bar.style.height = hLow + 'px';
    fragment.appendChild(bar);
  }

  container.appendChild(fragment);
})();

/* ── Tabs ────────────────────────────────────────────────── */
(function () {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels  = document.querySelectorAll('.tab-panel');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      buttons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      panels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      const panel = document.getElementById('tab-' + target);
      if (panel) panel.classList.add('active');
    });
  });
})();

/* ── Scroll reveal ───────────────────────────────────────── */
(function () {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          observer.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
})();

/* ── Nav shadow on scroll ────────────────────────────────── */
(function () {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  window.addEventListener('scroll', () => {
    nav.style.boxShadow = window.scrollY > 8
      ? '0 2px 20px rgba(0,0,0,.12)'
      : '';
  }, { passive: true });
})();
