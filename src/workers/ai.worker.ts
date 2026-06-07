import { polishTranscript, translateTextOffline } from '../services/textProcessing';
import type { PolishOptions, TranscriptSegment } from '../types';

type IncomingMessage =
  | { type: 'initialize'; sttModel: string; llmModel: string }
  | { type: 'transcribe'; id: string; samples: Float32Array; language: string }
  | { type: 'polish'; id: string; text: string; options: PolishOptions }
  | { type: 'translate'; id: string; text: string; sourceLang: string; targetLang: string };

let sttPipeline: unknown;
let webLlmEngine: unknown;
let initialized = false;

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'initialize') {
      await initializeModels(message.sttModel, message.llmModel);
      initialized = true;
      post({ type: 'ready' });
    }

    if (message.type === 'transcribe') {
      const segment = await transcribeSamples(message.samples, message.language);
      post({ type: 'transcript', id: message.id, segment });
    }

    if (message.type === 'polish') {
      const text = await polishWithLocalModel(message.text, message.options);
      post({ type: 'polished', id: message.id, text });
    }

    if (message.type === 'translate') {
      const text = await translateWithLocalModel(message.text, message.sourceLang, message.targetLang);
      post({ type: 'translated', id: message.id, text });
    }
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      initialized
    });
  }
};

async function initializeModels(sttModel: string, llmModel: string): Promise<void> {
  await Promise.all([withTimeout(initializeStt(sttModel), 8000, 'STT model load timed out; offline fallback remains active.'), initializeWebLlm(llmModel)]);
}

async function initializeStt(sttModel: string): Promise<void> {
  try {
    const hasLocalModel = await localModelExists(sttModel);
    if (!hasLocalModel) {
      post({
        type: 'resource-warning',
        message: 'STT model assets are not bundled yet; typed dictation and local text processing remain active.'
      });
      return;
    }
    const transformers = (await import('@huggingface/transformers')) as {
      env: { allowLocalModels: boolean; allowRemoteModels: boolean; localModelPath: string; useBrowserCache: boolean };
      pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<unknown>;
    };
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = false;
    transformers.env.localModelPath = '/models/';
    transformers.env.useBrowserCache = true;
    sttPipeline = await transformers.pipeline('automatic-speech-recognition', sttModel, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (progress: unknown) => post({ type: 'model-progress', progress })
    });
  } catch (error) {
    sttPipeline = undefined;
    post({ type: 'resource-warning', message: `STT model unavailable: ${formatModelError(error)}` });
  }
}

async function initializeWebLlm(llmModel: string): Promise<void> {
  if (!('gpu' in navigator)) {
    post({ type: 'resource-warning', message: 'WebGPU is unavailable; deterministic local polishing remains active.' });
    return;
  }

  if (!(await localModelExists(llmModel))) {
    post({
      type: 'resource-warning',
      message: 'WebLLM model assets are not bundled yet; deterministic local polishing remains active.'
    });
    return;
  }

  try {
    const webllm = (await import('@mlc-ai/web-llm')) as {
      CreateMLCEngine: (
        model: string,
        options: { initProgressCallback?: (progress: unknown) => void }
      ) => Promise<unknown>;
    };
    webLlmEngine = await webllm.CreateMLCEngine(llmModel, {
      initProgressCallback: (progress) => post({ type: 'model-progress', progress })
    });
  } catch (error) {
    webLlmEngine = undefined;
    post({ type: 'resource-warning', message: `Local LLM unavailable: ${formatModelError(error)}` });
  }
}

async function transcribeSamples(samples: Float32Array, language: string): Promise<TranscriptSegment> {
  if (!sttPipeline) {
    return {
      text: '',
      confidence: 0,
      startedAt: performance.now(),
      endedAt: performance.now()
    };
  }

  const startedAt = performance.now();
  const pipeline = sttPipeline as (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>;
  const result = await pipeline(samples, {
    sampling_rate: 16000,
    language,
    task: 'transcribe',
    chunk_length_s: 8,
    stride_length_s: 1
  });
  return {
    text: result.text ?? '',
    confidence: result.text ? 0.85 : 0,
    startedAt,
    endedAt: performance.now()
  };
}

async function polishWithLocalModel(text: string, options: PolishOptions): Promise<string> {
  if (!webLlmEngine) {
    return polishTranscript(text, options);
  }

  const engine = webLlmEngine as {
    chat: { completions: { create: (request: Record<string, unknown>) => Promise<{ choices?: Array<{ message?: { content?: string } }> }> } };
  };
  const response = await engine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content:
          'Polish dictated text into concise Markdown. Remove filler words, keep the speaker intent unchanged, and do not invent facts.'
      },
      { role: 'user', content: text }
    ],
    temperature: 0.2,
    max_tokens: 700
  });
  return response.choices?.[0]?.message?.content?.trim() || polishTranscript(text, options);
}

async function translateWithLocalModel(text: string, sourceLang: string, targetLang: string): Promise<string> {
  if (!webLlmEngine) {
    return translateTextOffline(text, sourceLang, targetLang);
  }

  const engine = webLlmEngine as {
    chat: { completions: { create: (request: Record<string, unknown>) => Promise<{ choices?: Array<{ message?: { content?: string } }> }> } };
  };
  const response = await engine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `Translate from ${sourceLang} to ${targetLang}. Preserve meaning and return only the translated text.`
      },
      { role: 'user', content: text }
    ],
    temperature: 0,
    max_tokens: 900
  });
  return response.choices?.[0]?.message?.content?.trim() || translateTextOffline(text, sourceLang, targetLang);
}

function post(message: Record<string, unknown>): void {
  self.postMessage(message);
}

async function localModelExists(model: string): Promise<boolean> {
  const response = await fetch(`/models/${model}/config.json`).catch(() => undefined);
  return Boolean(response?.ok && response.headers.get('content-type')?.includes('application/json'));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, warning: string): Promise<T | undefined> {
  let timer: number | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = self.setTimeout(() => {
      post({ type: 'resource-warning', message: warning });
      resolve(undefined);
    }, timeoutMs);
  });
  const result = await Promise.race([promise, timeout]);
  if (timer) {
    self.clearTimeout(timer);
  }
  return result;
}

function formatModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Unexpected token') || message.includes('<!doctype')) {
    return 'model assets are not available in the local cache yet.';
  }
  return message;
}
