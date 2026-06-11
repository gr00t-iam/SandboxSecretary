import { describe, expect, it, vi } from 'vitest';
import { SecretaryStorage } from './storage';
import { SyncManager } from './sync';

describe('SyncManager', () => {
  it('creates a mailto export and marks the document as synced', async () => {
    const storage = new SecretaryStorage(`sandbox-secretary-sync-test-${crypto.randomUUID()}`);
    await storage.saveDocument({
      raw_transcript: 'raw',
      polished_text: '# Notes\n\nSend update.',
      source_lang: 'en',
      target_lang: 'en',
      sync_status: 'pending',
      sync_destination: { type: 'email', path_or_recipient: 'ops@example.test' },
      title: 'Ops note'
    });
    const openMailto = vi.fn();
    const sync = new SyncManager(storage, { isOnline: () => true, openMailto });

    const result = await sync.flushPending();

    expect(result.synced).toBe(1);
    expect(openMailto.mock.calls[0][0]).toContain('mailto:ops%40example.test');
    const metrics = await storage.getMetrics();
    expect(metrics.synced).toBe(1);
  });

  it('leaves drive uploads pending when no OAuth token is available', async () => {
    const storage = new SecretaryStorage(`sandbox-secretary-sync-test-${crypto.randomUUID()}`);
    await storage.saveDocument({
      raw_transcript: 'raw',
      polished_text: 'draft',
      source_lang: 'en',
      target_lang: 'en',
      sync_status: 'pending',
      sync_destination: { type: 'gdrive', path_or_recipient: 'folder-id' },
      title: 'Drive note'
    });
    const sync = new SyncManager(storage, { isOnline: () => true, openMailto: vi.fn() });

    const result = await sync.flushPending();

    expect(result.failed).toBe(1);
    const metrics = await storage.getMetrics();
    expect(metrics.failed).toBe(1);
  });

  it('uses saved Drive credentials when a queued document only has the folder destination', async () => {
    const storage = new SecretaryStorage(`sandbox-secretary-sync-test-${crypto.randomUUID()}`);
    await storage.saveDocument({
      raw_transcript: 'raw',
      polished_text: 'draft',
      source_lang: 'en',
      target_lang: 'en',
      sync_status: 'pending',
      sync_destination: { type: 'gdrive', path_or_recipient: 'folder-id' },
      title: 'Drive note'
    });
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const sync = new SyncManager(storage, {
      isOnline: () => true,
      openMailto: vi.fn(),
      getDriveCredentials: async () => ({ folderId: 'folder-id', clientId: 'client-id', accessToken: 'saved-token' }),
      fetch: fetchImpl as unknown as typeof fetch
    });

    const result = await sync.flushPending();

    expect(result.synced).toBe(1);
    const [, requestInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestInit.headers).toMatchObject({
      Authorization: 'Bearer saved-token'
    });
    expect(String(requestInit.body)).toContain('"mimeType":"application/vnd.google-apps.document"');
    expect(String(requestInit.body)).toContain('Content-Type: text/html; charset=UTF-8');
    expect(String(requestInit.body)).toContain('<pre>draft</pre>');
  });
});
