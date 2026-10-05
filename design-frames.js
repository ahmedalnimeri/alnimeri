/* design-frames.js — the rack focus of the home compositions, on a film's
   own frames (the Frames under the player, bin-build-work-pages.py).

   Pointer: the frame under it takes the focus and keeps it until the
   pointer leaves the board; nothing follows the pointer (in a rack focus
   the camera holds still and only the focus moves). Phones: the frame
   crossing the middle of the screen is the sharp one. Keyboard focus racks
   too. Depth comes from the scroll: the lead holds its place, the planes
   behind it lag a little, the farthest the most.

   A press is not handled here: each frame is a link to the film at its
   second (data-from), and design-filmpages.js plays the page's film from
   there. One requestAnimationFrame loop, running only while something is
   moving and the board is near the screen. Reduced motion: no loop, no
   drift, no arrival; pointing or tabbing still racks the focus, at once.

   The stills themselves wait in data-* (bin-build-work-pages.py): the
   board hangs inside the browser's own lazy-load distance, which fetched
   all of them at page open. At page open only those on the screen or
   within a quarter of a screen of it are fetched; from the reader's first
   scroll, those within a whole screen of it, so a still is on its way
   well before it is on show (a quarter of a screen is a sixth of a second
   at a brisk scroll, too little for a still on a slow phone link). Their
   boxes keep their shape (--ar) while they wait. Without JS the <noscript>
   copies stand in. */
(function () {
  'use strict';
  var root = document.querySelector('.frm');
  if (!root) return;

  var waiting = [].slice.call(root.querySelectorAll('.frm__frame img[data-src]'));
  var hydrate = function (img) {
    if (!img.hasAttribute('data-src')) return;
    [].slice.call(img.parentNode.querySelectorAll('source[data-srcset]')).forEach(function (s) {
      s.srcset = s.getAttribute('data-srcset'); s.removeAttribute('data-srcset');
    });
    img.srcset = img.getAttribute('data-srcset'); img.removeAttribute('data-srcset');
    img.src = img.getAttribute('data-src'); img.removeAttribute('data-src');
  };
  if ('IntersectionObserver' in window) {
    var watch = function (margin) {
      var o = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { o.unobserve(e.target); hydrate(e.target); } });
      }, { rootMargin: margin });
      waiting.forEach(function (img) { if (img.hasAttribute('data-src')) o.observe(img); });
      return o;
    };
    var hio = watch('25% 0px');
    // the reader is moving: look a screen ahead. A reader who never scrolls
    // fetches nothing more, nor does one who only presses play.
    var ahead = function () {
      removeEventListener('scroll', ahead); removeEventListener('wheel', ahead);
      hio.disconnect();
      watch('100% 0px');
    };
    addEventListener('scroll', ahead, { passive: true });
    addEventListener('wheel', ahead, { passive: true });
  } else {
    waiting.forEach(hydrate);
  }

  var mq = function (q) { return !!(window.matchMedia && matchMedia(q).matches); };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var fine = mq('(hover: hover) and (pointer: fine)');
  var S = [].slice.call(root.querySelectorAll('.frm__still')).map(function (a) {
    return { el: a, d: parseFloat(a.getAttribute('data-depth')) || 1, s: 1, t: '' };
  });
  if (!S.length) return;
  var lead = S.filter(function (s) { return s.el.classList.contains('is-lead'); })[0] || S[0];
  var focus = null, over = null, seen = reduce;
  var kick = function () {};

  var setFocus = function (s) {
    if (focus === s) return;
    focus = s;
    S.forEach(function (t) { t.el.classList.toggle('is-focus', t === s); });
    root.classList.toggle('is-racked', s !== lead);
    kick();
  };
  var mouse = function (e) { return e.pointerType !== 'touch'; };
  // a frame that holds keyboard focus keeps the focus when the pointer leaves
  var keyed = function () {
    var a = document.activeElement;
    return !!(a && root.contains(a) && a.classList.contains('frm__still') && (!a.matches || a.matches(':focus-visible')));
  };
  setFocus(lead);
  S.forEach(function (s) {
    s.el.addEventListener('focus', function () { setFocus(s); });
    s.el.addEventListener('blur', function () { if (!over) setFocus(lead); });
    s.el.addEventListener('pointerover', function (e) { if (!mouse(e)) return; over = s; setFocus(s); });
    s.el.addEventListener('pointerout', function (e) { if (!mouse(e)) return; if (over === s) over = null; kick(); });
  });
  root.addEventListener('pointerleave', function (e) {
    if (!mouse(e)) return;
    over = null;
    if (!keyed()) setFocus(lead);
  });

  if (reduce || !('IntersectionObserver' in window)) return;
  root.classList.add('is-live');
  // the arrival runs back to front: the last frame first, the lead last
  S.forEach(function (s, k) { s.el.style.setProperty('--k', String(S.length - 1 - k)); });

  var arrive = function () {
    if (seen) return;
    seen = true; root.classList.add('is-in');
    setTimeout(function () { root.classList.add('is-settled'); }, 2100);
    kick();
  };
  new IntersectionObserver(function (es) { if (es[0].isIntersecting) arrive(); }, { rootMargin: '0px 0px -14% 0px', threshold: 0.04 }).observe(root);
  // nothing on screen may stay hidden waiting on a callback that never comes
  var failOpen = function () { var r = root.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) arrive(); };
  setTimeout(failOpen, 2200);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(failOpen, 400); });

  var near = false;
  new IntersectionObserver(function (es) { near = es[0].isIntersecting; root.classList.toggle('is-near', near); kick(); }, { rootMargin: '25% 0px' }).observe(root);

  var raf = 0;
  kick = function () { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick, { passive: true });

  function frame() {
    raf = 0;
    if (!near) return;
    var vh = innerHeight, busy = false;
    var rs = S.map(function (s) { return s.el.getBoundingClientRect(); });
    // phones: the frame crossing the middle of the screen takes the focus
    if (!fine && seen) {
      var line = vh * 0.5, best = null, bd = 1e9;
      S.forEach(function (s, i) {
        var q = rs[i], dd = Math.abs((q.top + q.bottom) / 2 - line);
        if (s === focus) dd -= 14;                       // a little hysteresis
        if (q.bottom > 0 && q.top < vh && dd < bd) { bd = dd; best = s; }
      });
      if (best) setFocus(best);
    }
    var engaged = !!over || focus !== lead;
    S.forEach(function (s, i) {
      var ts = !seen ? 0.96 : engaged ? (s === focus ? 1.035 : 0.985) : 1;
      s.s += (ts - s.s) * 0.12;
      if (Math.abs(ts - s.s) > 0.0005) busy = true; else s.s = ts;
      var q = rs[i], p = ((q.top + q.height / 2) - vh / 2) / vh;
      var y = fine ? p * -44 * (1 - s.d) : 0;      // only a pointer screen has room for the drift
      var t = 'translate3d(0,' + y.toFixed(2) + 'px,0) scale(' + s.s.toFixed(4) + ')';
      if (t !== s.t) { s.el.style.transform = t; s.t = t; }
    });
    if (busy) kick();
  }
  kick();
})();
