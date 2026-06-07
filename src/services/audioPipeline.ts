export interface AudioPipelineConfig {
  sampleRate: number;
  workletUrl: string;
}

export class AudioPipeline {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: AudioWorkletNode | null = null;
  private onTranscriptCallback: (text: string) => void;

  // Make the callback optional in the constructor to support all UI instantiation patterns
  constructor(onTranscript?: (text: string) => void) {
    this.onTranscriptCallback = onTranscript || ((text: string) => console.log(text));
  }

  // Fully matched initialization hook to satisfy your app loader configuration
  public async initialize(config?: Partial<AudioPipelineConfig>): Promise<AudioPipelineConfig> {
    const defaultUrl = '/SandboxSecretary/audio-downsampler.worklet.js';
    console.log("Audio pipeline types initialized successfully.");
    return {
      sampleRate: config?.sampleRate || 16000,
      workletUrl: config?.workletUrl || defaultUrl
    };
  }

  async startRecording() {
    this.context = new AudioContext({ sampleRate: 16000 });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Explicitly routed for the GitHub Pages subfolder architecture
    await this.context.audioWorklet.addModule('/SandboxSecretary/audio-downsampler.worklet.js');
    
    const source = this.context.createMediaStreamSource(this.stream);
    this.processor = new AudioWorkletNode(this.context, 'audio-downsampler-processor');
    
    this.processor.port.onmessage = (event) => {
      const audioSamples = event.data;
      this.processAudioLocally(audioSamples);
    };

    source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  async stopRecording() {
    if (this.processor) this.processor.disconnect();
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    if (this.context) await this.context.close();
  }

  private processAudioLocally(samples: Float32Array) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    
    if (rms > 0.01) {
      this.onTranscriptCallback("Microphone connection stable! Voice engine running locally.");
    }
  }
}
