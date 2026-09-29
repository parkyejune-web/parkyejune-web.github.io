// Pure DSP core for MR key / tempo changes. No DOM, no dependencies.
// Used by timepitch-worker.js (module worker) and by the node tests.
//
// Key + tempo = phase-vocoder time stretch, then windowed-sinc resampling:
//   pitch ratio r = 2^(semitones/12), stretch factor a = r / tempo,
//   stretch by a (duration x a, pitch kept), resample by r (duration / r, pitch x r)
//   => duration x 1/tempo, pitch x r.
// Phase vocoder: Hann FFT 2048 / synthesis hop 512 at 44.1-48 kHz, identity phase locking
// (Laroche & Dolson 1999) with phases computed once for both channels (keeps the stereo image),
// phase reset above ~150 Hz at detected onsets (keeps drums crisp).

const TWO_PI = 2 * Math.PI;
const INV_TWO_PI = 1 / TWO_PI;

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/**
 * In-place iterative complex FFT (radix-4 stages, one radix-2 stage when log2(n) is odd).
 * forward: X[k] = sum x[n] e^{-2 pi i k n / N}. inverse: unscaled (divide by N yourself).
 * @param {number} n power of two >= 2
 */
export function createFFT(n) {
  if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) {
    throw new RangeError(`FFT size must be a power of two, got ${n}`);
  }
  let bits = 0;
  while (1 << bits < n) bits++;
  const cosT = new Float64Array(n);
  const sinT = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cosT[i] = Math.cos((TWO_PI * i) / n);
    sinT[i] = Math.sin((TWO_PI * i) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let x = i;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r;
  }

  /** @param {Float64Array|Float32Array} re @param {Float64Array|Float32Array} im */
  function forward(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    let size = 1;
    if (bits & 1) {
      for (let a = 0; a < n; a += 2) {
        const b = a + 1;
        const tr = re[b];
        const ti = im[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
      size = 2;
    }
    // Combine four bit-reversed sub-DFTs [x(4j), x(4j+2), x(4j+1), x(4j+3)] of length `size`.
    for (; size < n; size <<= 2) {
      const L = size << 2;
      const ts = n / L;
      for (let i = 0; i < n; i += L) {
        for (let j = 0, k = 0; j < size; j++, k += ts) {
          const i0 = i + j;
          const i1 = i0 + size;
          const i2 = i1 + size;
          const i3 = i2 + size;
          const c1 = cosT[k];
          const s1 = sinT[k];
          const c2 = cosT[2 * k];
          const s2 = sinT[2 * k];
          const c3 = cosT[3 * k];
          const s3 = sinT[3 * k];
          const ar = re[i0];
          const ai = im[i0];
          let br = re[i1];
          let bi = im[i1];
          let cr = re[i2];
          let ci = im[i2];
          let dr = re[i3];
          let di = im[i3];
          let t = br * c2 + bi * s2;
          bi = bi * c2 - br * s2;
          br = t;
          t = cr * c1 + ci * s1;
          ci = ci * c1 - cr * s1;
          cr = t;
          t = dr * c3 + di * s3;
          di = di * c3 - dr * s3;
          dr = t;
          const e0r = ar + br;
          const e0i = ai + bi;
          const e1r = ar - br;
          const e1i = ai - bi;
          const o0r = cr + dr;
          const o0i = ci + di;
          const o1r = cr - dr;
          const o1i = ci - di;
          re[i0] = e0r + o0r;
          im[i0] = e0i + o0i;
          re[i2] = e0r - o0r;
          im[i2] = e0i - o0i;
          re[i1] = e1r + o1i;
          im[i1] = e1i - o1r;
          re[i3] = e1r - o1i;
          im[i3] = e1i + o1r;
        }
      }
    }
  }

  return {
    size: n,
    forward,
    /** Unscaled inverse: conj(FFT(conj(x))). @param {Float64Array|Float32Array} re @param {Float64Array|Float32Array} im */
    inverse(re, im) {
      for (let i = 0; i < n; i++) im[i] = -im[i];
      forward(re, im);
      for (let i = 0; i < n; i++) im[i] = -im[i];
    },
  };
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export const KEY_LIMIT = 12;
export const TEMPO_LIMITS = { min: 0.5, max: 2 };

/** FFT size for a sample rate: 2048 at 44.1-48 kHz (~46 ms), scaled for higher rates. @param {number} fs */
export function fftSizeFor(fs) {
  if (fs <= 50000) return 2048;
  if (fs <= 100000) return 4096;
  return 8192;
}

/** @param {number} semitones @param {number} tempo */
export function planTimePitch(semitones, tempo) {
  const pitchRatio = Math.pow(2, semitones / 12);
  return {
    pitchRatio,
    stretch: pitchRatio / tempo,
    identity: semitones === 0 && tempo === 1,
  };
}

/** Output length in samples for a tempo ratio (1 = original). @param {number} inputLength @param {number} tempo */
export function outputLength(inputLength, tempo) {
  return Math.round(inputLength / tempo);
}

// ---------------------------------------------------------------------------
// Windowed-sinc resampling
// ---------------------------------------------------------------------------

/** Modified Bessel function of the first kind, order 0. @param {number} x */
export function besselI0(x) {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/**
 * Kaiser-windowed sinc low-pass, tabulated on [0, halfWidth] input samples.
 * cutoff is in cycles per sample of the lower of the two rates (0.5 = Nyquist).
 * Defaults: 40 taps at ratio 1, ~70 dB stopband from Nyquist, passband to ~0.39 fs (17 kHz at 44.1 kHz).
 */
export function designSincKernel({ halfWidth = 20, beta = 6.8, cutoff = 0.446, resolution = 512 } = {}) {
  const len = halfWidth * resolution + 2;
  const table = new Float64Array(len);
  const i0b = besselI0(beta);
  for (let i = 0; i < len; i++) {
    const u = i / resolution;
    if (u >= halfWidth) {
      table[i] = 0;
      continue;
    }
    const x = 2 * cutoff * u;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = u / halfWidth;
    table[i] = 2 * cutoff * sinc * (besselI0(beta * Math.sqrt(1 - r * r)) / i0b);
  }
  return { table, halfWidth, resolution };
}

let defaultKernel = null;
function getDefaultKernel() {
  if (!defaultKernel) defaultKernel = designSincKernel();
  return defaultKernel;
}

/** Fractional positions are rounded to 1/BANK_PHASES of a sample (timing error <= 1.2e-4 sample). */
const BANK_PHASES = 4096;

/** Polyphase bank: row p holds the 2S tap weights for fractional position p / BANK_PHASES. */
function buildBank(ratio, kernel) {
  const s = Math.max(1, ratio);
  const S = Math.ceil(kernel.halfWidth * s);
  const T = 2 * S;
  const P = BANK_PHASES;
  const tab = kernel.table;
  const res = kernel.resolution;
  const tabMax = tab.length - 1;
  const hw = kernel.halfWidth;
  const invS = 1 / s;
  const bank = new Float32Array(P * T);
  for (let p = 0; p < P; p++) {
    const frac = p / P;
    const row = p * T;
    for (let q = 0; q < T; q++) {
      const k = q - S + 1;
      const u = Math.abs(frac - k) * invS;
      if (u >= hw) continue;
      const x = u * res;
      const xi = x | 0;
      const w = xi < tabMax ? tab[xi] + (x - xi) * (tab[xi + 1] - tab[xi]) : tab[tabMax];
      bank[row + q] = w * invS;
    }
  }
  return { bank, S, T, P };
}

/**
 * Streaming resampler. Output sample j reads the input at position j * ratio
 * (ratio > 1 = fewer output samples = higher pitch at the same playback rate).
 */
function createResamplerState(channelCount, ratio, kernel, capacityHint) {
  const { bank, S, T, P } = buildBank(ratio, kernel);
  const cap = Math.max(capacityHint, 4 * T + 64);
  // S zeros before input sample 0, so the taps of output 0 stay inside the buffer.
  return {
    ratio,
    bank,
    S,
    T,
    P,
    cap,
    fifo: Array.from({ length: channelCount }, () => new Float32Array(cap)),
    fifoStart: -S, // input index of fifo[0]
    fifoLen: S,
    next: 0, // next output index
  };
}

/** Input samples needed to produce outLen outputs. */
function resamplerNeeds(st, outLen) {
  return outLen > 0 ? Math.floor((outLen - 1) * st.ratio) + st.S + 2 : 0;
}

/** Appends src[c][from .. from + count) (or zeros when src is null). */
function fifoAppend(st, src, from, count) {
  if (st.fifoLen + count > st.cap) {
    const keepFrom = Math.floor(st.next * st.ratio) - st.S - 1;
    const drop = Math.min(st.fifoLen, Math.max(0, keepFrom - st.fifoStart));
    if (drop > 0) {
      for (const f of st.fifo) f.copyWithin(0, drop, st.fifoLen);
      st.fifoStart += drop;
      st.fifoLen -= drop;
    }
    if (st.fifoLen + count > st.cap) {
      const cap = Math.max(st.cap * 2, st.fifoLen + count);
      st.fifo = st.fifo.map((f) => {
        const g = new Float32Array(cap);
        g.set(f.subarray(0, st.fifoLen));
        return g;
      });
      st.cap = cap;
    }
  }
  for (let c = 0; c < st.fifo.length; c++) {
    if (src) st.fifo[c].set(src[c].subarray(from, from + count), st.fifoLen);
    else st.fifo[c].fill(0, st.fifoLen, st.fifoLen + count);
  }
  st.fifoLen += count;
}

/** Produces output samples while their taps are buffered. Returns the next output index. */
function resampleAvailable(st, out, outLen) {
  const { ratio, bank, S, T, P } = st;
  const stereo = st.fifo.length > 1;
  const f0 = st.fifo[0];
  const f1 = stereo ? st.fifo[1] : f0;
  const o0 = out[0];
  const o1 = stereo ? out[1] : o0;
  const avail = st.fifoStart + st.fifoLen;
  const fifoStart = st.fifoStart;
  let j = st.next;
  while (j < outLen) {
    const t = j * ratio;
    let ib = Math.floor(t);
    let p = Math.round((t - ib) * P);
    if (p === P) {
      p = 0;
      ib++;
    }
    if (ib + S >= avail) break;
    const base = ib - S + 1 - fifoStart;
    const row = p * T;
    if (stereo) {
      let acc0 = 0;
      let acc1 = 0;
      for (let q = 0; q < T; q++) {
        const w = bank[row + q];
        acc0 += w * f0[base + q];
        acc1 += w * f1[base + q];
      }
      o0[j] = acc0;
      o1[j] = acc1;
    } else {
      let acc0 = 0;
      for (let q = 0; q < T; q++) acc0 += bank[row + q] * f0[base + q];
      o0[j] = acc0;
    }
    j++;
  }
  st.next = j;
  return j;
}

/**
 * Whole-buffer resampling with the same kernel (reads x at j * ratio).
 * @param {Float32Array} x @param {number} ratio @param {number} [outLen]
 */
export function resample(x, ratio, outLen = Math.round(x.length / ratio)) {
  const st = createResamplerState(1, ratio, getDefaultKernel(), 8192);
  const out = [new Float32Array(outLen)];
  const chunk = 4096;
  for (let from = 0; from < x.length; from += chunk) {
    fifoAppend(st, [x], from, Math.min(chunk, x.length - from));
    resampleAvailable(st, out, outLen);
  }
  const missing = resamplerNeeds(st, outLen) - (st.fifoStart + st.fifoLen);
  if (missing > 0) fifoAppend(st, null, 0, missing);
  resampleAvailable(st, out, outLen);
  return out[0];
}

// ---------------------------------------------------------------------------
// Key / tempo job
// ---------------------------------------------------------------------------

/**
 * Creates a cooperative render job. Call step(budgetMs) until it returns done, then result().
 * @param {Float32Array[]} channels 1 or 2 channels of equal length (more are ignored)
 * @param {number} sampleRate
 * @param {{ semitones?: number, tempo?: number, fftSize?: number, transients?: boolean }} [opts]
 */
export function createTimePitchJob(channels, sampleRate, opts = {}) {
  const semitones = opts.semitones ?? 0;
  const tempo = opts.tempo ?? 1;
  if (!Array.isArray(channels) || channels.length === 0) throw new TypeError("channels must be a non-empty array");
  if (!(Math.abs(semitones) <= KEY_LIMIT)) throw new RangeError(`semitones out of range: ${semitones}`);
  if (!(tempo >= TEMPO_LIMITS.min && tempo <= TEMPO_LIMITS.max)) throw new RangeError(`tempo out of range: ${tempo}`);
  if (!(sampleRate > 0)) throw new RangeError(`bad sample rate: ${sampleRate}`);
  const src = channels.slice(0, 2);
  const C = src.length;
  const Lin = src[0].length;
  for (const ch of src) if (ch.length !== Lin) throw new RangeError("channels differ in length");
  const Lout = outputLength(Lin, tempo);
  const out = src.map(() => new Float32Array(Lout));
  const plan = planTimePitch(semitones, tempo);
  const stats = { frames: 0, transients: 0, ms: 0 };

  if (plan.identity || Lin === 0) {
    for (let c = 0; c < C; c++) out[c].set(src[c].subarray(0, Lout));
    return {
      outputLength: Lout,
      step: () => ({ done: true, progress: 1 }),
      result: () => out,
      stats,
    };
  }

  const N = opts.fftSize ?? fftSizeFor(sampleRate);
  const half = N >> 1;
  const H1 = half + 1;
  const overlap = 4;
  const Hs = N / overlap;
  const Ha = Hs / plan.stretch;
  const r = plan.pitchRatio;
  // Pitch up: resample first, so the vocoder runs on the shorter signal (fewer frames).
  // Pitch down: vocoder first, then resample. Same result either way.
  const preResample = r > 1;
  const direct = r >= 1;
  const transientsOn = opts.transients !== false;
  const kT = Math.max(2, Math.round((150 * N) / sampleRate));

  const fft = createFFT(N);
  const win = new Float64Array(N);
  for (let n = 0; n < N; n++) win[n] = 0.5 - 0.5 * Math.cos((TWO_PI * n) / N);
  // Sum of w^2 over the hops (1.5 for a periodic Hann at 4x overlap), averaged over one hop.
  let wsum = 0;
  for (let n = 0; n < Hs; n++) {
    for (let j = 0; j < overlap; j++) wsum += win[n + j * Hs] * win[n + j * Hs];
  }
  wsum /= Hs;
  const winS = new Float64Array(N);
  for (let n = 0; n < N; n++) winS[n] = win[n] / (N * wsum);
  const omega = new Float64Array(H1);
  for (let k = 0; k < H1; k++) omega[k] = (TWO_PI * k) / N;

  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const xLr = new Float64Array(H1);
  const xLi = new Float64Array(H1);
  const xRr = new Float64Array(H1);
  const xRi = new Float64Array(H1);
  const E = new Float64Array(H1);
  let mag = new Float64Array(H1);
  let magPrev = new Float64Array(H1);
  let refR = new Float64Array(H1);
  let refI = new Float64Array(H1);
  let prevRefR = new Float64Array(H1);
  let prevRefI = new Float64Array(H1);
  // Synthesis spectrum of the reference (ref * rotation); |syn| = |ref|.
  const synR = new Float64Array(H1);
  const synI = new Float64Array(H1);
  const peaks = new Int32Array(H1);
  const acc = src.map(() => new Float64Array(N));
  const emitBuf = src.map(() => new Float32Array(Hs));

  // Vocoder input: the source, or the source resampled by r (pitch up).
  const preLen = preResample ? Math.round(Lin / r) : 0;
  const pre = preResample ? src.map(() => new Float32Array(preLen)) : null;
  const preSt = preResample ? createResamplerState(C, r, getDefaultKernel(), 16384) : null;
  let preFrom = 0;
  let preDone = !preResample;
  let x0 = src[0];
  let x1 = C > 1 ? src[1] : null;
  let pvLen = Lin;
  if (pre) {
    x0 = pre[0];
    x1 = C > 1 ? pre[1] : null;
    pvLen = preLen;
  }
  const PRE_SHARE = 0.3; // progress share of the resampling pass

  const resampler = direct ? null : createResamplerState(C, r, getDefaultKernel(), 4 * N);
  const needed = direct ? Lout : resamplerNeeds(resampler, Lout);

  let m = 1 - overlap / 2; // first frame whose window reaches output sample 0
  let emittedEnd = 0; // stretched samples [0, emittedEnd) are final
  let havePrev = false;
  let aPrev = 0;
  let armed = true;
  let done = false;

  /** Rotates bins [k0, k1) by (Rr, Ri) and writes the packed synthesis spectrum. */
  function synthStereo(k0, k1, Rr, Ri) {
    for (let k = k0; k < k1; k++) {
      const alr = xLr[k];
      const ali = xLi[k];
      const arr = xRr[k];
      const ari = xRi[k];
      const lr = alr * Rr - ali * Ri;
      const li = alr * Ri + ali * Rr;
      const yr = arr * Rr - ari * Ri;
      const yi = arr * Ri + ari * Rr;
      const fr = refR[k];
      const fi = refI[k];
      synR[k] = fr * Rr - fi * Ri;
      synI[k] = fr * Ri + fi * Rr;
      re[k] = lr - yi;
      im[k] = li + yr;
      if (k > 0 && k < half) {
        re[N - k] = lr + yi;
        im[N - k] = yr - li;
      }
    }
  }

  function synthMono(k0, k1, Rr, Ri) {
    for (let k = k0; k < k1; k++) {
      const alr = xLr[k];
      const ali = xLi[k];
      const lr = alr * Rr - ali * Ri;
      const li = alr * Ri + ali * Rr;
      synR[k] = lr;
      synI[k] = li;
      re[k] = lr;
      im[k] = li;
      if (k > 0 && k < half) {
        re[N - k] = lr;
        im[N - k] = -li;
      }
    }
  }

  function frame() {
    const a = Math.round(m * Ha);
    const start = a - half;

    // --- analysis
    const n0 = Math.max(0, -start);
    const n1 = Math.min(N, pvLen - start);
    if (n0 > 0 || n1 < N || !x1) {
      re.fill(0);
      im.fill(0);
    }
    if (x1) {
      for (let n = n0; n < n1; n++) {
        const w = win[n];
        re[n] = w * x0[start + n];
        im[n] = w * x1[start + n];
      }
    } else {
      for (let n = n0; n < n1; n++) re[n] = win[n] * x0[start + n];
    }
    fft.forward(re, im);

    let maxE = 0;
    if (x1) {
      for (let k = 0; k <= half; k++) {
        const nk = (N - k) & (N - 1);
        const zr = re[k];
        const zi = im[k];
        const cr = re[nk];
        const ci = im[nk];
        const lr = 0.5 * (zr + cr);
        const li = 0.5 * (zi - ci);
        const rr = 0.5 * (zi + ci);
        const ri = 0.5 * (cr - zr);
        xLr[k] = lr;
        xLi[k] = li;
        xRr[k] = rr;
        xRi[k] = ri;
        const eL = lr * lr + li * li;
        const eR = rr * rr + ri * ri;
        const e = eL + eR;
        E[k] = e;
        if (e > maxE) maxE = e;
        mag[k] = Math.sqrt(e);
        const sr = lr + rr;
        const si = li + ri;
        if (sr * sr + si * si >= 0.05 * e) {
          refR[k] = sr;
          refI[k] = si;
        } else if (eL >= eR) {
          refR[k] = lr;
          refI[k] = li;
        } else {
          refR[k] = rr;
          refI[k] = ri;
        }
      }
    } else {
      for (let k = 0; k <= half; k++) {
        const lr = re[k];
        const li = im[k];
        xLr[k] = lr;
        xLi[k] = li;
        const e = lr * lr + li * li;
        E[k] = e;
        if (e > maxE) maxE = e;
        mag[k] = Math.sqrt(e);
        refR[k] = lr;
        refI[k] = li;
      }
    }

    // --- onset detection (spectral flux above ~150 Hz, with hysteresis)
    let transient = false;
    if (transientsOn && havePrev) {
      let num = 0;
      let den = 0;
      for (let k = kT; k <= half; k++) {
        const d = mag[k] - magPrev[k];
        if (d > 0) num += d;
        den += magPrev[k];
      }
      const f = num / (den + 1e-12);
      if (armed && f > 0.6 && num > 1e-4 * N) {
        transient = true;
        armed = false;
        stats.transients++;
      } else if (f < 0.25) {
        armed = true;
      }
    }

    // --- phase propagation (identity phase locking) and synthesis spectrum
    const synth = x1 ? synthStereo : synthMono;
    let np = 0;
    if (havePrev) {
      const floorE = maxE * 1e-9;
      for (let k = 1; k < half; k++) {
        const e = E[k];
        if (e > floorE && e > E[k - 1] && e >= E[k + 1] && (k < 2 || e > E[k - 2]) && (k + 2 > half || e >= E[k + 2])) {
          peaks[np++] = k;
        }
      }
    }
    if (np === 0) {
      synth(0, H1, 1, 0);
    } else {
      const ha = a - aPrev;
      const hsOverHa = Hs / ha;
      let regionStart = 0;
      for (let p = 0; p < np; p++) {
        const k = peaks[p];
        let Rr = 1;
        let Ri = 0;
        if (!(transient && k >= kT)) {
          const rr = refR[k];
          const ri = refI[k];
          const pr = prevRefR[k];
          const pim = prevRefI[k];
          const norm = (rr * rr + ri * ri) * (pr * pr + pim * pim);
          if (norm > 0) {
            const cr = rr * pr + ri * pim;
            const ci = ri * pr - rr * pim;
            const w = omega[k];
            let dev = Math.atan2(ci, cr) - w * ha;
            dev -= TWO_PI * Math.round(dev * INV_TWO_PI);
            const inc = w * Hs + dev * hsOverHa;
            const c = Math.cos(inc);
            const s = Math.sin(inc);
            // unit previous synthesis phasor * e^{i inc} * conj(ref) / |ref|
            const inv = 1 / Math.sqrt(norm);
            const sr = synR[k] * c - synI[k] * s;
            const si = synR[k] * s + synI[k] * c;
            Rr = (sr * rr + si * ri) * inv;
            Ri = (si * rr - sr * ri) * inv;
          }
        }
        let regionEnd;
        if (p === np - 1) {
          regionEnd = H1;
        } else {
          const k2 = peaks[p + 1];
          let mi = k + 1;
          for (let q = k + 2; q < k2; q++) if (E[q] < E[mi]) mi = q;
          regionEnd = mi + 1;
        }
        synth(regionStart, regionEnd, Rr, Ri);
        regionStart = regionEnd;
      }
      // DC and Nyquist stay real.
      synth(0, 1, 1, 0);
      synth(half, H1, 1, 0);
    }
    fft.inverse(re, im);

    // --- overlap-add
    const a0 = acc[0];
    for (let n = 0; n < N; n++) a0[n] += winS[n] * re[n];
    if (x1) {
      const a1 = acc[1];
      for (let n = 0; n < N; n++) a1[n] += winS[n] * im[n];
    }

    // Samples [s0, s0 + Hs) are final now (the next frame starts at s0 + Hs).
    const s0 = m * Hs - half;
    const from = Math.max(0, -s0);
    if (from < Hs) {
      const count = Hs - from;
      for (let c = 0; c < C; c++) {
        const buf = emitBuf[c];
        const ac = acc[c];
        for (let n = 0; n < count; n++) buf[n] = ac[from + n];
      }
      emit(s0 + from, count);
    }
    for (let c = 0; c < C; c++) {
      const ac = acc[c];
      ac.copyWithin(0, Hs);
      ac.fill(0, N - Hs);
    }

    let t = refR;
    refR = prevRefR;
    prevRefR = t;
    t = refI;
    refI = prevRefI;
    prevRefI = t;
    t = mag;
    mag = magPrev;
    magPrev = t;
    aPrev = a;
    havePrev = true;
    m++;
    stats.frames++;
  }

  /** @param {number} g stretched-stream index of emitBuf[0] @param {number} count */
  function emit(g, count) {
    if (direct) {
      const n = Math.min(count, Lout - g);
      for (let c = 0; c < C && n > 0; c++) out[c].set(emitBuf[c].subarray(0, n), g);
    } else {
      fifoAppend(resampler, emitBuf, 0, count);
      resampleAvailable(resampler, out, Lout);
    }
    emittedEnd = g + count;
  }

  function progress() {
    if (done) return 1;
    if (!preDone) return PRE_SHARE * Math.min(1, preFrom / Lin);
    const pv = direct ? emittedEnd / Lout : resampler.next / Lout;
    return Math.min(1, (preResample ? PRE_SHARE : 0) + (preResample ? 1 - PRE_SHARE : 1) * pv);
  }

  /** Resampling pass for pitch up, in chunks. Returns true when finished. */
  function preStep(t0, budgetMs) {
    const chunk = 8192;
    while (preFrom < Lin) {
      const n = Math.min(chunk, Lin - preFrom);
      fifoAppend(preSt, src, preFrom, n);
      resampleAvailable(preSt, pre, preLen);
      preFrom += n;
      if (now() - t0 >= budgetMs) return false;
    }
    const missing = resamplerNeeds(preSt, preLen) - (preSt.fifoStart + preSt.fifoLen);
    if (missing > 0) fifoAppend(preSt, null, 0, missing);
    resampleAvailable(preSt, pre, preLen);
    return true;
  }

  return {
    outputLength: Lout,
    /**
     * Runs for about budgetMs (Infinity = to the end).
     * @param {number} [budgetMs]
     */
    step(budgetMs = Infinity) {
      if (done) return { done: true, progress: 1 };
      const t0 = now();
      if (!preDone) {
        preDone = preStep(t0, budgetMs);
        if (!preDone) {
          stats.ms += now() - t0;
          return { done, progress: progress() };
        }
      }
      let i = 0;
      while (emittedEnd < needed) {
        frame();
        if (++i % 8 === 0 && now() - t0 >= budgetMs) break;
      }
      if (emittedEnd >= needed) {
        if (!direct) resampleAvailable(resampler, out, Lout);
        done = true;
      }
      stats.ms += now() - t0;
      return { done, progress: progress() };
    },
    result() {
      if (!done) throw new Error("render not finished");
      return out;
    },
    stats,
  };
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Synchronous key / tempo render.
 * @param {Float32Array[]} channels @param {number} sampleRate
 * @param {{ semitones?: number, tempo?: number, fftSize?: number, transients?: boolean }} [opts]
 */
export function renderTimePitch(channels, sampleRate, opts = {}) {
  const job = createTimePitchJob(channels, sampleRate, opts);
  while (!job.step(Infinity).done) {
    // runs to the end
  }
  return job.result();
}

// ---------------------------------------------------------------------------
// Take mix and alignment
// ---------------------------------------------------------------------------

/** (L + R) / 2, or the single channel. @param {Float32Array[]} channels */
export function downmix(channels) {
  if (channels.length === 1) return channels[0];
  const a = channels[0];
  const b = channels[1];
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = 0.5 * (a[i] + b[i]);
  return out;
}

/**
 * Stereo mix of a voice take with the track: out[i] = voiceGain * voice[i] + trackGain * track[i + trackStart].
 * trackStart = track sample under voice sample 0 (may be negative).
 * @param {Float32Array[]} track @param {Float32Array} voice
 * @param {{ trackStart: number, trackGain?: number, voiceGain?: number }} opts
 */
export function mixVoiceWithTrack(track, voice, { trackStart, trackGain = 0.6, voiceGain = 1 }) {
  const L = voice.length;
  const tL = track[0];
  const tR = track.length > 1 ? track[1] : track[0];
  const T = tL.length;
  const start = Math.round(trackStart);
  const o0 = new Float32Array(L);
  const o1 = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    const v = voiceGain * voice[i];
    o0[i] = v;
    o1[i] = v;
  }
  const iStart = Math.max(0, -start);
  const iEnd = Math.min(L, T - start);
  for (let i = iStart; i < iEnd; i++) {
    const q = i + start;
    o0[i] += trackGain * tL[q];
    o1[i] += trackGain * tR[q];
  }
  return [o0, o1];
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Finds how late the track's own sound (speaker bleed) appears in a voice recording, with a
 * band-limited GCC-PHAT cross-correlation. Model: voice[t] contains g * track[trackStart0 + t - lag].
 * Returns lag in samples (the take's latency offset) and whether the peak is clear enough to use.
 * @param {Float32Array | Float32Array[]} trackIn track at the recording's sample rate (channels are averaged)
 * @param {Float32Array} voice mono recording
 * @param {{ sampleRate: number, trackStart0: number, minLagSec?: number, maxLagSec?: number,
 *   windowSec?: number, skipSec?: number, loHz?: number, hiHz?: number }} opts
 */
export function estimateBleedLag(trackIn, voice, opts) {
  const tracks = Array.isArray(trackIn) ? trackIn : [trackIn];
  const track = tracks[0];
  const track2 = tracks.length > 1 ? tracks[1] : null;
  const fs = opts.sampleRate;
  const minLag = Math.round((opts.minLagSec ?? -0.08) * fs);
  const maxLag = Math.round((opts.maxLagSec ?? 0.7) * fs);
  const D = maxLag - minLag;
  const trackStart0 = Math.round(opts.trackStart0);
  // Voice window: skip the start, and begin where the track is defined for every lag.
  let t0 = Math.round((opts.skipSec ?? 0.3) * fs);
  t0 = Math.max(t0, maxLag - trackStart0);
  const W = Math.min(Math.round((opts.windowSec ?? 8) * fs), voice.length - t0, track.length - (trackStart0 + t0 - minLag));
  if (!(W >= fs * 1.5)) return { lag: null, lagSec: null, score: 0, ratio: 0, confident: false, reason: "short" };

  const M = nextPow2(W + D);
  const re = new Float64Array(M);
  const im = new Float64Array(M);
  const yStart = trackStart0 + t0 - maxLag;
  for (let n = 0; n < W; n++) re[n] = voice[t0 + n];
  for (let n = 0; n < W + D; n++) {
    const q = yStart + n;
    if (q < 0 || q >= track.length) continue;
    im[n] = track2 ? 0.5 * (track[q] + track2[q]) : track[q];
  }
  const fft = createFFT(M);
  fft.forward(re, im);
  const half = M >> 1;
  const kLo = Math.max(1, Math.floor(((opts.loHz ?? 200) * M) / fs));
  const kHi = Math.min(half - 1, Math.ceil(((opts.hiHz ?? 6000) * M) / fs));
  const gr = new Float64Array(M);
  const gi = new Float64Array(M);
  for (let k = kLo; k <= kHi; k++) {
    const nk = M - k;
    const zr = re[k];
    const zi = im[k];
    const cr = re[nk];
    const ci = im[nk];
    const xr = 0.5 * (zr + cr);
    const xi = 0.5 * (zi - ci);
    const yr = 0.5 * (zi + ci);
    const yi = 0.5 * (cr - zr);
    // conj(X) * Y, whitened
    const pr = xr * yr + xi * yi;
    const pim = xr * yi - xi * yr;
    const pm = Math.sqrt(pr * pr + pim * pim);
    if (pm > 1e-20) {
      gr[k] = pr / pm;
      gi[k] = pim / pm;
      gr[nk] = gr[k];
      gi[nk] = -gi[k];
    }
  }
  fft.inverse(gr, gi);

  let best = -Infinity;
  let bestD = 0;
  for (let d = 0; d <= D; d++) {
    if (gr[d] > best) {
      best = gr[d];
      bestD = d;
    }
  }
  const guard = Math.round(0.004 * fs);
  let sum = 0;
  let sum2 = 0;
  let cnt = 0;
  let second = -Infinity;
  for (let d = 0; d <= D; d++) {
    if (Math.abs(d - bestD) <= guard) continue;
    const v = gr[d];
    sum += v;
    sum2 += v * v;
    cnt++;
    if (v > second) second = v;
  }
  const mean = cnt ? sum / cnt : 0;
  const sd = cnt ? Math.sqrt(Math.max(1e-30, sum2 / cnt - mean * mean)) : 1;
  const score = (best - mean) / sd;
  const ratio = second > 0 ? best / second : Infinity;
  const lag = maxLag - bestD;
  return {
    lag,
    lagSec: lag / fs,
    score,
    ratio,
    // Without bleed the best peak scores ~9-11 on music-like signals; bleed at -30 dB scores ~35.
    confident: score >= 16 && ratio >= 1.5,
    reason: null,
  };
}
