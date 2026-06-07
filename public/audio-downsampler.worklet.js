class DownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.inputRate = sampleRate;
    this.carry = [];
    this.ratio = this.inputRate / this.targetRate;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) {
      return true;
    }

    let sumSquares = 0;
    for (let index = 0; index < input.length; index += 1) {
      sumSquares += input[index] * input[index];
      this.carry.push(input[index]);
    }

    const outputLength = Math.floor(this.carry.length / this.ratio);
    if (outputLength > 0) {
      const downsampled = new Float32Array(outputLength);
      for (let index = 0; index < outputLength; index += 1) {
        const start = Math.floor(index * this.ratio);
        const end = Math.max(start + 1, Math.floor((index + 1) * this.ratio));
        let total = 0;
        for (let cursor = start; cursor < end; cursor += 1) {
          total += this.carry[cursor] || 0;
        }
        downsampled[index] = total / (end - start);
      }

      const consumed = Math.floor(outputLength * this.ratio);
      this.carry = this.carry.slice(consumed);
      this.port.postMessage(
        {
          type: 'audio-frame',
          samples: downsampled,
          rms: Math.sqrt(sumSquares / input.length)
        },
        [downsampled.buffer]
      );
    } else {
      this.port.postMessage({ type: 'level', rms: Math.sqrt(sumSquares / input.length) });
    }

    return true;
  }
}

registerProcessor('downsample-processor', DownsampleProcessor);
