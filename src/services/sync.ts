import type { SecretaryDocument } from '../types';
import type { DriveCredentials } from './defaultConfig';
import type { SecretaryStorage } from './storage';
import { GMAIL_SEND_ENDPOINT } from './oauth';

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
      await this.sendEmail(document);
      return;
    }

    await uploadToDrive(document, this.fetchImpl, this.dependencies.getDriveCredentials);
  }

  // Sends the note via the Gmail API when Google is authorized (a real send with
  // no mail client); otherwise hands off to the system mailto: handler.
  private async sendEmail(document: SecretaryDocument): Promise<void> {
    const recipient = document.sync_destination.type === 'email' ? document.sync_destination.path_or_recipient : '';
    const credentials = await this.dependencies.getDriveCredentials?.();
    const token = credentials?.accessToken;
    if (token) {
      try {
        await sendGmailMessage(document, recipient, token, this.fetchImpl);
        return;
      } catch {
        // Gmail failed (token, scope, or network) — fall back to mailto below.
      }
    }
    this.dependencies.openMailto(buildMailtoHref(document));
  }
}

export function buildMailtoHref(document: SecretaryDocument): string {
  const recipient = encodeURIComponent(document.sync_destination.path_or_recipient);
  const subject = encodeURIComponent(`Sandbox Secretary: ${document.title}`);
  const body = encodeURIComponent(`${document.polished_text}\n\n---\nRaw transcript:\n${document.raw_transcript}`);
  return `mailto:${recipient}?subject=${subject}&body=${body}`;
}

async function sendGmailMessage(
  document: SecretaryDocument,
  recipient: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<void> {
  const subject = `Sandbox Secretary: ${document.title}`;
  const body = `${document.polished_text}\n\n---\nRaw transcript:\n${document.raw_transcript}`;
  const response = await fetchImpl(GMAIL_SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: buildRawEmail(recipient, subject, body) })
  });
  if (!response.ok) {
    throw new Error(`Gmail API send failed with ${response.status}.`);
  }
}

// Builds an RFC 2822 message and base64url-encodes it for the Gmail API.
function buildRawEmail(to: string, subject: string, body: string): string {
  const message =
    `To: ${to}\r\n` +
    `Subject: =?UTF-8?B?${base64Utf8(subject)}?=\r\n` +
    'MIME-Version: 1.0\r\n' +
    'Content-Type: text/plain; charset="UTF-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    base64Utf8(body);
  return base64Utf8(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
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
    name: document.title || document.id,
    mimeType: 'application/vnd.google-apps.document',
    parents: [folderId]
  };
  const html = `<!doctype html><meta charset="utf-8"><pre>${escapeHtml(document.polished_text)}</pre>`;
  const boundary = `sandbox-secretary-${document.id}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[character];
  });
}
