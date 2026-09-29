// Iterative radix-2 complex FFT. Allocation-free per call.
// Ported unchanged from experiments/dsp-bench/fft.mjs (R13 benchmark, reviewed 2026-09-28).
// createFFT(n) precomputes twiddles and the bit-reversal table once; forward()/inverse()
// work in place on caller-owned Float64Array re/im buffers.
// Convention: forward X[k] = sum_j x[j] e^{-2 pi i jk/n}; inverse includes the 1/n scale.

/**
 * @param {number} n power of two
 * @returns {{ n: number, forward(re: Float64Array, im: Float64Array): void, inverse(re: Float64Array, im: Float64Array): void }}
 */
export function createFFT(n) {
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error("FFT size must be a power of two: " + n);
  const levels = Math.round(Math.log2(n));
  const half = n >> 1;
  const cosT = new Float64Array(half);
  const sinT = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / n);
    sinT[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let x = i;
    for (let b = 0; b < levels; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r >>> 0;
  }

  function transform(re, im, sign) {
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
    for (let size = 2; size <= n; size <<= 1) {
      const h = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + h; j++, k += step) {
          const wr = cosT[k];
          const wi = sign * sinT[k];
          const l = j + h;
          const tr = re[l] * wr - im[l] * wi;
          const ti = re[l] * wi + im[l] * wr;
          re[l] = re[j] - tr;
          im[l] = im[j] - ti;
          re[j] += tr;
          im[j] += ti;
        }
      }
    }
  }

  return {
    n,
    forward(re, im) {
      transform(re, im, -1);
    },
    inverse(re, im) {
      transform(re, im, 1);
      const s = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= s;
        im[i] *= s;
      }
    },
  };
}

/** @param {number} x @returns {number} smallest power of two >= x */
export function nextPow2(x) {
  let p = 1;
  while (p < x) p <<= 1;
  return p;
}
