/** Energy VAD over PCM16/24 kHz mono. Decisions use audio time, not packet arrival time. */
export class OpenVAD {
  private frame = new Uint8Array(960);
  private used = 0;
  private pre: Uint8Array[] = [];
  private chunks: Uint8Array[] = [];
  private speech = 0;
  private silence = 0;
  private noise = 90;
  private active = false;
  constructor(private started: () => void, private turn: (pcm: Uint8Array) => void) {}
  reset() {
    this.used = 0; this.pre = []; this.chunks = []; this.speech = 0; this.silence = 0; this.active = false;
  }
  audio(bytes: Uint8Array) {
    for (let offset = 0; offset < bytes.length;) {
      const count = Math.min(this.frame.length - this.used, bytes.length - offset);
      this.frame.set(bytes.subarray(offset, offset + count), this.used); this.used += count; offset += count;
      if (this.used !== this.frame.length) continue;
      const frame = this.frame; this.frame = new Uint8Array(960); this.used = 0;
      const samples = new DataView(frame.buffer);
      let energy = 0;
      for (let i = 0; i < frame.length; i += 2) { const sample = samples.getInt16(i, true); energy += sample * sample; }
      const rms = Math.sqrt(energy / 480), voiced = rms > Math.max(450, this.noise * 3);
      if (!voiced && !this.active) this.noise = this.noise * .97 + Math.min(rms, 450) * .03;
      if (!this.active) {
        if (!voiced) { this.pre.push(frame); if (this.pre.length > 15) this.pre.shift(); continue; }
        this.active = true; this.chunks = this.pre; this.pre = []; this.started();
      }
      this.chunks.push(frame);
      if (voiced) { this.speech += 20; this.silence = 0; } else this.silence += 20;
      if (this.silence < 660 && this.chunks.length < 1500) continue;
      const chunks = this.chunks, speech = this.speech;
      this.chunks = []; this.active = false; this.speech = 0; this.silence = 0;
      if (speech >= 160) this.turn(Buffer.concat(chunks));
    }
  }
}
