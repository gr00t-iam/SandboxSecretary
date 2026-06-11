import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Gemma engine caching contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/services/gemmaEngine.ts'), 'utf8');

  it('keeps a singleton engine warmup path for repeated dictations', () => {
    expect(source).toContain('let enginePromise: Promise<LlmEngine> | null = null');
    expect(source).toContain('export function warmGemmaEngine');
    expect(source).toContain('if (enginePromise) return enginePromise');
    expect(source).toContain('export function isGemmaLoading');
  });

  it('checks OPFS and browser Cache API before downloading model weights', () => {
    expect(source).toContain('readModelFromOpfs');
    expect(source).toContain('readModelFromBrowserCache');
    expect(source).toContain("caches.open(GEMMA_BROWSER_CACHE)");
    expect(source).toContain('cacheModelResponse(response.clone())');
  });
});
