export interface AudioPipelineCallbacks {
  onAudioFrame: (samples: Float32Array) => void;
  onLevel: (rms: number) => void;
  onError: (message: string) => void;
}

export class AudioCaptureController {
  private stream?: MediaStream;
  private context?: AudioContext;
  private mediaRecorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private source?: MediaStreamAudioSourceNode;
  private workletNode?: AudioWorkletNode;

  async start(callbacks: AudioPipelineCallbacks): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is not available in this browser sandbox.');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextConstructor();
      await this.context.audioWorklet.addModule('/SandboxSecretary/audio-downsampler.worklet.js');
      this.source = this.context.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(this.context, 'downsample-processor');
      this.workletNode.port.onmessage = (event: MessageEvent) => {
        if (event.data.type === 'audio-frame') {
          callbacks.onLevel(event.data.rms);
          callbacks.onAudioFrame(new Float32Array(event.data.samples));
        }
        if (event.data.type === 'level') {
          callbacks.onLevel(event.data.rms);
        }
      };
      this.source.connect(this.workletNode);

      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: preferredMimeType() });
      this.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      });
      this.mediaRecorder.start(1000);
    } catch (error) {
      callbacks.onError(error instanceof Error ? error.message : String(error));
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<Blob | undefined> {
    const recorder = this.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }

    this.workletNode?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close().catch(() => undefined);

    this.mediaRecorder = undefined;
    this.workletNode = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.context = undefined;

    if (this.chunks.length === 0) {
      return undefined;
    }
    return new Blob(this.chunks, { type: recorder?.mimeType || 'audio/webm' });
  }
}

function preferredMimeType(): string {
  const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return supported.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
