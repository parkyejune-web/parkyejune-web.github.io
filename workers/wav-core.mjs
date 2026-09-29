// 16-bit PCM WAV writer. No DOM, no dependencies.
// Used by timepitch-worker.js (rendered MR variants, take mixes), by the Drive guide renderer
// (src/lib/guide/render.ts) and by the node tests.

/** Peak absolute sample value over all channels. @param {Float32Array[]} channels */
export function peakOf(channels) {
  let p = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] < 0 ? -ch[i] : ch[i];
      if (v > p) p = v;
    }
  }
  return p;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * Encodes interleaved 16-bit PCM WAV in one ArrayBuffer (44-byte header).
 * normalize: if the peak exceeds 1, the whole signal is scaled so it does not clip.
 * @param {Float32Array[]} channels @param {number} sampleRate
 * @param {{ normalize?: boolean }} [opts]
 */
export function encodeWav16(channels, sampleRate, opts = {}) {
  const C = channels.length;
  if (C < 1 || C > 8) throw new RangeError(`bad channel count ${C}`);
  const L = channels[0].length;
  const dataBytes = L * C * 2;
  if (36 + dataBytes > 0xffffffff) throw new RangeError("audio too long for WAV");
  const buf = new ArrayBuffer(44 + dataBytes);
  const dv = new DataView(buf);
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, C, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * C * 2, true);
  dv.setUint16(32, C * 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, dataBytes, true);

  let gain = 1;
  if (opts.normalize) {
    const p = peakOf(channels);
    if (p > 1) gain = 0.99 / p;
  }
  if (LITTLE_ENDIAN) {
    const pcm = new Int16Array(buf, 44, L * C);
    for (let c = 0; c < C; c++) {
      const ch = channels[c];
      for (let i = 0, o = c; i < L; i++, o += C) {
        let v = ch[i] * gain;
        v = v > 1 ? 1 : v < -1 ? -1 : v;
        pcm[o] = Math.round(v * 32767);
      }
    }
  } else {
    for (let i = 0; i < L; i++) {
      for (let c = 0; c < C; c++) {
        let v = channels[c][i] * gain;
        v = v > 1 ? 1 : v < -1 ? -1 : v;
        dv.setInt16(44 + (i * C + c) * 2, Math.round(v * 32767), true);
      }
    }
  }
  return buf;
}
