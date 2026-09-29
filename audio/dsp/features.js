// Frame level and 300-4000 Hz band power with noise compensation. Allocation-free per frame.
// Ported from experiments/dsp-bench: features.mjs (rmsDb, power spectral subtraction with a 1 %
// floor), dsputil.mjs (bandPowers: Hann-windowed FFT band power), noise.mjs (bandSnrDb).
// R13 §0/§10: gate scoring on the 300-4000 Hz band SNR, not on the full-band SNR; RMS after
// power subtraction of a 1 s noise calibration stays within 0.6 dB down to 0 dB SNR.
import { createFFT } from "./fft.js";

export const BAND_LO_HZ = 300;
export const BAND_HI_HZ = 4000;
/** Spectral-subtraction floor (fraction of the frame power kept). */
export const SS_FLOOR = 0.01;
/** Lowest noise power used in divisions (-90 dBFS). */
export const NOISE_POW_MIN = 1e-9;

/**
 * @param {ArrayLike<number>} x
 * @param {number} [n]
 * @returns {number} mean square
 */
export function meanSquare(x, n = x.length) {
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i] * x[i];
  return n > 0 ? s / n : 0;
}

/** @param {number} p power @returns {number} dB (floored at -200) */
export function db10(p) {
  return 10 * Math.log10(p > 1e-20 ? p : 1e-20);
}

/**
 * Hann-windowed band power of one frame (sum of |X[k]|^2 over the band's bins).
 * @param {{ N: number, fs: number, f1?: number, f2?: number }} o  N power of two
 */
export function createBandPower({ N, fs, f1 = BAND_LO_HZ, f2 = BAND_HI_HZ }) {
  const fft = createFFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / N);
  const df = fs / N;
  const k1 = Math.max(1, Math.ceil(f1 / df));
  const k2 = Math.min(N / 2, Math.floor(f2 / df));
  return {
    k1,
    k2,
    /** @param {ArrayLike<number>} x N samples @returns {number} */
    process(x) {
      for (let i = 0; i < N; i++) {
        re[i] = x[i] * win[i];
        im[i] = 0;
      }
      fft.forward(re, im);
      let s = 0;
      for (let k = k1; k <= k2; k++) s += re[k] * re[k] + im[k] * im[k];
      return s;
    },
  };
}

/**
 * Voice power estimate: frame power minus calibrated noise power, floored at 1 % of the frame.
 * @param {number} p
 * @param {number} noiseP
 */
export function subtractNoise(p, noiseP) {
  const v = p - noiseP;
  const fl = SS_FLOOR * p;
  return v > fl ? v : fl;
}

/**
 * Band SNR (dB) of a frame over the calibrated noise, assuming frame = voice + noise
 * (uncorrelated). Clamped to [-30, 60].
 * @param {number} p frame band power
 * @param {number} noiseP calibrated noise band power
 */
export function bandSnrDb(p, noiseP) {
  const n = noiseP > NOISE_POW_MIN * 1e-3 ? noiseP : NOISE_POW_MIN * 1e-3;
  const v = p - n;
  const snr = 10 * Math.log10((v > 1e-3 * n ? v : 1e-3 * n) / n);
  return snr > 60 ? 60 : snr;
}
