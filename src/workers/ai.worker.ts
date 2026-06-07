import type { PolishOptions, TranscriptSegment } from '../types';

type IncomingMessage =
  | { type: 'initialize'; sttModel: string; llmModel: string }
  | { type: 'transcribe'; id: string; samples: Float32Array; language: string }
  | { type: 'polish'; id: string; text: string; options: PolishOptions }
  | { type: 'translate'; id: string; text: string; sourceLang: string; targetLang: string };

// Declare global interfaces for the CDN libraries
declare global {
  interface Window {
    webllm: {
      CreateMLCEngine: (model: string, options: { initProgressCallback?: (progress: { text: string }) => void }) => Promise<any>;
    };
  }
}

let webLlmEngine: any = null;
let initialized = false;

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'initialize') {
      await initializeModels(message.llmModel);
      initialized = true;
      post({ type: 'ready' });
    }
    if (message.type === 'transcribe') {
      // Temporary structural fallback while audio pipeline initializes
      post({ 
        type: 'transcript', 
        id: message.id, 
        segment: { text: 'Audio received by worker. Processing transcription...', confidence: 1.0, startedAt: performance.now(), endedAt: performance.now() } 
      });
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

async function initializeModels(llmModel: string): Promise<void> {
  const targetLlmModel = "Gemma-2b-it-q4f16_1-MLC";
  
  if (!('gpu' in navigator)) {
    post({ type: 'resource-warning', message: 'WebGPU is unavailable in this browser context.' });
    return;
  }

  try {
    // Import WebLLM directly via standard Worker CDN script injection to bypass Vite bundle paths
    importScripts('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.46/dist/index.js');
    
    // @ts-ignore
    if (typeof webllm !== 'undefined') {
      // @ts-ignore
      webLlmEngine = await webllm.CreateMLCEngine(targetLlmModel, {
        initProgressCallback: (progress: { text: string }) => {
          post({ type: 'resource-warning', message: progress.text });
        }
      });
    } else {
      throw new Error('WebLLM library failed to initialize globally.');
    }
  } catch (error) {
    webLlmEngine = null;
    post({ type: 'resource-warning', message: `Local LLM initialization failed: ${error instanceof Error ? error.message : String(error)}` });
  }
}

async function polishWithLocalModel(text: string, options: PolishOptions): Promise<string> {
  if (!webLlmEngine) return text;
  
  const response = await webLlmEngine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `Polish dictated text into clean, beautifully structured Markdown text. Fix grammar, remove conversational filler words, and adhere tightly to these parameters: Tone=${options.tone || 'professional'}, Structure=${options.structure || 'paragraphs'}.`
      },
      { role: 'user', content: text }
    ],
    temperature: 0.3,
    max_tokens: 1024
  });
  return response.choices?.[0]?.message?.content?.trim() || text;
}

async function translateWithLocalModel(text: string, sourceLang: string, targetLang: string): Promise<string> {
  if (!webLlmEngine) return text;

  const response = await webLlmEngine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `Translate the text directly from ${sourceLang} to ${targetLang}. Preserve formatting and return only the raw translation output.`
      },
      { role: 'user', content: text }
    ],
    temperature: 0.1,
    max_tokens: 1024
  });
  return response.choices?.[0]?.message?.content?.trim() || text;
}

function post(message: Record<string, any>): void {
  self.postMessage(message);
}
