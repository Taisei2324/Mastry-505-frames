/* MASTRY — interactions */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* phones get a calmer page: no scroll-driven transforms, ambient animation only */
  var calmScroll = reduceMotion || window.matchMedia("(max-width: 760px)").matches;

  /* THE CONDUCTOR now drives DESKTOP too (user: "apply the same automation
     scroll from the mobile to PC"). It runs whenever motion is allowed — on
     phones it always did; here it also takes over the wide viewport, replacing
     the manual catch-the-frame freeze. `?guide` forces it on (also under the
     preview's forced reduced-motion), `?noguide` kills it and falls back to the
     manual freeze. The mobile CONDUCTOR block itself already handles wheel +
     keyboard input, so no input rewrite is needed. */
  var conduct = (!reduceMotion || /[?&]guide/.test(location.search)) && !/[?&]noguide/.test(location.search);

  /* Windows desktops scroll in big discrete wheel notches (a Mac trackpad tick
     is a few px; a mouse notch is ~100+), so the same choreography plays much
     faster there. Stamp .win-runway and style.css lengthens the animation
     runway — each notch advances the story less. No scroll hijacking. */
  if (!calmScroll && /Win/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "")) {
    document.documentElement.classList.add("win-runway");
  }
  if (reduceMotion) {
    document.querySelectorAll("model-viewer[auto-rotate]").forEach(function (mv) {
      mv.removeAttribute("auto-rotate");
    });
  }

  /* ── loader: STAGE-1 GATE — the veil holds until the HERO is ready ──
     bottle-3d.js sets window.__heroReady (+ fires mastry:heroready) when the
     bottle's body path COMMITS (real GLB with label+cap, or the fallback).
     While the veil is up the engine keeps waiting for the REAL bottle (up to
     7s), so "sometimes the bottle doesn't load on reload" becomes "the
     loading screen runs a little longer" instead. Ceilings keep it a veil,
     never a trap: 3.5s once the hero is ready, 8s absolute. */
  var loader = document.getElementById("loader");
  function loaderDone() {
    if (!loader || loader.classList.contains("done")) return;
    loader.classList.add("done");
    document.dispatchEvent(new CustomEvent("mastry:loaderdone")); // conductor re-arms its idle clock off this
  }
  var pageLoaded = false, brandMin = false;
  function tryLoaderDone() { if (pageLoaded && brandMin && window.__heroReady) loaderDone(); }
  window.addEventListener("load", function () {
    pageLoaded = true;
    setTimeout(function () { brandMin = true; tryLoaderDone(); }, reduceMotion ? 0 : 900);
  });
  document.addEventListener("mastry:heroready", tryLoaderDone);
  /* safety: never trap the user behind the loader */
  setTimeout(function () { if (window.__heroReady) loaderDone(); }, 3500);
  setTimeout(loaderDone, 8000);

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
      var near = 1 - Math.abs(p);                     /* 0 at edges … 1 dead centre */
      var t = "";
      if (s.tilt) t += "perspective(900px) rotateX(" + (p * s.tilt).toFixed(2) + "deg) ";
      if (s.speed) t += "translateY(" + (mid * s.speed).toFixed(1) + "px) ";
      if (s.drift) t += "translateX(" + (p * s.drift).toFixed(1) + "px) ";
      if (s.zoom) t += "scale(" + (s.zoom + (1 - s.zoom) * near).toFixed(3) + ") ";
      if (s.rot) t += "rotate(" + (p * s.rot).toFixed(2) + "deg)";
      if (t) s.el.style.transform = t;
      if (s.prog) s.el.style.setProperty("--p", Math.min(1, near * 1.6).toFixed(3));
    });
  }
  /* phones: the herowords copy box rode a data-speed parallax, but iOS
     delivers momentum-scroll events in bursts, so the transform landed in
     jumps and the box visibly TELEPORTED just as the cup framed it (user:
     "glitchy, laggy, teleporting"). Strip the attribute before the stage
     registers it AND before cupFrameY compensates for it — on a phone the
     box simply rides the page natively. */
  if (calmScroll) document.querySelectorAll(".herowords .hero__copy[data-speed]").forEach(function (el) { el.removeAttribute("data-speed"); });
  /* phones get the full scroll choreography except data-rotate (the spinning
     seal read as too busy mid-screen on mobile) */
  var stageSelector = calmScroll
    ? "[data-speed],[data-drift],[data-zoom],[data-tilt],[data-progress]"
    : "[data-speed],[data-drift],[data-rotate],[data-zoom],[data-tilt],[data-progress]";
  if (!reduceMotion) {
    document.querySelectorAll(stageSelector)
      .forEach(function (el) {
        stage.push({
          el: el,
          speed: parseFloat(el.dataset.speed) || 0,
          drift: parseFloat(el.dataset.drift) || 0,
          rot: parseFloat(el.dataset.rotate) || 0,
          zoom: parseFloat(el.dataset.zoom) || 0,
          tilt: parseFloat(el.dataset.tilt) || 0,
          prog: el.hasAttribute("data-progress"),
          top: 0, h: 0
        });
      });
    window.addEventListener("resize", measureStage);
    window.addEventListener("load", measureStage);  /* re-measure once images have sized the page */
    measureStage();
  }

  /* ── nav + hero scroll choreography ── */
  var nav = document.getElementById("nav");
  var progress = document.getElementById("progress");
  var heroBottle = document.getElementById("heroBottle");
  var heroCopy = document.querySelector(".hero__copy");
  var heroVertical = document.querySelector(".hero__vertical");
  var scrollCue = document.querySelector(".hero__scrollcue");
  var lastY = 0;

  function onScroll() {
    var y = window.scrollY;
    var vh = window.innerHeight;
    nav.classList.toggle("solid", y > 40);
    /* hide nav scrolling down, reveal scrolling up */
    if (!reduceMotion) {
      if (y > 480 && y > lastY + 2) nav.classList.add("hidden");
      else if (y < lastY - 2 || y <= 480) nav.classList.remove("hidden");
    }
    var h = document.documentElement.scrollHeight - vh;
    progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    /* pinned hero: the 3D bottle handles its own scroll physics; only the cue fades */
    if (!calmScroll && y < vh) {
      if (scrollCue) scrollCue.style.opacity = Math.max(0, 1 - y / (vh * 0.3)).toFixed(3);
    }
    choreograph();
    lastY = y;
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ── HUD reveal: the top bar pops up when the pointer nears the top edge,
     even mid-hero-sequence (html.heroseq otherwise pins it out of view). A
     mouse feature only — phones have no hover. Hysteresis (summon ≤78px, only
     dismiss past 140px after a beat) so a quick dip can't strobe it. ── */
  if (nav && window.matchMedia("(pointer: fine)").matches) {
    var peekHide = 0;
    window.addEventListener("mousemove", function (e) {
      if (e.clientY <= 78) {
        clearTimeout(peekHide);
        nav.classList.add("peek");
      } else if (e.clientY > 140 && nav.classList.contains("peek")) {
        clearTimeout(peekHide);
        peekHide = setTimeout(function () { nav.classList.remove("peek"); }, 260);
      }
    }, { passive: true });
    document.addEventListener("mouseleave", function () {
      clearTimeout(peekHide);
      peekHide = setTimeout(function () { nav.classList.remove("peek"); }, 260);
    }, { passive: true });
  }

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

  /* in-page anchor clicks glide with scroll-behavior:smooth — stamp the moment
     so THE WALL (bottle-3d.js) and the frame freeze stand down during the
     flight instead of killing it mid-pour */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (a && a.getAttribute("href").length > 1) window.__anchorGlide = Date.now();
  }, true);

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
  var JA = (document.documentElement.lang || "").indexOf("ja") === 0;
  var FLAVOURS = {
    original: {
      jp: "マスティック",
      desc: "The unfiltered taste of Chios. Cool resin, white flowers and clean sea air, carried on fine, persistent bubbles.",
      notes: ["mastic resin", "cedar & pine", "sea air"],
      descJa: "ヒオスそのままの味わい。冷たい樹脂、白い花、澄んだ潮風 — きめ細かく続く泡にのせて。",
      notesJa: ["マスティック樹脂", "杉と松", "潮風"],
      wash: "#F7F4D8", accent: "#91964F", deep: "#596532"          /* mastic-milk / mastic-olive / mastic-deep */
    },
    yuzu: {
      jp: "ゆず・マスティック",
      desc: "Winter citrus from the orchards of Kōchi meets Aegean resin — bright zest up front, a slow honeyed finish.",
      notes: ["yuzu zest", "honeyed citrus", "resin finish"],
      descJa: "高知の畑の冬柑橘と、エーゲ海の樹脂。はじける皮の香りのあと、蜂蜜のような余韻がゆっくりと。",
      notesJa: ["柚子の皮", "蜂蜜のような柑橘", "樹脂の余韻"],
      wash: "#FFF9E8", accent: "#C6A548", deep: "#856623"          /* sun-pale / sun-muted / sun-earth */
    },
    ume: {
      jp: "うめ・マスティック",
      desc: "Japanese plum blossom — softly tart, quietly floral. The gentlest bottle in the line, made for before dinner.",
      notes: ["ume plum", "blossom", "soft tartness"],
      descJa: "梅の花のように、やわらかな酸味とひかえめな花の香り。食前のための、いちばん穏やかな一本。",
      notesJa: ["梅", "花の香り", "やさしい酸味"],
      wash: "#F6EEE7", accent: "#C3936C", deep: "#714A2E"          /* clay-dust / clay-sun / clay-earth */
    },
    hinoki: {
      jp: "ヒノキ・マスティック",
      desc: "Cypress calm. A walk through a wet forest shrine — green, resinous, and clean all the way down.",
      notes: ["hinoki cypress", "forest floor", "cool resin"],
      descJa: "檜の静けさ。雨上がりの森の参道を歩くように — 緑と樹脂、最後まで清らか。",
      notesJa: ["檜", "森の香り", "冷たい樹脂"],
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

  var currentFlavour = "original"; // matches the is-active markup default
  var bottleTimer = null, bottleTimer2 = null;
  function selectFlavour(key) {
    var f = FLAVOURS[key];
    if (!f || key === currentFlavour) return;
    currentFlavour = key;
    root.style.setProperty("--fl-wash", f.wash);
    root.style.setProperty("--fl-accent", f.accent);
    root.style.setProperty("--fl-deep", f.deep);
    tabs.forEach(function (t) {
      var on = t.dataset.flavour === key;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on);
    });
    /* three-beat swap: evaporate the old bottle upward, hold the stage
       clearly empty, then condense the new bottle down into place */
    clearTimeout(bottleTimer); clearTimeout(bottleTimer2);
    if (reduceMotion) {
      bottles.forEach(function (b) {
        b.classList.remove("is-leaving");
        b.classList.toggle("is-active", b.dataset.flavour === key);
      });
    } else {
      bottles.forEach(function (b) {
        b.classList.toggle("is-leaving", b.classList.contains("is-active"));
        b.classList.remove("is-active");
      });
      bottleTimer = setTimeout(function () {
        bottles.forEach(function (b) { b.classList.remove("is-leaving"); });
      }, 620);
      bottleTimer2 = setTimeout(function () {
        bottles.forEach(function (b) {
          b.classList.toggle("is-active", b.dataset.flavour === key);
        });
      }, 1200);
    }
    detail.style.opacity = 0;
    setTimeout(function () {
      fJp.textContent = f.jp;
      fDesc.textContent = JA ? f.descJa : f.desc;
      fNotes.innerHTML = (JA ? f.notesJa : f.notes).map(function (n) { return "<li>" + n + "</li>"; }).join("");
      detail.style.transition = "opacity .5s ease";
      detail.style.opacity = 1;
    }, reduceMotion ? 0 : 180);
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { selectFlavour(t.dataset.flavour); });
  });

  /* ── hero bubbles ── */
  var canvas = document.getElementById("bubbles");
  if (canvas && !reduceMotion) {
    var ctx = canvas.getContext("2d");
    var bubbles = [];
    var running = true;

    function resize() {
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
    }
    resize();
    window.addEventListener("resize", resize);

    function spawn() {
      var w = canvas.width;
      return {
        x: w * (0.3 + Math.random() * 0.4),
        y: canvas.height + 10,
        r: (1 + Math.random() * 2.6) * devicePixelRatio,
        v: (0.35 + Math.random() * 0.75) * devicePixelRatio,
        drift: (Math.random() - 0.5) * 0.35 * devicePixelRatio,
        a: 0.12 + Math.random() * 0.25
      };
    }
    for (var i = 0; i < 26; i++) {
      var b = spawn();
      b.y = Math.random() * canvas.height;
      bubbles.push(b);
    }

    function tick() {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(107,122,50,0.55)"; /* olive-core */
      bubbles.forEach(function (b, idx) {
        b.y -= b.v;
        b.x += b.drift;
        if (b.y < -12) bubbles[idx] = spawn();
        ctx.globalAlpha = b.a;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);
    }
    tick();

    /* pause when hero is off-screen */
    new IntersectionObserver(function (entries) {
      var visible = entries[0].isIntersecting;
      if (visible && !running) { running = true; tick(); }
      else if (!visible) { running = false; }
    }).observe(canvas);
  }

  /* ── scenery filmstrip: slides horizontally, one frame every 5s, endless loop ── */
  var sceneryFrame = document.getElementById("sceneryFrame");
  if (sceneryFrame) {
    var track = document.getElementById("sceneryTrack");
    var slides = Array.prototype.slice.call(track.children);
    var n = slides.length;
    track.appendChild(slides[0].cloneNode(true));   /* seam for the seamless wrap */
    var dotsWrap = document.getElementById("sceneryDots");
    var current = 0;
    var timer = null;
    var HOLD = 5000;

    slides.forEach(function (s, i) {
      var d = document.createElement("button");
      d.setAttribute("role", "tab");
      d.setAttribute("aria-label", "Slide " + (i + 1));
      if (i === 0) d.classList.add("is-active");
      d.addEventListener("click", function () { snapIfWrapped(); go(i); restart(); });
      dotsWrap.appendChild(d);
    });
    var dots = dotsWrap.querySelectorAll("button");

    function setX(instant) {
      if (instant) track.style.transition = "none";
      track.style.transform = "translateX(" + (-current * 100) + "%)";
      if (instant) { void track.offsetWidth; track.style.transition = ""; }
    }
    function go(i) {
      current = i;
      setX(false);
      var active = current % n;
      dots.forEach(function (d, k) { d.classList.toggle("is-active", k === active); });
      /* nudge the next image to start fetching before it slides in */
      var next = track.children[(current + 1) % track.children.length].querySelector("img");
      if (next && next.loading === "lazy") next.loading = "eager";
    }
    /* after the seam clone slides in, silently reset to the real first slide */
    function snapIfWrapped() {
      if (current >= n) { current = 0; setX(true); }
    }
    track.addEventListener("transitionend", function (e) {
      if (e.target === track && e.propertyName === "transform") snapIfWrapped();
    });
    function restart() {
      if (timer) clearInterval(timer);
      timer = setInterval(function () { snapIfWrapped(); go(current + 1); }, HOLD);
    }

    go(0);
    restart();

    /* once the page is loaded, fetch the remaining slides in the background */
    window.addEventListener("load", function () {
      track.querySelectorAll("img").forEach(function (img) {
        if (img.loading === "lazy") img.loading = "eager";
      });
    });

    sceneryFrame.addEventListener("mouseenter", function () { if (timer) clearInterval(timer); });
    sceneryFrame.addEventListener("mouseleave", restart);
    /* don't advance while off-screen */
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

  /* ── coordinate helper (only with ?coords in the URL) ──────────────────────
     A live slider that moves the cup up/down in real time (sets window.__cupDrop,
     which bottle-3d reads each frame) plus a mouse-Y readout, so the exact cup
     position can be dialled in and read off as a plain pixel number. Invisible to
     normal visitors — it only builds when the URL has ?coords. */
  if (/[?&]coords/.test(location.search)) {
    var cbox = document.createElement("div");
    cbox.style.cssText = "position:fixed;top:14px;left:14px;z-index:99999;background:rgba(20,30,20,.92);color:#fff;font:13px/1.6 ui-monospace,Menlo,monospace;padding:12px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.3);";
    cbox.innerHTML =
      'cup drop: <b id="cdVal"></b> px &nbsp;(+ = lower / below the text-box midline)' +
      '<br><input id="cdSlider" type="range" min="-200" max="450" style="width:240px;margin:6px 0">' +
      '<br>glide: <b id="cgVal">280</b> ms &nbsp;(higher = duller / less jittery)' +
      '<br><input id="cgSlider" type="range" min="20" max="700" value="280" style="width:240px;margin:6px 0">' +
      '<br>freeze at frame: <b id="fhVal">1000</b> ms &nbsp;(lock the framed shot)' +
      '<br><input id="fhSlider" type="range" min="0" max="4000" step="100" value="1000" style="width:240px;margin:6px 0">' +
      '<br><span id="cdMouse" style="opacity:.75">move mouse — read Y</span>';
    document.body.appendChild(cbox);
    var line = document.createElement("div");
    line.style.cssText = "position:fixed;left:0;right:0;height:1px;background:rgba(255,80,80,.8);z-index:99998;pointer-events:none;top:0;";
    document.body.appendChild(line);
    /* start the drop slider at THIS device's real default (a viewport fraction,
       so it matches what the page is actually showing on this screen) */
    var dropDefault = window.matchMedia("(max-width: 760px)").matches
      ? Math.round(window.innerHeight * 0.086)
      : Math.min(170, Math.round(window.innerHeight * 0.2125));
    window.__cupDrop = dropDefault;
    window.__cupGlide = 280;
    window.__frameHold = 1000;
    var sl = cbox.querySelector("#cdSlider"), val = cbox.querySelector("#cdVal"), mo = cbox.querySelector("#cdMouse");
    sl.value = dropDefault; val.textContent = dropDefault;
    var gl = cbox.querySelector("#cgSlider"), gval = cbox.querySelector("#cgVal");
    var fh = cbox.querySelector("#fhSlider"), fhv = cbox.querySelector("#fhVal");
    sl.addEventListener("input", function () { window.__cupDrop = +sl.value; val.textContent = sl.value; });
    gl.addEventListener("input", function () { window.__cupGlide = +gl.value; gval.textContent = gl.value; });
    fh.addEventListener("input", function () { window.__frameHold = +fh.value; fhv.textContent = fh.value; });
    document.addEventListener("mousemove", function (e) {
      line.style.top = e.clientY + "px";
      mo.textContent = "mouse Y = " + e.clientY + " px  (" + (e.clientY / window.innerHeight).toFixed(3) + " vh)";
    });
  }

  /* ── frame freeze: NOT an auto-scroll. The reader scrolls manually; the first
     time they reach the "Two ancient islands / One clear water" frame (title at
     screen centre) going DOWN, the scroll LOCKS on that composition for ~2s, then
     releases. Bounded (a timer always ends it), scrolling UP is never affected,
     re-arms only after leaving the frame. ON for phones too (user: "the
     disabling-scroll thing on mobile doesn't work — work on that"): touchmove
     is preventDefault'd during the hold and the clamp catches any iOS momentum
     that ignores it. Off only for reduced-motion and via ?nofreeze.
     Tunable: window.__frameHold (ms; 0 = off). ──────────────────── */
  if (!reduceMotion || /[?&]guide/.test(location.search)) (function () { // always exports window.__mastryFreeze (the conductor consumes it); ?guide keeps it alive under forced reduced-motion. ?nofreeze now only disables the MANUAL catch-listeners (below), not this whole block.
    var box = document.querySelector(".herowords .hero__copy");
    var hbSec = document.querySelector(".highball");
    if (!box) return;
    var bottle = document.querySelector(".heropin bottle-3d"); // the WALL publishes engagement as _holdY — never freeze while it holds
    var HOLD_MS = 1000, holdTimer = 0, holding = false, lastY = window.scrollY, activeFrame = null;   // manual-freeze fallback hold: 1s to match the conductor
    // only a real reader can trip the freeze — a browser's async scroll-restore
    // crossing a frame on reload must never lock the page (or fight the
    // start-at-top guard in bottle-3d.js)
    var userGestured = false;
    ["wheel", "touchstart", "keydown", "pointerdown", "mousedown"].forEach(function (t) {
      window.addEventListener(t, function () { userGestured = true; }, { passive: true, once: true });
    });
    function vh() { return window.innerHeight; }
    // frame 1 — "Two ancient islands / One clear water":
    // DESKTOP: the copy box framed at screen centre — exact parallax fixed
    // point (the box carries data-speed, so the naive measure drifts with
    // where you measure from).
    // PHONES: the moment the title box has just fully entered at the BOTTOM
    // of the screen (user: "as soon as the text box spawns into the screen,
    // freeze it") — box flush with the viewport bottom, centred cup above.
    function cupFrameY() {
      if (calmScroll) {
        var br = box.getBoundingClientRect();
        return Math.round(br.top + window.scrollY + br.height - vh());
      }
      var r = box.getBoundingClientRect(), y = window.scrollY;
      var raw = r.top + y + r.height / 2 - 0.5 * vh();
      var sp = parseFloat(box.dataset.speed) || 0;
      return Math.round((raw + sp * y) / (1 + sp));
    }
    // frame 2 — "Splits beautifully with a little whisky": the CLOSING shot,
    // after the act has fully wound down (highball scrub w = 1.0, the same
    // formula bottle-3d drives the act with). The decanter and cork have
    // faded out entirely (gone past w 0.99), the tumbler stands alone at
    // screen centre with the finished drink, and the stage's bottom edge
    // sits exactly on the viewport bottom — the still-life composition.
    function whiskyFrameY() {
      if (!hbSec) return -1e9;
      var top = hbSec.getBoundingClientRect().top + window.scrollY;
      return Math.round(top - 0.8 * vh() + 1.0 * (hbSec.offsetHeight - 0.2 * vh()));
    }
    var frames = [{ fy: cupFrameY, armed: true }, { fy: whiskyFrameY, armed: true }];
    function freeze(e) { e.preventDefault(); }
    function keyFreeze(e) { var k = e.key; if (k === "ArrowDown" || k === "ArrowUp" || k === "PageDown" || k === "PageUp" || k === "Home" || k === "End" || k === " " || k === "Spacebar") e.preventDefault(); }
    function endHold() {
      clearTimeout(holdTimer); holding = false; activeFrame = null;
      document.documentElement.style.overflow = ""; // phones: unfreeze the scroller
      window.removeEventListener("wheel", freeze, { passive: false });
      window.removeEventListener("touchmove", freeze, { passive: false });
      window.removeEventListener("keydown", keyFreeze, true);
    }
    function startHold(f) {
      var ms = (typeof window.__frameHold === "number") ? window.__frameHold : HOLD_MS;
      if (ms <= 0) { f.armed = false; return; }
      holding = true; f.armed = false; activeFrame = f;
      window.addEventListener("wheel", freeze, { passive: false });
      window.addEventListener("touchmove", freeze, { passive: false });
      window.addEventListener("keydown", keyFreeze, true);
      if (calmScroll) {
        // phones: in-flight momentum ignores preventDefault, and clamping it
        // back every scroll event read as a jittery tug-of-war (the reported
        // glitch). Kill it dead instead: snap straight onto the composition,
        // then freeze the scroller itself — overflow:hidden halts momentum
        // instantly and blocks new gestures for the whole hold.
        var de = document.documentElement, pb = de.style.scrollBehavior;
        de.style.scrollBehavior = "auto";
        window.scrollTo(0, f.fy());
        de.style.scrollBehavior = pb;
        de.style.overflow = "hidden";
      } else {
        // desktop: present the EXACT frame — with input already locked, glide
        // the last few px so the composition lands precisely as designed
        window.scrollTo({ top: f.fy(), behavior: "smooth" });
      }
      clearTimeout(holdTimer); holdTimer = setTimeout(endHold, ms);
    }
    // DESKTOP fallback ONLY: the catch-the-frame listeners. The CONDUCTOR below
    // now supersedes them on desktop too (it drives the scroll itself and pauses
    // on these exact frames); they only run when the conductor is OFF (?noguide
    // or reduced-motion). Either way the frame formulas exported underneath are
    // shared with the conductor.
    if (!calmScroll && !conduct && !/[?&]nofreeze/.test(location.search)) {
      window.addEventListener("scroll", function () {
        var y = window.scrollY, prevY = lastY, down = y > prevY; lastY = y;
        if (holding) {
          // belt & braces: some browsers (Safari trackpad momentum) ignore the
          // wheel preventDefault, so ENFORCE the still frame — any drift is
          // snapped straight back (instant, overriding the CSS smooth scroll)
          var fy2 = activeFrame ? activeFrame.fy() : y;
          if (Math.abs(y - fy2) > 1 && Math.abs(y - fy2) > Math.abs(prevY - fy2) + 0.5) { // clamp only motion AWAY from the frame; the settle glide converges and lands softly
            var de = document.documentElement, prevB = de.style.scrollBehavior;
            de.style.scrollBehavior = "auto";
            window.scrollTo(0, fy2);
            de.style.scrollBehavior = prevB;
            lastY = fy2;
          }
          return;
        }
        // the WALL only blocks a freeze when the reader is actually AT it — on
        // iOS its _holdY can stay armed (12s failsafe) long after momentum blew
        // through, and that stale hold was silently vetoing the title freeze
        // for the whole ride ("skips past the whole animation")
        var wallNear = bottle && bottle._holdY != null && Math.abs(y - bottle._holdY) < 1.5 * vh();
        var clear = !wallNear && Date.now() - (window.__anchorGlide || 0) > 1500;
        var catchVh = 0.90;
        for (var i = 0; i < frames.length; i++) {
          var f = frames[i], fy = f.fy();
          if (y < fy - 0.20 * vh()) f.armed = true;                              // re-arm just above each frame — every fresh down-pass locks again
          // ZONE ENTRY, not strict crossing: momentum wheels deliver scroll in
          // bursts, so two consecutive events can BOTH land past the frame.
          // `armed` already guarantees one lock per down-pass; `down` keeps
          // upward scrolling free.
          if (userGestured && f.armed && down && clear && y >= fy && y <= fy + catchVh * vh()) { startHold(f); break; }
        }
      }, { passive: true });
      window.addEventListener("blur", function () { if (holding) endHold(); });
      document.addEventListener("visibilitychange", function () { if (document.hidden && holding) endHold(); });
    }
    window.__mastryFreeze = { get holding() { return holding; }, frames: frames, cupFrameY: cupFrameY, whiskyFrameY: whiskyFrameY, endHold: endHold };
  })();

  /* ── THE CONDUCTOR (phones): the story drives itself. A downward swipe is
     an ACTIVATION, not a scroll: it plays the next chapter with a
     negative-exponential glide (fast out of the gate, decaying, settling
     gently onto its checkpoint). Checkpoints: the bottle's pour (waits for
     the drain), the title still and the whisky still (2s holds). UP is
     always free — the lock is ONE-WAY (user: "going down is a one-way to
     watch the automation take place"); an up-gesture aborts any glide/hold
     into native scrolling, and the next down-swipe re-engages toward the
     next checkpoint below. One-shot: after the final still everything is
     released until reload. Force with ?guide, kill with ?noguide. Runs on
     desktop AND phones now (see `conduct` up top). ─────── */
  if (conduct) (function () {
    var pin = document.querySelector(".heropin");
    var bottle = document.querySelector(".heropin bottle-3d");
    var F = window.__mastryFreeze;
    if (!pin || !F) return;
    // deep-linked load (merch → index.html#find): the browser's async hash jump
    // fires AFTER arm(), and the gate (which now clamps ALL desktop leaks)
    // would read it as a downward leak and yank the reader back to the top.
    // A hash reader chose a destination — no conducting this load at all.
    if (location.hash) return;
    // negative-exponential time constants per segment (ms): ~95% of the
    // travel lands within 3τ — tune the feel here
    var TAU_POUR = 900, TAU_TITLE = 600, TAU_WHISKY = 1500;   // one smooth (no-stop) whisky glide — slow enough not to blow by
    var HOLD_MS = 1000, DRAIN_MAX_MS = 6000;   // each still holds ~1s (user-set "scroll disable time")
    var state = "wait";          // wait | tween | hold | done
    var released = false;
    var timer = 0, lastT = 0, tweenTo = 0, tweenTau = 900, tweenKind = "";
    var lockY = window.scrollY;  // the one-way gate: never below this without an activation
    var idleT = 0, idleCueT = 0, idleOff = false;   // idle assist: gently leads an IDLE/new reader on; killed for the whole session by the first up-gesture
    var IDLE_MS = 5000, CUE_MS = 2500;              // 2.5s of silence -> show the "keep scrolling" cue · 5s -> gently advance one beat
    var marqueeEl = document.querySelector(".marquee");
    var docEl = document.documentElement;
    function vh() { return window.innerHeight; }
    function holdMs() { return (typeof window.__frameHold === "number" && window.__frameHold >= 0) ? window.__frameHold : HOLD_MS; }
    // idle assist — armed ONLY while state=="wait", never after an up-gesture,
    // never before the loader clears; ANY input resets it; it fires the EXACT
    // activate() a wheel notch calls, so it can never snap past a beat.
    function armIdle() {
      clearTimeout(idleT); clearTimeout(idleCueT); docEl.removeAttribute("data-conduct-idle");
      if (state !== "wait" || idleOff || released) return;
      var ld = document.getElementById("loader");
      var pad = (ld && !ld.classList.contains("done")) ? 3600 : 0;   // don't count idle time spent behind the loader
      idleCueT = setTimeout(function () { if (state === "wait" && !idleOff && !released) docEl.setAttribute("data-conduct-idle", ""); }, pad + CUE_MS);
      idleT = setTimeout(function () { if (state === "wait" && !idleOff && !released && !document.hidden) { docEl.removeAttribute("data-conduct-idle"); activate(); } }, pad + IDLE_MS);
    }
    function setState(s) { state = s; docEl.setAttribute("data-conduct", s); armIdle(); }
    function snapTo(y) {
      var de = document.documentElement, pb = de.style.scrollBehavior;
      de.style.scrollBehavior = "auto";
      window.scrollTo(0, y);
      de.style.scrollBehavior = pb;
    }
    function exitY() {   // scroll position that lands the .marquee ("since antiquity") flush at the viewport top
      if (!marqueeEl) return F.whiskyFrameY() + vh();
      return Math.round(marqueeEl.getBoundingClientRect().top + window.scrollY);
    }
    function checkpoints() { // recomputed fresh — layout may have shifted
      return [
        { y: Math.round(pin.offsetTop + 0.88 * Math.max(1, pin.offsetHeight - vh())), tau: TAU_POUR, kind: "pour" },
        { y: F.cupFrameY(), tau: TAU_TITLE, kind: "still" },
        { y: F.whiskyFrameY(), tau: TAU_WHISKY, kind: "final" },   // no mid-pour stop — the whisky act plays as ONE smooth glide (user)
        { y: exitY(), tau: 900, kind: "exit" }                     // after the closing still, auto-lead down to the content ("since antiquity")
      ];
    }
    function release() {
      if (released) return;
      released = true; setState("done");
      clearTimeout(timer);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScrollGate);
      window.__conducted = true;
    }
    function activate() {
      if (state !== "wait") return;
      var y = window.scrollY, list = checkpoints(), next = null;
      for (var i = 0; i < list.length; i++) { if (list[i].y > y + 4) { next = list[i]; break; } }
      if (!next) { release(); return; } // already past the last checkpoint
      setState("tween"); tweenTo = next.y; tweenTau = next.tau; tweenKind = next.kind;
      lastT = performance.now();
      clearTimeout(timer); timer = setTimeout(step, 16);
    }
    function step() {
      var now = performance.now(), dt = Math.min(120, now - lastT); lastT = now;
      var y = window.scrollY;
      var gap = tweenTo - y;
      var stepPx = gap * (1 - Math.exp(-dt / tweenTau));
      // floor speed (60px/s): a pure exponential never quite lands, and
      // scrollY read-back quantization can stall the sub-pixel tail — the
      // floor carries the last few px in gently but SURELY
      var minStep = Math.min(Math.abs(gap), 60 * dt / 1000 + 0.5);
      if (Math.abs(stepPx) < minStep) stepPx = (gap > 0 ? 1 : -1) * minStep;
      var ny = y + stepPx;
      window.__anchorGlide = Date.now(); // THE WALL stands down while the conductor drives
      if (Math.abs(tweenTo - ny) < 1.5) { snapTo(tweenTo); lockY = tweenTo; arrive(); return; }
      snapTo(ny); lockY = ny;
      timer = setTimeout(step, 16);
    }
    function arrive() {
      setState("hold");
      if (tweenKind === "pour") {
        // the scrub holds the bottle tilted here; the drain is time-based —
        // wait for the pour to finish (hard ceiling so nobody is trapped)
        var t0 = Date.now();
        (function drained() {
          if (state !== "hold") return; // an up-gesture already freed the reader
          if ((bottle && bottle._level <= 0.25) || !bottle || Date.now() - t0 > DRAIN_MAX_MS) { setState("wait"); return; }
          timer = setTimeout(drained, 150);
        })();
      } else if (tweenKind === "final") {
        // hold the "Splits beautifully" still ~1s, then auto-LEAD the reader
        // down to the content ("since antiquity") — the designed hand-off
        timer = setTimeout(function () { if (state === "hold") { setState("wait"); activate(); } }, holdMs());
      } else if (tweenKind === "exit") {
        release(); // landed on the content at the top — hand the page over, no hold
      } else {
        timer = setTimeout(function () { setState("wait"); }, holdMs());
      }
    }
    function abortToFree() { // an up-gesture: hand control straight back
      idleOff = true;        // ...and never auto-assist again this session (an up-scroller wants to browse)
      clearTimeout(timer);
      if (tweenKind === "exit") { release(); return; } // up during the exit lead: the story's over, hand back HERE
      setState("wait");
    }
    // ── input: DOWN is an activation, UP is native and free ──
    var tY0 = 0, tX0 = 0, tFired = false, tCommit = "";
    function onTouchStart(e) {
      armIdle();                            // any touch resets the idle-assist countdown
      var t = e.touches[0]; if (!t) return;
      tY0 = t.clientY; tX0 = t.clientX; tFired = false; tCommit = "";
    }
    function onTouchMove(e) {
      var t = e.touches[0]; if (!t) return;
      var dy = tY0 - t.clientY;             // >0 = finger moved up = scroll-DOWN intent
      var dx = Math.abs(tX0 - t.clientX);
      if (!tCommit) {
        // direction still ambiguous: keep the page pinned — iOS grants the
        // gesture native control at the first UNprevented move, and we must
        // not give that away before knowing the direction
        if (Math.abs(dy) < 9 && dx < 9) { e.preventDefault(); return; }
        tCommit = (dy > 0 && dy >= dx * 0.7) ? "down" : (dy < 0 ? "up" : "spin");
        if (tCommit === "up") { if (window.scrollY > 4) { idleOff = true; clearTimeout(idleT); clearTimeout(idleCueT); docEl.removeAttribute("data-conduct-idle"); } if (state !== "wait" && state !== "done") abortToFree(); }
      }
      if (tCommit === "down") {
        e.preventDefault();                  // the one-way gate: no native downward motion, ever
        if (!tFired && dy > 24 && dy > 1.5 * dx) { tFired = true; activate(); }
      } else if (tCommit === "spin") {
        e.preventDefault();                  // horizontal drag (bottle spin) — never scrolls the page
      }
      // "up": unprevented — native free scrolling toward the top
    }
    function onTouchEnd() { tCommit = ""; tFired = false; }
    var wheelT = 0;
    function onWheel(e) {
      armIdle();                            // any wheel resets the idle-assist countdown
      if (e.deltaY > 0) {
        e.preventDefault();
        var now = Date.now();
        if (now - wheelT > 400) { wheelT = now; activate(); }
      } else if (e.deltaY < 0) {
        // an up-scroll AFTER engaging (not at the very top, where a fresh idle
        // reader waits) means "I'll browse myself" — never auto-assist again
        if (window.scrollY > 4) { idleOff = true; clearTimeout(idleT); clearTimeout(idleCueT); docEl.removeAttribute("data-conduct-idle"); }
        if (state !== "wait" && state !== "done") abortToFree();
      }
    }
    function onKey(e) {
      armIdle();                            // any keypress resets the idle-assist countdown
      // never hijack a key meant for a FOCUSED control — form fields, buttons,
      // links, tabs, menu items keep their native Space/Enter/arrow behaviour
      // (onKey runs in capture phase, so it would otherwise pre-empt them)
      var tgt = e.target;
      if (tgt && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(tgt.tagName) || tgt.isContentEditable ||
          (tgt.closest && tgt.closest('a[href],button,[role="button"],[role="tab"],[tabindex],summary,label')))) return;
      var k = e.key;
      // ArrowDown / PageDown / Space advance one chapter. Home stays NATIVE
      // (upward is always free). End = the keyboard ESCAPE: the gate now clamps
      // native downward motion (Windows driver-scroll fix), so an End jump
      // RELEASES the conductor first — a keyboard reader is never trapped.
      if (k === "ArrowDown" || k === "PageDown" || k === " " || k === "Spacebar") { e.preventDefault(); activate(); }
      else if (k === "End") { release(); }
      else if (k === "ArrowUp" || k === "PageUp") {
        if (window.scrollY > 4) { idleOff = true; clearTimeout(idleT); clearTimeout(idleCueT); docEl.removeAttribute("data-conduct-idle"); }
        if (state !== "wait" && state !== "done") abortToFree();
      }
    }
    // the one-way gate's backstop now catches EVERY pointer. It was touch-only
    // (desktop native scroll passed freely for scrollbar/middle-click/Ctrl+F),
    // but on Windows many mouse wheels scroll WITHOUT wheel events — vendor
    // drivers (Logitech/Razer "smooth scroll", free-spin wheels) and scrollbar
    // messages move scrollY directly, so onWheel never fired and the wheel
    // BLASTED past every checkpoint (user: "windows has a bypass through the
    // animation because of the mouse scroll — make the windows user go through
    // the animation with checkpoints"). Desktop leaks now snap back and CONVERT
    // into a proper activation, so any downward intent still advances — through
    // the checkpoints, never past them. UP stays native and free, always.
    // Escape hatches: End key = skip the story (release), nav/anchor clicks
    // release (below), ?noguide kills the conductor entirely.
    var coarsePointer = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    function onScrollGate() {
      if (state === "tween") return;                     // the conductor is driving (its own writes land here)
      var y = window.scrollY;
      if (state === "hold") {
        // desktop: enforce the hold against driver-scroll/scrollbar leaks.
        // (touch path unchanged — momentum dies inside the tween on phones)
        if (!coarsePointer && y > lockY + 2) snapTo(lockY);
        return;
      }
      if (y < lockY) { lockY = y; return; }              // riding up freely: the gate follows
      if (y <= lockY + 2) return;                        // settled on the gate
      snapTo(lockY);                                     // downward leak: back to the checkpoint...
      if (!coarsePointer && state === "wait") activate(); // ...and on desktop it still ADVANCES — as a glide (touch keeps its gesture-driven activation)
    }
    function arm() {
      released = false; idleOff = false; clearTimeout(timer); lockY = window.scrollY;
      // identical listener refs → addEventListener dedupes, so arm() is safe to
      // call again (used by the bfcache pageshow re-arm below)
      window.addEventListener("touchstart", onTouchStart, { passive: true });
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onTouchEnd, { passive: true });
      window.addEventListener("wheel", onWheel, { passive: false });
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("scroll", onScrollGate, { passive: true });
      setState("wait");   // stamps html[data-conduct] + arms the idle assist
    }
    arm();
    // bfcache Back/Forward restores this closure as 'released' with its listeners
    // gone, while the engine (bottle-3d) re-primes a fresh hero on pageshow — so
    // re-arm the conductor too, or the guided story silently vanishes on a return.
    window.addEventListener("pageshow", function (e) {
      if (e.persisted && released) { window.__conducted = false; arm(); }
    });
    // reader taps a nav/anchor link: they chose to skip the story — stand down
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (a && !released) release();
    }, true);
    // the loader can now hold up to 8s (stage-1 gate) — restart the idle-assist
    // clock the moment the veil actually lifts, so its countdown never runs
    // out while the reader is still staring at the loading screen
    document.addEventListener("mastry:loaderdone", armIdle);
    // tab hidden mid-glide: land the tween instantly, keep the machine sane
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state === "tween") { clearTimeout(timer); snapTo(tweenTo); lockY = tweenTo; arrive(); }
    });
    window.__conductor = { get state() { return state; }, get lockY() { return lockY; }, checkpoints: checkpoints, activate: activate, release: release };
  })();
})();
