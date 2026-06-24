import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AiWorkerClient singleton worker contract', () => {
  const originalWorker = globalThis.Worker;

  afterEach(() => {
    vi.resetModules();
    globalThis.Worker = originalWorker;
  });

  it('shares one worker and posts model initialization only once per browser session', async () => {
    class FakeWorker {
      static instances: FakeWorker[] = [];
      public messages: unknown[] = [];
      public onmessage: ((event: MessageEvent) => void) | null = null;
      public terminated = false;

      constructor() {
        FakeWorker.instances.push(this);
      }

      postMessage(message: unknown): void {
        this.messages.push(message);
        if ((message as { type?: string }).type === 'initialize') {
          this.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
        }
      }

      terminate(): void {
        this.terminated = true;
      }
    }

    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    const { AiWorkerClient } = await import('./aiWorkerClient');
    const first = new AiWorkerClient(vi.fn(), vi.fn());
    const second = new AiWorkerClient(vi.fn(), vi.fn());

    first.initialize();
    second.initialize();
    first.dispose();
    second.dispose();

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].messages.filter((message) => (message as { type?: string }).type === 'initialize')).toHaveLength(1);
    expect(FakeWorker.instances[0].terminated).toBe(false);
  });
});
