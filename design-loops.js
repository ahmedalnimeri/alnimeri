/* design-loops.js — the films beside the opening line move.

   Each of the hero's films carries a few seconds of itself: one shot, about
   three seconds, silent, cut so that its end runs back into its start
   (assets/loops/; bin-build-home-art.py writes them onto each .twoshot__shot
   as data-loop-webm / data-loop-mp4). While a film is the one shown, its loop
   plays over its still: the same frame, caption and bar, and the same slow
   push (design-loops.css). motion.js still does the cutting and the timing;
   this only listens to it.

   The still comes first. Nothing is fetched until the page has loaded and
   gone idle and the picture is on screen; then the film on show, and about
   two seconds into it the one after it, never more than one ahead. A loop
   dissolves in only once a frame of it has really been presented, so a loop
   that is blocked, slow or broken leaves the still exactly as it was; one
   that is already waiting comes in with its film, in the same dissolve, and
   the film going out keeps moving until it has gone. Off screen, in a
   hidden tab, or under the lightbox, the bin or the brief, nothing plays
   and nothing more is fetched. A browser that refuses to play them
   (autoplay blocked, Low Power Mode) gets no loops at all, as do reduced
   motion, Save-Data and a slow connection (2g/3g): only the stills.

   WebM (VP9) where the browser plays it, else MP4 (H.264); Apple's browsers
   take the MP4 first, which their hardware decodes. */
(function () {
  'use strict';
  var two = document.querySelector('.twoshot');
  var frame = two && two.querySelector('.twoshot__frame');
  if (!frame || !window.MutationObserver) return;
  var shots = [].slice.call(two.querySelectorAll('.twoshot__shot'));
  var calm = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var net = navigator.connection || {};
  var slow = function () { return !!net.saveData || /2g|3g/.test(net.effectiveType || ''); };
  if ((calm && calm.matches) || two.classList.contains('is-still') || slow()) return;
  var probe = document.createElement('video');
  var TYPES = [['webm', 'video/webm; codecs="vp9"'], ['mp4', 'video/mp4; codecs="avc1.640028"']]
    .filter(function (t) { return probe.canPlayType && probe.canPlayType(t[1]); });
  if (/Apple/.test(navigator.vendor || '')) TYPES.reverse();
  if (!TYPES.length) return;

  var AHEAD = 2000;   // ms into a film before the next one's loop is fetched
  var OUT = 1300;     // the films' own dissolve (refinement.css, 1.2 s), and a little more

  /* ---- one loop -------------------------------------------------------- */
  // made now, empty (no source, nothing on the wire), so that its slow push
  // runs in step with the still it sits on from the start
  var make = function (sh) {
    var srcs = TYPES.map(function (t) { return [sh.getAttribute('data-loop-' + t[0]), t[1]]; })
      .filter(function (s) { return s[0]; });
    if (!srcs.length) return null;
    var v = document.createElement('video');
    v.className = 'loop';
    v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
    ['muted', 'loop', 'playsinline', 'disablepictureinpicture', 'disableremoteplayback'].forEach(function (a) { v.setAttribute(a, ''); });
    v.setAttribute('preload', 'none'); v.setAttribute('aria-hidden', 'true'); v.setAttribute('tabindex', '-1');
    sh.appendChild(v);
    return { v: v, srcs: srcs, has: false, want: false, shown: false, t: 0 };
  };
  var load = function (L) {
    if (!L || L.has) return;
    L.has = true;
    L.srcs.forEach(function (s) {
      var el = document.createElement('source');
      el.src = s[0]; el.type = s[1];
      L.v.appendChild(el);
    });
    L.v.preload = 'auto';
    L.v.load();
  };
  var play = function (L) {
    var p = L.v.play();
    if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') halt(); });
  };
  // seen, a loop moves exactly as the still under it: the same transform,
  // and the rest of the still's own push (refinement.css), wherever it is
  var follow = function (L) {
    var img = L.v.parentNode.querySelector('img');
    if (!img || !L.v.animate) return;
    if (L.anim) L.anim.cancel();
    var now = getComputedStyle(img).transform, to = now, left = 0;
    var a = img.getAnimations ? img.getAnimations().filter(function (x) { return x.transitionProperty === 'transform' && x.playState === 'running'; })[0] : null;
    if (a) {
      var k = a.effect.getKeyframes();
      to = k[k.length - 1].transform;
      left = Math.max(0, a.effect.getComputedTiming().endTime - a.currentTime);
    }
    L.anim = L.v.animate([{ transform: now }, { transform: to }], { duration: left, easing: 'linear', fill: 'forwards' });
  };
  // unseen, it rests small (design-loops.css)
  var rest = function (L) { if (L.anim) { L.anim.cancel(); L.anim = null; } };
  var reveal = function (L) {
    if (!L.want || L.shown) return;
    L.shown = true;
    follow(L);
    L.v.classList.add('is-on');
  };
  // the still gives way only to a frame that is really on screen
  var onFrame = function (L) {
    var v = L.v;
    if (v.requestVideoFrameCallback) { v.requestVideoFrameCallback(function () { reveal(L); }); return; }
    var h = function () { if (v.currentTime > 0) { v.removeEventListener('timeupdate', h); reveal(L); } };
    v.addEventListener('timeupdate', h);
  };
  // the film coming up; cut: it is coming up this moment, in motion.js's
  // dissolve (else its still is already fully on screen)
  var come = function (L, cut) {
    clearTimeout(L.t);
    L.want = true;
    L.v.classList.remove('is-instant');
    if (cut && L.has && L.v.readyState >= 2) {
      // already waiting at a frame: it comes in with its still, in the same
      // dissolve, from its first frame
      try { L.v.currentTime = 0; } catch (e) {}
      L.shown = true;
      follow(L);
      L.v.classList.add('is-instant', 'is-on');
      void L.v.offsetWidth;
      L.v.classList.remove('is-instant');
      play(L);
      return;
    }
    // the still is showing: the loop dissolves in over it, from its first
    // presented frame (one that rests at a frame shows that frame at once)
    load(L);
    play(L);
    if (!L.shown) onFrame(L);
  };
  // the film going out keeps moving through the dissolve, then rests,
  // invisible, at whatever frame it reached
  var leave = function (L, wait) {
    L.want = false;
    clearTimeout(L.t);
    if (L.shown) follow(L);
    L.t = setTimeout(function () {
      if (L.want) return;
      L.v.pause();
      L.shown = false;
      L.v.classList.add('is-instant');
      L.v.classList.remove('is-on');
      rest(L);
    }, wait);
  };

  var Ls = shots.map(make);
  if (!Ls.some(Boolean)) return;
  var ready = false, inView = false, on = -1, ahead = 0, off = false;

  var sync = function () {
    if (off) return;
    var k = -1;
    shots.forEach(function (sh, i) { if (sh.classList.contains('is-on')) k = i; });
    var live = ready && inView && !document.hidden && !document.body.classList.contains('is-locked') && !document.querySelector('dialog[open]');
    var cut = k !== on && live;
    if (k !== on) {
      if (on >= 0 && Ls[on]) leave(Ls[on], live ? OUT : 0);
      on = k;
    }
    clearTimeout(ahead);
    if (!live) {
      // off screen or out of sight: the picture holds where it is
      Ls.forEach(function (L) { if (L && L.has) L.v.pause(); });
      return;
    }
    var L = k >= 0 ? Ls[k] : null;
    if (L) {
      if (!L.want) come(L, cut);
      else if (L.v.paused) play(L);
    }
    // one film ahead, never more, once this one has had a moment
    var next = Ls[(k + 1) % Ls.length];
    if (next && !next.has) ahead = setTimeout(function () { if (on === k && !off) load(next); }, AHEAD);
  };

  // every way out: back to the stills, and nothing more is fetched
  var halt = function () {
    off = true;
    clearTimeout(ahead);
    Ls.forEach(function (L) { if (!L) return; L.want = false; clearTimeout(L.t); L.v.pause(); L.v.classList.remove('is-on'); rest(L); });
  };

  shots.forEach(function (sh) { new MutationObserver(sync).observe(sh, { attributes: true, attributeFilter: ['class'] }); });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync);
  addEventListener('pageshow', function (e) { if (e.persisted) sync(); });
  if (calm) {
    var calmed = function () { if (calm.matches) halt(); };
    if (calm.addEventListener) calm.addEventListener('change', calmed); else if (calm.addListener) calm.addListener(calmed);
  }
  if (net.addEventListener) net.addEventListener('change', function () { if (slow()) halt(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { inView = es[es.length - 1].isIntersecting; sync(); }).observe(frame);
  } else inView = true;
  var go = function () { ready = true; sync(); };
  var idle = function () { if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 1200); };
  if (document.readyState === 'complete') idle(); else addEventListener('load', idle, { once: true });
})();
