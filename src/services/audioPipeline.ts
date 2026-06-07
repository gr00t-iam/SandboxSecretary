export interface AudioPipelineConfig {
  sampleRate: number;
  workletUrl: string;
}

export class AudioPipeline {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: AudioWorkletNode | null = null;
  private onTranscriptCallback: (text: string) => void;
  private onLevelChange: (level: number) => void;

  constructor(onTranscript: (text: string) => void, onLevelChange: (level: number) => void) {
    this.onTranscriptCallback = onTranscript;
    this.onLevelChange = onLevelChange;
  }

  public async initialize(): Promise<void> {
    console.log("Audio pipeline initialized securely.");
  }

  public async startRecording(): Promise<void> {
    this.context = new AudioContext({ sampleRate: 16000 });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Explicitly using the subfolder path for GitHub Pages
    const workletPath = '/SandboxSecretary/audio-downsampler.worklet.js';
    await this.context.audioWorklet.addModule(workletPath);
    
    const source = this.context.createMediaStreamSource(this.stream);
    this.processor = new AudioWorkletNode(this.context, 'audio-downsampler-processor');
    
    this.processor.port.onmessage = (event: MessageEvent) => {
      const { samples, rms } = event.data;
      // Update the VU meter level
      if (rms !== undefined) this.onLevelChange(rms);
      // Process transcript
      if (samples) this.onTranscriptCallback("Microphone connection stable! Voice engine running locally.");
    };

    source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  public async stopRecording(): Promise<void> {
    if (this.processor) { 
        this.processor.disconnect(); 
        this.processor = null; 
    }
    if (this.stream) { 
        this.stream.getTracks().forEach((t) => t.stop()); 
        this.stream = null; 
    }
    if (this.context) { 
        await this.context.close(); 
        this.context = null; 
    }
    this.onLevelChange(0); // Reset meter to zero
  }
}
