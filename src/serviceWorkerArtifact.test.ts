import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('service worker artifact', () => {
  const sw = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  const rootSw = readFileSync(resolve(process.cwd(), 'sw.js'), 'utf8');
  const html = readFileSync(resolve(process.cwd(), 'sandbox-secretary.html'), 'utf8');
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };

  it('pre-caches the PWA shell and standalone page for airplane-mode startup', () => {
    ['index.html', 'sandbox-secretary.html', 'manifest.json', 'icons/icon.svg', 'audio-downsampler.worklet.js'].forEach(
      (asset) => expect(sw).toContain(asset)
    );
    expect(sw).toContain('self.registration.scope');
    expect(sw).toContain('toScopeUrl');
    expect(sw).toContain('scopeRelativePath');
    expect(sw).toContain('request.mode === \'navigate\'');
    expect(sw).toContain('offlineShellResponse');
    expect(sw).toContain('precacheBuildAssets');
    expect(sw).toContain('extractBuildAssetUrls');
    expect(sw).toContain("scopedPath.startsWith('assets/')");
    expect(sw).toContain('cache.addAll');
  });

  it('keeps a root-scope sw.js mirror for standalone static hosting', () => {
    expect(rootSw).toBe(sw);
  });

  it('handles standard PWA assets and large model/runtime assets with separate caches', () => {
    ['STATIC_CACHE', 'RUNTIME_CACHE', 'MODEL_CACHE', 'isStaticAssetRequest', 'isModelAssetRequest'].forEach((marker) =>
      expect(sw).toContain(marker)
    );
    ['.tflite', '.task', '.bin', '.safetensors', '.wasm'].forEach((extension) => expect(sw).toContain(extension));
    expect(sw).toContain('Range');
    expect(sw).toContain('206');
  });

  it('keeps the standalone artifact registered against the real sw.js file', () => {
    expect(html).toContain("const swUrl = new URL('sw.js', location.href)");
    expect(html).toContain('navigator.serviceWorker.register(swUrl.href');
    expect(html).not.toContain("navigator.serviceWorker.register('/sw.js'");
  });

  it('declares Google LiteRT.js as the official WebGPU-ready runtime dependency', () => {
    expect(packageJson.dependencies).toHaveProperty('@litertjs/core');
  });
});
