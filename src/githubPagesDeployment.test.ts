import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('GitHub Pages deployment wiring', () => {
  const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/static.yml'), 'utf8');
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const pwaService = readFileSync(resolve(process.cwd(), 'src/services/pwa.ts'), 'utf8');
  const audioPipeline = readFileSync(resolve(process.cwd(), 'src/services/audioPipeline.ts'), 'utf8');
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')) as {
    start_url: string;
    scope: string;
    icons: Array<{ src: string }>;
  };

  it('builds the app under the repository subpath only for GitHub Pages', () => {
    expect(viteConfig).toContain("process.env.GITHUB_PAGES === 'true'");
    expect(viteConfig).toContain("'/SandboxSecretary/'");
    expect(viteConfig).toContain("resolve(__dirname, 'index.html')");
    expect(viteConfig).toContain("resolve(__dirname, 'sandbox-secretary.html')");
    expect(workflow).toContain('GITHUB_PAGES: true');
    expect(workflow).toContain('actions/configure-pages@v5');
    expect(workflow).toContain('actions/deploy-pages@v4');
  });

  it('uses relative PWA manifest URLs so GitHub Pages controls the install scope', () => {
    expect(manifest.start_url).toBe('.');
    expect(manifest.scope).toBe('.');
    expect(manifest.icons[0]?.src).toBe('icons/icon.svg');
    expect(indexHtml).toContain('<link rel="manifest" href="manifest.json"');
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes"');
  });

  it('resolves browser runtime assets from the Vite base URL', () => {
    expect(pwaService).toContain('import.meta.env.BASE_URL');
    expect(pwaService).toContain('sw.js');
    expect(pwaService).toContain('navigator.serviceWorker.register(swUrl.href');
    expect(pwaService).not.toContain("navigator.serviceWorker.register('/SandboxSecretary/sw.js'");
    expect(pwaService).not.toContain('getRegistrations()');

    expect(audioPipeline).toContain('import.meta.env.BASE_URL');
    expect(audioPipeline).toContain('audio-downsampler.worklet.js');
    expect(audioPipeline).not.toContain("'/SandboxSecretary/audio-downsampler.worklet.js'");
  });
});
