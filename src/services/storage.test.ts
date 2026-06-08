import { describe, expect, it } from 'vitest';
import { SecretaryStorage } from './storage';

describe('SecretaryStorage', () => {
  it('stores documents and reports queue metrics', async () => {
    const storage = new SecretaryStorage(`sandbox-secretary-test-${crypto.randomUUID()}`);
    await storage.saveDocument({
      raw_transcript: 'raw',
      polished_text: 'polished',
      source_lang: 'en',
      target_lang: 'es',
      sync_status: 'pending',
      sync_destination: { type: 'email', path_or_recipient: 'team@example.test' },
      title: 'Test note'
    });

    const metrics = await storage.getMetrics();
    expect(metrics).toMatchObject({ documents: 1, pending: 1, failed: 0, synced: 0 });
  });

  it('returns pending documents chronologically', async () => {
    const storage = new SecretaryStorage(`sandbox-secretary-test-${crypto.randomUUID()}`);
    const later = await storage.saveDocument({
      raw_transcript: 'later',
      polished_text: 'later',
      source_lang: 'en',
      target_lang: 'en',
      sync_status: 'pending',
      sync_destination: { type: 'email', path_or_recipient: 'b@example.test' },
      title: 'Later',
      timestamp: '2026-06-07T18:00:00.000Z'
    });
    const earlier = await storage.saveDocument({
      raw_transcript: 'earlier',
      polished_text: 'earlier',
      source_lang: 'en',
      target_lang: 'en',
      sync_status: 'pending',
      sync_destination: { type: 'email', path_or_recipient: 'a@example.test' },
      title: 'Earlier',
      timestamp: '2026-06-07T17:00:00.000Z'
    });

    const pending = await storage.listPendingDocuments();
    expect(pending.map((doc) => doc.id)).toEqual([earlier.id, later.id]);
  });

  it('stores local app configuration separately from documents', async () => {
    const storage = new SecretaryStorage(`sandbox-secretary-test-${crypto.randomUUID()}`);
    await storage.putConfig('driveCredentials', {
      folderId: 'folder-id',
      clientId: 'client-id',
      accessToken: 'token'
    });

    await expect(storage.getConfig('driveCredentials')).resolves.toMatchObject({
      folderId: 'folder-id',
      clientId: 'client-id',
      accessToken: 'token'
    });

    await storage.deleteConfig('driveCredentials');
    await expect(storage.getConfig('driveCredentials')).resolves.toBeUndefined();
  });
});
