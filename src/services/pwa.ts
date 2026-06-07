export async function registerServiceWorker(onFlushSync: () => void): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  if (import.meta.env.DEV) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    return;
  }

  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
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
