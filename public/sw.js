const VERSION = 'v8';
const STATIC_CACHE = `sandbox-secretary-static-${VERSION}`;
const RUNTIME_CACHE = `sandbox-secretary-runtime-${VERSION}`;
const MODEL_CACHE = `sandbox-secretary-models-${VERSION}`;
const CACHE_NAMES = [STATIC_CACHE, RUNTIME_CACHE, MODEL_CACHE];

const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/') ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;

const CORE_PRECACHE_PATHS = ['', 'index.html', 'manifest.json', 'icons/icon.svg', 'audio-downsampler.worklet.js'];

const OPTIONAL_PRECACHE_PATHS = [
  'sandbox-secretary.html',
  'models/README.md',
  'litert/wasm/litert_wasm_internal.js',
  'litert/wasm/litert_wasm_internal.wasm',
  'litert/wasm/litert_wasm_jspi_internal.js',
  'litert/wasm/litert_wasm_jspi_internal.wasm',
  'litert/wasm/litert_wasm_threaded_internal.js',
  'litert/wasm/litert_wasm_threaded_internal.wasm',
  'litert/wasm/litert_wasm_compat_internal.js',
  'litert/wasm/litert_wasm_compat_internal.wasm'
];

const STATIC_DESTINATIONS = new Set(['document', 'script', 'style', 'worker', 'sharedworker', 'image', 'font', 'manifest']);
const STATIC_EXTENSIONS = [
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.png',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.worklet.js'
];
const MODEL_EXTENSIONS = ['.tflite', '.task', '.bin', '.safetensors', '.onnx', '.gguf', '.model', '.weights', '.wasm'];
const MODEL_HOSTS = ['huggingface.co', 'cdn-lfs.huggingface.co', 'storage.googleapis.com', 'kaggle.com', 'www.kaggle.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(async (cache) => {
        await cache.addAll(CORE_PRECACHE_PATHS.map(toScopeUrl));
        await precacheBuildAssets(cache);
        await Promise.all(
          OPTIONAL_PRECACHE_PATHS.map((path) => cache.add(toScopeUrl(path)).catch(() => undefined))
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CACHE_NAMES.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (shouldBypassRequest(url)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(offlineShellResponse(request));
    return;
  }

  if (isModelAssetRequest(request, url)) {
    event.respondWith(modelResponse(request));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (urlWithinScope(url)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sandbox-secretary-flush') {
    event.waitUntil(notifyClients({ type: 'FLUSH_SYNC_QUEUE' }));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil(cacheUrls(event.data.urls));
  }
});

async function offlineShellResponse(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const url = new URL(request.url);
    const requestedPath = scopeRelativePath(url);
    const candidates = requestedPath === 'sandbox-secretary.html'
      ? ['sandbox-secretary.html', 'index.html', '']
      : ['index.html', '', 'sandbox-secretary.html'];

    for (const candidate of candidates) {
      const cached = await cache.match(toScopeUrl(candidate));
      if (cached) {
        return cached;
      }
    }

    return new Response('Sandbox Secretary is offline and the app shell is not cached yet.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 503,
      statusText: 'Offline'
    });
  }
}

async function modelResponse(request) {
  const cache = await caches.open(MODEL_CACHE);
  const range = request.headers.get('Range');

  if (range) {
    const cached = await cache.match(stripRangeHeader(request));
    if (cached) {
      return rangeResponse(cached, range);
    }
    return fetch(request);
  }

  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (isCacheableResponse(response)) {
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => cached);
  return cached || refresh;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw new Error(`No cached response for ${request.url}`);
  }
}

async function rangeResponse(response, rangeHeader) {
  const size = Number(response.headers.get('Content-Length')) || (await response.clone().arrayBuffer()).byteLength;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return response;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
    return new Response(null, {
      headers: { 'Content-Range': `bytes */${size}` },
      status: 416,
      statusText: 'Range Not Satisfiable'
    });
  }

  const bytes = await response.arrayBuffer();
  return new Response(bytes.slice(start, end + 1), {
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream'
    },
    status: 206,
    statusText: 'Partial Content'
  });
}

function stripRangeHeader(request) {
  const headers = new Headers(request.headers);
  headers.delete('Range');
  return new Request(request.url, {
    cache: request.cache,
    credentials: request.credentials,
    headers,
    integrity: request.integrity,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy
  });
}

function isStaticAssetRequest(request, url) {
  if (!urlWithinScope(url)) {
    return false;
  }
  const pathname = scopeRelativePath(url).toLowerCase();
  return (
    STATIC_DESTINATIONS.has(request.destination) ||
    STATIC_EXTENSIONS.some((extension) => pathname.endsWith(extension)) ||
    pathname.startsWith('assets/')
  );
}

function isModelAssetRequest(request, url) {
  const pathname = url.pathname.toLowerCase();
  const scopedPath = urlWithinScope(url) ? scopeRelativePath(url).toLowerCase() : pathname;
  const isKnownModelFile = MODEL_EXTENSIONS.some((extension) => pathname.endsWith(extension));
  const isLocalModel = urlWithinScope(url) && (scopedPath.startsWith('models/') || scopedPath.startsWith('litert/wasm/'));
  const isRemoteModel = MODEL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  return isKnownModelFile && (isLocalModel || isRemoteModel || request.destination === 'empty');
}

function shouldBypassRequest(url) {
  return (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.hostname === 'www.googleapis.com' ||
    url.hostname === 'googleapis.com' ||
    url.hostname.endsWith('.googleapis.com') ||
    url.protocol === 'chrome-extension:'
  );
}

function isCacheableResponse(response) {
  return response && (response.ok || response.type === 'opaque');
}

async function cacheUrls(urls) {
  const staticCache = await caches.open(STATIC_CACHE);
  const modelCache = await caches.open(MODEL_CACHE);
  await Promise.all(
    urls.map(async (url) => {
      const request = scopedRequest(url);
      const parsed = new URL(request.url);
      const cache = isModelAssetRequest(request, parsed) ? modelCache : staticCache;
      const response = await fetch(request);
      if (isCacheableResponse(response)) {
        await cache.put(request, response);
      }
    })
  );
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach((client) => {
    client.postMessage(message);
    if (message.type === 'FLUSH_SYNC_QUEUE') {
      client.postMessage({ type: 'sync' });
    }
  });
}

async function precacheBuildAssets(cache) {
  const shellUrl = toScopeUrl('index.html');
  const response = await fetch(shellUrl, { cache: 'reload' }).catch(() => undefined);
  if (!response || !response.ok) {
    return;
  }

  const copy = response.clone();
  await cache.put(shellUrl, response);
  const html = await copy.text();
  await Promise.all(extractBuildAssetUrls(html).map((url) => cache.add(url).catch(() => undefined)));
}

function extractBuildAssetUrls(html) {
  const urls = new Set();
  const attributePattern = /\b(?:src|href)=["']([^"']+)["']/g;
  let match = attributePattern.exec(html);
  while (match) {
    const url = new URL(match[1], self.registration.scope);
    const scopedPath = urlWithinScope(url) ? scopeRelativePath(url).toLowerCase() : '';
    if (scopedPath.startsWith('assets/')) {
      urls.add(url.href);
    }
    match = attributePattern.exec(html);
  }
  return Array.from(urls);
}

function scopedRequest(url) {
  return new Request(new URL(String(url), self.registration.scope).href);
}

function toScopeUrl(path) {
  return new URL(String(path).replace(/^\/+/, ''), self.registration.scope).href;
}

function urlWithinScope(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(SCOPE_PATH);
}

function scopeRelativePath(url) {
  return url.pathname.slice(SCOPE_PATH.length).replace(/^\/+/, '');
}
