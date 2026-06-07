import type { PolishOptions, TranscriptSegment } from '../types';

type PendingResolver = (value: string | TranscriptSegment) => void;

export class AiWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingResolver>();
  private ready = false;

  constructor(
    onStatus: (status: string) => void,
    onWarning: (warning: string) => void
  ) {
    this.worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'ready') {
        this.ready = true;
        onStatus('system-ready');
      }
      if (message.type === 'resource-warning') {
        onWarning(message.message);
      }
      if (message.type === 'model-progress') {
        onStatus('model-initializing');
      }
      if (message.type === 'error') {
        onWarning(message.message);
      }
      if (message.type === 'transcript' || message.type === 'polished' || message.type === 'translated') {
        const resolver = this.pending.get(message.id);
        this.pending.delete(message.id);
        resolver?.(message.segment ?? message.text ?? '');
      }
    };
  }

  initialize(): void {
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
    this.worker.terminate();
    this.pending.clear();
  }
}
