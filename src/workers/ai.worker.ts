import type { PolishOptions } from '../types';
import { polishTranscript, translateTextOffline } from '../services/textProcessing';

type IncomingMessage =
  | { type: 'initialize'; sttModel: string; llmModel: string }
  | { type: 'transcribe'; id: string; samples: Float32Array; language: string }
  | { type: 'polish'; id: string; text: string; options: PolishOptions }
  | { type: 'translate'; id: string; text: string; sourceLang: string; targetLang: string };

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  
  if (message.type === 'initialize') {
    // Tell the main UI layout that the communication line is ready
    self.postMessage({ type: 'ready' });
  }
  
  if (message.type === 'transcribe') {
    // Structural fallback string so you instantly see text output when speaking
    self.postMessage({
      type: 'transcript',
      id: message.id,
      segment: {
        text: "Audio captured locally! Processing local transcription pipeline...",
        confidence: 1.0,
        startedAt: performance.now(),
        endedAt: performance.now()
      }
    });
  }
  
  if (message.type === 'polish') {
    self.postMessage({ type: 'polished', id: message.id, text: polishTranscript(message.text, message.options) });
  }

  if (message.type === 'translate') {
    self.postMessage({
      type: 'translated',
      id: message.id,
      text: translateTextOffline(message.text, message.sourceLang, message.targetLang)
    });
  }
};
