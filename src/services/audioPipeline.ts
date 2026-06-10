// Audio pipeline: drives the VU meter via the existing AudioWorklet downsampler
// (resolved from the Vite BASE_URL so it works under the GitHub Pages subpath),
// and performs real-time dictation with the Web Speech API. Transcribed words
// are appended to the caller's text via onTranscript; the previous build only
// emitted a hard-coded placeholder string, which is why nothing populated.

export interface AudioPipelineConfig {
  sampleRate: number;
  workletUrl: string;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

const RECOGNITION_LANG: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  ja: 'ja-JP'
};

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export class AudioPipeline {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private recognition: SpeechRecognitionLike | null = null;
  private rafId = 0;
  private baseText = '';
  private finalText = '';
  private stopRequested = false;

  private readonly onTranscriptCallback: (text: string) => void;
  private readonly onLevelChange: (level: number) => void;
  private readonly onWarning: (message: string) => void;

  constructor(
    onTranscript: (text: string) => void,
    onLevelChange: (level: number) => void,
    onWarning: (message: string) => void = () => undefined
  ) {
    this.onTranscriptCallback = onTranscript;
    this.onLevelChange = onLevelChange;
    this.onWarning = onWarning;
  }

  public async initialize(): Promise<void> {
    // Reserved for future model warm-up; kept for API compatibility.
  }

  public async startRecording(baseText = '', language = 'en'): Promise<void> {
    this.stopRequested = false;
    // Snapshot existing text so dictation is appended, never overwritten.
    this.baseText = baseText ? baseText.replace(/\s*$/, '') + '\n' : '';
    this.finalText = '';

    this.context = new AudioContext({ sampleRate: 16000 });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const workletPath = new URL(
      `${normalizeBasePath(import.meta.env.BASE_URL)}audio-downsampler.worklet.js`,
      window.location.origin
    ).href;

    try {
      await this.context.audioWorklet.addModule(workletPath);
      const source = this.context.createMediaStreamSource(this.stream);
      this.processor = new AudioWorkletNode(this.context, 'audio-downsampler-processor');
      this.processor.port.onmessage = (event: MessageEvent) => {
        const data = (event.data ?? {}) as { rms?: number };
        if (data.rms !== undefined) this.onLevelChange(data.rms);
      };
      source.connect(this.processor);
      this.processor.connect(this.context.destination);
    } catch {
      // If the worklet cannot load, fall back to an analyser-based meter.
      this.startAnalyserMeter();
    }

    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      this.onWarning(
        'Live transcription is not supported in this browser. Audio is captured, but words will not auto-fill — Chrome or Edge give the best results.'
      );
      return;
    }
    this.startSpeechRecognition(Recognition, language);
  }

  private startSpeechRecognition(Recognition: SpeechRecognitionCtor, language: string): void {
    const recognition = new Recognition();
    recognition.lang = RECOGNITION_LANG[language] || 'en-US';
    recognition.continuous = true; // keep listening across natural pauses
    recognition.interimResults = true; // surface words as they are recognised
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0].transcript as string;
        if (result.isFinal) this.finalText += transcript + ' ';
        else interim += transcript;
      }
      this.onTranscriptCallback(this.baseText + this.finalText + interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const err: string | undefined = event?.error;
      if (err === 'no-speech' || err === 'aborted') return;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this.stopRequested = true;
        this.onWarning('Microphone permission was denied. Allow microphone access in your browser to dictate.');
      } else if (err === 'audio-capture') {
        this.stopRequested = true;
        this.onWarning('No microphone was found. Connect one and try again.');
      } else if (err === 'network') {
        this.onWarning('The speech service had a network hiccup. Reconnecting…');
      } else if (err) {
        this.onWarning('Speech recognition error: ' + err);
      }
    };

    recognition.onend = () => {
      // The engine auto-stops after pauses; restart unless the user stopped.
      if (!this.stopRequested) {
        try {
          recognition.start();
          return;
        } catch {
          /* ignore restart races */
        }
      }
      this.onTranscriptCallback((this.baseText + this.finalText).replace(/\s+$/, ''));
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      this.onWarning('Could not start dictation: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private startAnalyserMeter(): void {
    if (!this.context || !this.stream) return;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    const source = this.context.createMediaStreamSource(this.stream);
    source.connect(this.analyser);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = (): void => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      this.onLevelChange(Math.sqrt(sum / data.length));
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public async stopRecording(): Promise<void> {
    this.stopRequested = true;

    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onend = null;
      this.recognition.onerror = null;
      try {
        this.recognition.stop();
      } catch {
        /* already stopped */
      }
      this.recognition = null;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    // Commit the final transcript (no-op if nothing was dictated).
    if (this.finalText) {
      this.onTranscriptCallback((this.baseText + this.finalText).replace(/\s+$/, ''));
    }
    this.onLevelChange(0);
  }
}

function normalizeBasePath(baseUrl: string): string {
  if (!baseUrl || baseUrl === './') {
    return '/';
  }
  const withLeadingSlash = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}
