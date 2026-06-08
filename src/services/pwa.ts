export async function registerServiceWorker(onFlushSync: () => void): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    const basePath = normalizeBasePath(import.meta.env.BASE_URL);
    const swUrl = new URL(`${basePath}sw.js`, window.location.origin);
    const scope = new URL(basePath, window.location.origin).pathname;
    const registration = await navigator.serviceWorker.register(swUrl.href, { scope });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'FLUSH_SYNC_QUEUE') {
        onFlushSync();
      }
    });

    if ('sync' in registration) {
      await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync
        .register('sandbox-secretary-flush')
        .catch(() => undefined);
    }
  } catch (error) {
    console.warn("Service Worker registration failed:", error);
  }
}

export function subscribeToNetworkStatus(onChange: (online: boolean) => void): () => void {
  const update = () => onChange(navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
  return () => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  };
}

function normalizeBasePath(baseUrl: string): string {
  if (!baseUrl || baseUrl === './') {
    return '/';
  }
  const withLeadingSlash = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}
