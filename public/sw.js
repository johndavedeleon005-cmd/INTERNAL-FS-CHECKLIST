const CACHE_NAME = 'iqaf005-app-shell-v1';

const getShellRootUrl = () => new URL('./', self.registration.scope).href;
const getFaviconUrl = () => new URL('./favicon.ico', self.registration.scope).href;

let lastNavigationSource = 'network';
let lastCachedAt = null;

async function broadcastShellStatus(source, cachedAt) {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  for (const client of clients) {
    client.postMessage({
      type: 'APP_SHELL_STATUS',
      source,
      cachedAt,
    });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const urls = [getShellRootUrl(), getFaviconUrl()];
        await Promise.allSettled(
          urls.map(async (url) => {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res.ok) {
              await cache.put(url, res.clone());
            }
          })
        );
        lastCachedAt = new Date().toISOString();
      } catch {
        // Ignore pre-cache failures if offline during initial install
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith('iqaf005-app-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }

  if (data.type === 'GET_SHELL_STATUS') {
    const replyTarget = event.ports?.[0] || event.source;
    if (replyTarget && typeof replyTarget.postMessage === 'function') {
      replyTarget.postMessage({
        type: 'APP_SHELL_STATUS',
        source: lastNavigationSource,
        cachedAt: lastCachedAt,
      });
    }
    return;
  }

  if (data.type === 'REFRESH_APP_SHELL') {
    event.waitUntil(
      (async () => {
        const replyTarget = event.ports?.[0] || event.source;
        try {
          const rootUrl = getShellRootUrl();
          const res = await fetch(rootUrl, { cache: 'no-store' });
          if (res.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(rootUrl, res.clone());
            lastNavigationSource = 'network';
            lastCachedAt = new Date().toISOString();
            if (replyTarget && typeof replyTarget.postMessage === 'function') {
              replyTarget.postMessage({ ok: true, cachedAt: lastCachedAt });
            }
            return;
          }
        } catch {
          // Network unreachable
        }
        if (replyTarget && typeof replyTarget.postMessage === 'function') {
          replyTarget.postMessage({ ok: false });
        }
      })()
    );
  }
});

function shouldBypassCache(request, url) {
  if (request.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname.startsWith('/__/')) return true;
  if (url.searchParams.has('__shell_check')) return true;
  if (request.headers.get('x-app-shell-check') === '1') return true;
  return false;
}

function isCacheableStaticAsset(request, url) {
  const dest = request.destination;
  if (
    dest === 'script' ||
    dest === 'style' ||
    dest === 'font' ||
    dest === 'image' ||
    dest === 'manifest'
  ) {
    return true;
  }
  return /\.(?:js|mjs|css|png|jpg|jpeg|webp|svg|ico|woff2?|json)$/i.test(
    url.pathname
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypassCache(request, url)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const rootUrl = getShellRootUrl();
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            await cache.put(rootUrl, networkResponse.clone());
            lastNavigationSource = 'network';
            lastCachedAt = new Date().toISOString();
            void broadcastShellStatus('network', lastCachedAt);
          }
          return networkResponse;
        } catch {
          const cached =
            (await cache.match(request)) || (await cache.match(rootUrl));
          if (cached) {
            lastNavigationSource = 'offline-cache';
            const headers = new Headers(cached.headers);
            headers.set('X-App-Shell-Source', 'offline-cache');
            void broadcastShellStatus('offline-cache', lastCachedAt);
            return new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers,
            });
          }
          return new Response(
            '<!doctype html><html><body style="font-family:sans-serif;padding:2rem;"><h2>Offline</h2><p>Unable to reach the server and no cached app shell is available yet.</p></body></html>',
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }
          );
        }
      })()
    );
    return;
  }

  if (isCacheableStaticAsset(request, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            await cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cached = await cache.match(request);
          if (cached) {
            return cached;
          }
          throw new Error('Asset unavailable offline');
        }
      })()
    );
  }
});
