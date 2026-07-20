/* =============================================================================
 * MASTRY — scrubber.js  ·  Station 2 (scroll-scrub canvas engine)
 * -----------------------------------------------------------------------------
 * Vanilla JS, dependency-free, no build step, works from file:// (images loaded
 * via new Image(), never fetch). Drives an Apple-product-page-style hero: a tall
 * pinned section scrubs through a sequence of rendered frames drawn cover-fit to
 * a <canvas>.
 *
 * Public surface (the ONLY global): window.MastryScrubber
 *   window.MastryScrubber.init({ canvas, manifest, scrollEl,
 *                                onReady, onProgress, onLoadProgress })
 *   window.MastryScrubber.destroy()   // bonus: tears down the active instance
 *
 * See CONTRACT 2 in SPEC.md. The page owns the DOM; the engine only reads
 * geometry (getBoundingClientRect) and paints — it never creates or styles DOM.
 *
 * Internally composed of three parts, kept in one closure so nothing leaks:
 *   §1  canvas helpers   — HiDPI backing-store sizing + cover-fit draw math
 *   §2  frame store      — priority-window preloader / decode manager
 *   §3  core engine      — tier select, scroll→progress→frame, rAF dirty loop,
 *                          reduced-motion branch, wiring + public API
 * ========================================================================== */
(function () {
  'use strict';

  /* ===========================================================================
   * §1  CANVAS HELPERS  —  HiDPI backing-store sizing + cover-fit draw math
   *     Pure/DOM functions, no shared state, safe to call every animation frame.
   * ========================================================================= */

  /* coverRect(imgW, imgH, areaW, areaH) -> { sx, sy, sw, sh, dx, dy, dw, dh }
   * PURE math. CSS `background-size: cover` via the SOURCE-CROP form: dest is
   * always the full area (0,0,areaW,areaH); we crop a centered rectangle out of
   * the SOURCE whose aspect matches the area, so sw/sh === areaW/areaH and there
   * is no squish (a circle stays a circle). Source-crop never paints off-canvas.
   * Rounding: intentionally NOT floored/ceiled — exact floats keep the sampled
   * aspect exact (the whole point of "no squish"); drawImage samples fractional
   * source rects fine and drawCover enables high-quality smoothing. */
  function coverRect(imgW, imgH, areaW, areaH) {
    // Any non-finite/<=0 input -> all-zero rect. drawImage is a silent no-op on a
    // zero source size, so this never throws even if a caller skips the guard.
    if (!isFinite(imgW) || !isFinite(imgH) || !isFinite(areaW) || !isFinite(areaH) ||
        imgW <= 0 || imgH <= 0 || areaW <= 0 || areaH <= 0) {
      return { sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, dw: 0, dh: 0 };
    }

    var imgAspect = imgW / imgH;
    var areaAspect = areaW / areaH;
    var sx, sy, sw, sh;

    if (imgAspect > areaAspect) {
      // Wide image into a relatively tall/narrow area: keep FULL height, crop
      // left/right, center horizontally. sw/sh === areaAspect exactly.
      sh = imgH;
      sw = imgH * areaAspect;
      sy = 0;
      sx = (imgW - sw) / 2;
    } else if (imgAspect < areaAspect) {
      // Tall image into a relatively wide area: keep FULL width, crop top/bottom,
      // center vertically. Mirror of the case above.
      sw = imgW;
      sh = imgW / areaAspect;
      sx = 0;
      sy = (imgH - sh) / 2;
    } else {
      // Aspects match — use the whole image, no crop.
      sx = 0; sy = 0; sw = imgW; sh = imgH;
    }

    return { sx: sx, sy: sy, sw: sw, sh: sh, dx: 0, dy: 0, dw: areaW, dh: areaH };
  }

  /* sizeCanvas(canvas, dprCap, maxW, maxH) -> { w, h, dpr, cssW, cssH, changed }
   * Sizes the backing store (canvas.width/height, device px) to CSS size × dpr,
   * dpr capped at dprCap (default 2). Only writes width/height when they change —
   * assigning them clears the buffer, an avoidable flash. If the element has zero
   * CSS size (not laid out yet), it does NOT zero the backing store; it returns
   * changed:false so the caller can defer and retry (guard against init-before-layout).
   * maxW/maxH (optional): the SOURCE frame resolution. The backing store is
   * additionally capped so it never exceeds the source — a Retina display would
   * otherwise get a 2x store (e.g. 3456×2160, 7.5M px) repainted every tick while
   * the 1920×1080 frames have no extra detail to offer: pure per-frame paint cost,
   * the main "laggy on a MacBook" source. Below-1 dpr is fine — the canvas is
   * CSS-scaled up for free by the compositor. */
  function sizeCanvas(canvas, dprCap, maxW, maxH) {
    var cap = (typeof dprCap === 'number' && isFinite(dprCap) && dprCap > 0) ? dprCap : 2;

    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    var cssW = (rect && rect.width) ? rect.width : (canvas.clientWidth || 0);
    var cssH = (rect && rect.height) ? rect.height : (canvas.clientHeight || 0);

    var dpr = Math.min(window.devicePixelRatio || 1, cap);
    if (!isFinite(dpr) || dpr < 1) dpr = 1;
    if (maxW > 0 && maxH > 0 && cssW > 0 && cssH > 0) {
      dpr = Math.min(dpr, maxW / cssW, maxH / cssH);
      if (!isFinite(dpr) || dpr < 0.5) dpr = 0.5;   // sanity floor
    }

    if (cssW <= 0 || cssH <= 0) {
      // Not laid out yet — report current dims, don't destroy the buffer.
      return { w: canvas.width, h: canvas.height, dpr: dpr, cssW: cssW, cssH: cssH, changed: false };
    }

    var w = Math.round(cssW * dpr);
    var h = Math.round(cssH * dpr);

    var changed = false;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      changed = true;
    }
    return { w: w, h: h, dpr: dpr, cssW: cssW, cssH: cssH, changed: changed };
  }

  /* drawCover(ctx, img, targetW, targetH) -> boolean
   * Paints img cover-fit into a backing store of targetW×targetH DEVICE px
   * (pass canvas.width/height, not CSS size — we draw in device space, no scale).
   * Never clears: cover-fit paints every pixel, so a pre-clear is redundant and
   * would flash blank between an old frame and a not-yet-ready new one. If the
   * image is missing/undecoded or the target is degenerate, returns false and
   * touches nothing — the previous frame stays on screen (no white flash). */
  function drawCover(ctx, img, targetW, targetH) {
    if (!ctx || !img) return false;

    // naturalWidth/Height is 0 until an <img> has decoded (or on error); fall
    // back to width/height for ImageBitmap/canvas-like sources.
    var natW = img.naturalWidth || img.width || 0;
    var natH = img.naturalHeight || img.height || 0;
    if (natW <= 0 || natH <= 0) return false;
    if (!isFinite(targetW) || !isFinite(targetH) || targetW <= 0 || targetH <= 0) return false;

    var r = coverRect(natW, natH, targetW, targetH);
    if (r.sw <= 0 || r.sh <= 0 || r.dw <= 0 || r.dh <= 0) return false;

    // Premium downscaling: frames are usually higher-res than their display area.
    ctx.imageSmoothingEnabled = true;
    try { if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'; } catch (e) { /* unsupported */ }

    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    return true;
  }


  /* ===========================================================================
   * §2  FRAME STORE  —  priority-window preloader / decode manager
   *     Owns the image cache + scheduling ONLY. One scheduler, one global
   *     concurrency cap. Prefers img.decode() before marking a frame ready.
   * ========================================================================= */

  function createFrameStore(opts) {
    opts = opts || {};

    // ---- config ----
    var base = String(opts.base || '');
    var ext = String(opts.ext || '');
    var pad = opts.pad == null ? 0 : (opts.pad | 0);
    var count = Math.max(0, opts.count | 0);                          // 0 = valid empty store
    var concurrency = Math.min(8, Math.max(1, opts.concurrency == null ? 6 : (opts.concurrency | 0)));
    var windowRadius = Math.max(0, opts.window == null ? 60 : (opts.window | 0));
    var maxRadius = (opts.maxRadius != null && opts.maxRadius > 0) ? (opts.maxRadius | 0) : Infinity; // cap outward fill (mobile: don't preload the whole reel)
    var maxDecoded = Math.max(0, opts.maxDecoded == null ? 0 : (opts.maxDecoded | 0)); // held-frame cap; 0 = unbounded (hold all)
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var onReadyFrame = typeof opts.onReadyFrame === 'function' ? opts.onReadyFrame : null;

    var MAX_RETRIES = 2;                                              // total attempts = 1 + 2 retries

    // ---- per-frame state, 1-indexed (index 0 unused; keeps 1-based math clean) ----
    var STATE_IDLE = 0, STATE_LOADING = 1, STATE_READY = 2, STATE_FAILED = 3;
    var state = new Uint8Array(count + 1);                            // ~0.5KB for 505; all IDLE
    var imgs = new Array(count + 1);
    for (var _i = 0; _i <= count; _i++) imgs[_i] = null;

    // ---- scheduler bookkeeping ----
    var inFlightImgs = new Map();                                     // i -> loading Image (for destroy/abort)
    var inFlightCount = 0;                                            // occupied concurrency slots
    var readyCount = 0;                                               // DISTINCT frames ever readied (monotonic; drives load %)
    var heldReady = 0;                                                // frames CURRENTLY decoded & held in imgs[] (bounded by maxDecoded)
    var everSeen = new Uint8Array(count + 1);                        // 1 once a frame has readied — keeps readyCount monotonic across evictions
    var focusCenter = count > 0 ? 1 : 0;                             // priority center, set by focus()
    var destroyed = false;
    var pumpScheduled = false;                                        // microtask coalescing for focus()-spam
    var pinned = new Set();                                           // ensure()'d frames, FIFO top priority
    var ensureResolvers = new Map();                                 // i -> { resolve, reject }
    var ensureCache = new Map();                                     // i -> shared Promise

    function clampFrame(i) { i = i | 0; return i < 1 ? 1 : (i > count ? count : i); }
    function frameUrl(i) { return base + String(i).padStart(pad, '0') + '.' + ext; }

    // Coalesce bursts of focus()/ensure() into one pump per microtask tick.
    function schedulePump() {
      if (destroyed || pumpScheduled) return;
      pumpScheduled = true;
      Promise.resolve().then(function () { pumpScheduled = false; pump(); });
    }

    // Fill every free slot with the next-highest-priority idle frame.
    function pump() {
      if (destroyed) return;
      while (inFlightCount < concurrency) {
        var next = pickNext();
        if (next === 0) break;
        startLoad(next);
      }
    }

    // Priority: (1) pinned/ensure()'d frames, FIFO; (2) within ±windowRadius of
    // focusCenter, filling outward; (3) everything else outward (background fill,
    // so the whole sequence eventually loads for smooth seeking anywhere).
    function pickNext() {
      if (count <= 0) return 0;

      for (var pi of pinned) {
        if (state[pi] === STATE_IDLE) return pi;
      }

      var c = focusCenter, lo = 1, hi = count;

      for (var off = 0; off <= windowRadius; off++) {
        var a = c + off;
        if (a <= hi && state[a] === STATE_IDLE) return a;
        if (off > 0) {
          var b = c - off;
          if (b >= lo && state[b] === STATE_IDLE) return b;
        }
      }

      var maxOff = Math.min(maxRadius, Math.max(c - lo, hi - c));     // mobile: bounded fill — only schedule near the playhead, not the whole reel
      for (var off2 = windowRadius + 1; off2 <= maxOff; off2++) {
        var a2 = c + off2;
        if (a2 <= hi && state[a2] === STATE_IDLE) return a2;
        var b2 = c - off2;
        if (b2 >= lo && state[b2] === STATE_IDLE) return b2;
      }
      return 0;                                                       // fully scheduled
    }

    function startLoad(i) {
      state[i] = STATE_LOADING;
      inFlightCount++;                                                // the ONE place a slot is claimed
      attemptLoad(i, 0);
    }

    // Retries reuse the same concurrency slot (inFlightCount only moves in
    // startLoad and the two terminal outcomes), so the cap is a hard ceiling.
    function attemptLoad(i, attempt) {
      if (destroyed) return;

      var img = new Image();
      img.decoding = 'async';
      inFlightImgs.set(i, img);

      img.onerror = function () {
        img.onload = img.onerror = null;
        inFlightImgs.delete(i);
        if (attempt < MAX_RETRIES) attemptLoad(i, attempt + 1);
        else failLoad(i);
      };

      img.onload = function () {
        // Bytes in — prefer a full decode() before "ready" so the first draw
        // never pays decode cost on the main thread (no jank, no white flash).
        // decode() may reject for some browsers/formats; per spec that is NOT a
        // failure — onload already proves the image is usable, so we fall through
        // to ready whether decode() resolves or rejects.
        if (typeof img.decode === 'function') img.decode().then(onDecodeSettled, onDecodeSettled);
        else onDecodeSettled();
      };

      function onDecodeSettled() {
        img.onload = img.onerror = null;
        inFlightImgs.delete(i);
        finishLoad(i, img);
      }

      img.src = frameUrl(i);
    }

    function finishLoad(i, img) {
      if (destroyed) return;
      state[i] = STATE_READY;
      imgs[i] = img;
      inFlightCount--;
      heldReady++;
      if (!everSeen[i]) { everSeen[i] = 1; readyCount++; }           // first-ever load -> bump monotonic progress
      pinned.delete(i);

      if (onReadyFrame) onReadyFrame(i);
      if (onProgress) onProgress(readyCount, count);                 // monotonic (eviction below never regresses it)

      settleEnsure(i, null, img);
      maybeEvict();                                                  // bound decoded-image RAM (mobile): drop frames far from the playhead
      schedulePump();                                                // a slot freed — keep the pipe full
    }

    function failLoad(i) {
      if (destroyed) return;
      state[i] = STATE_FAILED;                                        // terminal: pickNext never picks it -> no deadlock
      inFlightCount--;
      pinned.delete(i);
      settleEnsure(i, new Error('frame ' + i + ' failed: ' + frameUrl(i)), null);
      schedulePump();
    }

    function settleEnsure(i, err, img) {
      var r = ensureResolvers.get(i);
      if (!r) return;
      ensureResolvers.delete(i);
      ensureCache.delete(i);
      if (err) r.reject(err); else r.resolve(img);
    }

    // ---- decoded-memory cap (mobile) ----
    // Holding every decoded frame (505 × ~2MB @540p ≈ 1GB) overruns a phone's
    // image budget, so the browser silently evicts+re-decodes under the hood —
    // the synchronous re-decode on each drawImage is the mid-scroll "1fps" stutter.
    // With maxDecoded set we instead keep a bounded window of decoded frames around
    // focusCenter (the playhead) and release the farthest ones; a released frame is
    // just STATE_IDLE, so it reloads normally if the user scrolls back to it.
    function maybeEvict() {
      if (maxDecoded <= 0) return;                                    // desktop: unbounded, no-op
      var guard = count + 2;                                          // hard stop against any pathological spin
      while (heldReady > maxDecoded && guard-- > 0) {
        var v = pickEvict();
        if (v === 0) break;                                          // nothing safely evictable — bail
        evict(v);
      }
    }
    // Farthest READY frame from the playhead, never a pinned/ensure()'d one. The
    // scheduled fill radius (maxRadius) is < maxDecoded/2, so the farthest held
    // frame is always outside the schedule window and won't immediately reload.
    function pickEvict() {
      var best = 0, bestDist = -1;
      for (var i = 1; i <= count; i++) {
        if (state[i] !== STATE_READY || pinned.has(i)) continue;
        var d = i > focusCenter ? i - focusCenter : focusCenter - i;
        if (d > bestDist) { bestDist = d; best = i; }
      }
      return best;
    }
    function evict(i) {
      imgs[i] = null;                                                // drop the decoded bitmap (GC-eligible)
      state[i] = STATE_IDLE;                                          // reloadable on revisit
      heldReady--;
      // readyCount / everSeen untouched -> load progress never regresses
    }

    // ---- public store API ----
    function get(i) {
      if (destroyed || count <= 0) return null;
      i = clampFrame(i);
      return state[i] === STATE_READY ? imgs[i] : null;
    }
    function isReady(i) {
      if (destroyed || count <= 0) return false;
      i = clampFrame(i);
      return state[i] === STATE_READY;
    }
    // Bounded outward scan for the nearest ready frame — used to avoid white
    // flashes when the exact target isn't decoded yet. Cheap once the window
    // around i has filled (the common scroll-scrub case).
    function nearestReady(i) {
      if (destroyed || count <= 0) return null;
      i = clampFrame(i);
      if (state[i] === STATE_READY) return imgs[i];
      var maxOff = Math.max(i - 1, count - i);
      for (var off = 1; off <= maxOff; off++) {
        var a = i + off;
        if (a <= count && state[a] === STATE_READY) return imgs[a];
        var b = i - off;
        if (b >= 1 && state[b] === STATE_READY) return imgs[b];
      }
      return null;
    }
    // Called every scroll/rAF tick — deliberately cheap (clamp + int write +
    // coalesced pump). No allocation, no scan.
    function focus(i) {
      if (destroyed || count <= 0) return;
      focusCenter = clampFrame(i);
      schedulePump();
    }
    // Re-budget the preloader after creation. Used to PHASE the load: start with a
    // small window (fast, contention-free first paint), then widen once the hero
    // is on screen so the rest of the reel streams in behind the visitor without
    // starving the initial render. Pass Infinity/0 for maxR to mean "unbounded".
    function setBudget(win, maxR) {
      if (destroyed) return;
      if (win != null) windowRadius = Math.max(0, win | 0);
      if (maxR != null) maxRadius = (isFinite(maxR) && maxR > 0) ? (maxR | 0) : Infinity;
      schedulePump();
    }
    // Promise<Image> resolving when frame i is decoded. Jumps the queue (top
    // priority) but still obeys the global concurrency cap. Shared per index.
    function ensure(i) {
      if (destroyed) return Promise.reject(new Error('FrameStore: destroyed'));
      if (count <= 0) return Promise.reject(new Error('FrameStore: empty'));
      i = clampFrame(i);
      if (state[i] === STATE_READY) return Promise.resolve(imgs[i]);
      if (state[i] === STATE_FAILED) return Promise.reject(new Error('frame ' + i + ' failed'));
      var cached = ensureCache.get(i);
      if (cached) return cached;
      var p = new Promise(function (resolve, reject) { ensureResolvers.set(i, { resolve: resolve, reject: reject }); });
      ensureCache.set(i, p);
      pinned.add(i);
      schedulePump();
      return p;
    }
    function loadedCount() { return readyCount; }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      inFlightImgs.forEach(function (img) { img.onload = null; img.onerror = null; img.src = ''; }); // best-effort abort
      inFlightImgs.clear();
      pinned.clear();
      ensureResolvers.forEach(function (r) { r.reject(new Error('FrameStore: destroyed')); });
      ensureResolvers.clear();
      ensureCache.clear();
      for (var i = 0; i <= count; i++) imgs[i] = null;
      state.fill(STATE_IDLE);
      everSeen.fill(0);
      inFlightCount = 0;
      readyCount = 0;
      heldReady = 0;
      pumpScheduled = false;
    }

    return {
      total: count,
      get: get, isReady: isReady, nearestReady: nearestReady,
      focus: focus, setBudget: setBudget, ensure: ensure, loadedCount: loadedCount, destroy: destroy
    };
  }


  /* ===========================================================================
   * §3  CORE ENGINE  —  tier select, scroll→progress→frame, rAF dirty loop,
   *                     reduced-motion branch, wiring, public API
   * ========================================================================= */

  var win = window;
  var DPR_CAP = 2;
  var SCROLL_OPTS = { passive: true };                                // reused ref for add/removeEventListener
  var RO = (typeof win.ResizeObserver === 'function') ? win.ResizeObserver : null;

  function noop() {}
  // Host callbacks are wrapped so a throw in page code can never break the engine.
  function safeCall(fn) {
    if (typeof fn !== 'function') return;
    try { fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) { /* swallow */ }
  }
  function mmMatches(q) {
    try { return !!(win.matchMedia && win.matchMedia(q).matches); } catch (e) { return false; }
  }
  function nonEmptyStr(s) { return typeof s === 'string' && s.length > 0; }

  var activeInstance = null;                                          // only one engine at a time

  function init(opts) {
    opts = opts || {};
    destroy();                                                        // clean re-init: tear down any prior instance

    var canvas = opts.canvas;
    var manifest = opts.manifest;
    var scrollEl = opts.scrollEl;
    var onReady = opts.onReady;
    var onProgress = opts.onProgress;
    var onLoadProgress = opts.onLoadProgress;

    // Hard guards — if we can't possibly run, still let the page proceed.
    if (!canvas || !canvas.getContext || !manifest) { safeCall(onReady); return; }
    var ctx = canvas.getContext('2d');
    if (!ctx) { safeCall(onReady); return; }

    var count = Math.max(0, manifest.count | 0);
    var ext = nonEmptyStr(manifest.ext) ? manifest.ext : 'webp';
    var pad = manifest.pad == null ? 4 : (manifest.pad | 0);
    // Source frame resolution — used to cap the canvas backing store: painting
    // more device pixels than the frames contain is pure per-tick cost (Retina).
    var srcW = manifest.width | 0, srcH = manifest.height | 0;

    // No frames at all: nothing to render, but don't hang the page.
    if (count <= 0) { safeCall(onLoadProgress, 0, 0); safeCall(onReady); return; }

    // ---- scroll "slow zone" over the underwater transition ----
    // The dive + underwater current (frames ~200..366) advance at REDUCED scroll
    // sensitivity so the water reads slow and deliberate: each frame in the zone
    // is given a larger scroll "weight" (factor× the normal per-frame scroll),
    // smoothly ramped in/out so the change in feel is gradual, never a hard step.
    // The .cine track in CSS is enlarged to absorb the extra travel, so frames
    // OUTSIDE the zone keep their original sensitivity — nothing else speeds up.
    // Keep SLOW roughly in sync with the .cine height (style.css); the height is
    // tuned so non-zone density matches the old linear map.
    var SLOW = { from: 200, a: 222, b: 346, to: 366, factor: 2.1 };
    function smoothstep(t) { return t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)); }
    function frameWeight(f) {
      if (f <= SLOW.from || f >= SLOW.to) return 1;                   // flat outside the zone
      if (f >= SLOW.a && f <= SLOW.b) return SLOW.factor;             // full-slow plateau
      var t = (f < SLOW.a) ? (f - SLOW.from) / (SLOW.a - SLOW.from)   // ramp in
                           : (SLOW.to - f) / (SLOW.to - SLOW.b);      // ramp out
      return 1 + (SLOW.factor - 1) * smoothstep(t);
    }
    // Precompute cumulative weight: node[i] = weighted scroll position of frame i
    // (node[1]=0). A wider gap node[i+1]-node[i] means more scroll to cross that
    // frame = slower there. Built once; the per-tick lookup is a cheap bisect.
    var node = new Float64Array(count + 1);
    for (var wf = 2; wf <= count; wf++) node[wf] = node[wf - 1] + frameWeight(wf);
    var span = node[count] || 1;
    // Map linear scroll progress p∈[0,1] -> eased float frame index ∈[1,count],
    // monotonic. Bisect for the segment then interpolate within it.
    function frameForP(p) {
      if (count <= 1) return 1;
      var target = (p < 0 ? 0 : (p > 1 ? 1 : p)) * span;
      var lo = 1, hi = count;                                         // largest i with node[i] <= target
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (node[mid] <= target) lo = mid; else hi = mid - 1;
      }
      if (lo >= count) return count;
      var seg = node[lo + 1] - node[lo];
      var ff = lo + (seg > 0 ? (target - node[lo]) / seg : 0);
      return ff < 1 ? 1 : (ff > count ? count : ff);
    }

    // ---- environment / mode ----
    // NOTE: the scrub is user-CONTROLLED (scroll position drives the frame), not
    // auto-playing motion, so we intentionally do NOT disable it under
    // prefers-reduced-motion — otherwise that setting silently kills the hero.
    // Only a genuinely missing scroll driver forces the single-still fallback.
    var reduced = mmMatches('(prefers-reduced-motion: reduce)');
    var noScroll = !scrollEl || !scrollEl.getBoundingClientRect;      // can't scrub without a driver
    var still = noScroll;                                             // "paint one representative frame" mode

    // ---- tier selection: three INDEPENDENT axes ----
    // SHAPE follows the DEVICE: a phone-sized portrait viewport loads the portrait
    //   center-crop tiers (manifest.baseP / basePLow) — the exact 9:16 slice that
    //   cover-fit would crop out of the landscape frames anyway, pre-cut on disk so
    //   the ~70% of each landscape frame a phone never shows is never downloaded
    //   (~5.4 MB instead of ~15.4 MB; identical pixels on screen). Landscape phones
    //   (rare for a scroll page) exceed 760px width → landscape tiers, still correct.
    // RESOLUTION follows the CONNECTION: a slow link (data-saver, 2g/3g, or a weak
    //   "low" 4g) loads the lighter tier of the chosen shape (720-tall) so the hero
    //   still arrives quickly. The Network Information API is absent on iOS Safari →
    //   treated as "not slow" → an iPhone gets the full portrait tier (its max
    //   quality) — NOT the 15 MB desktop reel it used to be handed.
    // MEMORY BOUNDING follows the VIEWPORT: screens small in EITHER dimension hold
    //   only a decoded window (phones in any orientation have a tight image
    //   budget); desktops hold the whole reel.
    // tier is {low, portrait, bounded}; a missing dir falls back low→full within
    // the shape, then portrait→landscape (see canFallback/fallbackTier).
    var hasLow = nonEmptyStr(manifest.baseLow);
    var hasBase = nonEmptyStr(manifest.base);
    var hasP = nonEmptyStr(manifest.baseP);
    var hasPLow = nonEmptyStr(manifest.basePLow);
    var hasLite = nonEmptyStr(manifest.baseLite);
    var hasPLite = nonEmptyStr(manifest.basePLite);
    var vw = win.innerWidth || 9999, vh = win.innerHeight || 9999;
    var smallViewport = mmMatches('(max-width:760px)') || vw <= 760;
    var boundedViewport = mmMatches('(max-width:760px), (max-height:760px)') || Math.min(vw, vh) <= 760;
    var portraitViewport = mmMatches('(orientation: portrait)') || vh >= vw;
    function detectSlowNet() {
      try {
        var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!c) return false;                                         // no API (iOS) → assume fast → full tier
        if (c.saveData) return true;                                  // user opted into data-saver
        var et = c.effectiveType || '';
        if (/(^|-)2g$/.test(et) || et === '3g') return true;          // 3g and below
        if (et === '4g' && c.downlink > 0 && c.downlink < 2) return true; // a weak ("low") 4g
      } catch (e) {}
      return false;
    }
    // detectCrawlNet: the truly starved link (2g, or a sub-800kbps downlink
    // report) — start straight on the lite tier rather than discovering it the
    // slow way via measurement.
    function detectCrawlNet() {
      try {
        var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!c) return false;
        if (/(^|-)2g$/.test(c.effectiveType || '')) return true;
        if (c.downlink > 0 && c.downlink < 0.8) return true;
      } catch (e) {}
      return false;
    }
    var tier = {
      low: detectSlowNet(),
      lite: detectCrawlNet(),
      portrait: hasP && smallViewport && portraitViewport,            // the phone case
      bounded: boundedViewport
    };
    // Per-branch gating: a requested lite/low/portrait dir that isn't in the
    // manifest quietly resolves to the nearest present tier (never a broken URL).
    function baseFor(t) {
      var b = t.portrait
        ? (t.lite && hasPLite ? manifest.basePLite : (t.low || t.lite) && hasPLow ? manifest.basePLow : manifest.baseP)
        : (t.lite && hasLite ? manifest.baseLite : (t.low || t.lite) && hasLow ? manifest.baseLow : manifest.base);
      return String(b || '');
    }
    function frameUrl(t, i) { return baseFor(t) + String(i).padStart(pad, '0') + '.' + ext; }
    // Average bytes/frame for a tier (0 = unknown) — drives the measured ladder.
    function tierAvg(t) {
      try { var b = manifest.tierBytes && manifest.tierBytes[baseFor(t)]; return (b > 0 && count > 0) ? b / count : 0; }
      catch (e) { return 0; }
    }
    // Runtime fallback (dir present in manifest but 404s on disk): shed one axis
    // per step — lite first, then low, then portrait — bottoming out at the
    // 1080p landscape reel. fallbacksLeft (below) bounds the walk.
    function canFallback(t) { return (t.lite || t.low || t.portrait) && hasBase; }
    function fallbackTier(t) {
      return t.lite ? { lite: false, low: t.low, portrait: t.portrait, bounded: t.bounded }
           : t.low ? { lite: false, low: false, portrait: t.portrait, bounded: t.bounded }
                   : { lite: false, low: false, portrait: false, bounded: t.bounded };
    }

    // ---- instance handle ----
    var inst = { destroyed: false, teardown: noop };
    activeInstance = inst;

    // ---- shared render state ----
    var store = null;
    var ctxCanvas = canvas;
    var readyFired = false;
    var fallbacksLeft = 3;                                           // portrait-lite → portrait-low → portrait → landscape is 3 steps max
    var downgrades = 0;                                              // measured-ladder steps taken (bounds re-measure loops)
    var shownImg = null;                                             // Image currently on canvas (dedupe + resize redraw)
    var ro = null;

    function fireReady() { if (readyFired || inst.destroyed) return; readyFired = true; safeCall(onReady); }

    /* ---------------- reduced-motion / no-scroll: single still frame ----------------
     * Representative frame = the last frame (count) — the bottle at rest on the
     * Greek limestone ledge, i.e. the finished product. Loaded directly (no store,
     * so we never download all 505 for a static hero). Redraws on resize so it
     * stays cover-fit correct through rotation, but binds NO scroll scrubbing. */
    function startStill(t) {
      var rep = count;                                                // ~last Greek frame
      safeCall(onLoadProgress, 0, 1);
      loadOne(frameUrl(t, rep)).then(function (img) {
        if (inst.destroyed) return;
        shownImg = img;
        paintStill();
        safeCall(onLoadProgress, 1, 1);
        safeCall(onProgress, 1, rep);                                 // onProgress may be called once
        fireReady();
      }, function () {
        if (inst.destroyed) return;
        if (canFallback(t) && fallbacksLeft > 0) { fallbacksLeft--; startStill(fallbackTier(t)); return; }
        fireReady();                                                  // couldn't load; still let the page proceed
      });
    }
    function paintStill() {
      if (inst.destroyed || !shownImg) return;
      sizeCanvas(ctxCanvas, DPR_CAP, srcW, srcH);                     // (re)size backing store, then repaint in-frame
      drawCover(ctx, shownImg, ctxCanvas.width, ctxCanvas.height);
    }

    // Tiny standalone loader for the still path (decode-before-ready, file://-safe).
    function loadOne(url) {
      return new Promise(function (resolve, reject) {
        var im = new Image();
        im.decoding = 'async';
        im.onload = function () {
          if (typeof im.decode === 'function') im.decode().then(function () { resolve(im); }, function () { resolve(im); });
          else resolve(im);
        };
        im.onerror = function () { reject(new Error('load failed: ' + url)); };
        im.src = url;
      });
    }

    /* ---------------- normal scrubbing path ---------------- */

    // ---- eased ("smoothed") scrub loop ----
    // The displayed frame does NOT snap to the scroll position; it EASES toward it
    // each rAF tick, so a chunky mouse-wheel notch (which jumps several frames at
    // once) plays as a smooth glide instead of a step. currentFloat chases
    // targetFloat; when it lands, the loop parks itself until the next scroll.
    var rafId = 0;
    var running = false;                                             // is the loop currently ticking?
    var needResize = true;                                           // force first sizing
    var renderedFrame = -1;                                          // exact frame currently painted (-1 = none)
    var lastReportedFrame = -1, lastReportedP = -1;
    var layoutRetries = 0;
    var targetFloat = 1;                                             // where scroll wants us (float, 1..count)
    var currentFloat = 1;                                            // eased displayed position (float)
    var primed = false;                                             // snap to first real target (no ease-in on load)
    var SMOOTH = 0.18;                                               // ease fraction / tick (higher = snappier, less float)
    var SNAP = 0.4;                                                  // within this many frames of target -> land + park

    // progress: p=0 when scrollEl top hits viewport top, p=1 when its bottom hits
    // viewport bottom (progress through the pinned region). Clamped; div-by-zero safe.
    function computeProgress() {
      var rect = scrollEl.getBoundingClientRect();
      var vh = win.innerHeight || document.documentElement.clientHeight || 0;
      var travel = rect.height - vh;                                  // scrollable distance while pinned
      if (!(travel > 0)) return 0;                                    // degenerate section -> guard
      var p = (0 - rect.top) / travel;
      return p < 0 ? 0 : (p > 1 ? 1 : p);
    }
    function clampFrameIdx(f) { f = Math.round(f); return f < 1 ? 1 : (f > count ? count : f); }

    // Contiguous READY frames ahead of the displayed position — the page's
    // buffer-aware auto-glide asks this to pace itself like a streaming player
    // (start only when buffered, hold when the buffer runs dry). Returns -1 in
    // still mode / before the store exists, meaning "not applicable, don't gate".
    inst.status = function (margin) {
      if (still || !store) return -1;
      var m = (margin | 0) > 0 ? (margin | 0) : 12;
      var base = clampFrameIdx(currentFloat);
      var n = 0;
      while (n < m && base + n <= count && store.isReady(base + n)) n++;
      return (base + n > count) ? m : n;               // ran off the end -> fully buffered
    };

    // Any scroll / resize / decode just (re)starts the loop; it runs until the
    // eased position settles on the target, then parks (no idle rAF churn).
    function requestTick() {
      if (inst.destroyed) return;
      if (!running) { running = true; rafId = win.requestAnimationFrame(onRaf); }
    }

    function onRaf() {
      rafId = 0;
      if (inst.destroyed) { running = false; return; }

      if (needResize) {
        var s = sizeCanvas(ctxCanvas, DPR_CAP, srcW, srcH);
        if (s.cssW <= 0 || s.cssH <= 0) {
          // Not laid out yet (init-before-layout). Retry a bounded number of
          // frames; ResizeObserver/resize will also re-kick us once sized.
          if (layoutRetries++ < 240) { rafId = win.requestAnimationFrame(onRaf); return; }
          running = false; return;
        }
        layoutRetries = 0;
        needResize = false;
        if (s.changed) { shownImg = null; renderedFrame = -1; }       // buffer cleared by resize -> force repaint
      }

      // where scroll wants us, as a float frame index — warped so the underwater
      // transition advances slower per unit scroll (see frameForP / the SLOW zone).
      var p = computeProgress();
      targetFloat = frameForP(p);
      if (!primed) { currentFloat = targetFloat; primed = true; }     // first paint: no ease-in from frame 1

      // ease currentFloat toward targetFloat
      var gap = targetFloat - currentFloat;
      if (Math.abs(gap) <= SNAP) currentFloat = targetFloat;          // close enough -> land exactly
      else currentFloat += gap * SMOOTH;

      var frame = clampFrameIdx(currentFloat);
      store.focus(clampFrameIdx(targetFloat));                        // preload AHEAD, toward the destination

      var img = store.get(frame);
      var exact = !!img;
      if (!img) img = store.nearestReady(frame);                      // no white flash: nearest decoded
      if (img && (img !== shownImg || (exact && renderedFrame !== frame))) {
        if (drawCover(ctx, img, ctxCanvas.width, ctxCanvas.height)) {
          shownImg = img;
          renderedFrame = exact ? frame : -1;                         // settle only on the exact frame (decode upgrades)
        }
      }

      // report the EASED progress so any host reveal (the end-card) tracks it smoothly
      var pEased = count > 1 ? (currentFloat - 1) / (count - 1) : 0;
      if (pEased < 0) pEased = 0; else if (pEased > 1) pEased = 1;
      if (frame !== lastReportedFrame || pEased !== lastReportedP) {
        lastReportedFrame = frame; lastReportedP = pEased;
        safeCall(onProgress, pEased, frame);
      }

      // keep gliding until we land on the target; otherwise park (scroll/decode re-kicks)
      if (needResize || currentFloat !== targetFloat) {
        rafId = win.requestAnimationFrame(onRaf);
      } else {
        running = false;
      }
    }

    function buildStore(t) {
      // Desktop (unbounded): keep every frame decoded — plenty of RAM. Fill starts
      //   small for a contention-free first paint, then setBudget() widens it to
      //   the whole reel after ready. Mobile (bounded): hold only a decoded window around the
      //   playhead and stream the rest (HTTP-cached, so revisits re-decode, not
      //   re-download). Window is sized per TIER's decoded frame cost to land
      //   ~230-365MB held: landscape 1080p ≈ 8.3MB/frame → 44; landscape 720p ≈
      //   3.7MB → 90; portrait 608x1080 ≈ 2.6MB → 120; portrait 406x720 ≈ 1.2MB →
      //   190. In every case maxDecoded > 2×maxRadius so the farthest held frame
      //   sits outside the schedule window and eviction can't thrash against the
      //   preloader. The portrait tiers' cheaper frames buy a much wider decoded
      //   window — flings that used to hit the 1080p re-decode stutter now land
      //   on already-held frames.
      var cfg = !t.bounded
        ? { concurrency: 6, window: 30, maxRadius: 60, maxDecoded: 0  }   // desktop: START small near the playhead for a fast, contention-free first paint; widened to the full reel after ready (see startScrub)
        : t.lite
          ? (t.portrait
              ? { concurrency: 6, window: 110, maxRadius: 140, maxDecoded: 300 } // phone portrait lite (304x540 ≈ .66MB dec): ~198MB
              : { concurrency: 6, window: 90,  maxRadius: 110, maxDecoded: 250 })// small landscape lite (640x360 ≈ .92MB dec): ~230MB
        : t.portrait
          ? (t.low
              ? { concurrency: 4, window: 70, maxRadius: 90, maxDecoded: 190 } // phone portrait 720: ~223MB
              : { concurrency: 4, window: 50, maxRadius: 55, maxDecoded: 120 })// phone portrait 1080: ~315MB
          : t.low
            ? { concurrency: 4, window: 40, maxRadius: 40, maxDecoded: 90 } // small landscape 720p: ~333MB
            : { concurrency: 3, window: 20, maxRadius: 20, maxDecoded: 44 };// small landscape 1080p: ~365MB
      var tBuild = (win.performance && win.performance.now) ? win.performance.now() : 0;
      return createFrameStore({
        base: baseFor(t), ext: ext, pad: pad, count: count,
        concurrency: cfg.concurrency,
        window: cfg.window,
        maxRadius: cfg.maxRadius,
        maxDecoded: cfg.maxDecoded,
        onProgress: function (loaded, total) {
          if (inst.destroyed) return;
          safeCall(onLoadProgress, loaded, total);
          // whole reel in — completion rate is a trustworthy bandwidth read;
          // climb back up a tier if it comfortably sustains one (see maybeUpgrade)
          if (loaded === total && tBuild > 0) maybeUpgrade(t, (win.performance.now() - tBuild) / 1000);
        },
        onReadyFrame: function () { if (!inst.destroyed) requestTick(); } // a frame decoded -> maybe upgrade paint
      });
    }

    // ---- measured-throughput ladder ----
    // The Network Information API routinely lies or is absent; what can't lie is
    // how long the frames ACTUALLY took. From frames-loaded-so-far + elapsed we
    // get real bytes/sec — if that can't sustain ~20 frames/sec of the current
    // tier, step down (full → low → lite) BEFORE revealing, so a 4g-at-its-worst
    // phone plays the lite reel smoothly instead of slideshow-stepping the heavy
    // one. HTTP-cached repeat visits measure instant → no downgrade. Returns the
    // next tier to try, or null to stay.
    function measuredNext(t, framesLoaded, tStart) {
      if (!(tStart > 0) || downgrades >= 2 || t.lite || framesLoaded <= 0) return null;
      var secs = Math.max(0.001, (win.performance.now() - tStart) / 1000);
      var avgNow = tierAvg(t);
      if (!(avgNow > 0)) return null;                                 // no tierBytes — can't measure
      var rate = (framesLoaded * avgNow) / secs;                      // measured bytes/sec
      // Thresholds are deliberately forgiving: the first hit on a cold CDN (DNS,
      // TLS, edge misses) measures slower than the link really is, and dropping
      // quality is the visible cost. Only leave a tier that truly can't play
      // (<14fps arrival), and prefer the 720 middle step whenever it plausibly
      // sustains — the crawl tier is a last resort, not a first response.
      if (rate / avgNow >= 14) return null;                           // current tier playable — stay
      var lowT = { lite: false, low: true, portrait: t.portrait, bounded: t.bounded };
      var liteT = { lite: true, low: t.low, portrait: t.portrait, bounded: t.bounded };
      if (!t.low && tierAvg(lowT) > 0 && rate / tierAvg(lowT) >= 14) return lowT; // low is enough
      if (t.portrait ? hasPLite : hasLite) return liteT;              // else the crawl tier
      if (!t.low && (t.portrait ? hasPLow : hasLow)) return lowT;     // no lite dir — low is still lighter
      return null;
    }

    // ---- background quality UPGRADE (the ladder's way back up) ----
    // A cold-start mismeasure (or a congested moment) must not pin the visitor
    // at low quality forever. When the CURRENT tier's whole reel finishes
    // loading, the completion rate is a solid bandwidth read — if it sustains
    // one tier up at ~24fps with 1.5x margin, swap up ONCE. The old frames stay
    // painted (the canvas never clears) while the better ones stream in around
    // the playhead, so the swap is invisible except for sharpening.
    var upgraded = false;
    function upgradeTier(t) {
      if (t.lite) return { lite: false, low: true, portrait: t.portrait, bounded: t.bounded };
      if (t.low) return { lite: false, low: false, portrait: t.portrait, bounded: t.bounded };
      return null;
    }
    function maybeUpgrade(t, totalSecs) {
      if (upgraded || inst.destroyed || still || !(totalSecs > 0)) return;
      var up = upgradeTier(t);
      if (!up) return;                                                // already at full
      var avgNow = tierAvg(t), avgUp = tierAvg(up);
      if (!(avgNow > 0) || !(avgUp > 0)) return;
      var rate = (count * avgNow) / totalSecs;                        // achieved bytes/sec over the whole reel
      // Bar = the upper tier at ~20fps. No extra margin: the completion rate
      // already understates true bandwidth (it amortizes decode + the pipeline's
      // concurrency cap), and a wrong upgrade self-corrects — the new tier's
      // critical-set re-measure can step back down (bounded by the downgrade cap).
      if (rate >= avgUp * 20) { upgraded = true; startScrub(up); }
    }

    var earlyTimer = 0;                                               // 3s partial-progress check (crawl links)

    function startScrub(t) {
      if (store) { store.destroy(); store = null; }
      if (earlyTimer) { win.clearTimeout(earlyTimer); earlyTimer = 0; }
      store = buildStore(t);
      tier = t;
      var thisStore = store;                                          // guard against stale callbacks after fallback

      // Early paint: load frame 1 first and draw it ASAP.
      store.ensure(1).then(function () {
        if (inst.destroyed || store !== thisStore) return;
        requestTick();
      }, function () {
        if (inst.destroyed || store !== thisStore) return;
        if (canFallback(t) && fallbacksLeft > 0) { fallbacksLeft--; startScrub(fallbackTier(t)); }
        // else frame 1 failed on the base landscape reel too — critical settle below still fires onReady
      });

      // Critical set for onReady = frame 1 + a few early frames. Resilient: each
      // ensure is caught so onReady fires even if a frame or two fail to decode.
      var K = Math.min(count, 12);
      var crit = [];
      var tCrit = (win.performance && win.performance.now) ? win.performance.now() : 0;
      for (var k = 1; k <= K; k++) crit.push(store.ensure(k).catch(noop));

      // On a crawl link the full critical set can take 10s+ — don't sit behind
      // the splash that long. After 3s, decide from PARTIAL progress and step
      // down early; the crit .then's store guard makes the old set a no-op.
      earlyTimer = win.setTimeout(function () {
        earlyTimer = 0;
        if (inst.destroyed || store !== thisStore || readyFired) return;
        var loaded = store.loadedCount();
        if (loaded >= K) return;                                      // done — the .then will handle it
        var next = measuredNext(t, Math.max(1, loaded), tCrit);
        if (next) { downgrades++; startScrub(next); }
      }, 3000);
      Promise.all(crit).then(function () {
        if (inst.destroyed || store !== thisStore) return;            // don't fire ready for a superseded tier

        if (earlyTimer) { win.clearTimeout(earlyTimer); earlyTimer = 0; }
        var nextTier = measuredNext(t, K, tCrit);                     // measured-throughput ladder (below)
        if (nextTier) { downgrades++; startScrub(nextTier); return; } // reveal happens on the lighter tier

        fireReady();
        // Hero is on screen — NOW widen the desktop preload so the rest of the reel
        // streams in behind the visitor (smooth seeking anywhere). Deferred a beat
        // so the first paint and the opening glide aren't fighting a full-reel
        // fetch burst — the burst is what stalls rendering on Safari / slow CPUs.
        if (!t.bounded) {
          win.setTimeout(function () {
            if (!inst.destroyed && store === thisStore) store.setBudget(120, Infinity);
          }, 700);
        }
      });
    }

    /* ---------------- listeners + teardown ---------------- */

    function onScroll() { requestTick(); }
    function onResize() {
      needResize = true;
      if (still) paintStill();                                        // still mode: resize keeps the frame cover-fit
      else requestTick();
    }

    inst.teardown = function () {
      inst.destroyed = true;
      if (rafId) { try { win.cancelAnimationFrame(rafId); } catch (e) {} rafId = 0; }
      win.removeEventListener('scroll', onScroll, SCROLL_OPTS);
      win.removeEventListener('resize', onResize);
      win.removeEventListener('orientationchange', onResize);
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
      if (earlyTimer) { try { win.clearTimeout(earlyTimer); } catch (e) {} earlyTimer = 0; }
      if (store) { try { store.destroy(); } catch (e) {} store = null; }
    };

    // ---- go ----
    win.addEventListener('resize', onResize);
    win.addEventListener('orientationchange', onResize);
    if (RO) { try { ro = new RO(onResize); ro.observe(canvas); } catch (e) { ro = null; } }

    if (still) {
      // Reduced-motion / no-scroll: no scroll binding, no rAF loop — one still frame.
      startStill(tier);
    } else {
      win.addEventListener('scroll', onScroll, SCROLL_OPTS);
      startScrub(tier);
      requestTick();                                                  // kick first sizing + paint attempt
    }
  }

  function destroy() {
    if (activeInstance) { try { activeInstance.teardown(); } catch (e) {} activeInstance = null; }
  }

  // Buffered-frames query for the active engine (used by the page's auto-glide
  // to pace itself against the loader). -1 when no engine / not applicable.
  function status(margin) {
    return (activeInstance && activeInstance.status) ? activeInstance.status(margin) : -1;
  }

  // The ONE global. Nothing else leaks from this closure.
  win.MastryScrubber = { init: init, destroy: destroy, status: status };
})();
