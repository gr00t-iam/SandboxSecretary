import { describe, expect, it, vi } from 'vitest';
import { SecretaryStorage } from './storage';
import { buildGmailAppComposeHref, buildGmailComposeHref, chooseGmailComposeHref, SyncManager } from './sync';

describe('SyncManager', () => {
  it('creates a Gmail browser compose URL and marks the document as synced', async () => {
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
    const openGmailCompose = vi.fn();
    const sync = new SyncManager(storage, { isOnline: () => true, openGmailCompose });

    const result = await sync.flushPending();

    expect(result.synced).toBe(1);
    expect(openGmailCompose.mock.calls[0][0]).toContain('https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1');
    expect(openGmailCompose.mock.calls[0][0]).toContain('to=ops%40example.test');
    expect(openGmailCompose.mock.calls[0][0]).toContain('body=%23%20Notes%0A%0ASend%20update.');
    const metrics = await storage.getMetrics();
    expect(metrics.synced).toBe(1);
  });

  it('preserves multiline output body when composing a Gmail URL', () => {
    const href = buildGmailComposeHref({
      id: 'doc-1',
      raw_transcript: 'first line\nsecond line',
      polished_text: 'polished line one\npolished line two',
      source_lang: 'en',
      target_lang: 'en',
      sync_status: 'pending',
      sync_destination: { type: 'email', path_or_recipient: 'ops@example.test' },
      timestamp: new Date().toISOString(),
      title: 'Multiline'
    });

    expect(href).toContain('https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1');
    expect(href).toContain('body=polished%20line%20one%0Apolished%20line%20two');
    expect(href).not.toContain('mailto:');
  });

  it('builds a Gmail app compose deep link for mobile app handoff', () => {
    const document = {
      id: 'doc-1',
      raw_transcript: 'raw line',
      polished_text: 'polished line one\npolished & special?',
      source_lang: 'en',
      target_lang: 'en',
      sync_status: 'pending' as const,
      sync_destination: { type: 'email' as const, path_or_recipient: 'ops@example.test' },
      timestamp: new Date().toISOString(),
      title: 'Mobile Draft'
    };

    const appHref = buildGmailAppComposeHref(document);
    expect(appHref).toContain('googlegmail:///co?');
    expect(appHref).toContain('to=ops%40example.test');
    expect(appHref).toContain('subject=Sandbox%20Secretary%3A%20Mobile%20Draft');
    expect(appHref).toContain('body=polished%20line%20one%0Apolished%20%26%20special%3F');
    expect(chooseGmailComposeHref(document, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(appHref);
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
    const sync = new SyncManager(storage, { isOnline: () => true, openGmailCompose: vi.fn() });

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
      openGmailCompose: vi.fn(),
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
