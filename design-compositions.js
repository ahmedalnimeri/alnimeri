/* design-compositions.js — a rack focus for each composition on the home page.

   Every still answers the pointer on its own. Point at one and focus racks
   to it: it sharpens and comes forward, the others fall soft and recede (the
   filters are CSS; this file only moves the focus and the planes), and its
   chip follows the pointer across it. The three planes also shift with the
   pointer and drift with the scroll at their own depth, so the composition
   reads as depth, not as a flat collage.

   Phones have no pointer to point with, so the scroll pulls focus: the still
   crossing the middle of the screen is the sharp one, and every film gets its
   turn and its chip. Keyboard focus racks to the focused still too.

   One requestAnimationFrame loop, running only while something is moving and
   only for compositions near the screen. Reduced motion: no loop, no drift;
   pointing or tabbing still chooses the film, instantly. */
(function () {
  'use strict';
  var root = document.querySelector('.cmps');
  if (!root) return;
  var mq = function (q) { return !!(window.matchMedia && matchMedia(q).matches); };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var fine = mq('(hover: hover) and (pointer: fine)');

  var C = [].slice.call(root.querySelectorAll('.cmp')).map(function (el) {
    var stills = [].slice.call(el.querySelectorAll('.cmp__still')).map(function (a) {
      return { el: a, chip: a.querySelector('.cmp__chip'), d: parseFloat(a.dataset.depth) || 1,
               s: 1, x: 0, y: 0, kx: 0, ky: 0, w: 0, h: 0, cw: 0, ch: 0 };
    });
    return { el: el, stills: stills, lead: stills[0], focus: null, over: null, inside: false,
             seen: reduce, px: 0, py: 0, nx: 0, ny: 0, cx: 0, cy: 0 };
  });

  var kick = function () {};
  // a still that holds keyboard focus keeps the focus when the pointer leaves
  var keyed = function (c) {
    var a = document.activeElement;
    return !!(a && a.classList.contains('cmp__still') && c.el.contains(a) && (!a.matches || a.matches(':focus-visible')));
  };
  var setFocus = function (c, s) {
    if (c.focus === s) return;
    c.focus = s;
    c.stills.forEach(function (t) { t.el.classList.toggle('is-focus', t === s); });
    c.el.classList.toggle('is-racked', s !== c.lead);
    kick();
  };
  C.forEach(function (c) {
    setFocus(c, c.lead);
    c.stills.forEach(function (s) {
      s.el.addEventListener('focus', function () { setFocus(c, s); });
      s.el.addEventListener('blur', function () { if (!c.inside) setFocus(c, c.lead); });
    });
  });

  if (reduce) {
    C.forEach(function (c) {
      c.stills.forEach(function (s) {
        s.el.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') setFocus(c, s); });
      });
      c.el.addEventListener('pointerleave', function () { if (!keyed(c)) setFocus(c, c.lead); });
    });
    return;
  }
  if (!('IntersectionObserver' in window)) return;
  root.classList.add('is-live');

  /* ---- arrival: each composition resolves once, when it is first seen --- */
  var arrive = function (c) {
    if (c.seen) return;
    c.seen = true; c.el.classList.add('is-in');
    setTimeout(function () { c.el.classList.add('is-settled'); }, 1900);
    kick();
  };
  var seenIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      seenIO.unobserve(e.target);
      C.forEach(function (c) { if (c.el === e.target) arrive(c); });
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
  // nothing on screen may stay hidden waiting on a callback that never comes
  var failOpen = function () {
    C.forEach(function (c) { var r = c.el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) arrive(c); });
  };
  setTimeout(failOpen, 2200);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(failOpen, 400); });

  /* ---- only compositions near the screen are worked on ------------------ */
  var near = [];
  var nearIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      C.forEach(function (c) {
        if (c.el !== e.target) return;
        var i = near.indexOf(c);
        if (e.isIntersecting && i < 0) near.push(c);
        if (!e.isIntersecting && i >= 0) near.splice(i, 1);
        c.el.classList.toggle('is-near', e.isIntersecting);
      });
    });
    kick();
  }, { rootMargin: '25% 0px' });
  C.forEach(function (c) { seenIO.observe(c.el); nearIO.observe(c.el); });

  // layout sizes (untransformed) for the chip's travel; re-read on resize
  var measure = function () {
    C.forEach(function (c) {
      c.stills.forEach(function (s) {
        s.w = s.el.offsetWidth; s.h = s.el.offsetHeight;
        if (!s.chip) return;
        s.cw = s.chip.offsetWidth; s.ch = s.chip.offsetHeight;
        s.ax = s.chip.offsetLeft; s.ay = s.chip.offsetTop;      // its resting corner
      });
    });
  };
  measure();
  addEventListener('resize', function () { measure(); kick(); }, { passive: true });
  addEventListener('load', measure);

  /* ---- the pointer: focus, depth and the chip --------------------------- */
  if (fine) {
    C.forEach(function (c) {
      var track = function (e) {
        if (e.pointerType === 'touch') return;
        c.inside = true; c.px = e.clientX; c.py = e.clientY;
        var t = e.target.closest ? e.target.closest('.cmp__still') : null;
        c.over = null;
        c.stills.forEach(function (s) { if (s.el === t) c.over = s; });
        if (c.over) setFocus(c, c.over);
        kick();
      };
      c.el.addEventListener('pointermove', track);
      c.el.addEventListener('pointerover', track);
      c.el.addEventListener('pointerleave', function () {
        c.inside = false; c.over = null;
        if (!keyed(c)) setFocus(c, c.lead);
        kick();
      });
    });
  }

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var raf = 0;
  kick = function () { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener('scroll', kick, { passive: true });

  function frame() {
    raf = 0;
    var vh = innerHeight, busy = false;
    // read everything first, then write
    var reads = near.map(function (c) {
      return { c: c, r: c.el.getBoundingClientRect(),
               sr: (c.inside || !fine) ? c.stills.map(function (s) { return s.el.getBoundingClientRect(); }) : null };
    });
    reads.forEach(function (o) {
      var c = o.c, r = o.r;
      // pointer position across the composition, -1..1, eased
      if (c.inside) {
        c.nx = clamp((c.px - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
        c.ny = clamp((c.py - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
      }
      var tx = c.inside ? c.nx : 0, ty = c.inside ? c.ny : 0;
      c.cx += (tx - c.cx) * 0.09; c.cy += (ty - c.cy) * 0.09;
      if (Math.abs(tx - c.cx) + Math.abs(ty - c.cy) > 0.002) busy = true;

      // phones: the still crossing the middle of the screen takes the focus
      if (!fine && c.seen && o.sr) {
        var line = vh * 0.5, best = null, bd = 1e9;
        c.stills.forEach(function (s, i) {
          var q = o.sr[i], mid = (q.top + q.bottom) / 2, dd = Math.abs(mid - line);
          if (s === c.focus) dd -= 24;                     // a little hysteresis
          if (q.bottom > 0 && q.top < vh && dd < bd) { bd = dd; best = s; }
        });
        if (best) setFocus(c, best);
      }

      var p = ((r.top + r.height / 2) - vh / 2) / vh;       // -1..1 as it crosses the screen
      var engaged = c.inside || c.focus !== c.lead;
      c.stills.forEach(function (s, i) {
        var ts = !c.seen ? 0.95 : engaged ? (s === c.focus ? 1.035 : 0.985) : 1;
        s.s += (ts - s.s) * 0.12;
        var x = c.cx * s.d * 18;
        var y = c.cy * s.d * 12 + p * -38 * s.d;
        if (Math.abs(ts - s.s) > 0.0005) busy = true;
        var t = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0) scale(' + s.s.toFixed(4) + ')';
        if (t !== s.t) { s.el.style.transform = t; s.t = t; }

        // the chip follows the pointer across its own still, and settles
        // back into its corner when the pointer leaves
        if (!s.chip) return;
        var tkx = 0, tky = 0;
        if (fine && c.over === s && o.sr) {
          var q = o.sr[i], k = s.s || 1;
          var lx = (c.px - q.left) / k, ly = (c.py - q.top) / k;
          tkx = clamp(lx + 16, 10, Math.max(10, s.w - s.cw - 10)) - s.ax;
          tky = clamp(ly + 20, 10, Math.max(10, s.h - s.ch - 10)) - s.ay;
        }
        s.kx += (tkx - s.kx) * 0.16; s.ky += (tky - s.ky) * 0.16;
        if (Math.abs(tkx - s.kx) + Math.abs(tky - s.ky) > 0.3) busy = true;
        var kt = 'translate3d(' + s.kx.toFixed(1) + 'px,' + s.ky.toFixed(1) + 'px,0)';
        if (kt !== s.kt) { s.chip.style.transform = kt; s.kt = kt; }
      });
    });
    if (busy) kick();
  }
  kick();
})();
