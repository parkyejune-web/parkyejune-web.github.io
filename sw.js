/* Service worker template. scripts/gen-sw.mjs fills the two placeholders and writes out/sw.js. */
const VERSION = "d5509c4d0a92bd25";
const PRECACHE = ["/","/404.html","/404/","/__next.__PAGE__.txt","/__next._full.txt","/__next._tree.txt","/_next/static/Q5aa48ouUrRP43V8n4Cjw/_buildManifest.js","/_next/static/Q5aa48ouUrRP43V8n4Cjw/_clientMiddlewareManifest.js","/_next/static/Q5aa48ouUrRP43V8n4Cjw/_ssgManifest.js","/_next/static/chunks/0azizvk-3-jv0.css","/_next/static/chunks/0bma92pht_c97.js","/_next/static/chunks/0cz1d0mv5g_q7.js","/_next/static/chunks/0jumckm_om98h.js","/_next/static/chunks/0sb-gjcikuofd.js","/_next/static/chunks/0tak-xtsa2515.js","/_next/static/chunks/0xdaojn39-af-.js","/_next/static/chunks/17ul3lapjqcf9.js","/_next/static/chunks/1em_bt7ou9a3_.css","/_next/static/chunks/1hj-pgxx0ked4.js","/_next/static/chunks/1qtu8j25rbc3l.js","/_next/static/chunks/1rrlt1m6iq99o.js","/_next/static/chunks/1zisdd0p73uxo.js","/_next/static/chunks/2bmz0osvslsnm.js","/_next/static/chunks/2ey7kye10u_uh.js","/_next/static/chunks/2fog_b9nzv3st.js","/_next/static/chunks/2mmpezlrfmbu5.js","/_next/static/chunks/2pdvhl0jgpfpk.js","/_next/static/chunks/2slu14h2fjn1a.css","/_next/static/chunks/2xv9gg-bhpui7.js","/_next/static/chunks/310vm2bl3xxpt.js","/_next/static/chunks/32jin42378aap.js","/_next/static/chunks/3895w7j-3tobw.js","/_next/static/chunks/3fntmmi971322.js","/_next/static/chunks/3lkecfxzu03_2.js","/_next/static/chunks/3zy-ldwnmfhgl.js","/_next/static/chunks/406bu7b1jxyhg.js","/_next/static/chunks/41_f-c3n6j6s_.js","/_next/static/chunks/44t-7i2v36_kc.js","/_next/static/chunks/turbopack-2v4g57vd62qiv.js","/_next/static/media/PretendardVariable.subset.0.1opc5fl0c2f81.woff2","/_next/static/media/PretendardVariable.subset.1.3jpvyxtka5kur.woff2","/_next/static/media/PretendardVariable.subset.10.08kq_n7ex2y9x.woff2","/_next/static/media/PretendardVariable.subset.11.3nbd8nq5u4nl0.woff2","/_next/static/media/PretendardVariable.subset.12.127avanf2ev93.woff2","/_next/static/media/PretendardVariable.subset.13.0ma32vgner4p4.woff2","/_next/static/media/PretendardVariable.subset.14.2caoymaehd_s0.woff2","/_next/static/media/PretendardVariable.subset.15.2geaj-xwjis4o.woff2","/_next/static/media/PretendardVariable.subset.16.2b5h2wk76hiti.woff2","/_next/static/media/PretendardVariable.subset.17.3tqnw86odg8p6.woff2","/_next/static/media/PretendardVariable.subset.18.41t__atdf4k_7.woff2","/_next/static/media/PretendardVariable.subset.19.0jb_dwif1hle-.woff2","/_next/static/media/PretendardVariable.subset.2.3azkretd0h85s.woff2","/_next/static/media/PretendardVariable.subset.20.1ugumq9uh2c7z.woff2","/_next/static/media/PretendardVariable.subset.21.1hf22s0cg74ob.woff2","/_next/static/media/PretendardVariable.subset.22.2x2s6kefk7xdd.woff2","/_next/static/media/PretendardVariable.subset.23.0k7y319wnzgj9.woff2","/_next/static/media/PretendardVariable.subset.24.37hapzrq1173m.woff2","/_next/static/media/PretendardVariable.subset.25.3wcpo-a2e-1ct.woff2","/_next/static/media/PretendardVariable.subset.26.44s046zi9w_ha.woff2","/_next/static/media/PretendardVariable.subset.27.2dvy8r0rqcx61.woff2","/_next/static/media/PretendardVariable.subset.28.2if7h676h087f.woff2","/_next/static/media/PretendardVariable.subset.29.1f9iu-losndp6.woff2","/_next/static/media/PretendardVariable.subset.3.1-l5rrvcrkjj2.woff2","/_next/static/media/PretendardVariable.subset.30.21mdta5cqdban.woff2","/_next/static/media/PretendardVariable.subset.31.12jmpbo9frivn.woff2","/_next/static/media/PretendardVariable.subset.32.3u6h0e9h872s8.woff2","/_next/static/media/PretendardVariable.subset.33.05uugvwzrxkb6.woff2","/_next/static/media/PretendardVariable.subset.34.3lq8w1vm_e47e.woff2","/_next/static/media/PretendardVariable.subset.35.1ppgtatne2ui8.woff2","/_next/static/media/PretendardVariable.subset.36.3ux5acjt0max2.woff2","/_next/static/media/PretendardVariable.subset.37.19qollwjug8tx.woff2","/_next/static/media/PretendardVariable.subset.38.3eu7369_6bb6r.woff2","/_next/static/media/PretendardVariable.subset.39.3zndt2z01pr5b.woff2","/_next/static/media/PretendardVariable.subset.4.2uwd87t53w3g5.woff2","/_next/static/media/PretendardVariable.subset.40.449-e6qi0aa4q.woff2","/_next/static/media/PretendardVariable.subset.41.3wxzbxkeg9rs_.woff2","/_next/static/media/PretendardVariable.subset.42.2zw3vvml8md8l.woff2","/_next/static/media/PretendardVariable.subset.43.0iijzecdnioc7.woff2","/_next/static/media/PretendardVariable.subset.44.1gto1t8ikpp1c.woff2","/_next/static/media/PretendardVariable.subset.45.2rtdo7_sn70f8.woff2","/_next/static/media/PretendardVariable.subset.46.43ad7_qqya4x3.woff2","/_next/static/media/PretendardVariable.subset.47.3_2b_fmh-wqfp.woff2","/_next/static/media/PretendardVariable.subset.48.3z55w9z-c1brr.woff2","/_next/static/media/PretendardVariable.subset.49.26_uxgk__zdp7.woff2","/_next/static/media/PretendardVariable.subset.5.1cl4x-lh8y6x_.woff2","/_next/static/media/PretendardVariable.subset.50.0fk64wetd5xi1.woff2","/_next/static/media/PretendardVariable.subset.51.1irt0qp1j3vry.woff2","/_next/static/media/PretendardVariable.subset.52.2cmta9627jasm.woff2","/_next/static/media/PretendardVariable.subset.53.3yba1sytppvnq.woff2","/_next/static/media/PretendardVariable.subset.54.1e1rf2hyda6pv.woff2","/_next/static/media/PretendardVariable.subset.55.0qy4fl2esbgj7.woff2","/_next/static/media/PretendardVariable.subset.56.3xsfwu3u9-aix.woff2","/_next/static/media/PretendardVariable.subset.57.2uo1ho80f0b07.woff2","/_next/static/media/PretendardVariable.subset.58.019ppwwy_b_9v.woff2","/_next/static/media/PretendardVariable.subset.59.1ypeeqcpf5fph.woff2","/_next/static/media/PretendardVariable.subset.6.103yvpiqe2hei.woff2","/_next/static/media/PretendardVariable.subset.60.1y3n-tgs5nvz9.woff2","/_next/static/media/PretendardVariable.subset.61.23-t-2mo6rqs3.woff2","/_next/static/media/PretendardVariable.subset.62.1a3capm4mjxtu.woff2","/_next/static/media/PretendardVariable.subset.63.236v2r7z70_zy.woff2","/_next/static/media/PretendardVariable.subset.64.2z3h-ckznft70.woff2","/_next/static/media/PretendardVariable.subset.65.367vi4q2eppxy.woff2","/_next/static/media/PretendardVariable.subset.66.12fbrvcs8stj0.woff2","/_next/static/media/PretendardVariable.subset.67.43kqv7xcg-enj.woff2","/_next/static/media/PretendardVariable.subset.68.1krkfzqlf4z_c.woff2","/_next/static/media/PretendardVariable.subset.69.3v_1frmpl26k5.woff2","/_next/static/media/PretendardVariable.subset.7.3l2-8ek_x-2ju.woff2","/_next/static/media/PretendardVariable.subset.70.2su1d5-ccu5wv.woff2","/_next/static/media/PretendardVariable.subset.71.0f3b6or6a1o5c.woff2","/_next/static/media/PretendardVariable.subset.72.0k06bo9kj7w6n.woff2","/_next/static/media/PretendardVariable.subset.73.1c35j_fqh-z-2.woff2","/_next/static/media/PretendardVariable.subset.74.0z5ed_z8yffbn.woff2","/_next/static/media/PretendardVariable.subset.75.2djwq9cq5zdcs.woff2","/_next/static/media/PretendardVariable.subset.76.32txflmgctesv.woff2","/_next/static/media/PretendardVariable.subset.77.1-z_w3dygzj17.woff2","/_next/static/media/PretendardVariable.subset.78.3yk9a1dxwi_e2.woff2","/_next/static/media/PretendardVariable.subset.79.0o0a_ipsbx2is.woff2","/_next/static/media/PretendardVariable.subset.8.1wb7jy5pn6qvq.woff2","/_next/static/media/PretendardVariable.subset.80.353j9i9428i5j.woff2","/_next/static/media/PretendardVariable.subset.81.2wgf0971-r7is.woff2","/_next/static/media/PretendardVariable.subset.82.0kysavmczb7xh.woff2","/_next/static/media/PretendardVariable.subset.83.2pkzd_vg0x177.woff2","/_next/static/media/PretendardVariable.subset.84.28031o4p9rh5r.woff2","/_next/static/media/PretendardVariable.subset.85.40wseot0_ztzc.woff2","/_next/static/media/PretendardVariable.subset.86.0os6bexur6-au.woff2","/_next/static/media/PretendardVariable.subset.87.1_fd8he4pz2ym.woff2","/_next/static/media/PretendardVariable.subset.88.1yj5itwobcnml.woff2","/_next/static/media/PretendardVariable.subset.89.1epab-vcunkfo.woff2","/_next/static/media/PretendardVariable.subset.9.2cudtybdi0377.woff2","/_next/static/media/PretendardVariable.subset.90.1kt2p7gqo-ty1.woff2","/_next/static/media/PretendardVariable.subset.91.130hqdrq941zw.woff2","/_not-found/","/_not-found/__next._full.txt","/_not-found/__next._not-found.__PAGE__.txt","/_not-found/__next._tree.txt","/_not-found/index.txt","/audio/analyzer-worker.js","/audio/dsp/analyzer.js","/audio/dsp/decimator.js","/audio/dsp/features.js","/audio/dsp/fft.js","/audio/dsp/mpm.js","/audio/dsp/synth.js","/audio/package.json","/audio/pitch-worklet.js","/audio/synth-worker.js","/diagnostics/","/diagnostics/__next._full.txt","/diagnostics/__next._tree.txt","/diagnostics/__next.diagnostics.__PAGE__.txt","/diagnostics/index.txt","/drive/","/drive/__next._full.txt","/drive/__next._tree.txt","/drive/__next.drive.__PAGE__.txt","/drive/index.txt","/history/","/history/__next._full.txt","/history/__next._tree.txt","/history/__next.history.__PAGE__.txt","/history/index.txt","/icons/apple-touch-icon.png","/icons/icon-192.png","/icons/icon-512.png","/icons/icon-maskable-512.png","/index.txt","/manifest.webmanifest","/mr/","/mr/__next._full.txt","/mr/__next._tree.txt","/mr/__next.mr.__PAGE__.txt","/mr/index.txt","/mr/play/","/mr/play/__next._full.txt","/mr/play/__next._tree.txt","/mr/play/__next.mr.play.__PAGE__.txt","/mr/play/index.txt","/onboarding/","/onboarding/__next._full.txt","/onboarding/__next._tree.txt","/onboarding/__next.onboarding.__PAGE__.txt","/onboarding/index.txt","/practice/","/practice/__next._full.txt","/practice/__next._tree.txt","/practice/__next.practice.__PAGE__.txt","/practice/index.txt","/practice/run/","/practice/run/__next._full.txt","/practice/run/__next._tree.txt","/practice/run/__next.practice.run.__PAGE__.txt","/practice/run/index.txt","/results/","/results/__next._full.txt","/results/__next._tree.txt","/results/__next.results.__PAGE__.txt","/results/index.txt","/robots.txt","/settings/","/settings/__next._full.txt","/settings/__next._tree.txt","/settings/__next.settings.__PAGE__.txt","/settings/index.txt","/voice/manifest.json","/voice/num.min.1.wav","/voice/num.min.10.wav","/voice/num.min.11.wav","/voice/num.min.12.wav","/voice/num.min.13.wav","/voice/num.min.14.wav","/voice/num.min.15.wav","/voice/num.min.2.wav","/voice/num.min.3.wav","/voice/num.min.4.wav","/voice/num.min.5.wav","/voice/num.min.6.wav","/voice/num.min.7.wav","/voice/num.min.8.wav","/voice/num.min.9.wav","/voice/num.times.1.wav","/voice/num.times.2.wav","/voice/num.times.3.wav","/voice/num.times.4.wav","/voice/num.times.5.wav","/voice/num.times.6.wav","/voice/num.times.7.wav","/voice/num.times.8.wav","/voice/num.timesOf.1.wav","/voice/num.timesOf.2.wav","/voice/num.timesOf.3.wav","/voice/num.timesOf.4.wav","/voice/num.timesOf.5.wav","/voice/num.timesOf.6.wav","/voice/num.timesOf.7.wav","/voice/num.timesOf.8.wav","/voice/seg.300048b3.wav","/voice/seg.9a2019ef.wav","/voice/seg.b0c7094e.wav","/voice/tts.ex.arpeggio.wav","/voice/tts.ex.cooldown.wav","/voice/tts.ex.fiveTone.wav","/voice/tts.ex.humGlide.wav","/voice/tts.ex.humming.wav","/voice/tts.ex.intervals.wav","/voice/tts.ex.lipTrill.wav","/voice/tts.ex.lipTrillAlt.wav","/voice/tts.ex.longTone.wav","/voice/tts.ex.onset.wav","/voice/tts.ex.rangeCheck.wav","/voice/tts.ex.swell.wav","/voice/tts.fb.good.1.wav","/voice/tts.fb.good.2.wav","/voice/tts.fb.good.3.wav","/voice/tts.fb.high.1.wav","/voice/tts.fb.high.2.wav","/voice/tts.fb.loud.1.wav","/voice/tts.fb.loud.2.wav","/voice/tts.fb.low.1.wav","/voice/tts.fb.low.2.wav","/voice/tts.fb.quiet.wav","/voice/tts.fb.skip.1.wav","/voice/tts.fb.skip.2.wav","/voice/tts.fb.unstable.1.wav","/voice/tts.fb.unstable.2.wav","/voice/tts.guide.again.wav","/voice/tts.guide.againListen.wav","/voice/tts.guide.listen.cooldown.wav","/voice/tts.guide.listen.fiveTone.wav","/voice/tts.guide.listen.glide.wav","/voice/tts.guide.listen.hum.wav","/voice/tts.guide.listen.longTone.wav","/voice/tts.guide.rest.wav","/voice/tts.guide.start.wav","/voice/tts.guide.startShort.wav","/voice/tts.intro.wav","/voice/tts.introHome.wav","/voice/tts.pause.wav","/voice/tts.paused.hidden.wav","/voice/tts.paused.micLost.wav","/voice/tts.resume.wav","/voice/tts.stop.wav","/voice/tts.turn.wav","/workers/timepitch-core.mjs","/workers/timepitch-worker.js","/workers/wav-core.mjs"];

const CACHE_PREFIX = "vocal-os-";
const CACHE = CACHE_PREFIX + VERSION;
const ORIGIN = self.location.origin;

// "/drive/index.html" and "/drive" both map to "/drive/" (trailingSlash export).
function normalizePath(pathname) {
  if (pathname.endsWith("/index.html")) return pathname.slice(0, -"index.html".length);
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (last && !last.includes(".")) return pathname + "/";
  return pathname;
}

const PRECACHE_PATHS = new Set(PRECACHE.map((p) => new URL(p, ORIGIN).pathname));

async function precache() {
  const cache = await caches.open(CACHE);
  const queue = [...PRECACHE];
  const worker = async () => {
    while (queue.length) {
      const path = queue.shift();
      const res = await fetch(new Request(path, { cache: "reload" }));
      if (!res.ok) throw new Error("precache failed: " + path + " " + res.status);
      // A redirected response cannot answer a navigation; store a clean copy.
      const clean = res.redirected
        ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })
        : res;
      await cache.put(new URL(path, ORIGIN).href, clean);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

self.addEventListener("install", (event) => {
  // No skipWaiting here: the new version waits until the page asks for it.
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function fromCache(path) {
  const cache = await caches.open(CACHE);
  return cache.match(ORIGIN + path);
}

async function handleNavigate(request, path) {
  const hit = PRECACHE_PATHS.has(path) ? await fromCache(path) : undefined;
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch (err) {
    const fallback = await fromCache("/");
    if (fallback) return fallback;
    throw err;
  }
}

// The router checks a page with a HEAD request before prefetching it (output: "export"):
// answer from the precache so links keep working offline.
async function handleHead(request, path) {
  const hit = PRECACHE_PATHS.has(path) ? await fromCache(path) : undefined;
  if (hit) return new Response(null, { status: hit.status, statusText: hit.statusText, headers: hit.headers });
  return fetch(request);
}

async function handleAsset(request, path) {
  // Query strings (e.g. Next's ?_rsc=) are ignored for precached files.
  if (PRECACHE_PATHS.has(path)) {
    const hit = await fromCache(path);
    if (hit) return hit;
  } else {
    const hit = await caches.match(request, { cacheName: CACHE });
    if (hit) return hit;
  }
  const res = await fetch(request);
  if (res.ok && res.type === "basic" && !new URL(request.url).search) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" && request.method !== "HEAD") return;
  if (request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== ORIGIN) return;
  if (url.pathname === "/sw.js") return;
  const path = normalizePath(url.pathname);
  if (request.method === "HEAD") event.respondWith(handleHead(request, path));
  else event.respondWith(request.mode === "navigate" ? handleNavigate(request, path) : handleAsset(request, path));
});
