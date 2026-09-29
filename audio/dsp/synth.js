// Synthetic test signals: a singing-like voice that follows a note schedule, and car / HVAC /
// white noise. Used by the engine's synthetic input mode (no microphone) and by node tests.
// THESE ARE SYNTHETIC TEST SIGNALS, NOT MODELS OF A REAL SINGER OR CAR.
// Ported from experiments/dsp-bench (R13 benchmark, reviewed 2026-09-28): prng.mjs (mulberry32,
// polar Gaussian), dsputil.mjs (RBJ biquads, Klatt resonator), signals.mjs (synthVoice: -12 dB/oct
// harmonic source, per-cycle jitter/shimmer, aspiration, F1-F5 resonators, lip radiation) and
// noise.mjs (makeNoise, mixAtSnr). Changes: note schedule with legato glides, cents offset,
// per-note scatter, skipped notes, sample-rate independent harmonic limit.

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/** @param {number} seed @returns {() => number} uniform [0, 1) */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {() => number} rng @returns {() => number} standard normal */
export function makeGauss(rng) {
  let spare = 0;
  let hasSpare = false;
  return function gauss() {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }
    let u;
    let v;
    let s;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    hasSpare = true;
    return u * m;
  };
}

// ---------------------------------------------------------------------------
// Filters (offline)
// ---------------------------------------------------------------------------

/** RBJ cookbook biquad, normalized by a0. */
export function biquadCoeffs(type, f0, Q, fs) {
  const w0 = (2 * Math.PI * f0) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * Q);
  let b0;
  let b1;
  let b2;
  if (type === "lowpass") {
    b0 = (1 - cw) / 2;
    b1 = 1 - cw;
    b2 = (1 - cw) / 2;
  } else if (type === "highpass") {
    b0 = (1 + cw) / 2;
    b1 = -(1 + cw);
    b2 = (1 + cw) / 2;
  } else throw new Error("unknown biquad type " + type);
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
}

export function filt(x, type, f0, fs, Q = Math.SQRT1_2) {
  const c = biquadCoeffs(type, f0, Q, fs);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
  return x;
}

/** Klatt (1980) second-order resonator, unity gain at DC. */
export function klattResonatorInPlace(x, F, BW, fs) {
  const T = 1 / fs;
  const C = -Math.exp(-2 * Math.PI * BW * T);
  const B = 2 * Math.exp(-Math.PI * BW * T) * Math.cos(2 * Math.PI * F * T);
  const A = 1 - B - C;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = A * x[i] + B * y1 + C * y2;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

export function rms(x, start = 0, end = x.length) {
  let s = 0;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export const VOWELS = {
  a: [
    [700, 80],
    [1200, 90],
    [2600, 120],
  ],
  i: [
    [300, 60],
    [2300, 100],
    [3000, 120],
  ],
  u: [
    [320, 60],
    [800, 80],
    [2400, 120],
  ],
};
const HIGHER_FORMANTS = [
  [3500, 250],
  [4500, 300],
];

const hzOf = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * @typedef {{ midi: number, startSec: number, durSec: number }} SynthNote
 * @typedef {object} VoiceOptions
 * @property {number} fs
 * @property {SynthNote[]} notes
 * @property {number} [totalSec]        output length (default: last note end + 0.2 s)
 * @property {number} [centsError]      constant pitch offset, + sharp
 * @property {number} [noteScatterCents] SD of a random per-note offset
 * @property {{ rateHz: number, cents: number } | null} [vibrato]  cents = half peak-to-peak
 * @property {number} [jitter]          relative cycle-to-cycle jitter (0.005)
 * @property {number} [shimmer]         relative cycle-to-cycle shimmer (0.03)
 * @property {number} [aspirationDb]    breath noise re harmonic RMS (-20)
 * @property {"a" | "i" | "u"} [vowel]
 * @property {boolean} [weakH1]         source H1 x 0.3, H2 x 1.5 (octave-error stress case)
 * @property {number} [attackSec]
 * @property {number} [releaseSec]
 * @property {number} [glideSec]        pitch transition between touching notes
 * @property {number} [levelDb]         RMS of the sung parts, dBFS (-26)
 * @property {number[]} [skipNotes]     indices of notes left silent
 * @property {number} [seed]
 */

/**
 * @param {VoiceOptions} o
 * @returns {{ x: Float32Array, f0: Float32Array }} samples and nominal F0 per sample (0 = silent)
 */
export function renderVoice(o) {
  const fs = o.fs;
  const notes = (o.notes || []).slice().sort((a, b) => a.startSec - b.startSec);
  const lastEnd = notes.reduce((m, nt) => Math.max(m, nt.startSec + nt.durSec), 0);
  const n = Math.max(1, Math.round(fs * (o.totalSec ?? lastEnd + 0.2)));
  const rng = mulberry32(o.seed ?? 1);
  const g = makeGauss(rng);
  const skip = new Set(o.skipNotes || []);
  const attack = o.attackSec ?? 0.04;
  const release = o.releaseSec ?? 0.05;
  const glide = o.glideSec ?? 0.04;
  const vib = o.vibrato ?? null;
  const cents0 = o.centsError ?? 0;
  const scatter = o.noteScatterCents ?? 0;

  const f0 = new Float32Array(n);
  const env = new Float32Array(n);
  let prevEnd = -1;
  let prevHz = 0;
  let prevSung = false;
  for (let i = 0; i < notes.length; i++) {
    const nt = notes[i];
    const hz = hzOf(nt.midi + (cents0 + scatter * g()) / 100);
    const s = Math.max(0, Math.round(nt.startSec * fs));
    const e = Math.min(n, Math.round((nt.startSec + nt.durSec) * fs));
    const sung = !skip.has(i);
    const next = notes[i + 1];
    const legatoIn = sung && prevSung && Math.abs(s - prevEnd) <= 2;
    const legatoOut = sung && next && !skip.has(i + 1) && Math.abs(Math.round(next.startSec * fs) - e) <= 2;
    const na = Math.max(1, Math.round(attack * fs));
    const nr = Math.max(1, Math.round(release * fs));
    const ng = Math.max(1, Math.round(glide * fs));
    for (let k = s; k < e; k++) {
      const u = k - s;
      let hzK = hz;
      if (legatoIn && u < ng) hzK = prevHz * Math.pow(hz / prevHz, u / ng);
      f0[k] = sung ? hzK : 0;
      if (!sung) continue;
      let a = 1;
      if (!legatoIn && u < na) a = 0.5 - 0.5 * Math.cos((Math.PI * u) / na);
      const left = e - 1 - k;
      if (!legatoOut && left < nr) a = Math.min(a, 0.5 - 0.5 * Math.cos((Math.PI * left) / nr));
      env[k] = a;
    }
    prevEnd = e;
    prevHz = hz;
    prevSung = sung;
  }
  if (vib && vib.cents) {
    for (let k = 0; k < n; k++) {
      if (f0[k] > 0) f0[k] *= Math.pow(2, (vib.cents * Math.sin((2 * Math.PI * vib.rateHz * k) / fs)) / 1200);
    }
  }

  // Oscillator frequency: hold the last sung pitch through silences so the phase stays continuous.
  let fMin = Infinity;
  let hold = 0;
  for (let k = 0; k < n; k++) if (f0[k] > 0 && f0[k] < fMin) fMin = f0[k];
  if (!Number.isFinite(fMin)) return { x: new Float32Array(n), f0 };
  hold = fMin;

  const fHarmMax = Math.min(10000, 0.45 * fs);
  const Kmax = Math.floor(fHarmMax / fMin) + 2;
  const amp = new Float64Array(Kmax + 1);
  for (let k = 1; k <= Kmax; k++) amp[k] = 1 / (k * k);
  if (o.weakH1) {
    amp[1] = 0.3;
    amp[2] = 0.25 * 1.5;
  }
  let harmPow = 0;
  for (let k = 1; k * fMin < fHarmMax && k <= Kmax; k++) harmPow += (amp[k] * amp[k]) / 2;
  const harmRms = Math.sqrt(harmPow);
  const hpA = 1 / (1 + (2 * Math.PI * 500) / fs);
  const aspGain = (harmRms * Math.pow(10, (o.aspirationDb ?? -20) / 20)) / Math.sqrt(0.9);
  const sj = (o.jitter ?? 0.005) * 0.886;
  const ss = (o.shimmer ?? 0.03) * 0.886;

  const src = new Float64Array(n);
  let phase = 0;
  let jit = 1 + sj * g();
  let shim = 1 + ss * g();
  let hpX1 = 0;
  let hpY1 = 0;
  const taperStart = 0.9 * fHarmMax;
  for (let i = 0; i < n; i++) {
    if (f0[i] > 0) hold = f0[i];
    const f = hold * jit;
    phase += f / fs;
    if (phase >= 1) {
      phase -= 1;
      jit = 1 + sj * g();
      shim = 1 + ss * g();
    }
    const th = 2 * Math.PI * phase;
    const s1 = Math.sin(th);
    const c1 = Math.cos(th);
    const c2 = 2 * c1;
    let sPrev = 0;
    let sCur = s1;
    let sum = 0;
    for (let k = 1; k <= Kmax; k++) {
      const fk = k * f;
      if (fk >= fHarmMax) break;
      let wk = amp[k];
      if (fk > taperStart) wk *= (fHarmMax - fk) / (fHarmMax - taperStart);
      sum += wk * sCur;
      const sNext = c2 * sCur - sPrev;
      sPrev = sCur;
      sCur = sNext;
    }
    const wn = g();
    const hp = hpA * (hpY1 + wn - hpX1);
    hpX1 = wn;
    hpY1 = hp;
    src[i] = shim * sum + aspGain * hp * (0.6 + 0.4 * c1);
  }
  for (const [F, BW] of VOWELS[o.vowel ?? "a"] || VOWELS.a) klattResonatorInPlace(src, F, BW, fs);
  for (const [F, BW] of HIGHER_FORMANTS) if (F < 0.45 * fs) klattResonatorInPlace(src, F, BW, fs);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    src[i] = v - 0.98 * prev;
    prev = v;
  }

  let sPow = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    src[i] *= env[i];
    if (env[i] >= 0.99) {
      sPow += src[i] * src[i];
      cnt++;
    }
  }
  const r = Math.sqrt(sPow / Math.max(1, cnt));
  const gain = r > 0 ? Math.pow(10, (o.levelDb ?? -26) / 20) / r : 0;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = src[i] * gain;
  return { x, f0 };
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

function pink(n, g) {
  const x = new Float64Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = g();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return x;
}

function brown(n, g, fs) {
  const x = new Float64Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = 0.998 * y + g();
    x[i] = y;
  }
  filt(x, "highpass", 20, fs);
  filt(x, "highpass", 20, fs);
  return x;
}

function unitRms(x) {
  const s = 1 / Math.max(rms(x), 1e-20);
  for (let i = 0; i < x.length; i++) x[i] *= s;
  return x;
}

function engine(n, fs, rng, g) {
  const x = new Float64Array(n);
  const orders = [1, 2, 3, 4, 5];
  const amps = [0.3, 1.0, 0.2, 0.45, 0.15];
  const ph = orders.map(() => rng() * 2 * Math.PI);
  const lfoPh = rng() * 2 * Math.PI;
  const walkEvery = Math.max(1, Math.round(fs / 100));
  let walk = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    if (i % walkEvery === 0) {
      walk += 0.05 * g();
      walk = Math.max(-1.5, Math.min(1.5, walk));
    }
    const fr = 30 + 2.5 * Math.sin(2 * Math.PI * 0.07 * t + lfoPh) + walk;
    const am = 1 + 0.1 * Math.sin(2 * Math.PI * 0.3 * t);
    let s = 0;
    for (let m = 0; m < orders.length; m++) {
      ph[m] += (2 * Math.PI * orders[m] * fr) / fs;
      if (ph[m] > 2 * Math.PI) ph[m] -= 2 * Math.PI;
      s += amps[m] * Math.sin(ph[m]);
    }
    x[i] = am * s;
  }
  return x;
}

function bladeTones(n, fs, rng) {
  const x = new Float64Array(n);
  const amps = [1, 0.5, 0.25];
  const ph = amps.map(() => rng() * 2 * Math.PI);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const fb = 170 * (1 + 0.004 * Math.sin(2 * Math.PI * 0.2 * t));
    let s = 0;
    for (let m = 0; m < 3; m++) {
      ph[m] += (2 * Math.PI * (m + 1) * fb) / fs;
      if (ph[m] > 2 * Math.PI) ph[m] -= 2 * Math.PI;
      s += amps[m] * Math.sin(ph[m]);
    }
    x[i] = s;
  }
  return x;
}

function sumWeighted(n, comps) {
  const y = new Float64Array(n);
  for (const [x, dB] of comps) {
    const gdb = Math.pow(10, dB / 20);
    for (let i = 0; i < n; i++) y[i] += gdb * x[i];
  }
  return y;
}

/**
 * Unit-RMS synthetic noise. car = low-frequency heavy (brown + low-passed pink + engine orders
 * 30-150 Hz + weak wind); hvac = broadband fan noise with weak blade tones; white.
 * @param {"car" | "hvac" | "white"} type
 * @param {{ fs?: number, dur?: number, seed?: number }} [opts]
 * @returns {Float32Array}
 */
export function makeNoise(type, { fs = 48000, dur = 2, seed = 1 } = {}) {
  const n = Math.round(fs * dur);
  const rng = mulberry32(seed);
  const g = makeGauss(rng);
  let y;
  if (type === "car") {
    const b = unitRms(brown(n, g, fs));
    const lp = pink(n, g);
    filt(lp, "lowpass", 1200, fs);
    filt(lp, "highpass", 30, fs);
    unitRms(lp);
    const eng = unitRms(engine(n, fs, rng, g));
    const wind = pink(n, g);
    filt(wind, "highpass", 300, fs);
    filt(wind, "lowpass", Math.min(6000, 0.45 * fs), fs);
    unitRms(wind);
    y = sumWeighted(n, [
      [b, 0],
      [lp, -6],
      [eng, -6],
      [wind, -24],
    ]);
  } else if (type === "hvac") {
    const fan = new Float64Array(n);
    for (let i = 0; i < n; i++) fan[i] = g();
    filt(fan, "highpass", 150, fs);
    filt(fan, "lowpass", Math.min(5000, 0.45 * fs), fs);
    unitRms(fan);
    const pk = pink(n, g);
    filt(pk, "highpass", 80, fs);
    unitRms(pk);
    const bt = unitRms(bladeTones(n, fs, rng));
    const rum = unitRms(brown(n, g, fs));
    y = sumWeighted(n, [
      [fan, 0],
      [pk, -4],
      [bt, -14],
      [rum, -8],
    ]);
  } else if (type === "white") {
    y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = g();
  } else throw new Error("unknown noise type " + type);
  unitRms(y);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = y[i];
  return out;
}

/**
 * Mixes voice + noise at a full-band SNR measured over [vStart, vEnd).
 * @returns {{ y: Float32Array, noiseScaled: Float32Array, gain: number }}
 */
export function mixAtSnr(voice, vStart, vEnd, noise, snrDb) {
  const pv = Math.pow(rms(voice, vStart, vEnd), 2);
  const pn = Math.pow(rms(noise, vStart, vEnd), 2);
  const gain = Math.sqrt(pv / (pn * Math.pow(10, snrDb / 10)));
  const y = new Float32Array(voice.length);
  const ns = new Float32Array(voice.length);
  for (let i = 0; i < voice.length; i++) {
    ns[i] = noise[i] * gain;
    y[i] = voice[i] + ns[i];
  }
  return { y, noiseScaled: ns, gain };
}
