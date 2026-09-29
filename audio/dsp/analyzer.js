// Pitch analysis pipeline. Runs in public/audio/analyzer-worker.js; node tests run the same code.
// Input: decimated samples (~24 kHz) with the AudioContext time of the first sample.
// Every 10 ms hop on the last N samples (N = 1024, 42.7 ms at 24 kHz):
//   level (mean square) -> MPM (k = 0.9) with an optional target-note octave prior
//   -> 300-4000 Hz band power -> gates -> 60 ms minimum voiced run -> 5-frame median
//   -> frame {t, f0, midi, conf, rmsDb, snrDb, status}.
// Settings follow research/R13_dsp_benchmark.md §0 and §10.1.
//
// Gates:
//   level:   RMS >= calibrated noise floor + 6 dB (before calibration: >= -65 dBFS)
//   clarity: >= 0.7 shown and scored; 0.5..0.7 "provisional" (shown faint, never scored)
//   band SNR (300-4000 Hz) >= 10 dB to score, else "noise" (null before calibration)
//   run:     runs of fewer than 6 frames (60 ms) passing level + clarity >= 0.5 get no pitch;
//            with the 43 ms window this drops sounds shorter than about 30 ms
// Frames are emitted 5 hops (50 ms) late: the run gate and the median need that lookahead.
import { createMpm, pickCandidate } from "./mpm.js";
import { NOISE_POW_MIN, bandSnrDb, createBandPower, db10, meanSquare, subtractNoise } from "./features.js";

export const ANALYZER_DEFAULTS = Object.freeze({
  hopSec: 0.01,
  fMin: 70,
  fMax: 1100,
  k: 0.9,
  clarityShow: 0.7,
  clarityProvisional: 0.5,
  minSnrDb: 10,
  levelMarginDb: 6,
  uncalibratedFloorDb: -65,
  minRunSec: 0.06,
  smoothFrames: 5,
  priorCents: 600,
  priorTolSec: 0.3,
});

/** @param {number} fs @returns {number} */
export function windowSizeFor(fs) {
  return fs <= 32000 ? 1024 : 2048;
}

/** @param {number} hz */
export function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

/** @param {number} midi */
export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * @typedef {"voiced" | "provisional" | "noise" | "unvoiced" | "silent"} FrameStatus
 * @typedef {{ t: number, f0: number | null, midi: number | null, conf: number, rmsDb: number,
 *   snrDb: number | null, status: FrameStatus }} AnalyzedFrame
 * @typedef {{ ms: number, band: number, floorDb: number, bandDb: number, frames: number }} NoiseProfile
 * @typedef {{ midi: number, t0: number, t1: number }} TimedTarget
 */

const r3 = (x) => Math.round(x * 1000) / 1000;

function medianInPlace(a) {
  a.sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * @param {Partial<typeof ANALYZER_DEFAULTS> & { fs: number, N?: number }} options
 */
export function createPitchAnalyzer(options) {
  const o = { ...ANALYZER_DEFAULTS, ...options };
  const fs = o.fs;
  const N = o.N ?? windowSizeFor(fs);
  const hop = Math.max(1, Math.round(fs * o.hopSec));
  const hopSec = hop / fs;
  let range = { fMin: o.fMin, fMax: o.fMax };
  let mpm = createMpm({ N, fs, fMin: range.fMin, fMax: range.fMax, k: o.k });
  const band = createBandPower({ N, fs });
  let winPow = 0;
  for (let i = 0; i < N; i++) {
    const wv = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / N);
    winPow += wv * wv;
  }
  const bandFloor = NOISE_POW_MIN * winPow * (band.k2 - band.k1 + 1);

  const ring = new Float32Array(2 * N); // double-write ring: window is always contiguous
  const frame = new Float32Array(N);
  let w = 0;
  let filled = 0;
  let sinceHop = 0;
  let nextT = NaN;

  const levelFactor = Math.pow(10, o.levelMarginDb / 10);
  const absFloorMs = Math.pow(10, o.uncalibratedFloorDb / 10);
  /** @type {NoiseProfile | null} */
  let noise = null;
  /** @type {{ left: number, ms: number[], band: number[], done: (r: NoiseProfile | null) => void } | null} */
  let calib = null;
  /** @type {TimedTarget[]} */
  let targets = [];

  const runFrames = Math.max(1, Math.round(o.minRunSec / o.hopSec));
  const half = Math.max(0, (o.smoothFrames - 1) >> 1);
  const look = Math.max(runFrames - 1, half);
  /** @type {{ t: number, f0: number, midi: number, clarity: number, levelOk: boolean, rmsDb: number, snrDb: number | null }[]} */
  let q = [];
  let fin = 0;
  const med = [];

  function targetAt(t) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < targets.length; i++) {
      const x = targets[i];
      if (t >= x.t0 && t < x.t1) return x.midi;
      const d = t < x.t0 ? x.t0 - t : t - x.t1;
      if (d < bestD) {
        bestD = d;
        best = x.midi;
      }
    }
    return bestD <= o.priorTolSec ? best : null;
  }

  function finishCalibration() {
    const c = calib;
    calib = null;
    if (!c) return;
    const n = c.ms.length;
    if (n === 0) {
      c.done(null);
      return;
    }
    const sorted = c.ms.slice().sort((a, b) => a - b);
    const medMs = sorted[n >> 1];
    let sMs = 0;
    let sBand = 0;
    let k = 0;
    // Drop transients (> +6 dB over the median frame) from the noise estimate.
    for (let i = 0; i < n; i++) {
      if (c.ms[i] <= 4 * medMs) {
        sMs += c.ms[i];
        sBand += c.band[i];
        k++;
      }
    }
    const ms = Math.max(sMs / k, NOISE_POW_MIN);
    const bp = Math.max(sBand / k, bandFloor);
    noise = { ms, band: bp, floorDb: r3(db10(ms)), bandDb: r3(db10(bp)), frames: k };
    c.done({ ...noise });
  }

  function analyzeHop(t) {
    for (let i = 0; i < N; i++) frame[i] = ring[w + i];
    const ms = meanSquare(frame, N);
    const levelOk = noise ? ms >= noise.ms * levelFactor : ms >= absFloorMs;
    let f0 = 0;
    let clarity = 0;
    if (levelOk) {
      const res = mpm.process(frame);
      let idx = res.best;
      if (idx >= 0 && targets.length > 0) {
        const tm = targetAt(t);
        if (tm !== null) idx = pickCandidate(res, fs, midiToHz(tm), o.priorCents);
      }
      if (idx >= 0) {
        f0 = fs / res.candTau[idx];
        clarity = res.candVal[idx];
      }
    }
    let bp = 0;
    if (noise || calib) bp = band.process(frame);
    if (calib) {
      calib.ms.push(ms);
      calib.band.push(bp);
      if (--calib.left <= 0) finishCalibration();
    }
    const snrDb = noise ? r3(bandSnrDb(bp, noise.band)) : null;
    const rmsDb = r3(noise ? db10(subtractNoise(ms, noise.ms)) : db10(ms));
    q.push({ t, f0, midi: f0 > 0 ? hzToMidi(f0) : 0, clarity, levelOk, rmsDb, snrDb });
  }

  function isCand(r) {
    return r.levelOk && r.f0 > 0 && r.clarity >= o.clarityProvisional;
  }

  /** @param {number} j @param {(f: AnalyzedFrame) => void} emit */
  function finalize(j, emit) {
    const r = q[j];
    /** @type {FrameStatus} */
    let status;
    let midi = null;
    if (!r.levelOk) status = "silent";
    else if (!isCand(r)) status = "unvoiced";
    else {
      let back = 0;
      for (let i = j - 1; i >= 0 && back < runFrames && isCand(q[i]); i--) back++;
      let fwd = 0;
      for (let i = j + 1; i < q.length && fwd < runFrames && isCand(q[i]); i++) fwd++;
      if (back + 1 + fwd < runFrames) status = "unvoiced";
      else {
        med.length = 0;
        med.push(r.midi);
        for (let d = 1; d <= half && j - d >= 0 && isCand(q[j - d]); d++) med.push(q[j - d].midi);
        for (let d = 1; d <= half && j + d < q.length && isCand(q[j + d]); d++) med.push(q[j + d].midi);
        midi = medianInPlace(med);
        if (r.clarity < o.clarityShow) status = "provisional";
        else if (r.snrDb !== null && r.snrDb < o.minSnrDb) status = "noise";
        else status = "voiced";
      }
    }
    emit({
      t: Math.round(r.t * 1e5) / 1e5,
      f0: midi === null ? null : Math.round(midiToHz(midi) * 100) / 100,
      midi: midi === null ? null : Math.round(midi * 1e4) / 1e4,
      conf: r3(r.clarity),
      rmsDb: r.rmsDb,
      snrDb: r.snrDb,
      status,
    });
  }

  function resetRing() {
    ring.fill(0);
    w = 0;
    filled = 0;
    sinceHop = 0;
  }

  /** Emits every pending frame (no further lookahead) and forgets the run context. */
  function flush(emit) {
    while (fin < q.length) finalize(fin++, emit);
    q = [];
    fin = 0;
  }

  /**
   * @param {ArrayLike<number>} buf decimated samples
   * @param {number} n number of samples in buf to use
   * @param {number} t0 AudioContext time (s) of buf[0]
   * @param {(f: AnalyzedFrame) => void} emit
   */
  function process(buf, n, t0, emit) {
    if (n <= 0) return;
    // A jump in time (dropped batch, capture restart) breaks the window: start over.
    if (Number.isFinite(nextT) && Math.abs(t0 - nextT) > hopSec) {
      flush(emit);
      resetRing();
    }
    for (let i = 0; i < n; i++) {
      const v = buf[i];
      ring[w] = v;
      ring[w + N] = v;
      w = w + 1 === N ? 0 : w + 1;
      if (filled < N) filled++;
      if (++sinceHop >= hop && filled >= N) {
        sinceHop = 0;
        analyzeHop(t0 + (i - (N - 1) / 2) / fs);
        while (q.length - fin > look) finalize(fin++, emit);
      }
    }
    nextT = t0 + n / fs;
    if (fin > 256) {
      q.splice(0, fin - look);
      fin = look;
    }
  }

  return {
    fs,
    N,
    hop,
    hopSec,
    process,
    flush,
    /** Clears audio state and pending frames; keeps the noise profile and range. */
    reset() {
      resetRing();
      q = [];
      fin = 0;
      nextT = NaN;
      targets = [];
      if (calib) {
        const c = calib;
        calib = null;
        c.done(null);
      }
    },
    /** @param {TimedTarget[] | null} list target notes on the same clock as t0 */
    setTargets(list) {
      targets = (list || [])
        .filter((x) => Number.isFinite(x.midi) && Number.isFinite(x.t0) && Number.isFinite(x.t1) && x.t1 > x.t0)
        .map((x) => ({ midi: x.midi, t0: x.t0, t1: x.t1 }))
        .sort((a, b) => a.t0 - b.t0);
    },
    /** Search range in Hz, clamped to what the window supports. Returns the applied range. */
    setRange(fMin, fMax) {
      const lo = Math.max(fMin, Math.ceil(fs / (N - 17)), 40);
      const hi = Math.min(fMax, fs / 4, 1600);
      if (!(hi > lo * 1.5)) return { ...range };
      range = { fMin: lo, fMax: hi };
      mpm = createMpm({ N, fs, fMin: lo, fMax: hi, k: o.k });
      return { ...range };
    },
    getRange() {
      return { ...range };
    },
    /**
     * Measures the noise over the next `sec` seconds of input (mean power, transients dropped).
     * @param {number} sec
     * @param {(r: NoiseProfile | null) => void} done
     */
    startCalibration(sec, done) {
      if (calib) calib.done(null);
      calib = { left: Math.max(1, Math.round(sec / hopSec)), ms: [], band: [], done };
    },
    /** @param {NoiseProfile | null} p */
    setNoise(p) {
      noise = p && p.ms > 0 && p.band > 0 ? { ...p } : null;
    },
    /** @returns {NoiseProfile | null} */
    getNoise() {
      return noise ? { ...noise } : null;
    },
  };
}
