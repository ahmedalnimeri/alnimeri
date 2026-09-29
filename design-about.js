/* design-about.js — /about only. No dependencies.
   1. The pointer: a still or a print you hover leans toward the pointer and
      catches a light where it is; a comment card lights under it. One rAF per
      pointer move, only on the element under the pointer, fine pointers only.
   2. On Set prints open once, as each arrives.
   3. The comment strips stop drifting while they are off screen. */
(function () {
  'use strict';
  if (!window.matchMedia) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* ---- 1. pointer ----------------------------------------------------- */
  // [selector for the element that listens, selector for the one that moves,
  //  max tilt in degrees (0 = light only)]
  var KINDS = [
    ['.pin', '.pin__media', 7],
    ['.set__print', '.set__win', 4],
    ['#said .said-wall .said', null, 0]
  ];
  var active = null, box = null, target = null, tilt = 0, lastE = null, queued = false;

  function paint() {
    queued = false;
    if (!active || !lastE) return;
    var x = (lastE.clientX - box.left) / box.width;
    var y = (lastE.clientY - box.top) / box.height;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    y = y < 0 ? 0 : y > 1 ? 1 : y;
    var s = target.style;
    s.setProperty('--mx', (x * 100).toFixed(1) + '%');
    s.setProperty('--my', (y * 100).toFixed(1) + '%');
    if (tilt) {
      s.setProperty('--rx', ((0.5 - y) * tilt).toFixed(2) + 'deg');
      s.setProperty('--ry', ((x - 0.5) * tilt).toFixed(2) + 'deg');
    }
  }

  function enter(el, kind, e) {
    leave();
    active = el;
    target = kind[1] ? el.querySelector(kind[1]) : el;
    if (!target) { active = null; return; }
    tilt = kind[2];
    box = target.getBoundingClientRect();
    target.style.setProperty('--lit', '1');
    lastE = e;
    paint();
  }

  function leave() {
    if (!active) return;
    var s = target.style;
    s.setProperty('--lit', '0');
    s.removeProperty('--rx');
    s.removeProperty('--ry');
    active = target = box = lastE = null;
  }

  function find(node) {
    for (var i = 0; i < KINDS.length; i++) {
      var el = node && node.closest ? node.closest(KINDS[i][0]) : null;
      if (el) return [el, KINDS[i]];
    }
    return null;
  }

  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var hit = find(e.target);
    if (!hit) { leave(); return; }
    if (hit[0] !== active) enter(hit[0], hit[1], e);
    lastE = e;
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  }

  var on = false;
  function arm() {
    var want = fine.matches && !reduce.matches;
    if (want === on) return;
    on = want;
    if (on) {
      document.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerleave', leave, { passive: true });
      // The board scrolls under a still pointer: let go rather than tilt a
      // print by a stale measurement; the next move picks it up again.
      window.addEventListener('scroll', leave, { passive: true });
    } else {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', leave);
      window.removeEventListener('scroll', leave);
      leave();
    }
  }
  function listen(mq, fn) {
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  }
  listen(fine, arm);
  listen(reduce, arm);
  arm();

  /* ---- 2. On Set: each print opens as it arrives ---------------------- */
  // Prints are only hidden once this runs (.ab-armed), so without JS, IO or
  // motion they simply stand on the page.
  var prints = document.querySelectorAll('.set__print');
  if (prints.length && 'IntersectionObserver' in window && !reduce.matches) {
    document.documentElement.classList.add('ab-armed');
    var pio = new IntersectionObserver(function (es) {
      var n = 0;
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (!e.isIntersecting) continue;
        // Prints arriving together open in turn, a beat apart.
        e.target.style.setProperty('--ab-d', (n++ * 140) + 'ms');
        e.target.classList.add('is-open');
        pio.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    for (var p = 0; p < prints.length; p++) pio.observe(prints[p]);
  }

  /* ---- 3. strips rest off screen ------------------------------------- */
  var says = document.querySelector('#said .says');
  if (says && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      says.classList.toggle('ab-still', !es[es.length - 1].isIntersecting);
    }, { rootMargin: '10% 0px' }).observe(says);
  }
})();
