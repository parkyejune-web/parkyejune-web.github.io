// Module Worker for the engine's synthetic input mode (testing without a microphone).
// { id, type: "voice", opts }                -> { id, x: Float32Array }  (see dsp/synth.js renderVoice)
// { id, type: "noise", noiseType, fs, dur, seed } -> { id, x: Float32Array } unit RMS
// Errors: { id, error }
import { makeNoise, renderVoice } from "./dsp/synth.js";

self.onmessage = (e) => {
  const d = e.data;
  if (!d || typeof d !== "object") return;
  try {
    let x;
    if (d.type === "voice") x = renderVoice(d.opts).x;
    else if (d.type === "noise") x = makeNoise(d.noiseType, { fs: d.fs, dur: d.dur, seed: d.seed });
    else throw new Error("unknown request " + d.type);
    self.postMessage({ id: d.id, x }, [x.buffer]);
  } catch (err) {
    self.postMessage({ id: d.id, error: String((err && err.message) || err) });
  }
};
