// Installable app + offline start (needs https). Updates arrive by themselves: the new service worker takes over at once
// (skipWaiting + clients.claim) and the page reloads, unless the user is recording or looking at a result, where a banner asks instead.
export function registerWorker({ busy = () => false } = {}) {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  const hadWorker = !!navigator.serviceWorker.controller;
  let reloading = false;
  const reload = () => { reloading = true; location.reload(); };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker || reloading) return;
    if (!busy()) return reload();
    if (document.getElementById('updateBanner')) return;
    const b = document.createElement('button');
    b.id = 'updateBanner'; b.className = 'update'; b.type = 'button'; b.textContent = 'Update available: tap to refresh';
    b.onclick = reload; document.body.append(b);
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }).catch(() => { /* not fatal */ });
}
