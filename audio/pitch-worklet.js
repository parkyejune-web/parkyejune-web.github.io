// AudioWorkletProcessor "pitch-processor": capture bookkeeping only (R13 §10.3).
//  - decimates the mic to ~24 kHz into preallocated batch buffers of 5 hops (50 ms)
//  - sends each full batch to the analyzer Worker over a MessagePort that the main thread
//    transfers in at startup; buffers are transferred and handed back by the Worker
//  - counts runs of exact zeros (a phone call gives digital silence without a mute event)
//  - posts a heartbeat to the main thread every 250 ms
// process() allocates nothing, accepts any block length and always returns true.
// The node's output is left silent: the voice is never played back.
import { createDecimator, decimationPlan, designLowpassFIR } from "./dsp/decimator.js";

const POOL_SIZE = 8;
const HOPS_PER_BATCH = 5;
const HEARTBEAT_SEC = 0.25;
const MAX_CHUNK = 1024;

class PitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const plan = decimationPlan(sampleRate);
    this.decim = plan.decim;
    this.fsA = plan.fsA;
    this.dec = createDecimator(plan.decim, plan.decim > 1 ? designLowpassFIR(plan.taps, plan.fc, sampleRate) : null, MAX_CHUNK);
    this.decOut = new Float32Array(MAX_CHUNK + 1);
    this.hop = Math.round(this.fsA * 0.01);
    this.batchLen = this.hop * HOPS_PER_BATCH;

    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) this.pool.push(new Float32Array(this.batchLen));
    this.cur = null;
    this.curN = 0;
    this.pcmMsg = { type: "pcm", buf: null, n: 0, t0: 0, fs: this.fsA, seq: 0 };
    this.xfer = [null];
    this.workerPort = null;

    this.armed = false;
    this.zeroLimit = Math.round((sampleRate * (o.digitalSilenceMs || 1000)) / 1000);
    this.zeroRun = 0;
    this.zeroFlagged = false;
    this.zeroMsg = { type: "zeros", ms: 0, frame: 0 };
    this.zeroEndMsg = { type: "zeros_end", ms: 0, frame: 0 };

    this.hbEvery = Math.round(sampleRate * HEARTBEAT_SEC);
    this.sinceHb = 0;
    this.dropped = 0;
    this.hbMsg = { type: "hb", frame: 0, armed: false, zeroRun: 0, dropped: 0, fsA: this.fsA, decim: this.decim };

    this.port.onmessage = (e) => this.onControl(e.data);
  }

  onControl(d) {
    if (!d || typeof d !== "object") return;
    if (d.type === "port" && d.port) {
      this.workerPort = d.port;
      this.workerPort.onmessage = (e) => {
        const m = e.data;
        if (m && m.type === "ret" && m.buf && m.buf.length === this.batchLen && this.pool.length < POOL_SIZE * 2) {
          this.pool.push(m.buf);
        }
      };
    } else if (d.type === "arm") {
      if (!d.on) this.flushBatch();
      this.armed = !!d.on;
      this.zeroRun = 0;
      this.zeroFlagged = false;
      this.dec.reset();
    } else if (d.type === "config" && d.digitalSilenceMs > 0) {
      this.zeroLimit = Math.round((sampleRate * d.digitalSilenceMs) / 1000);
    }
  }

  flushBatch() {
    if (!this.cur || !this.workerPort) return;
    const m = this.pcmMsg;
    m.buf = this.cur;
    m.n = this.curN;
    m.seq++;
    this.xfer[0] = this.cur.buffer;
    this.workerPort.postMessage(m, this.xfer);
    m.buf = null;
    this.xfer[0] = null;
    this.cur = null;
    this.curN = 0;
  }

  process(inputs, outputs) {
    const ch = inputs[0] && inputs[0].length > 0 ? inputs[0][0] : null;
    const outCh = outputs[0] && outputs[0].length > 0 ? outputs[0][0] : null;
    const L = ch ? ch.length : outCh ? outCh.length : 128;

    if (this.armed) {
      // Digital-silence watchdog (no input connected counts as zeros too).
      let zr = this.zeroRun;
      if (!ch) zr += L;
      else {
        for (let i = 0; i < L; i++) {
          if (ch[i] === 0) zr++;
          else if (zr > 0) {
            if (this.zeroFlagged) {
              this.zeroEndMsg.ms = Math.round((zr * 1000) / sampleRate);
              this.zeroEndMsg.frame = currentFrame + i;
              this.port.postMessage(this.zeroEndMsg);
              this.zeroFlagged = false;
            }
            zr = 0;
          }
        }
      }
      this.zeroRun = zr;
      if (!this.zeroFlagged && zr >= this.zeroLimit) {
        this.zeroFlagged = true;
        this.zeroMsg.ms = Math.round((zr * 1000) / sampleRate);
        this.zeroMsg.frame = currentFrame;
        this.port.postMessage(this.zeroMsg);
      }

      // Decimate into batches for the analyzer Worker.
      if (ch && this.workerPort) {
        const dec = this.dec;
        const decim = this.decim;
        const gd = dec.groupDelay;
        for (let off = 0; off < L; off += MAX_CHUNK) {
          const len = L - off < MAX_CHUNK ? L - off : MAX_CHUNK;
          const n = dec.process(ch, off, len, this.decOut);
          const first = off + dec.firstIndex;
          for (let j = 0; j < n; j++) {
            if (!this.cur) {
              if (this.pool.length === 0) {
                this.dropped++;
                continue;
              }
              this.cur = this.pool.pop();
              this.curN = 0;
              this.pcmMsg.t0 = (currentFrame + first + j * decim - gd) / sampleRate;
            }
            this.cur[this.curN++] = this.decOut[j];
            if (this.curN === this.batchLen) this.flushBatch();
          }
        }
      }
    }

    this.sinceHb += L;
    if (this.sinceHb >= this.hbEvery) {
      this.sinceHb = 0;
      const hb = this.hbMsg;
      hb.frame = currentFrame + L;
      hb.armed = this.armed;
      hb.zeroRun = this.zeroRun;
      hb.dropped = this.dropped;
      this.port.postMessage(hb);
    }
    return true;
  }
}

registerProcessor("pitch-processor", PitchProcessor);
