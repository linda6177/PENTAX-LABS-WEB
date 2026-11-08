(() => {
  'use strict';
  const html = document.documentElement;
  const overlay = document.getElementById('introOverlay');
  if (!overlay) { html.classList.remove('labs-intro-pending'); return; }
  const status = document.getElementById('footerStatus');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  let revealRequested = false;
  let revealed = false;
  function finishReveal() {
    if (revealed) return;
    revealed = true;
    html.classList.add('labs-intro-reveal');
    overlay.classList.add('is-leaving');
    window.setTimeout(() => {
      overlay.remove();
      html.classList.remove('labs-intro-pending');
      window.setTimeout(() => html.classList.remove('labs-intro-reveal'), 760);
    }, 370);
  }
  function requestReveal() {
    if (revealRequested || revealed) return;
    revealRequested = true;
    if (reducedMotion) { finishReveal(); return; }
    window.setTimeout(finishReveal, Math.max(0, 720 - (performance.now() - start)));
  }
  function ready() { return /就绪|ready|初始化失败|initialization failed/i.test((status?.textContent || '').trim()); }
  if (status) {
    const observer = new MutationObserver(() => {
      if (ready()) { observer.disconnect(); requestReveal(); }
    });
    observer.observe(status, { childList: true, subtree: true, characterData: true });
    if (ready()) requestReveal();
  } else requestReveal();
  window.setTimeout(requestReveal, 4800);
  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    requestReveal();
    window.removeEventListener('keydown', onKeydown);
  }
  window.addEventListener('keydown', onKeydown);
})();
