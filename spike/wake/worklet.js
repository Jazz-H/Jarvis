// Wake-word spike: hands the page 80 ms of 16 kHz microphone audio at a time (1280 samples, as int16-range floats).
class WakeTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1280);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = Math.max(-1, Math.min(1, ch[i])) * 32767;
        if (this.n === 1280) {
          this.port.postMessage(this.buf);
          this.buf = new Float32Array(1280);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("wake-tap", WakeTap);
