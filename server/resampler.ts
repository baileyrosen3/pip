const INPUT_RATE = 24_000;
const OUTPUT_RATE = 16_000;
const TAPS = 63;
const HALF_TAPS = (TAPS - 1) / 2;
const HISTORY_SIZE = 64;
const CUTOFF_HZ = 7_200;
const SINC_CUTOFF = 2 * CUTOFF_HZ / INPUT_RATE;

function sinc(x: number): number {
  if (Math.abs(x) < 1e-12) return 1;
  const angle = Math.PI * x;
  return Math.sin(angle) / angle;
}

function makeCoefficients(fraction: number): Float64Array {
  const coefficients = new Float64Array(TAPS);
  let sum = 0;
  for (let tap = 0; tap < TAPS; tap++) {
    const distance = tap - HALF_TAPS - fraction;
    const windowPosition = distance / (HALF_TAPS + 1);
    const window = 0.42 + 0.5 * Math.cos(Math.PI * windowPosition) + 0.08 * Math.cos(2 * Math.PI * windowPosition);
    const coefficient = SINC_CUTOFF * sinc(SINC_CUTOFF * distance) * window;
    coefficients[tap] = coefficient;
    sum += coefficient;
  }
  for (let tap = 0; tap < TAPS; tap++) coefficients[tap] /= sum;
  return coefficients;
}

const COEFFICIENTS = [makeCoefficients(0), makeCoefficients(0.5)];

/**
 * Streaming 24 kHz PCM16 mono to 16 kHz PCM16 mono resampler.
 * A 63-tap Blackman-windowed low-pass FIR precedes the 3:2 rational sample
 * schedule. Its centered kernel adds 31 input frames (about 1.29 ms) of
 * streaming latency. flush() zero-pads that lookahead, returns only samples
 * whose timestamps fall within the actual input, then starts a fresh stream;
 * no synthetic zero-tail frames are emitted.
 */
export class PCMResampler24To16 {
  private readonly history = new Int16Array(HISTORY_SIZE);
  private inputFrames = 0;
  private outputFrames = 0;

  process(input: Uint8Array): Uint8Array {
    if (input.byteLength % 2 !== 0) throw new RangeError('PCM16 input must contain an even number of bytes');

    const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const endFrame = this.inputFrames + input.byteLength / 2;
    const readyCount = Math.ceil(Math.max(0, endFrame - HALF_TAPS) * OUTPUT_RATE / INPUT_RATE);
    const result = new Uint8Array((readyCount - this.outputFrames) * 2);
    const resultView = new DataView(result.buffer);
    let written = 0;
    for (let frame = 0; frame < input.byteLength / 2; frame++) {
      const absoluteFrame = this.inputFrames;
      this.history[absoluteFrame % HISTORY_SIZE] = inputView.getInt16(frame * 2, true);
      this.inputFrames++;
      const readyThrough = Math.max(0, this.inputFrames - HALF_TAPS);
      const readyFrames = Math.ceil(readyThrough * OUTPUT_RATE / INPUT_RATE);
      while (this.outputFrames < readyFrames) {
        resultView.setInt16(written * 2, this.sampleAt(this.outputFrames++), true);
        written++;
      }
    }
    return result;
  }

  reset(): void {
    this.inputFrames = 0;
    this.outputFrames = 0;
    this.history.fill(0);
  }

  flush(): Uint8Array {
    const count = this.outputCountBefore(this.inputFrames);
    const result = new Uint8Array(count * 2);
    const resultView = new DataView(result.buffer);
    for (let i = 0; i < count; i++) {
      resultView.setInt16(i * 2, this.sampleAt(this.outputFrames++), true);
    }
    this.reset();
    return result;
  }

  private outputCountBefore(frameLimit: number): number {
    // Output timestamps are 0, 1.5, 3, ... input frames: exactly 2/3 as many
    // output frames over a complete input stream, rounded up for partial blocks.
    return Math.ceil(frameLimit * OUTPUT_RATE / INPUT_RATE) - this.outputFrames;
  }

  private sampleAt(outputFrame: number): number {
    const positionNumerator = outputFrame * 3;
    const integerPosition = Math.floor(positionNumerator / 2);
    const fraction = positionNumerator % 2 === 0 ? 0 : 0.5;
    const coefficients = COEFFICIENTS[fraction === 0 ? 0 : 1];
    let value = 0;
    for (let tap = 0; tap < TAPS; tap++) {
      const sourceFrame = integerPosition + tap - HALF_TAPS;
      if (sourceFrame < 0 || sourceFrame >= this.inputFrames) continue;
      value += this.history[sourceFrame % HISTORY_SIZE] * coefficients[tap];
    }
    return Math.max(-32768, Math.min(32767, Math.round(value)));
  }
}
