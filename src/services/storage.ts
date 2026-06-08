import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CacheMetrics, SecretaryDocument } from '../types';

interface ConfigRecord<T = unknown> {
  key: string;
  value: T;
  updated_at: string;
}

interface SecretarySchema extends DBSchema {
  documents: {
    key: string;
    value: SecretaryDocument;
    indexes: {
      'by-timestamp': string;
      'by-sync-status': string;
    };
  };
  config: {
    key: string;
    value: ConfigRecord;
  };
}

type NewDocument = Omit<SecretaryDocument, 'id' | 'timestamp'> &
  Partial<Pick<SecretaryDocument, 'id' | 'timestamp'>>;

export class SecretaryStorage {
  private readonly dbPromise: Promise<IDBPDatabase<SecretarySchema>>;

  constructor(databaseName = 'sandbox-secretary') {
    this.dbPromise = openDB<SecretarySchema>(databaseName, 2, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('documents')) {
          const store = database.createObjectStore('documents', { keyPath: 'id' });
          store.createIndex('by-timestamp', 'timestamp');
          store.createIndex('by-sync-status', 'sync_status');
        }
        if (!database.objectStoreNames.contains('config')) {
          database.createObjectStore('config', { keyPath: 'key' });
        }
      }
    });
  }

  async saveDocument(document: NewDocument): Promise<SecretaryDocument> {
    const db = await this.dbPromise;
    const now = new Date().toISOString();
    const record: SecretaryDocument = {
      id: document.id ?? crypto.randomUUID(),
      timestamp: document.timestamp ?? now,
      ...document
    };
    await db.put('documents', record);
    return record;
  }

  async updateDocument(document: SecretaryDocument): Promise<void> {
    const db = await this.dbPromise;
    await db.put('documents', document);
  }

  async getDocument(id: string): Promise<SecretaryDocument | undefined> {
    const db = await this.dbPromise;
    return db.get('documents', id);
  }

  async listDocuments(): Promise<SecretaryDocument[]> {
    const db = await this.dbPromise;
    const documents = await db.getAllFromIndex('documents', 'by-timestamp');
    return documents.reverse();
  }

  async listPendingDocuments(): Promise<SecretaryDocument[]> {
    const db = await this.dbPromise;
    const pending = await db.getAllFromIndex('documents', 'by-sync-status', 'pending');
    return pending.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async setSyncStatus(id: string, sync_status: SecretaryDocument['sync_status'], failure_reason?: string): Promise<void> {
    const current = await this.getDocument(id);
    if (!current) {
      return;
    }
    await this.updateDocument({ ...current, sync_status, failure_reason });
  }

  async getMetrics(): Promise<CacheMetrics> {
    const db = await this.dbPromise;
    const all = await db.getAll('documents');
    return all.reduce<CacheMetrics>(
      (metrics, document) => {
        metrics.documents += 1;
        metrics[document.sync_status] += 1;
        return metrics;
      },
      { documents: 0, pending: 0, failed: 0, synced: 0 }
    );
  }

  async putConfig<T>(key: string, value: T): Promise<void> {
    const db = await this.dbPromise;
    await db.put('config', { key, value, updated_at: new Date().toISOString() });
  }

  async getConfig<T>(key: string): Promise<T | undefined> {
    const db = await this.dbPromise;
    const record = await db.get('config', key);
    return record?.value as T | undefined;
  }

  async deleteConfig(key: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('config', key);
  }
}
