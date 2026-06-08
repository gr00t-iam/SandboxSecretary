import type { SecretaryDocument } from '../types';
import type { DriveCredentials } from './defaultConfig';
import type { SecretaryStorage } from './storage';

interface SyncDependencies {
  isOnline: () => boolean;
  openMailto: (href: string) => void;
  getDriveCredentials?: () => Promise<DriveCredentials | undefined>;
  fetch?: typeof fetch;
}

export interface SyncFlushResult {
  scanned: number;
  synced: number;
  failed: number;
  deferred: number;
}

export class SyncManager {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly storage: SecretaryStorage,
    private readonly dependencies: SyncDependencies
  ) {
    this.fetchImpl = dependencies.fetch ?? fetch.bind(globalThis);
  }

  async flushPending(): Promise<SyncFlushResult> {
    const result: SyncFlushResult = { scanned: 0, synced: 0, failed: 0, deferred: 0 };
    if (!this.dependencies.isOnline()) {
      const pending = await this.storage.listPendingDocuments();
      return { ...result, scanned: pending.length, deferred: pending.length };
    }

    const pending = await this.storage.listPendingDocuments();
    for (const document of pending) {
      result.scanned += 1;
      try {
        await this.syncDocument(document);
        await this.storage.setSyncStatus(document.id, 'synced');
        result.synced += 1;
      } catch (error) {
        await this.storage.setSyncStatus(document.id, 'failed', error instanceof Error ? error.message : String(error));
        result.failed += 1;
      }
    }
    return result;
  }

  private async syncDocument(document: SecretaryDocument): Promise<void> {
    if (document.sync_destination.type === 'email') {
      this.dependencies.openMailto(buildMailtoHref(document));
      return;
    }

    await uploadToDrive(document, this.fetchImpl, this.dependencies.getDriveCredentials);
  }
}

export function buildMailtoHref(document: SecretaryDocument): string {
  const recipient = encodeURIComponent(document.sync_destination.path_or_recipient);
  const subject = encodeURIComponent(`Sandbox Secretary: ${document.title}`);
  const body = encodeURIComponent(`${document.polished_text}\n\n---\nRaw transcript:\n${document.raw_transcript}`);
  return `mailto:${recipient}?subject=${subject}&body=${body}`;
}

async function uploadToDrive(
  document: SecretaryDocument,
  fetchImpl: typeof fetch,
  getDriveCredentials?: () => Promise<DriveCredentials | undefined>
): Promise<void> {
  const { sync_destination } = document;
  if (sync_destination.type !== 'gdrive') {
    return;
  }

  const savedCredentials = await getDriveCredentials?.();
  const accessToken = sync_destination.accessToken || savedCredentials?.accessToken;
  const folderId = sync_destination.path_or_recipient || savedCredentials?.folderId;

  if (!accessToken) {
    throw new Error('Google Drive OAuth token is required for browser-native upload.');
  }
  if (!folderId) {
    throw new Error('Google Drive folder ID is required for browser-native upload.');
  }

  const metadata = {
    name: `${document.title || document.id}.md`,
    mimeType: 'text/markdown',
    parents: [folderId]
  };
  const boundary = `sandbox-secretary-${document.id}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/markdown; charset=UTF-8',
    '',
    document.polished_text,
    `--${boundary}--`
  ].join('\r\n');

  const response = await fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Google Drive upload failed with ${response.status}.`);
  }
}
