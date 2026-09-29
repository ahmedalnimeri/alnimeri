/* motion.js — motion that carries an idea, never motion for its own sake.

   The films follow one another beside the opening line. Words resolve from
   blur. A light
   follows the eye across the work. Films open like a letterbox and keep a
   little depth in the frame. At the foot of the page, beside "I answer my own
   email", the match cut is the face of the person who does.

   Under reduced motion nothing animates: the two-shot still answers hover and
   focus, but cuts instead of dissolving, and never cuts on its own. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---- the films beside the line --------------------------------------- */
  // One after another, with the caption naming the one on screen. Hovering
  // the picture holds it.
  var two = document.querySelector('.twoshot');
  if (two) {
    var shots = [].slice.call(two.querySelectorAll('.twoshot__shot'));
    var cap = two.querySelector('.twoshot__label');
    var cur = 0, held = false;
    var show = function (i) {
      cur = i;
      var s = shots[i];
      shots.forEach(function (x, k) { x.classList.toggle('is-on', k === i); });
      if (cap) { cap.querySelector('b').textContent = s.dataset.title; cap.querySelector('span').textContent = s.dataset.kind; cap.href = s.getAttribute('href'); }
    };
    var frame = two.querySelector('.twoshot__frame');
    [frame, cap].forEach(function (el) {
      if (!el) return;
      el.addEventListener('pointerenter', function () { held = true; });
      el.addEventListener('pointerleave', function () { held = false; });
    });
    if (!reduce && shots.length > 1) {
      setTimeout(function () {
        setInterval(function () { if (!held && !document.hidden) show((cur + 1) % shots.length); }, 3400);
      }, 1750);
    }
  }

  if (reduce) {
    // no autoplay: show the match cut as a still frame instead of a blank box
    var still = document.querySelector('.contact__cut');
    if (still && still.dataset.poster) still.poster = still.dataset.poster;
    return;
  }
  document.documentElement.classList.add('has-motion');

  /* ---- words resolve one by one --------------------------------------- */
  var name = document.querySelector('.hero__name');
  if (name) {
    var i = 0;
    var wrap = function (node) {
      [].slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) {
          var frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
            var s = document.createElement('span');
            s.className = 'w'; s.textContent = p; s.style.setProperty('--i', i++);
            frag.appendChild(s);
          });
          ch.parentNode.replaceChild(frag, ch);
        } else if (ch.nodeType === 1) { wrap(ch); }
      });
    };
    wrap(name);
    name.classList.add('has-words');
  }

  /* ---- a light that follows the eye ----------------------------------- */
  if (fine) {
    var track = function (container, sel) {
      if (!container) return;
      container.addEventListener('pointermove', function (e) {
        container.querySelectorAll(sel).forEach(function (el) {
          var r = el.getBoundingClientRect();
          el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
          el.style.setProperty('--my', (e.clientY - r.top) + 'px');
        });
      });
    };
    track(document.querySelector('.commission__grid'), '.commission__card, .commission__still');
    track(document.querySelector('#work .grid'), '.tile__link');
  }

  /* ---- depth inside the frame (the letterbox reveal itself is CSS) ----- */
  var depthEls = [].slice.call(document.querySelectorAll('#work .tile__img, .commission__still img'));
  if (depthEls.length && 'IntersectionObserver' in window) {
    var live = new Set();
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.isIntersecting ? live.add(e.target) : live.delete(e.target); });
    }, { rootMargin: '10% 0px' });
    depthEls.forEach(function (el) { io.observe(el); });
    var ticking = false;
    var paint = function () {
      ticking = false;
      var vh = innerHeight;
      live.forEach(function (el) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--py', ((((r.top + r.height / 2) - vh / 2) / vh) * -22).toFixed(1) + 'px');
      });
    };
    addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
    paint();
  }

  /* ---- the face beside "I answer my own email" ------------------------ */
  var cut = document.querySelector('.contact__cut');
  if (cut && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) {
          if (!cut.poster && cut.dataset.poster) cut.poster = cut.dataset.poster;
          if (cut.preload !== 'auto') cut.preload = 'auto';
          var pr = cut.play(); if (pr && pr.catch) pr.catch(function () {});
        } else if (!cut.paused) { cut.pause(); }
      });
    }, { threshold: 0.25 }).observe(cut);
  }
})();
