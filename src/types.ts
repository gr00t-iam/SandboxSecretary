export type SyncStatus = 'pending' | 'synced' | 'failed';

export type SyncDestination =
  | { type: 'email'; path_or_recipient: string }
  | { type: 'gdrive'; path_or_recipient: string; accessToken?: string };

export interface SecretaryDocument {
  id: string;
  raw_transcript: string;
  polished_text: string;
  audio_blob_url?: string;
  source_lang: string;
  target_lang: string;
  sync_status: SyncStatus;
  sync_destination: SyncDestination;
  timestamp: string;
  title: string;
  failure_reason?: string;
}

export interface PolishOptions {
  concise: number;
  structure: number;
  tone: number;
}

export interface CacheMetrics {
  documents: number;
  pending: number;
  failed: number;
  synced: number;
}

export interface TranscriptSegment {
  text: string;
  confidence: number;
  startedAt: number;
  endedAt: number;
}

export type ModelState =
  | 'model-initializing'
  | 'system-ready'
  | 'recording-active'
  | 'processing-local-polish'
  | 'sync-pending'
  | 'resource-restricted'
  | 'offline';
