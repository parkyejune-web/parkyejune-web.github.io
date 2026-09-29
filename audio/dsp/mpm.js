// McLeod Pitch Method (McLeod & Wyvill 2005): NSDF from an FFT autocorrelation, key maxima,
// k-threshold (k = 0.9), parabolic interpolation. clarity = NSDF value at the chosen peak.
// Ported from experiments/dsp-bench/detectors.mjs (createMpm, useFFT path; R13 benchmark,
// reviewed 2026-09-28). Added: every key maximum is kept as a candidate so that a target
// note can act as an octave prior (pickCandidate).
// process() allocates nothing and returns the same result object.
import { createFFT, nextPow2 } from "./fft.js";

const ENERGY_EPS = 1e-12;

/**
 * @param {number} N window length
 * @param {number} fs sample rate
 * @param {number} fMin Hz
 * @param {number} fMax Hz
 */
export function mpmLagLimits(N, fs, fMin, fMax) {
  const maxLag = Math.ceil(fs / fMin);
  const minLag = Math.max(2, Math.floor(fs / fMax));
  if (maxLag >= N - 16) throw new Error(`window N=${N} too short for fMin=${fMin} at fs=${fs}`);
  if (minLag >= maxLag) throw new Error(`empty lag range for ${fMin}-${fMax} Hz`);
  return { minLag, maxLag };
}

function parabolicShift(arr, t) {
  const a = arr[t - 1];
  const b = arr[t];
  const c = arr[t + 1];
  const den = a - 2 * b + c;
  if (den === 0) return 0;
  let s = (0.5 * (a - c)) / den;
  if (s > 1) s = 1;
  else if (s < -1) s = -1;
  return s;
}

/**
 * @typedef {object} MpmResult
 * @property {number} f0        Hz of the MPM choice, 0 = no estimate
 * @property {number} clarity   0..1
 * @property {number} tau       refined lag (samples)
 * @property {number} best      index into the candidate arrays, -1 = none
 * @property {number} nCand
 * @property {Float64Array} candTau  refined lag of each key maximum (in lag order)
 * @property {Float64Array} candVal  refined NSDF value of each key maximum
 * @property {number} highest   largest key-maximum NSDF value
 */

/**
 * @param {{ N: number, fs: number, fMin?: number, fMax?: number, k?: number }} o
 */
export function createMpm({ N, fs, fMin = 70, fMax = 1100, k = 0.9 }) {
  const { minLag, maxLag } = mpmLagLimits(N, fs, fMin, fMax);
  const L = maxLag + 1;
  const M = nextPow2(N + L + 1); // linear (not circular) autocorrelation up to lag L
  const fft = createFFT(M);
  const re = new Float64Array(M);
  const im = new Float64Array(M);
  const r = new Float64Array(L + 1);
  const nsdf = new Float64Array(L + 1);
  const keyMax = new Int32Array(L + 1);
  /** @type {MpmResult} */
  const out = {
    f0: 0,
    clarity: 0,
    tau: 0,
    best: -1,
    nCand: 0,
    candTau: new Float64Array(L + 1),
    candVal: new Float64Array(L + 1),
    highest: 0,
  };

  function none() {
    out.f0 = 0;
    out.clarity = 0;
    out.tau = 0;
    out.best = -1;
    out.nCand = 0;
    out.highest = 0;
    return out;
  }

  /** @param {Float32Array | Float64Array} x frame of N samples */
  function process(x) {
    for (let j = 0; j < N; j++) {
      re[j] = x[j];
      im[j] = 0;
    }
    for (let j = N; j < M; j++) {
      re[j] = 0;
      im[j] = 0;
    }
    fft.forward(re, im);
    for (let q = 0; q < M; q++) {
      re[q] = re[q] * re[q] + im[q] * im[q];
      im[q] = 0;
    }
    fft.inverse(re, im);
    for (let tau = 0; tau <= L; tau++) r[tau] = re[tau];

    let m = 2 * r[0];
    if (m < 2 * ENERGY_EPS) return none();
    nsdf[0] = 1;
    for (let tau = 1; tau <= L; tau++) {
      const a = x[tau - 1];
      const b = x[N - tau];
      m -= a * a + b * b;
      nsdf[tau] = m > 0 ? (2 * r[tau]) / m : 0;
    }

    // Key maxima: one per positive lobe, lags 0..maxLag (nsdf[L] only as a right neighbour).
    const size = maxLag + 1;
    let pos = 0;
    const lim = Math.floor((size - 1) / 3);
    while (pos < lim && nsdf[pos] > 0) pos++;
    while (pos < size - 1 && nsdf[pos] <= 0) pos++;
    if (pos === 0) pos = 1;
    let nKey = 0;
    let cur = 0;
    while (pos < size - 1) {
      if (nsdf[pos] > nsdf[pos - 1] && nsdf[pos] >= nsdf[pos + 1]) {
        if (cur === 0 || nsdf[pos] > nsdf[cur]) cur = pos;
      }
      pos++;
      if (pos < size - 1 && nsdf[pos] <= 0) {
        if (cur > 0) {
          keyMax[nKey++] = cur;
          cur = 0;
        }
        while (pos < size - 1 && nsdf[pos] <= 0) pos++;
      }
    }
    if (cur > 0) keyMax[nKey++] = cur;

    let highest = -Infinity;
    let nCand = 0;
    for (let i = 0; i < nKey; i++) {
      const p = keyMax[i];
      if (p < minLag) continue;
      if (nsdf[p] > highest) highest = nsdf[p];
      const s = parabolicShift(nsdf, p);
      const v = nsdf[p] - 0.25 * (nsdf[p - 1] - nsdf[p + 1]) * s;
      out.candTau[nCand] = p + s;
      out.candVal[nCand] = v < 0 ? 0 : v > 1 ? 1 : v;
      keyMax[nCand] = p; // compact to candidates only
      nCand++;
    }
    if (nCand === 0) return none();
    const thr = k * highest;
    let best = 0;
    for (let i = 0; i < nCand; i++) {
      if (nsdf[keyMax[i]] >= thr) {
        best = i;
        break;
      }
    }
    out.nCand = nCand;
    out.highest = highest;
    out.best = best;
    out.tau = out.candTau[best];
    out.f0 = fs / out.tau;
    out.clarity = out.candVal[best];
    return out;
  }

  return { N, fs, minLag, maxLag, fMin, fMax, process, out };
}

/**
 * Octave prior: keeps the MPM choice when it lies within maxCents of the target; otherwise
 * picks the key maximum closest to the target among strong candidates
 * (value >= max(minVal, 0.6 * highest)). Falls back to the MPM choice.
 * @param {MpmResult} res
 * @param {number} fs
 * @param {number} targetHz
 * @param {number} [maxCents]
 * @param {number} [minVal]
 * @returns {number} candidate index, -1 = none
 */
export function pickCandidate(res, fs, targetHz, maxCents = 600, minVal = 0.5) {
  if (res.best < 0 || !(targetHz > 0)) return res.best;
  const centsOf = (i) => 1200 * Math.log2(fs / res.candTau[i] / targetHz);
  if (Math.abs(centsOf(res.best)) <= maxCents) return res.best;
  const floor = Math.max(minVal, 0.6 * res.highest);
  let bestI = -1;
  let bestD = Infinity;
  for (let i = 0; i < res.nCand; i++) {
    if (res.candVal[i] < floor) continue;
    const d = Math.abs(centsOf(i));
    if (d <= maxCents && d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI >= 0 ? bestI : res.best;
}
