// Streaming FIR decimator: 48 kHz -> 24 kHz, 44.1 kHz -> 22.05 kHz (63 taps).
// Ported from experiments/dsp-bench/dsputil.mjs (designLowpassFIR, createDecimator;
// R13 benchmark, reviewed 2026-09-28). Changes: block offset argument, index of the first
// output inside the block (for timestamps), pass-through when no decimation is needed.
// process() allocates nothing.

export const FIR_TAPS = 63;
export const TARGET_RATE = 24000;

/**
 * Decimation factor and analysis rate for an input rate.
 * The cut-off keeps the bench setting (10 kHz for 48 kHz -> 24 kHz), i.e. 5/6 of the output Nyquist.
 * @param {number} sampleRate
 * @returns {{ decim: number, fsA: number, fc: number, taps: number }}
 */
export function decimationPlan(sampleRate) {
  const decim = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  const fsA = sampleRate / decim;
  return { decim, fsA, fc: (fsA / 2) * (5 / 6), taps: FIR_TAPS };
}

/**
 * Blackman-windowed sinc lowpass FIR (odd length, unity DC gain).
 * @param {number} numTaps
 * @param {number} fc Hz
 * @param {number} fs Hz
 * @returns {Float64Array}
 */
export function designLowpassFIR(numTaps, fc, fs) {
  if (numTaps % 2 === 0) throw new Error("numTaps must be odd");
  const h = new Float64Array(numTaps);
  const M = numTaps - 1;
  let sum = 0;
  for (let n = 0; n < numTaps; n++) {
    const m = n - M / 2;
    const sinc = m === 0 ? (2 * fc) / fs : Math.sin(((2 * Math.PI * fc) / fs) * m) / (Math.PI * m);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / M) + 0.08 * Math.cos((4 * Math.PI * n) / M);
    h[n] = sinc * w;
    sum += h[n];
  }
  for (let n = 0; n < numTaps; n++) h[n] /= sum;
  return h;
}

/**
 * @typedef {object} Decimator
 * @property {number} factor
 * @property {number} groupDelay  filter delay in input samples
 * @property {number} maxBlock     largest L accepted by process()
 * @property {number} firstIndex   after process(): index (relative to offset) of the first output's input sample
 * @property {(input: ArrayLike<number>, offset: number, L: number, out: Float32Array | Float64Array) => number} process
 * @property {() => void} reset
 */

/**
 * Causal streaming decimator. Output m of a call corresponds to input sample
 * offset + firstIndex + m * factor, delayed by groupDelay samples.
 * `out` must hold at least floor(maxBlock / factor) + 1 values.
 * @param {number} factor
 * @param {Float64Array | null} h  FIR taps (ignored when factor is 1)
 * @param {number} maxBlock
 * @returns {Decimator}
 */
export function createDecimator(factor, h, maxBlock) {
  if (factor === 1 || !h) {
    /** @type {Decimator} */
    const pass = {
      factor: 1,
      groupDelay: 0,
      maxBlock,
      firstIndex: 0,
      process(input, offset, L, out) {
        for (let i = 0; i < L; i++) out[i] = input[offset + i];
        return L;
      },
      reset() {},
    };
    return pass;
  }
  const M = h.length;
  const H = M - 1;
  const buf = new Float64Array(H + maxBlock);
  let phase = 0; // input index (relative to the next block) of the next output
  /** @type {Decimator} */
  const dec = {
    factor,
    groupDelay: H / 2,
    maxBlock,
    firstIndex: 0,
    process(input, offset, L, out) {
      if (L > maxBlock) throw new RangeError("block larger than maxBlock");
      for (let i = 0; i < L; i++) buf[H + i] = input[offset + i];
      let n = 0;
      let p = phase;
      dec.firstIndex = p;
      for (; p < L; p += factor) {
        let s = 0;
        const base = p + H;
        for (let k = 0; k < M; k++) s += h[k] * buf[base - k];
        out[n++] = s;
      }
      phase = p - L;
      for (let i = 0; i < H; i++) buf[i] = buf[L + i];
      return n;
    },
    reset() {
      buf.fill(0);
      phase = 0;
    },
  };
  return dec;
}
