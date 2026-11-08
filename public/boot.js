'use strict';
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) { e.preventDefault(); window.print(); }
  if (e.target.closest('[data-back]')) { e.preventDefault(); history.length > 1 ? history.back() : (location.hash = '#/'); }
});
document.addEventListener('focusin', (e) => { if (e.target.matches('input[readonly]')) e.target.select(); });
(async () => {
  try { await loadMe(); } catch (e) { ME = null; }
  if (!location.hash || location.hash === '#') location.hash = ME ? '#/' : '#/login';
  go();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
