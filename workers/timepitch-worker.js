// Module Web Worker: offline key / tempo rendering, take mixing and take alignment for the MR player.
// DSP lives in timepitch-core.mjs and wav-core.mjs (pure, also run by the node tests).
//
// The worker keeps one decoded track ("source"), its last rendered variant and one voice take,
// so the main thread never holds raw PCM of the song.
//
// in:
//   { type: "load",   id, channels: Float32Array[], sampleRate }          -> done {}
//   { type: "unload", id }                                                -> done {}
//   { type: "render", id, key, tempo, wav?: boolean }                     -> progress*, done { wav?, durationSec, ms }
//   { type: "voice",  id, voiceId, pcm: Float32Array }                    -> done {}
//   { type: "mix",    id, voiceId, key, tempo, trackStart, trackGain, voiceGain } -> progress*, done { wav, durationSec }
//   { type: "align",  id, voiceId, key, tempo, trackStart0, minLagSec, maxLagSec } -> progress*, done { lag, score, ratio, confident }
//   { type: "cancel", id }
// out:
//   { type: "progress", id, ratio } | { type: "done", id, ... } | { type: "cancelled", id } | { type: "error", id, message }
// Float32Arrays / ArrayBuffers are transferred in both directions.
import { createTimePitchJob, estimateBleedLag, mixVoiceWithTrack } from "./timepitch-core.mjs";
import { encodeWav16 } from "./wav-core.mjs";

/** @type {{ channels: Float32Array[], sampleRate: number } | null} */
let source = null;
/** @type {{ key: number, tempo: number, channels: Float32Array[] } | null} */
let variant = null;
/** @type {{ voiceId: string, pcm: Float32Array } | null} */
let voice = null;

const queue = [];
const cancelled = new Set();
let busy = false;

const CANCELLED = Symbol("cancelled");
const SLICE_MS = 50;

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "cancel") {
    cancelled.add(msg.id);
    return;
  }
  queue.push(msg);
  void pump();
};

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const msg = queue.shift();
    if (cancelled.delete(msg.id)) {
      self.postMessage({ type: "cancelled", id: msg.id });
      continue;
    }
    try {
      await handle(msg);
    } catch (err) {
      if (err === CANCELLED) self.postMessage({ type: "cancelled", id: msg.id });
      else self.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
    cancelled.delete(msg.id);
  }
  busy = false;
}

const yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0));

function checkCancel(id) {
  if (cancelled.has(id)) throw CANCELLED;
}

/** Channels of the source rendered at key / tempo (cached as the last variant). */
async function ensureVariant(id, key, tempo) {
  if (!source) throw new Error("no track loaded");
  if (key === 0 && tempo === 1) return source.channels;
  if (variant && variant.key === key && variant.tempo === tempo) return variant.channels;
  variant = null; // free before allocating the new render
  const job = createTimePitchJob(source.channels, source.sampleRate, { semitones: key, tempo });
  let lastPost = 0;
  for (;;) {
    const st = job.step(SLICE_MS);
    if (st.done) break;
    const t = performance.now();
    if (t - lastPost > 100) {
      self.postMessage({ type: "progress", id, ratio: st.progress });
      lastPost = t;
    }
    await yieldNow();
    checkCancel(id);
  }
  variant = { key, tempo, channels: job.result() };
  return variant.channels;
}

function requireVoice(voiceId) {
  if (!voice || voice.voiceId !== voiceId) throw new Error("voice not loaded");
  return voice.pcm;
}

async function handle(msg) {
  const id = msg.id;
  switch (msg.type) {
    case "load": {
      if (!Array.isArray(msg.channels) || !msg.channels.length) throw new Error("no channels");
      source = { channels: msg.channels.slice(0, 2), sampleRate: msg.sampleRate };
      variant = null;
      self.postMessage({ type: "done", id, durationSec: source.channels[0].length / source.sampleRate });
      return;
    }
    case "unload": {
      source = null;
      variant = null;
      voice = null;
      self.postMessage({ type: "done", id });
      return;
    }
    case "render": {
      const t0 = performance.now();
      const ch = await ensureVariant(id, msg.key, msg.tempo);
      const ms = performance.now() - t0;
      const durationSec = ch[0].length / source.sampleRate;
      if (msg.wav === false) {
        self.postMessage({ type: "done", id, durationSec, ms });
        return;
      }
      await yieldNow();
      checkCancel(id);
      const wav = encodeWav16(ch, source.sampleRate, { normalize: true });
      self.postMessage({ type: "done", id, wav, durationSec, ms }, [wav]);
      return;
    }
    case "voice": {
      voice = { voiceId: msg.voiceId, pcm: msg.pcm };
      self.postMessage({ type: "done", id });
      return;
    }
    case "mix": {
      const pcm = requireVoice(msg.voiceId);
      const ch = await ensureVariant(id, msg.key, msg.tempo);
      checkCancel(id);
      const mixed = mixVoiceWithTrack(ch, pcm, {
        trackStart: msg.trackStart,
        trackGain: msg.trackGain ?? 0.6,
        voiceGain: msg.voiceGain ?? 1,
      });
      await yieldNow();
      checkCancel(id);
      const wav = encodeWav16(mixed, source.sampleRate, { normalize: true });
      self.postMessage({ type: "done", id, wav, durationSec: pcm.length / source.sampleRate }, [wav]);
      return;
    }
    case "align": {
      const pcm = requireVoice(msg.voiceId);
      const ch = await ensureVariant(id, msg.key, msg.tempo);
      checkCancel(id);
      const r = estimateBleedLag(ch, pcm, {
        sampleRate: source.sampleRate,
        trackStart0: msg.trackStart0,
        minLagSec: msg.minLagSec,
        maxLagSec: msg.maxLagSec,
      });
      self.postMessage({ type: "done", id, lag: r.lag, score: r.score, ratio: r.ratio, confident: r.confident });
      return;
    }
    default:
      throw new Error(`unknown message ${String(msg.type)}`);
  }
}
