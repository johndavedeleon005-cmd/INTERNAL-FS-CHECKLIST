export type AppShellUpdateCheckStatus =
  | 'offline'
  | 'update-found'
  | 'up-to-date'
  | 'error';

export interface AppShellUpdateCheckResult {
  status: AppShellUpdateCheckStatus;
  message: string;
  checkedAt: string;
  shouldReload: boolean;
}

export interface AppShellDetectionSnapshot {
  bootedFromOfflineCache: boolean;
  cachedAt: string | null;
  updateAvailable: boolean;
}

interface ShellSignature {
  assetUrls: string[];
  htmlHash: string;
  etag: string | null;
}

let swRegistration: ServiceWorkerRegistration | null = null;
let initialLiveSignature: ShellSignature | null = null;
let lastKnownCachedAt: string | null = null;
let detectedBootOfflineCache = false;
let detectedUpdateAvailable = false;

const listeners = new Set<(snapshot: AppShellDetectionSnapshot) => void>();

function notifyListeners() {
  const snapshot: AppShellDetectionSnapshot = {
    bootedFromOfflineCache: detectedBootOfflineCache,
    cachedAt: lastKnownCachedAt,
    updateAvailable: detectedUpdateAvailable,
  };
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeAssetUrl(raw: string): string {
  try {
    const resolved = new URL(raw, window.location.href);
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return raw.trim();
  }
}

function getCurrentDomAssetUrls(): string[] {
  if (typeof document === 'undefined') return [];
  const urls: string[] = [];
  document
    .querySelectorAll('script[src], link[rel="stylesheet"][href]')
    .forEach((el) => {
      const attr =
        el.tagName.toLowerCase() === 'script'
          ? el.getAttribute('src')
          : el.getAttribute('href');
      if (attr) {
        const normalized = normalizeAssetUrl(attr);
        if (normalized && !normalized.startsWith('http')) {
          urls.push(normalized);
        }
      }
    });
  return Array.from(new Set(urls)).sort();
}

function extractShellSignatureFromHtml(
  html: string,
  etag: string | null
): ShellSignature {
  const assetUrls: string[] = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc
      .querySelectorAll('script[src], link[rel="stylesheet"][href]')
      .forEach((el) => {
        const attr =
          el.tagName.toLowerCase() === 'script'
            ? el.getAttribute('src')
            : el.getAttribute('href');
        if (attr) {
          const normalized = normalizeAssetUrl(attr);
          if (normalized && !normalized.startsWith('http')) {
            assetUrls.push(normalized);
          }
        }
      });
  } catch {
    // Fallback regex extraction
    const matches = html.matchAll(/(?:src|href)=["']([^"']+)["']/gi);
    for (const match of matches) {
      if (match[1]) {
        assetUrls.push(normalizeAssetUrl(match[1]));
      }
    }
  }

  return {
    assetUrls: Array.from(new Set(assetUrls)).sort(),
    htmlHash: hashString(html),
    etag,
  };
}

function areSignaturesDifferent(
  fetched: ShellSignature,
  baseline: ShellSignature | null,
  domAssets: string[]
): boolean {
  if (baseline) {
    if (baseline.etag && fetched.etag && baseline.etag !== fetched.etag) {
      return true;
    }
    if (baseline.htmlHash !== fetched.htmlHash) {
      return true;
    }
  }

  // Compare production bundle assets if present
  const hasHashedAssets = (urls: string[]) =>
    urls.some((u) => u.includes('/assets/') || /-[a-z0-9_-]{6,}\.(js|css)$/i.test(u));

  if (hasHashedAssets(domAssets) && hasHashedAssets(fetched.assetUrls)) {
    if (domAssets.length !== fetched.assetUrls.length) return true;
    for (let i = 0; i < domAssets.length; i += 1) {
      if (domAssets[i] !== fetched.assetUrls[i]) return true;
    }
  }

  return false;
}

function getShellCheckUrl(): string {
  const base = import.meta.env.BASE_URL || './';
  const url = new URL(base, window.location.href);
  url.searchParams.set('__shell_check', String(Date.now()));
  return url.toString();
}

async function fetchLiveAppShell(timeoutMs = 7000): Promise<{
  ok: boolean;
  signature: ShellSignature | null;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, signature: null };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(getShellCheckUrl(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'x-app-shell-check': '1',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, signature: null };
    }

    const sourceHeader = res.headers.get('X-App-Shell-Source');
    if (sourceHeader === 'offline-cache') {
      return { ok: false, signature: null };
    }

    const contentType = res.headers.get('content-type') || '';
    const html = await res.text();
    if (!contentType.includes('text/html') && !html.includes('<div id="root">')) {
      return { ok: false, signature: null };
    }

    return {
      ok: true,
      signature: extractShellSignatureFromHtml(html, res.headers.get('etag')),
    };
  } catch {
    return { ok: false, signature: null };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function queryServiceWorkerShellStatus(): Promise<{
  source: string | null;
  cachedAt: string | null;
}> {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !navigator.serviceWorker.controller
  ) {
    return { source: null, cachedAt: null };
  }

  const controller = navigator.serviceWorker.controller;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      resolve({ source: null, cachedAt: null });
    }, 800);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      const data = event.data as
        | { type?: string; source?: string; cachedAt?: string | null }
        | undefined;
      resolve({
        source: data?.source ?? null,
        cachedAt: data?.cachedAt ?? null,
      });
    };

    try {
      controller.postMessage({ type: 'GET_SHELL_STATUS' }, [channel.port2]);
    } catch {
      window.clearTimeout(timer);
      resolve({ source: null, cachedAt: null });
    }
  });
}

async function refreshServiceWorkerShellCache(): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !navigator.serviceWorker.controller
  ) {
    return;
  }

  const controller = navigator.serviceWorker.controller;
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(), 2500);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      const data = event.data as { cachedAt?: string | null } | undefined;
      if (data?.cachedAt) {
        lastKnownCachedAt = data.cachedAt;
      }
      resolve();
    };
    try {
      controller.postMessage({ type: 'REFRESH_APP_SHELL' }, [channel.port2]);
    } catch {
      window.clearTimeout(timer);
      resolve();
    }
  });
}

function wireRegistrationLifecycle(reg: ServiceWorkerRegistration) {
  if (reg.waiting) {
    detectedUpdateAvailable = true;
    notifyListeners();
  }

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (
        installing.state === 'installed' &&
        navigator.serviceWorker.controller
      ) {
        detectedUpdateAvailable = true;
        notifyListeners();
      }
    });
  });
}

export async function registerAppShellServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as
      | { type?: string; source?: string; cachedAt?: string | null }
      | undefined;
    if (!data || data.type !== 'APP_SHELL_STATUS') return;
    if (data.cachedAt) {
      lastKnownCachedAt = data.cachedAt;
    }
    if (data.source === 'offline-cache') {
      detectedBootOfflineCache = true;
      notifyListeners();
    }
  });

  try {
    const swUrl = new URL(
      `${import.meta.env.BASE_URL || './'}sw.js`,
      window.location.href
    ).toString();
    const scopeUrl = new URL(
      import.meta.env.BASE_URL || './',
      window.location.href
    ).toString();

    const reg = await navigator.serviceWorker.register(swUrl, {
      scope: scopeUrl,
    });
    swRegistration = reg;
    wireRegistrationLifecycle(reg);
  } catch {
    // Service worker may be disallowed in restricted contexts; fallback checks still work
  }
}

export async function initializeAppShellDetection(): Promise<AppShellDetectionSnapshot> {
  if (typeof window === 'undefined') {
    return {
      bootedFromOfflineCache: false,
      cachedAt: null,
      updateAvailable: false,
    };
  }

  const navEntries = performance.getEntriesByType(
    'navigation'
  ) as PerformanceNavigationTiming[];
  const navEntry = navEntries[0];
  const zeroTransferBoot =
    Boolean(navEntry) &&
    navEntry.transferSize === 0 &&
    navEntry.decodedBodySize > 0;

  const [swStatus, liveProbe] = await Promise.all([
    queryServiceWorkerShellStatus(),
    fetchLiveAppShell(4500),
  ]);

  if (swStatus.cachedAt) {
    lastKnownCachedAt = swStatus.cachedAt;
  }

  const browserOfflineAtBoot =
    typeof navigator !== 'undefined' && !navigator.onLine;

  if (swStatus.source === 'offline-cache') {
    detectedBootOfflineCache = true;
  } else if (browserOfflineAtBoot) {
    detectedBootOfflineCache = true;
  } else if (!liveProbe.ok && zeroTransferBoot) {
    detectedBootOfflineCache = true;
  } else if (!liveProbe.ok) {
    // Live app shell could not be fetched on startup -> running from cached bundle
    detectedBootOfflineCache = true;
  } else if (liveProbe.signature) {
    initialLiveSignature = liveProbe.signature;
  }

  notifyListeners();

  return {
    bootedFromOfflineCache: detectedBootOfflineCache,
    cachedAt: lastKnownCachedAt,
    updateAvailable: detectedUpdateAvailable,
  };
}

export function subscribeToAppShellStatus(
  listener: (snapshot: AppShellDetectionSnapshot) => void
): () => void {
  listeners.add(listener);
  listener({
    bootedFromOfflineCache: detectedBootOfflineCache,
    cachedAt: lastKnownCachedAt,
    updateAvailable: detectedUpdateAvailable,
  });
  return () => {
    listeners.delete(listener);
  };
}

export async function checkForAppShellUpdates(): Promise<AppShellUpdateCheckResult> {
  const checkedAt = new Date().toISOString();

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      status: 'offline',
      message: 'Still offline — unable to reach server for updates.',
      checkedAt,
      shouldReload: false,
    };
  }

  if (swRegistration) {
    try {
      await swRegistration.update();
    } catch {
      // Ignore SW update check failure and continue with direct app shell fetch
    }
  }

  const liveProbe = await fetchLiveAppShell(8000);
  if (!liveProbe.ok || !liveProbe.signature) {
    return {
      status: 'offline',
      message: 'Server unreachable — still running from offline cached version.',
      checkedAt,
      shouldReload: false,
    };
  }

  const domAssets = getCurrentDomAssetUrls();
  const waitingWorker = swRegistration?.waiting ?? null;
  const shellChanged = areSignaturesDifferent(
    liveProbe.signature,
    initialLiveSignature,
    domAssets
  );

  if (waitingWorker || shellChanged) {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
    await refreshServiceWorkerShellCache();
    detectedUpdateAvailable = true;
    notifyListeners();

    return {
      status: 'update-found',
      message: 'Updated app shell fetched — reloading latest version…',
      checkedAt,
      shouldReload: true,
    };
  }

  // Live server matched the currently running app shell: refresh SW cache and clear offline-cached boot flag
  initialLiveSignature = liveProbe.signature;
  await refreshServiceWorkerShellCache();
  detectedBootOfflineCache = false;
  detectedUpdateAvailable = false;
  notifyListeners();

  return {
    status: 'up-to-date',
    message: 'Latest app shell verified — running the current version.',
    checkedAt,
    shouldReload: false,
  };
}
