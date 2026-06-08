// Real on-device LLM polishing + translation with Gemma 4 E2B via Google's
// MediaPipe LLM Inference (LiteRT) runtime. The runtime + the browser-optimized
// .task model load at runtime (never bundled). The model (~2 GB) is downloaded
// once and cached in the Origin Private File System (OPFS), so later sessions
// reuse it instead of re-downloading.
//
// Requirements: WebGPU (Chrome/Edge). The community build is Apache-2.0 and
// ungated, so no Hugging Face token is needed. Callers MUST provide a fallback
// for browsers without WebGPU or when the download/cache is unavailable.

const MEDIAPIPE_ESM = 'https://esm.sh/@mediapipe/tasks-genai@0.10.27';
const MEDIAPIPE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.27/wasm';
const GEMMA4_E2B_WEB_TASK =
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task?download=true';
const OPFS_MODEL_NAME = 'gemma-4-E2B-it-web.task';

export interface GemmaPolishOptions {
  concise: number;
  structure: number;
  tone: number;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese'
};

let enginePromise: Promise<any> | null = null;
let engineReady = false;

// WebGPU is mandatory for the MediaPipe LLM runtime.
export function isGemmaSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

// True only once the model is fully loaded — used to route Translate through
// Gemma without triggering the multi-GB download just for a translation.
export function isGemmaReady(): boolean {
  return engineReady;
}

// --- OPFS model cache --------------------------------------------------------
async function readModelFromOpfs(): Promise<Uint8Array | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(OPFS_MODEL_NAME);
    const file = await handle.getFile();
    if (!file.size) return null;
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null; // not cached yet (getFileHandle throws) or OPFS unavailable
  }
}

async function writeModelToOpfs(bytes: Uint8Array): Promise<void> {
  try {
    if (!navigator.storage?.getDirectory) return;
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(OPFS_MODEL_NAME, { create: true });
    const writable = await handle.createWritable();
    // Cast: lib DOM types are strict about shared-vs-non-shared buffers here.
    await (writable as { write: (data: Uint8Array) => Promise<void> }).write(bytes);
    await writable.close();
  } catch {
    // Best-effort cache (e.g. quota exceeded) — failure just means re-download.
  }
}

async function downloadModel(onProgress?: (message: string) => void): Promise<Uint8Array> {
  const response = await fetch(GEMMA4_E2B_WEB_TASK);
  if (!response.ok || !response.body) {
    throw new Error(`Gemma model download failed (HTTP ${response.status}).`);
  }
  const total = Number(response.headers.get('Content-Length') || 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.length;
    const mb = (received / 1048576).toFixed(0);
    onProgress?.(total ? `Downloading Gemma 4 E2B… ${Math.round((received / total) * 100)}%` : `Downloading Gemma 4 E2B… ${mb} MB`);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function getEngine(onProgress?: (message: string) => void): Promise<any> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    onProgress?.('Loading Gemma 4 runtime…');
    const mediapipe = await import(/* @vite-ignore */ MEDIAPIPE_ESM);
    const FilesetResolver = mediapipe.FilesetResolver;
    const LlmInference = mediapipe.LlmInference;
    const genai = await FilesetResolver.forGenAiTasks(MEDIAPIPE_WASM);

    let modelBytes = await readModelFromOpfs();
    if (modelBytes) {
      onProgress?.('Loading cached Gemma 4 model…');
    } else {
      onProgress?.('Downloading Gemma 4 E2B (~2 GB, first run only)…');
      modelBytes = await downloadModel(onProgress);
      onProgress?.('Caching Gemma 4 model for next time…');
      await writeModelToOpfs(modelBytes);
    }

    const engine = await LlmInference.createFromOptions(genai, {
      baseOptions: { modelAssetBuffer: modelBytes },
      maxTokens: 4096,
      topK: 40,
      temperature: 0.7,
      randomSeed: 101
    });
    engineReady = true;
    return engine;
  })().catch((error) => {
    enginePromise = null;
    engineReady = false;
    throw error instanceof Error ? error : new Error(String(error));
  });
  return enginePromise;
}

// Shared streaming generation helper.
function generate(engine: any, prompt: string, onPartial?: (partial: string) => void): Promise<string> {
  if (typeof onPartial === 'function') {
    return new Promise<string>((resolve, reject) => {
      let full = '';
      try {
        engine.generateResponse(prompt, (partial: string, done: boolean) => {
          full += partial;
          onPartial(full.trimStart());
          if (done) resolve(full.trim());
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  return Promise.resolve(engine.generateResponse(prompt)).then((result) => String(result).trim());
}

// Polish dictated text with Gemma 4 E2B (streams partial output via onPartial).
export async function polishWithGemma(
  text: string,
  options: GemmaPolishOptions,
  onPartial?: (partial: string) => void,
  onProgress?: (message: string) => void
): Promise<string> {
  if (!isGemmaSupported()) {
    throw new Error('WebGPU is required for Gemma 4 and is unavailable in this browser.');
  }
  const engine = await getEngine(onProgress);
  return generate(engine, buildPolishPrompt(text, options), onPartial);
}

// Translate with Gemma 4 E2B. Intended to be called only when isGemmaReady() is
// true, so it reuses the already-loaded engine rather than starting a download.
export async function translateWithGemma(
  text: string,
  sourceLang: string,
  targetLang: string,
  onPartial?: (partial: string) => void
): Promise<string> {
  if (!isGemmaSupported()) {
    throw new Error('WebGPU is required for Gemma 4 and is unavailable in this browser.');
  }
  const engine = await getEngine();
  return generate(engine, buildTranslatePrompt(text, sourceLang, targetLang), onPartial);
}

function buildPolishPrompt(text: string, options: GemmaPolishOptions): string {
  const tone =
    options.tone >= 70 ? 'warm and friendly' : options.tone <= 30 ? 'direct and professional' : 'neutral and professional';
  const concise = options.concise >= 65 ? 'Be concise and cut redundancy.' : 'Preserve the speaker’s detail.';
  const structure =
    options.structure >= 70 ? 'Use short paragraphs or bullet points where they help readability.' : 'Keep it as flowing prose.';
  return [
    'You are a careful editor. Rewrite the dictated text below into clean, correct, well-punctuated writing.',
    `Tone: ${tone}. ${concise} ${structure}`,
    'Fix grammar and capitalization, and remove filler words such as "um", "uh", and "you know".',
    'Do not add new facts or commentary. Return ONLY the rewritten text.',
    '',
    'Dictated text:',
    text
  ].join('\n');
}

function buildTranslatePrompt(text: string, sourceLang: string, targetLang: string): string {
  const from = LANGUAGE_NAMES[sourceLang] || sourceLang;
  const to = LANGUAGE_NAMES[targetLang] || targetLang;
  return [
    `Translate the text below from ${from} to ${to}.`,
    'Preserve meaning and tone. Return ONLY the translation, with no notes, labels, or quotation marks.',
    '',
    text
  ].join('\n');
}
