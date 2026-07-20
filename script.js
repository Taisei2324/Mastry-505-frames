/* MASTRY — interactions */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── loader ──
     YouTube-style: reveal the hero as soon as its FIRST frames are decoded
     (scrubber onReady, below) and keep buffering the rest in the background — we
     do NOT wait on window 'load' (all 505 frames + every image), which used to
     keep the splash up for seconds. A short minimum keeps the wordmark from
     flashing; a hard cap never traps the visitor. */
  var loader = document.getElementById("loader");
  var loaderDone = false;
  var loaderStart = Date.now();
  var MIN_SPLASH = reduceMotion ? 0 : 550;
  function dismissLoader() {
    if (loaderDone || !loader) return;
    loaderDone = true;
    var wait = Math.max(0, MIN_SPLASH - (Date.now() - loaderStart));
    /* Add the class synchronously when the minimum has elapsed. A NESTED
       setTimeout here can be starved for seconds behind a heavy frame-load burst
       (the outer timer fires on time, but a freshly-queued macrotask waits) —
       which would keep the splash up long after it should clear. */
    if (wait <= 0) loader.classList.add("done");
    else setTimeout(function () { loader.classList.add("done"); }, wait);
  }
  setTimeout(dismissLoader, 3500);              /* safety: never trap the visitor */

  /* ── stage 2: the rest of the site ──
     TWO-STAGE LOADING. Stage 1 (loading screen): the network belongs to the
     hero frames alone — everything marked data-src (the ~1.4MB-each flavour
     bottles) sits at zero bytes. Stage 2 (animation playing): stream those in
     SEQUENTIALLY — one request at a time — so the still-buffering frame reel
     keeps priority and the glide never starves. One-shot; never re-runs. */
  function loadRestOfSite() {
    if (loadRestOfSite.done) return;
    loadRestOfSite.done = true;
    var queue = Array.prototype.slice.call(document.querySelectorAll("img[data-src]"));
    (function next() {
      var img = queue.shift();
      if (!img) return;
      img.onload = img.onerror = function () { img.onload = img.onerror = null; next(); };
      img.src = img.getAttribute("data-src");
      img.removeAttribute("data-src");
    })();
  }

  /* ── cinematic auto-scroll (ice glide) ──
     Once the hero is ready the page GLIDES down through the pinned cinematic on
     its own — one smooth, constant-velocity motion that plays the bottle's
     journey. The first genuine interaction (wheel, touch, drag, or a navigation
     key) UNLOCKS it: the glide releases instantly and the visitor scrolls freely
     from there, and it never re-locks. Honours reduced-motion and won't hijack a
     visitor who has already started scrolling.

     Why this also fixes Safari: driving the scroll on a steady rAF cadence keeps
     the scrub engine's own loop running frame-to-frame, instead of depending on
     Safari's coalesced/deferred wheel + momentum scroll events (the source of the
     stutter). We also neutralise CSS `scroll-behavior:smooth` for the duration,
     which otherwise fights every programmatic scrollTo on Safari and Chrome. */
  var startAutoScroll = function () {};         /* no-op unless enabled just below */
  (function () {
    if (reduceMotion) return;                   /* auto-motion: honour the OS setting */
    var cineEl = document.getElementById("cine");
    if (!cineEl) return;

    var running = false, unlocked = false, rafId = 0, t0 = 0, fromY = 0, toY = 0, dur = 0;
    var rootEl = document.documentElement;
    var prevBehavior = "";

    /* ice glide: short ease-in, long CONSTANT-velocity cruise, short ease-out — a
       trapezoidal speed profile (no fast middle), so the motion reads frictionless. */
    function iceEase(t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      var R = 0.16;                             /* ramp fraction at each end */
      var cruise = 1 - 2 * R;
      var v = 1 / (cruise + R);                 /* cruise speed, area-normalised to 1 */
      if (t < R) return v * (t * t) / (2 * R);
      if (t < R + cruise) return v * (R / 2 + (t - R));
      var td = t - R - cruise;
      return v * (R / 2 + cruise + td - (td * td) / (2 * R));
    }

    function restoreBehavior() { rootEl.style.scrollBehavior = prevBehavior; }
    function stop() {
      if (!running) return;
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      restoreBehavior();                        /* hand back CSS smooth for anchor links */
    }
    function unlock() {                          /* the visitor took over — release for good */
      if (unlocked) return;
      unlocked = true;
      stop();
      EVENTS.forEach(function (type) { window.removeEventListener(type, onIntent, INTENT_OPTS); });
      loadRestOfSite();                          /* they're free-scrolling now — bring in stage 2 */
    }
    /* ── buffer-aware pacing (YouTube-style) ──
       The glide must never outrun the frame loader — that's what reads as
       "glitchy" on a real connection (localhost hides it). So it begins only
       once a healthy run of frames is decoded ahead, and mid-glide it HOLDS
       (clock paused, current frame stays up, no jumping) whenever the buffered
       run ahead of the playhead dips low, resuming as frames arrive. */
    var BUFFER_START = 30;                      /* decoded frames ahead required to begin */
    var BUFFER_KEEP = 10;                       /* hold when fewer than this remain ahead */
    var startWaited = 0, lastNow = 0, holdRun = 0;
    function bufferedAhead(m) {
      try { return (window.MastryScrubber && window.MastryScrubber.status) ? window.MastryScrubber.status(m) : -1; }
      catch (e) { return -1; }
    }

    function tick(now) {
      if (!running) return;
      var dt = lastNow > 0 ? now - lastNow : 0;
      lastNow = now;
      var ahead = bufferedAhead(BUFFER_KEEP);
      if (ahead >= 0 && ahead < BUFFER_KEEP) {
        /* Buffer low -> SLOW-MOTION, not a hard stop: scale the clock by how much
           buffer remains (empty = frozen, half = half speed), so on a starved
           link the glide degrades to a steady crawl that matches the arrival
           rate — continuous motion — instead of hold-then-burst stepping. */
        var f = ahead / BUFFER_KEEP;
        t0 += dt * (1 - f);
        holdRun = ahead === 0 ? holdRun + dt : 0;
        if (holdRun > 12000) { stop(); return; } /* frames stopped arriving entirely -> bow out */
        if (ahead === 0) { rafId = requestAnimationFrame(tick); return; }
      } else {
        holdRun = 0;
      }
      var p = dur > 0 ? Math.min((now - t0) / dur, 1) : 1;
      var y = fromY + (toY - fromY) * iceEase(p);
      try { window.scrollTo({ top: y, left: 0, behavior: "auto" }); }
      catch (e) { window.scrollTo(0, y); }      /* older Safari: object form unsupported */
      if (p < 1) rafId = requestAnimationFrame(tick);
      else unlock();                            /* reached the end — hand off PERMANENTLY (the
                                                   glide is one-shot and can never re-arm/reloop) */
    }

    startAutoScroll = function () {
      if (unlocked || running) return;
      if ((window.scrollY || window.pageYOffset || 0) > 4) return;   /* visitor already moved */
      var ahead = bufferedAhead(BUFFER_START);
      if (ahead >= 0 && ahead < BUFFER_START && startWaited < 15000) {
        startWaited += 350;                     /* not buffered yet -> check again shortly */
        setTimeout(startAutoScroll, 350);
        return;
      }
      fromY = window.scrollY || window.pageYOffset || 0;
      toY = Math.max(0, cineEl.offsetTop + cineEl.offsetHeight - window.innerHeight);
      var dist = toY - fromY;
      if (dist <= 0) return;
      dur = Math.min(18000, Math.max(10000, dist / 0.38));   /* ~10–18s glide, paced to the hero */
      prevBehavior = rootEl.style.scrollBehavior;
      rootEl.style.scrollBehavior = "auto";     /* stop CSS smooth from fighting the glide */
      t0 = performance.now();
      lastNow = 0; holdRun = 0;
      running = true;
      rafId = requestAnimationFrame(tick);
      setTimeout(loadRestOfSite, 2500);         /* stage 2: a beat into the glide, start the rest */
    };

    /* Genuine user-intent events unlock; the glide's own scrollTo does NOT (we
       never listen to 'scroll'). Navigation keys count; typing in a field doesn't. */
    var EVENTS = ["wheel", "touchstart", "touchmove", "pointerdown", "mousedown", "keydown"];
    var INTENT_OPTS = { passive: true };
    var NAV_KEYS = { ArrowDown: 1, ArrowUp: 1, PageDown: 1, PageUp: 1, Home: 1, End: 1, " ": 1, Spacebar: 1 };
    function onIntent(e) {
      if (e.type === "keydown") {
        var tag = (e.target && e.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;  /* let forms type */
        if (!NAV_KEYS[e.key]) return;           /* only navigation keys mean "take over" */
      }
      unlock();
    }
    EVENTS.forEach(function (type) { window.addEventListener(type, onIntent, INTENT_OPTS); });
  })();

  /* ── hero: scroll-scrub cinematic (frames.js manifest + scrubber.js engine) ──
     A tall pinned track scrubs 505 rendered frames onto #heroCanvas as you
     scroll. onProgress drives the phase overlays (data-cine) + the marker (--cp).
     The engine handles preloading, HiDPI cover-fit, tiers, and reduced-motion. */
  (function () {
    var cineEl = document.getElementById("cine");
    var canvas = document.getElementById("heroCanvas");
    if (!cineEl || !canvas || !window.MastryScrubber || !window.MASTRY_FRAMES) return;
    var onProgressEnd = false;                   /* last end-card state (write class only on change) */
    window.MastryScrubber.init({
      canvas: canvas, manifest: window.MASTRY_FRAMES, scrollEl: cineEl,
      onReady: function () {
        document.body.classList.add("cine-ready");
        dismissLoader();                         /* first frames decoded — reveal now, keep buffering */
        setTimeout(startAutoScroll, 800);        /* let the splash finish fading, then glide */
        /* stage-2 safety: reduced-motion visitors get no glide (its start would
           normally trigger this), and a stalled start must not strand the rest
           of the site — so load it regardless after a generous beat. */
        setTimeout(loadRestOfSite, reduceMotion ? 1500 : 15000);
      },
      onProgress: function (p) {                 /* eased progress from the engine */
        if (p < 0) p = 0; else if (p > 1) p = 1;
        /* NOTE: no per-tick style writes here. Setting a :root custom property
           every animation frame invalidates style for the whole document (the
           old --cp write — nothing consumed it) and reads as jank, especially
           in Safari. Only flip the end-card class when it actually changes. */
        var end = p >= 0.9;
        if (end !== onProgressEnd) {
          onProgressEnd = end;
          document.body.classList.toggle("cine-end", end);
        }
      },
      onLoadProgress: function () {}
    });
  })();

  /* ── scroll engine: data-speed (parallax Y), data-drift (X scrub), data-rotate ──
     Layout positions are cached (not read per frame) so scrolling stays 60fps. */
  var stage = [];
  function measureStage() {
    stage.forEach(function (s) { s.el.style.transform = ""; });
    var sy = window.scrollY;
    stage.forEach(function (s) {
      var r = s.el.getBoundingClientRect();
      s.top = r.top + sy;
      s.h = r.height;
    });
    choreograph();
  }
  function choreograph() {
    if (!stage.length) return;
    var vh = window.innerHeight;
    var center = window.scrollY + vh / 2;
    stage.forEach(function (s) {
      var mid = s.top + s.h / 2 - center;          /* px from viewport centre */
      var range = vh / 2 + s.h / 2;
      var p = Math.max(-1, Math.min(1, mid / range)); /* -1 entering … 0 centred … 1 leaving */
      var t = "";
      if (s.speed) t += "translateY(" + (mid * s.speed).toFixed(1) + "px) ";
      if (s.drift) t += "translateX(" + (p * s.drift).toFixed(1) + "px) ";
      if (s.rot) t += "rotate(" + (p * s.rot).toFixed(2) + "deg)";
      s.el.style.transform = t;
    });
  }
  if (!reduceMotion) {
    document.querySelectorAll("[data-speed],[data-drift],[data-rotate]").forEach(function (el) {
      stage.push({
        el: el,
        speed: parseFloat(el.dataset.speed) || 0,
        drift: parseFloat(el.dataset.drift) || 0,
        rot: parseFloat(el.dataset.rotate) || 0,
        top: 0, h: 0
      });
    });
    window.addEventListener("resize", measureStage);
    window.addEventListener("load", measureStage);  /* re-measure once images have sized the page */
    measureStage();
  }

  /* ── nav + progress ── */
  var nav = document.getElementById("nav");
  var progress = document.getElementById("progress");
  var cine = document.getElementById("cine");
  var lastY = 0;

  function onScroll() {
    var y = window.scrollY;
    var vh = window.innerHeight;
    /* The cinematic hero is a tall, dark, full-bleed track. Keep the nav
       transparent + light (and always visible) across it; turn it solid — and
       enable hide-on-scroll-down — only once we're past it, in the light content. */
    var heroExit = cine ? cine.offsetHeight - vh * 1.1 : 40;
    nav.classList.toggle("solid", y > heroExit);
    if (!reduceMotion && y > heroExit) {
      if (y > lastY + 2) nav.classList.add("hidden");
      else if (y < lastY - 2) nav.classList.remove("hidden");
    } else {
      nav.classList.remove("hidden");
    }
    var h = document.documentElement.scrollHeight - vh;
    progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    choreograph();
    lastY = y;
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var burger = document.getElementById("burger");
  var navLinks = document.getElementById("navLinks");
  burger.addEventListener("click", function () {
    var open = navLinks.classList.toggle("open");
    burger.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", open);
  });
  navLinks.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      navLinks.classList.remove("open");
      burger.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
    }
  });

  /* ── scrollspy: mark the nav link for the section in view ── */
  var spyLinks = {};
  document.querySelectorAll('.nav__links a[href^="#"]').forEach(function (a) {
    spyLinks[a.getAttribute("href").slice(1)] = a;
  });
  var spyObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var link = spyLinks[entry.target.id];
      if (!link) return;
      if (entry.isIntersecting) {
        Object.keys(spyLinks).forEach(function (k) { spyLinks[k].classList.remove("active"); });
        link.classList.add("active");
      }
    });
  }, { rootMargin: "-35% 0px -55% 0px" });
  Object.keys(spyLinks).forEach(function (id) {
    var sec = document.getElementById(id);
    if (sec) spyObserver.observe(sec);
  });

  /* ── scroll reveals ── */
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  document.querySelectorAll(".reveal, .reveal--fade").forEach(function (el) { revealObserver.observe(el); });

  /* ── stat counters ── */
  var statObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      statObserver.unobserve(entry.target);
      var el = entry.target;
      var target = parseInt(el.dataset.count, 10);
      if (reduceMotion || target === 0) { el.textContent = target; return; }
      var start = null;
      function step(t) {
        if (!start) start = t;
        var p = Math.min((t - start) / 1200, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll(".stats__num").forEach(function (el) { statObserver.observe(el); });

  /* ── flavour switcher ── */
  var FLAVOURS = {
    original: {
      jp: "マスティック",
      desc: "The unfiltered taste of Chios. Cool resin, white flowers and clean sea air, carried on fine, persistent bubbles.",
      notes: ["mastic resin", "cedar & pine", "sea air"],
      wash: "#F7F4D8", accent: "#91964F", deep: "#596532"          /* mastic-milk / mastic-olive / mastic-deep */
    },
    yuzu: {
      jp: "ゆず・マスティック",
      desc: "Winter citrus from the orchards of Kōchi meets Aegean resin — bright zest up front, a slow honeyed finish.",
      notes: ["yuzu zest", "honeyed citrus", "resin finish"],
      wash: "#FFF9E8", accent: "#C6A548", deep: "#856623"          /* sun-pale / sun-muted / sun-earth */
    },
    ume: {
      jp: "うめ・マスティック",
      desc: "Japanese plum blossom — softly tart, quietly floral. The gentlest bottle in the line, made for before dinner.",
      notes: ["ume plum", "blossom", "soft tartness"],
      wash: "#F6EEE7", accent: "#C3936C", deep: "#714A2E"          /* clay-dust / clay-sun / clay-earth */
    },
    hinoki: {
      jp: "ヒノキ・マスティック",
      desc: "Cypress calm. A walk through a wet forest shrine — green, resinous, and clean all the way down.",
      notes: ["hinoki cypress", "forest floor", "cool resin"],
      wash: "#EEF5EA", accent: "#527748", deep: "#314C2B"          /* forest-milk / forest-pine / forest-bark */
    }
  };

  var root = document.documentElement;
  var tabs = document.querySelectorAll(".flavours__tab");
  var bottles = document.querySelectorAll(".flavours__bottle");
  var fJp = document.getElementById("fJp");
  var fDesc = document.getElementById("fDesc");
  var fNotes = document.getElementById("fNotes");
  var detail = document.getElementById("flavourDetail");

  function selectFlavour(key) {
    var f = FLAVOURS[key];
    if (!f) return;
    root.style.setProperty("--fl-wash", f.wash);
    root.style.setProperty("--fl-accent", f.accent);
    root.style.setProperty("--fl-deep", f.deep);
    tabs.forEach(function (t) {
      var on = t.dataset.flavour === key;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on);
    });
    bottles.forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.flavour === key);
    });
    /* detail panel was stripped for the minimalist layout; guard so tab clicks
       still swap the bottle + tint without touching removed nodes. */
    if (detail && fJp && fDesc && fNotes) {
      detail.style.opacity = 0;
      setTimeout(function () {
        fJp.textContent = f.jp;
        fDesc.textContent = f.desc;
        fNotes.innerHTML = f.notes.map(function (n) { return "<li>" + n + "</li>"; }).join("");
        detail.style.transition = "opacity .5s ease";
        detail.style.opacity = 1;
      }, reduceMotion ? 0 : 180);
    }
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { selectFlavour(t.dataset.flavour); });
  });

  /* (the old hero bubbles canvas was removed — the hero is now the scroll-scrub
     cinematic wired above.) */

  /* ── scenery rotation ── */
  var sceneryFrame = document.getElementById("sceneryFrame");
  if (sceneryFrame) {
    var slides = sceneryFrame.querySelectorAll(".scenery__slide");
    var dotsWrap = document.getElementById("sceneryDots");
    var current = 0;
    var timer = null;
    var HOLD = 2600;

    slides.forEach(function (s, i) {
      var d = document.createElement("button");
      d.setAttribute("role", "tab");
      d.setAttribute("aria-label", "Slide " + (i + 1));
      if (i === 0) d.classList.add("is-active");
      d.addEventListener("click", function () { go(i); restart(); });
      dotsWrap.appendChild(d);
    });
    var dots = dotsWrap.querySelectorAll("button");

    function go(i) {
      current = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle("is-active", k === current); });
      dots.forEach(function (d, k) { d.classList.toggle("is-active", k === current); });
      /* nudge the next image to start fetching before it's shown */
      var next = slides[(current + 1) % slides.length].querySelector("img");
      if (next && next.loading === "lazy") next.loading = "eager";
    }
    function restart() {
      if (timer) clearInterval(timer);
      if (!reduceMotion) timer = setInterval(function () { go(current + 1); }, HOLD);
    }

    /* land on a different scene each page load */
    go(Math.floor(Math.random() * slides.length));
    restart();

    /* once the page is loaded, fetch the remaining slides in the background */
    window.addEventListener("load", function () {
      slides.forEach(function (s) {
        var img = s.querySelector("img");
        if (img.loading === "lazy") img.loading = "eager";
      });
    });

    sceneryFrame.addEventListener("mouseenter", function () { if (timer) clearInterval(timer); });
    sceneryFrame.addEventListener("mouseleave", restart);
    /* don't rotate while off-screen */
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) restart();
      else if (timer) clearInterval(timer);
    }).observe(sceneryFrame);
  }

  /* ── order form (static site — no backend) ── */
  var orderForm = document.getElementById("orderForm");
  if (orderForm) {
    var orderOk = document.getElementById("orderOk");
    var required = orderForm.querySelectorAll("[required]");
    orderForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var valid = true;
      required.forEach(function (field) {
        var empty = !field.value.trim();
        var bad = field.type === "email" && field.value.indexOf("@") < 1;
        if (empty || bad) {
          valid = false;
          field.style.borderBottomColor = "#9A6B43"; /* clay-brown */
          if (valid === false && field === required[0]) field.focus();
        } else {
          field.style.borderBottomColor = "";
        }
      });
      if (!valid) return;
      orderForm.querySelectorAll(".fg, .fg-row, .btn, .order__note").forEach(function (el) {
        el.style.display = "none";
      });
      orderOk.hidden = false;
    });
  }
})();
