/* design-compositions.js — a rack focus for each composition on the home page.

   Every still answers the pointer on its own. Point at one and focus racks
   to it: it sharpens and comes forward, the others fall soft and recede (the
   filters are CSS; this file only moves the focus), and its chip comes into
   focus in its corner. Nothing else follows the pointer: in a rack focus the
   camera holds still and only the focus moves.

   Depth comes from the scroll. The lead sits on the focal plane with the
   words and holds its place on the grid; the planes behind it lag as the
   page moves, the farthest the most, as far things do.

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
      return { el: a, d: parseFloat(a.dataset.depth) || 1, s: 1, t: '' };
    });
    return { el: el, stills: stills, lead: stills[0], focus: null, over: null, seen: reduce };
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
  var mouse = function (e) { return e.pointerType !== 'touch'; };
  C.forEach(function (c) {
    setFocus(c, c.lead);
    c.stills.forEach(function (s) {
      s.el.addEventListener('focus', function () { setFocus(c, s); });
      s.el.addEventListener('blur', function () { if (!c.over) setFocus(c, c.lead); });
      // the pointer is the focus puller: the still under it takes the focus,
      // and keeps it until the pointer leaves the composition
      s.el.addEventListener('pointerover', function (e) { if (!mouse(e)) return; c.over = s; setFocus(c, s); kick(); });
      s.el.addEventListener('pointerout', function (e) { if (!mouse(e)) return; if (c.over === s) c.over = null; kick(); });
    });
    c.el.addEventListener('pointerleave', function (e) {
      if (!mouse(e)) return;
      c.over = null;
      if (!keyed(c)) setFocus(c, c.lead);
      kick();
    });
  });

  if (reduce || !('IntersectionObserver' in window)) return;
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

  var raf = 0;
  kick = function () { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick, { passive: true });

  function frame() {
    raf = 0;
    var vh = innerHeight, busy = false;
    // read everything first, then write
    var reads = near.map(function (c) {
      return { c: c, r: c.el.getBoundingClientRect(),
               sr: !fine ? c.stills.map(function (s) { return s.el.getBoundingClientRect(); }) : null };
    });
    reads.forEach(function (o) {
      var c = o.c, r = o.r;

      // phones: the still crossing the middle of the screen takes the focus
      if (o.sr && c.seen) {
        var line = vh * 0.5, best = null, bd = 1e9;
        c.stills.forEach(function (s, i) {
          var q = o.sr[i], dd = Math.abs((q.top + q.bottom) / 2 - line);
          if (s === c.focus) dd -= 24;                     // a little hysteresis
          if (q.bottom > 0 && q.top < vh && dd < bd) { bd = dd; best = s; }
        });
        if (best) setFocus(c, best);
      }

      var p = ((r.top + r.height / 2) - vh / 2) / vh;       // -1..1 as it crosses the screen
      var engaged = !!c.over || c.focus !== c.lead;
      c.stills.forEach(function (s) {
        var ts = !c.seen ? 0.95 : engaged ? (s === c.focus ? 1.035 : 0.985) : 1;
        s.s += (ts - s.s) * 0.12;
        if (Math.abs(ts - s.s) > 0.0005) busy = true;
        else s.s = ts;
        // the lead (depth 1) holds the grid; the planes behind it lag
        var y = p * -56 * (1 - s.d);
        var t = 'translate3d(0,' + y.toFixed(2) + 'px,0) scale(' + s.s.toFixed(4) + ')';
        if (t !== s.t) { s.el.style.transform = t; s.t = t; }
      });
    });
    if (busy) kick();
  }
  kick();
})();
