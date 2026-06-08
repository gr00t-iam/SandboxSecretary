// Real on-device LLM polishing + translation with Gemma 4 E2B via Google's
// MediaPipe LLM Inference (LiteRT) runtime. Runtime + model load at runtime
// (never bundled). The ~2 GB .task model is downloaded ONCE, written to the
// Origin Private File System (OPFS) in small chunks, and reused on every later
// visit. Model bytes are cached separately from the engine, so a failed engine
// init never forces a re-download.
//
// Requirements: WebGPU (Chrome/Edge). The community build is Apache-2.0 and
// ungated (no Hugging Face token needed). Callers MUST provide a fallback.

const MEDIAPIPE_ESM = 'https://esm.sh/@mediapipe/tasks-genai@0.10.27';
const MEDIAPIPE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.27/wasm';
const GEMMA4_E2B_WEB_TASK =
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task?download=true';
const OPFS_MODEL_NAME = 'gemma-4-E2B-it-web.task';
const MIN_VALID_MODEL_BYTES = 100 * 1024 * 1024; // guard against truncated cache
const OPFS_WRITE_CHUNK = 8 * 1024 * 1024; // 8 MB writes are far more reliable than one 2 GB blob

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

let modelBytesPromise: Promise<Uint8Array> | null = null;
let enginePromise: Promise<any> | null = null;
let engineReady = false;

export function isGemmaSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

// True only once the model is fully loaded — lets Translate reuse the engine
// without ever triggering the multi-GB download on its own.
export function isGemmaReady(): boolean {
  return engineReady;
}

// --- OPFS model cache --------------------------------------------------------
async function getOpfsRoot(): Promise<any | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function readModelFromOpfs(): Promise<Uint8Array | null> {
  try {
    const root = await getOpfsRoot();
    if (!root) return null;
    const handle = await root.getFileHandle(OPFS_MODEL_NAME);
    const file = await handle.getFile();
    if (!file || file.size < MIN_VALID_MODEL_BYTES) return null; // missing/partial
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null; // not cached yet (getFileHandle throws) or OPFS unavailable
  }
}

async function writeModelToOpfs(bytes: Uint8Array): Promise<void> {
  try {
    const root = await getOpfsRoot();
    if (!root) return;
    const handle = await root.getFileHandle(OPFS_MODEL_NAME, { create: true });
    const writable = (await handle.createWritable()) as { write: (d: Uint8Array) => Promise<void>; close: () => Promise<void> };
    for (let offset = 0; offset < bytes.length; offset += OPFS_WRITE_CHUNK) {
      await writable.write(bytes.subarray(offset, Math.min(offset + OPFS_WRITE_CHUNK, bytes.length)));
    }
    await writable.close();
  } catch {
    // Best-effort cache (quota/permission) — failure just means re-download later.
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

// Resolves the model bytes from OPFS, or downloads + caches them. Cached as its
// own promise so engine-init failures never cause a re-download.
function loadModelBytes(onProgress?: (message: string) => void): Promise<Uint8Array> {
  if (modelBytesPromise) return modelBytesPromise;
  modelBytesPromise = (async () => {
    // Ask for durable storage so the browser keeps the 2 GB cache around.
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* ignore */
    }
    const cached = await readModelFromOpfs();
    if (cached) {
      onProgress?.('Loading cached Gemma 4 model…');
      return cached;
    }
    onProgress?.('Downloading Gemma 4 E2B (~2 GB, first run only)…');
    const bytes = await downloadModel(onProgress);
    onProgress?.('Caching Gemma 4 model for next time…');
    await writeModelToOpfs(bytes);
    return bytes;
  })().catch((error) => {
    modelBytesPromise = null; // allow a later retry of the download
    throw error instanceof Error ? error : new Error(String(error));
  });
  return modelBytesPromise;
}

async function getEngine(onProgress?: (message: string) => void): Promise<any> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    onProgress?.('Loading Gemma 4 runtime…');
    const mediapipe = await import(/* @vite-ignore */ MEDIAPIPE_ESM);
    const genai = await mediapipe.FilesetResolver.forGenAiTasks(MEDIAPIPE_WASM);
    const modelBytes = await loadModelBytes(onProgress);
    const engine = await mediapipe.LlmInference.createFromOptions(genai, {
      baseOptions: { modelAssetBuffer: modelBytes },
      maxTokens: 4096,
      topK: 40,
      temperature: 0.7,
      randomSeed: 101
    });
    engineReady = true;
    return engine;
  })().catch((error) => {
    enginePromise = null; // model stays cached; only the engine is retried
    engineReady = false;
    throw error instanceof Error ? error : new Error(String(error));
  });
  return enginePromise;
}

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
