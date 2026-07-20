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

  /* ── hero scroll-speed GOVERNOR (no automation — the visitor drives) ──
     The page never scrolls on its own. Instead, the hero enforces a MAXIMUM
     downward scroll speed that decays toward the arrival: generous at the top,
     ~1/4 of that by the last frames, so nobody can blow through the cinematic —
     but under the limit the visitor scrolls completely freely, at any rhythm,
     pausing or reversing whenever they like.

       - limit(y) = V0 · e^(−DECAY · y/heroEnd)   (gradually slower toward the end)
       - the ceiling also TIGHTENS when the frame buffer runs low, so fast
         scrolling can never outrun the loader on a slow connection (the cause
         of the old stutter) — frames stream in like a player, position follows
       - upward scrolling is never limited; once past the hero, nothing is
       - nav anchor clicks (Story / Order / …) bypass the governor briefly so
         in-page navigation still jumps instantly past the hero
       - honours prefers-reduced-motion (no governor at all) */
  (function () {
    if (reduceMotion) return;
    var cineEl = document.getElementById("cine");
    if (!cineEl) return;

    var V0 = 3600;                              /* px/s ceiling at the top of the hero */
    var DECAY = 1.15;                           /* ceiling falls to e^-1.15 ≈ 32% by the arrival */
    var KEEP = 10;                              /* frames that must be decoded ahead for full speed */
    var allowed = 0, lastT = 0, heroEnd = 0, bypassUntil = 0;
    /* TOUCH DEVICES: never clamp. A phone's momentum scroll is animated by the
       OS itself; writing scrollTo against it every frame is a tug-of-war that
       reads as constant jank ("very laggy on mobile"). So the law applies to
       WHEEL input only (which we own end-to-end, no fight); coarse-pointer
       devices scroll natively and rely on the exponential frame pacing + the
       engine's nearest-ready rendering instead. */
    var COARSE = false;
    try { COARSE = window.matchMedia("(pointer: coarse)").matches; } catch (e) {}

    function limitAt(y) {
      var p = heroEnd > 0 ? Math.min(1, Math.max(0, y / heroEnd)) : 1;
      return V0 * Math.exp(-DECAY * p);
    }
    function buffered(m) {
      try { return (window.MastryScrubber && window.MastryScrubber.status) ? window.MastryScrubber.status(m) : -1; }
      catch (e) { return -1; }
    }
    function measure() { heroEnd = Math.max(0, cineEl.offsetTop + cineEl.offsetHeight - window.innerHeight); }

    /* THE LAW, with zero self-motion: every pixel of movement happens
       SYNCHRONOUSLY inside the visitor's own input event. Wheel input is taken
       over entirely (preventDefault — the browser never scrolls, so there is no
       overshoot, nothing to snap back, no jitter); each event may advance at
       most limit × (time since the previous event), and anything beyond the
       ceiling is simply VOID — not banked, not replayed. Stop scrolling and the
       page stops that same instant. Upward is always free. */
    var lastWheelT = 0;
    function setY(y) {
      /* MUST be 'instant': 'auto' defers to the page's CSS scroll-behavior
         (smooth) and turns every write into a ~600ms ANIMATION — the governor
         then fights its own animation and the law crawls. Older engines that
         reject 'instant' fall back to a plain write with CSS smooth suspended. */
      try { window.scrollTo({ top: y, left: 0, behavior: "instant" }); }
      catch (e) {
        var el = document.documentElement, prev = el.style.scrollBehavior;
        el.style.scrollBehavior = "auto";
        window.scrollTo(0, Math.round(y));
        el.style.scrollBehavior = prev;
      }
    }
    function onWheel(e) {
      if (window.__noSpeedLimit || reduceMotion) return;
      var now = performance.now();
      var y = window.scrollY || 0;
      if (now < bypassUntil || y >= heroEnd) { lastWheelT = now; return; }  /* past hero / anchor nav — native */
      var dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= window.innerHeight;
      if (!dy) return;                                        /* horizontal-only — let it be */
      e.preventDefault();
      if (dy < 0) {                                           /* upward is always free + instant */
        setY(Math.max(0, y + dy));
        allowed = Math.max(0, y + dy);
        lastWheelT = now;
        return;
      }
      /* budget for THIS event = ceiling speed × time since the last event
         (capped, so idle time doesn't accumulate into a burst allowance) */
      var gap = lastWheelT ? Math.min(0.15, (now - lastWheelT) / 1000) : 0.016;
      lastWheelT = now;
      var v = limitAt(y);
      var ahead = buffered(KEEP);
      if (ahead >= 0 && ahead < KEEP) v *= ahead / KEEP;      /* buffer low → tighter ceiling (0 = hold) */
      var take = Math.min(dy, v * gap);                       /* excess intent is VOID, never banked */
      if (take <= 0) return;
      var ny = Math.min(heroEnd, y + take);
      if (ny > y) { setY(ny); allowed = ny; }
    }

    /* Backstop for inputs that scroll natively (touch, keyboard): a gentle
       per-frame ceiling — overshoot is eased back (viscosity, not a fight).
       This only ever REACTS to the visitor's motion; with no input the page
       position is never touched. */
    function tick(now) {
      requestAnimationFrame(tick);
      var dt = lastT ? (now - lastT) / 1000 : 0;
      lastT = now;
      if (dt <= 0 || dt > 0.25) return;          /* first tick / hidden tab — don't accumulate */
      var y = window.scrollY || 0;
      if (COARSE || window.__noSpeedLimit || now < bypassUntil || y >= heroEnd) { allowed = Math.min(y, heroEnd); return; }
      var v = limitAt(allowed);
      var ahead = buffered(KEEP);
      if (ahead >= 0 && ahead < KEEP) v *= ahead / KEEP;
      var cap = allowed + v * dt;
      if (y > cap + 2) {
        var back = cap + (y - cap) * 0.55;        /* absorb ~half the overshoot per frame */
        setY(back);
        allowed = cap;
      } else {
        allowed = y > 0 ? y : 0;                 /* under the limit (or upward) — untouched */
      }
    }

    /* in-page anchor navigation must still work: bypass while the browser's
       smooth scroll animates to the target (it sails through the hero fast). */
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (a) bypassUntil = performance.now() + 1500;
    }, true);

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("wheel", onWheel, { passive: false });
    requestAnimationFrame(tick);
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
        /* stage 2: give the hero frames a short bandwidth head start, then
           stream the rest of the site while the visitor watches/scrolls. */
        setTimeout(loadRestOfSite, 2200);
      },
      onProgress: function (p, frame) {          /* eased progress from the engine */
        if (p < 0) p = 0; else if (p > 1) p = 1;
        window.__cineFrame = frame;              /* instrumentation: current painted frame (cheap plain write) */
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
