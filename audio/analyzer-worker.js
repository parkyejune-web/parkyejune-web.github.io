// Module Worker: pitch analysis off the audio thread (R13 §10.3).
// Receives PCM batches from pitch-worklet.js over a transferred MessagePort, returns each
// buffer to the worklet, runs dsp/analyzer.js and posts frame batches (~20 per second)
// to the main thread.
//
// Main thread -> worker:
//   { type: "init", port, fs, fMin?, fMax? }         fs = decimated rate from the worklet
//   { type: "reset" }                                 new capture: clear audio state + targets
//   { type: "flush" }                                 emit pending frames now
//   { type: "range", fMin, fMax }
//   { type: "targets", notes: [{ midi, t0, t1 }] | null }   AudioContext times
//   { type: "calibrate", id, sec }
//   { type: "noise", noise }                          restore a saved noise profile (or null)
// Worker -> main thread:
//   { type: "ready", N, hop, fs, range }
//   { type: "frames", frames }
//   { type: "calibrated", id, noise }                 noise = null when nothing was captured
//   { type: "range", range }
//   { type: "error", message }
import { createPitchAnalyzer } from "./dsp/analyzer.js";

let analyzer = null;
let port = null;
let out = [];

function emit(f) {
  out.push(f);
}

function post() {
  if (out.length === 0) return;
  self.postMessage({ type: "frames", frames: out });
  out = [];
}

function fail(err) {
  self.postMessage({ type: "error", message: String((err && err.message) || err) });
}

function onPcm(e) {
  const d = e.data;
  if (!d || d.type !== "pcm" || !d.buf) return;
  try {
    if (analyzer) analyzer.process(d.buf, d.n, d.t0, emit);
  } catch (err) {
    fail(err);
  }
  port.postMessage({ type: "ret", buf: d.buf }, [d.buf.buffer]);
  post();
}

self.onmessage = (e) => {
  const d = e.data;
  if (!d || typeof d !== "object") return;
  try {
    switch (d.type) {
      case "init": {
        analyzer = createPitchAnalyzer({ fs: d.fs, fMin: d.fMin ?? 70, fMax: d.fMax ?? 1100 });
        port = d.port;
        port.onmessage = onPcm;
        self.postMessage({ type: "ready", N: analyzer.N, hop: analyzer.hop, fs: analyzer.fs, range: analyzer.getRange() });
        break;
      }
      case "reset":
        if (analyzer) analyzer.reset();
        out = [];
        break;
      case "flush":
        if (analyzer) analyzer.flush(emit);
        post();
        break;
      case "range":
        if (analyzer) self.postMessage({ type: "range", range: analyzer.setRange(d.fMin, d.fMax) });
        break;
      case "targets":
        if (analyzer) analyzer.setTargets(d.notes);
        break;
      case "calibrate":
        if (!analyzer) {
          self.postMessage({ type: "calibrated", id: d.id, noise: null });
          break;
        }
        analyzer.startCalibration(d.sec, (noise) => self.postMessage({ type: "calibrated", id: d.id, noise }));
        break;
      case "noise":
        if (analyzer) analyzer.setNoise(d.noise);
        break;
      default:
        break;
    }
  } catch (err) {
    fail(err);
  }
};
