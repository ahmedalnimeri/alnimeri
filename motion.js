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

  /* ---- the films beside the line: a slideshow you can feel ------------- */
  // Ahmed: "I should feel there's a slideshow here." A row of segments, one per
  // film: the current one fills while its film is up, the ones behind stay
  // filled. The fill itself drives the timing (animationend advances), so
  // pausing on hover and advancing can never drift apart. Segments jump;
  // phones can swipe.
  var two = document.querySelector('.twoshot');
  if (two) {
    var shots = [].slice.call(two.querySelectorAll('.twoshot__shot'));
    var cap = two.querySelector('.twoshot__label');
    var frame = two.querySelector('.twoshot__frame');
    var cur = 0;
    // Only the first film is in the markup with a real src; the others carry
    // data-srcset/data-src, because stacked in the frame they sit inside the
    // viewport and loading=lazy would fetch all six at first paint. Each film
    // is put on the wire before it can be needed: the next one whenever a film
    // comes up (4.2 s ahead), one under the pointer or focus before its click,
    // and the rest once the page has loaded and gone idle.
    var hydrate = function (k) {
      var sh = shots[(k + shots.length) % shots.length];
      if (!sh) return;
      [].forEach.call(sh.querySelectorAll('source[data-srcset], img[data-srcset], img[data-src]'), function (el) {
        if (el.dataset.srcset) { el.srcset = el.dataset.srcset; el.removeAttribute('data-srcset'); }
        if (el.dataset.src) { el.src = el.dataset.src; el.removeAttribute('data-src'); }
      });
    };
    var bar = document.createElement('div');
    bar.className = 'twoshot__bar'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Films');
    var segs = shots.map(function (sh, k) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'twoshot__seg'; b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', 'Show ' + sh.dataset.title);
      b.innerHTML = '<i></i>';
      ['pointerenter', 'pointerdown', 'focus'].forEach(function (t) { b.addEventListener(t, function () { hydrate(k); }); });
      b.addEventListener('click', function () { show(k); });
      bar.appendChild(b);
      return b;
    });
    frame.insertAdjacentElement('afterend', bar);
    var show = function (i) {
      cur = (i + shots.length) % shots.length;
      hydrate(cur); hydrate(cur + 1);
      var again = segs[cur].classList.contains('is-on');
      shots.forEach(function (x, k) { x.classList.toggle('is-on', k === cur); });
      segs.forEach(function (sg, k) {
        sg.classList.toggle('is-done', k < cur);
        sg.classList.remove('is-on');
        sg.setAttribute('aria-selected', k === cur ? 'true' : 'false');
      });
      if (again) void segs[cur].offsetWidth;      // restart the fill (only a re-shown segment needs it)
      segs[cur].classList.add('is-on');
      var s = shots[cur];
      if (cap) { cap.querySelector('b').textContent = s.dataset.title; cap.querySelector('span').textContent = s.dataset.kind; cap.href = s.getAttribute('href'); }
    };
    segs.forEach(function (sg) {
      sg.querySelector('i').addEventListener('animationend', function () { if (sg.classList.contains('is-on')) show(cur + 1); });
    });
    // holding the pointer on the picture holds the film
    [frame, cap, bar].forEach(function (el) {
      if (!el) return;
      el.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') two.classList.add('is-held'); });
      el.addEventListener('pointerleave', function () { two.classList.remove('is-held'); });
    });
    // swipe on touch screens
    var x0 = null;
    frame.addEventListener('pointerdown', function (e) { hydrate(cur + 1); hydrate(cur - 1); if (e.pointerType !== 'mouse') x0 = e.clientX; });
    frame.addEventListener('pointerup', function (e) {
      if (x0 === null) return;
      var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) show(cur + (dx < 0 ? 1 : -1));
    });
    document.addEventListener('visibilitychange', function () { two.classList.toggle('is-away', document.hidden); });
    if (reduce) two.classList.add('is-still');
    show(0);
    var rest = function () { shots.forEach(function (sh, k) { hydrate(k); }); };
    var idle = function () { if ('requestIdleCallback' in window) requestIdleCallback(rest, { timeout: 3000 }); else setTimeout(rest, 2000); };
    if (document.readyState === 'complete') idle(); else addEventListener('load', idle, { once: true });
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
    var ticking = false;
    var later = function () { if (!ticking) { ticking = true; requestAnimationFrame(paint); } };
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.isIntersecting ? live.add(e.target) : live.delete(e.target); });
      // A jump (a hard cut, the timeline, keyboard focus) brings pictures in
      // after the scroll's own paint ran: repaint, or they keep a stale offset.
      later();
    }, { rootMargin: '10% 0px' });
    depthEls.forEach(function (el) { io.observe(el); });
    var paint = function () {
      ticking = false;
      var vh = innerHeight, at = [];
      // Read everything, then write, so one frame costs one style pass.
      live.forEach(function (el) {
        var r = el.getBoundingClientRect();
        // scale(1.08) overscans the frame by 4% of its height on each side;
        // shifting further than that showed a black band inside the frame.
        var o = el.offsetHeight * 0.04;
        var v = (((r.top + r.height / 2) - vh / 2) / vh) * -22;
        at.push([el, Math.max(-o, Math.min(o, v))]);
      });
      at.forEach(function (p) { p[0].style.setProperty('--py', p[1].toFixed(1) + 'px'); });
    };
    addEventListener('scroll', later, { passive: true });
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
