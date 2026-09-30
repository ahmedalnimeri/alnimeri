/* design-about.js — /about only. No dependencies.
   1. The pointer: the film still you look at leans in and reframes toward
      where you look, the way an operator follows the eye. One rAF per
      pointer move, only on the still under the pointer, fine pointers only.
   2. On Set prints are fetched a screen ahead and open once, as each arrives.
   3. The comment strips stop drifting while they are off screen. */
(function () {
  'use strict';
  /* ---- 2a. On Set: prints are fetched a screen before they arrive ------ */
  // bin-build-onset.py writes them with data-src/data-srcset (and a
  // <noscript> copy); nothing else puts them on the wire.
  var waiting = document.querySelectorAll('.set__img[data-src]');
  var hydrate = function (img) {
    var set = img.getAttribute('data-srcset');
    if (set) { img.srcset = set; img.removeAttribute('data-srcset'); }
    var src = img.getAttribute('data-src');
    if (src) { img.src = src; img.removeAttribute('data-src'); }
  };
  if (waiting.length) {
    if ('IntersectionObserver' in window) {
      var hio = new IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) {
          if (es[i].isIntersecting) { hydrate(es[i].target); hio.unobserve(es[i].target); }
        }
      }, { rootMargin: '100% 0px 100% 0px' });
      for (var w = 0; w < waiting.length; w++) hio.observe(waiting[w]);
    } else {
      for (var w2 = 0; w2 < waiting.length; w2++) hydrate(waiting[w2]);
    }
    window.addEventListener('beforeprint', function () {
      for (var i = 0; i < waiting.length; i++) hydrate(waiting[i]);
    });
  }

  if (!window.matchMedia) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* ---- 1. pointer ----------------------------------------------------- */
  // How far the frame may travel, as a share of the still. The still is
  // pushed in to 108%, so 3% each way never shows its edge.
  var REACH = 6;
  var active = null, img = null, lastE = null, queued = false;

  function paint() {
    queued = false;
    if (!active || !lastE) return;
    // Measured per frame, so a board scrolling under a still pointer is
    // read where it is now, not where it was.
    var box = active.getBoundingClientRect();
    var x = (lastE.clientX - box.left) / box.width;
    var y = (lastE.clientY - box.top) / box.height;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    y = y < 0 ? 0 : y > 1 ? 1 : y;
    // Look right and the frame pans right: the picture moves the other way.
    img.style.setProperty('--px', ((0.5 - x) * REACH).toFixed(2) + '%');
    img.style.setProperty('--py', ((0.5 - y) * REACH).toFixed(2) + '%');
  }

  function leave() {
    if (!active) return;
    img.style.removeProperty('--px');
    img.style.removeProperty('--py');
    active = img = lastE = null;
  }

  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var pin = e.target && e.target.closest ? e.target.closest('.pin') : null;
    var media = pin && pin.querySelector('.pin__media');
    var still = media && media.querySelector('img');
    if (!still) { leave(); return; }
    if (media !== active) { leave(); active = media; img = still; }
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
    } else {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', leave);
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
