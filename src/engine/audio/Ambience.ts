// Âm thanh nền tự sinh bằng WebAudio (không cần file): tiếng gió theo tốc độ, dày hơn khi trong mây,
// và tiếng chuông nhẹ (chime) cho sự kiện trong game. Trình duyệt chỉ cho phát sau khi người chơi tương tác.
export class Ambience {
  private ctx: AudioContext | null = null;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private master!: GainNode;
  muted = false;

  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // Tiếng ồn nâu (brown noise) -> lọc thấp = tiếng gió
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
    return this.muted;
  }

  update(speed: number, cloud: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, Math.abs(speed) / 45);
    this.windGain.gain.setTargetAtTime(0.05 + s * 0.12 + cloud * 0.1, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(250 + s * 600 + cloud * 300, t, 0.3);
  }

  chime(): void {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 1.4);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 1.5);
    });
  }
}
