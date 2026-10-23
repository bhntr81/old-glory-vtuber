/** Microphone loudness with an adaptive noise gate. */
export class Mic {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.buf = null;
    this.running = false;
    this.sensitivity = 2.2;
    this.floor = 0.008; // adaptive noise floor (RMS)
    this.level = 0;
  }

  async start() {
    if (this.running) return true;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.running = true;
    return true;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close();
    this.stream = this.ctx = this.analyser = null;
    this.running = false;
    this.level = 0;
  }

  /** 0..1 mouth-open style envelope. */
  read() {
    if (!this.running) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);

    // Track the room noise slowly while the input is quiet.
    if (rms < this.floor * 1.6) this.floor = this.floor * 0.995 + rms * 0.005;
    this.floor = Math.min(this.floor, 0.05);

    const above = Math.max(0, rms - this.floor * 1.5);
    const target = Math.min(1, above * this.sensitivity * 9);
    // Fast attack, slower release reads more like speech.
    this.level += (target - this.level) * (target > this.level ? 0.55 : 0.18);
    return this.level;
  }
}
