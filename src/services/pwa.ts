export async function registerServiceWorker(onFlushSync: () => void): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  // FORCE unregister all existing service workers. 
  // This cleans up any previous registrations (even from the root domain)
  // so the new, correctly scoped registration can take over.
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  try {
    // Register the new worker with the correct subfolder path and scope
    const registration = await navigator.serviceWorker.register('/SandboxSecretary/sw.js', { 
      scope: '/SandboxSecretary/' 
    });

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
