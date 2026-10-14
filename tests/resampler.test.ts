import { describe, expect, test } from 'bun:test';
import { PCMResampler24To16 } from '../server/resampler.ts';

function pcm16(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return bytes;
}

function decode(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true));
}

function sine(frequency: number, frames: number, amplitude = 0.5): number[] {
  return Array.from({ length: frames }, (_, i) => Math.round(Math.sin(2 * Math.PI * frequency * i / 24_000) * amplitude * 32767));
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function rms(samples: number[]): number {
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

describe('PCMResampler24To16', () => {
  test('preserves a 1 kHz tone frequency and pass-band amplitude', () => {
    const resampler = new PCMResampler24To16();
    const output = decode(concatenate([resampler.process(pcm16(sine(1_000, 24_000))), resampler.flush()]));
    expect(output).toHaveLength(16_000);
    const steady = output.slice(500, -500);
    const crossings: number[] = [];
    for (let i = 1; i < steady.length; i++) {
      if (steady[i - 1] <= 0 && steady[i] > 0) crossings.push(i);
    }
    const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    expect(16_000 / period).toBeCloseTo(1_000, 0);
    expect(rms(steady) * Math.SQRT2 / 32767).toBeGreaterThan(0.47);
    expect(rms(steady) * Math.SQRT2 / 32767).toBeLessThan(0.53);
  });

  test('suppresses a 10 kHz tone before it aliases below the 8 kHz Nyquist limit', () => {
    const resampler = new PCMResampler24To16();
    const output = decode(concatenate([resampler.process(pcm16(sine(10_000, 24_000))), resampler.flush()]));
    expect(rms(output.slice(500, -500)) / 32767).toBeLessThan(0.01);
  });

  test('keeps exact 3:2 output lengths and identical output across packet boundaries', () => {
    const input = pcm16(sine(2_300, 4_803));
    const whole = new PCMResampler24To16();
    const expected = concatenate([whole.process(input), whole.flush()]);
    expect(expected).toHaveLength(Math.ceil(4_803 * 2 / 3) * 2);

    const chunked = new PCMResampler24To16();
    const output: Uint8Array[] = [];
    let inputOffset = 0;
    for (const packetFrames of [1, 337, 2_400, 17, 2_048]) {
      if (inputOffset >= input.length) break;
      const end = Math.min(input.length, inputOffset + packetFrames * 2);
      output.push(chunked.process(input.subarray(inputOffset, end)));
      inputOffset = end;
    }
    if (inputOffset < input.length) output.push(chunked.process(input.subarray(inputOffset)));
    output.push(chunked.flush());
    expect(concatenate(output)).toEqual(expected);
  });

  test('reads non-zero byte offsets and writes little-endian PCM16', () => {
    const samples = sine(1_000, 3_000, 0.4);
    const encoded = pcm16(samples);
    const withPadding = new Uint8Array(encoded.length + 6);
    withPadding.set(encoded, 3);
    const resampler = new PCMResampler24To16();
    const output = concatenate([resampler.process(withPadding.subarray(3, 3 + encoded.length)), resampler.flush()]);
    const decoded = decode(output);
    expect(decoded.length).toBe(2_000);
    expect(decoded[100]).toBeGreaterThan(0);
    const independentlyEncoded = pcm16(decoded);
    expect(output).toEqual(independentlyEncoded);
  });

  test('rejects odd byte lengths and reset discards buffered history', () => {
    const resampler = new PCMResampler24To16();
    expect(() => resampler.process(new Uint8Array([0]))).toThrow(RangeError);
    const input = pcm16(sine(700, 2_400));
    resampler.process(input);
    resampler.reset();
    const afterReset = concatenate([resampler.process(input), resampler.flush()]);
    const fresh = new PCMResampler24To16();
    expect(afterReset).toEqual(concatenate([fresh.process(input), fresh.flush()]));
    expect(resampler.flush()).toHaveLength(0);
  });
});
