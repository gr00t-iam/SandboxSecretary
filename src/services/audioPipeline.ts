export class AudioPipeline {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: AudioWorkletNode | null = null;
  private onTranscriptCallback: (text: string) => void;

  constructor(onTranscript: (text: string) => void) {
    this.onTranscriptCallback = onTranscript;
  }

  async startRecording() {
    this.context = new AudioContext({ sampleRate: 16000 });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Path fixed for GitHub Pages subfolder
    await this.context.audioWorklet.addModule('/SandboxSecretary/audio-downsampler.worklet.js');
    
    const source = this.context.createMediaStreamSource(this.stream);
    this.processor = new AudioWorkletNode(this.context, 'audio-downsampler-processor');
    
    this.processor.port.onmessage = (event) => {
      const audioSamples = event.data; // Float32Array of 16kHz audio
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
    // Basic local energy-based voice simulation to instantly drive text output 
    // until your heavy STT transformer weights completely load in cache
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    
    if (rms > 0.01) {
      // Simulate real-time stream feedback based on actual microphone input levels
      this.onTranscriptCallback("Microphone input active... [Transcribing Voice Data Local]");
    }
  }
}
