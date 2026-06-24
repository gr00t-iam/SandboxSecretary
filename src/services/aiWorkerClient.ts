import type { PolishOptions, TranscriptSegment } from '../types';

type PendingResolver = (value: string | TranscriptSegment) => void;

let sharedWorker: Worker | null = null;
let sharedWorkerReady = false;
let sharedWorkerInitialized = false;
const activeClients = new Set<AiWorkerClient>();

export class AiWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingResolver>();
  private ready = false;

  constructor(
    onStatus: (status: string) => void,
    onWarning: (warning: string) => void
  ) {
    this.onStatus = onStatus;
    this.onWarning = onWarning;
    this.worker = getSharedWorker();
    activeClients.add(this);
    if (sharedWorkerReady) {
      this.ready = true;
      this.onStatus('system-ready');
    }
  }

  private readonly onStatus: (status: string) => void;
  private readonly onWarning: (warning: string) => void;

  initialize(): void {
    if (sharedWorkerInitialized) {
      if (sharedWorkerReady) {
        this.ready = true;
        this.onStatus('system-ready');
      }
      return;
    }
    sharedWorkerInitialized = true;
    this.worker.postMessage({
      type: 'initialize',
      sttModel: 'Xenova/whisper-tiny.en',
      llmModel: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  async transcribe(samples: Float32Array, language: string): Promise<TranscriptSegment> {
    const id = crypto.randomUUID();
    const result = new Promise<TranscriptSegment>((resolve) => {
      this.pending.set(id, resolve as PendingResolver);
    });
    this.worker.postMessage({ type: 'transcribe', id, samples, language }, [samples.buffer]);
    return result;
  }

  async polish(text: string, options: PolishOptions): Promise<string> {
    const id = crypto.randomUUID();
    const result = new Promise<string>((resolve) => {
      this.pending.set(id, resolve as PendingResolver);
    });
    this.worker.postMessage({ type: 'polish', id, text, options });
    return result;
  }

  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const id = crypto.randomUUID();
    const result = new Promise<string>((resolve) => {
      this.pending.set(id, resolve as PendingResolver);
    });
    this.worker.postMessage({ type: 'translate', id, text, sourceLang, targetLang });
    return result;
  }

  dispose(): void {
    activeClients.delete(this);
    this.pending.clear();
  }

  handleMessage(message: {
    type: string;
    id?: string;
    message?: string;
    segment?: TranscriptSegment;
    text?: string;
  }): void {
    if (message.type === 'ready') {
      this.ready = true;
      this.onStatus('system-ready');
    }
    if (message.type === 'resource-warning' && message.message) {
      this.onWarning(message.message);
    }
    if (message.type === 'model-progress') {
      this.onStatus('model-initializing');
    }
    if (message.type === 'error' && message.message) {
      this.onWarning(message.message);
    }
    if ((message.type === 'transcript' || message.type === 'polished' || message.type === 'translated') && message.id) {
      const resolver = this.pending.get(message.id);
      this.pending.delete(message.id);
      resolver?.(message.segment ?? message.text ?? '');
    }
  }
}

function getSharedWorker(): Worker {
  if (sharedWorker) {
    return sharedWorker;
  }
  sharedWorker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' });
  sharedWorker.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'ready') {
      sharedWorkerReady = true;
    }
    activeClients.forEach((client) => client.handleMessage(message));
  };
  return sharedWorker;
}
