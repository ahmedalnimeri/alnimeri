/* design-ending.js — the end credits at the foot of the home page.

   The roll is built from the films already on the page (#work), so it can
   never drift from the grid, and each frame reuses the exact file its tile
   has already fetched. Built only as the ending comes near. While the ending
   is on screen one passive scroll listener writes --p on the roll (0 as the
   section enters, 1 at the end of the page) and the columns rise with it;
   off screen the listener is gone. Under reduced motion --p is never written and the
   frames simply hold in their last position. */
(function () {
  'use strict';
  var sec = document.querySelector('.ending');
  var roll = sec && sec.querySelector('.ending__roll');
  if (!roll || !('IntersectionObserver' in window)) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var built = false;
  var build = function () {
    built = true;
    // landscape films only: the vertical ones are phone frames, and one of
    // them shows a child
    var tiles = [].slice.call(document.querySelectorAll('#work .tile'))
      .filter(function (t) { return !t.classList.contains('tile--tall'); });
    var cols = ['a', 'b'].map(function (k) {
      var c = document.createElement('div');
      c.className = 'ending__col ending__col--' + k;
      roll.appendChild(c);
      return c;
    });
    tiles.forEach(function (t, i) {
      var src = t.querySelector('.tile__img'), name = t.querySelector('.tile__name a');
      if (!src || !name) return;
      var kind = t.querySelector('.tile__kind');
      var a = document.createElement('a');
      a.className = 'ending__frame'; a.href = name.getAttribute('href'); a.tabIndex = -1;
      var pic = document.createElement('span'); pic.className = 'ending__pic';
      var img = document.createElement('img');
      img.alt = ''; img.width = 1280; img.height = 720;
      img.loading = 'lazy'; img.decoding = 'async';
      // the grid has usually fetched its still by now: reuse exactly that
      // file, so the roll costs no new bytes; otherwise pick from the set
      if (src.currentSrc) img.src = src.currentSrc;
      else {
        img.sizes = '(max-width: 999px) 46vw, 21vw';
        if (src.getAttribute('srcset')) img.srcset = src.getAttribute('srcset');
        img.src = src.getAttribute('src');
      }
      pic.appendChild(img);
      var cap = document.createElement('span'); cap.className = 'ending__cap';
      var b = document.createElement('b'); b.textContent = name.textContent.trim();
      cap.appendChild(b);
      if (kind) {
        var s = document.createElement('span');
        s.textContent = kind.textContent.split('·')[0].trim();
        cap.appendChild(s);
      }
      a.appendChild(pic); a.appendChild(cap);
      // built from the bottom up: the films that open the grid are the ones
      // the roll comes to rest on
      var col = cols[i % 2];
      col.insertBefore(a, col.firstChild);
    });
  };

  var ticking = false, live = false;
  var paint = function () {
    ticking = false;
    var r = sec.getBoundingClientRect();
    var p = (innerHeight - r.top) / r.height;
    roll.style.setProperty('--p', Math.max(0, Math.min(1, p)).toFixed(4));
  };
  var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(paint); } };

  new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting) {
        if (!built) build();
        if (!reduce && !live) {
          live = true;
          sec.classList.add('is-rolling');
          addEventListener('scroll', onScroll, { passive: true });
          addEventListener('resize', onScroll);
          paint();
        }
      } else if (live) {
        live = false;
        sec.classList.remove('is-rolling');
        removeEventListener('scroll', onScroll);
        removeEventListener('resize', onScroll);
      }
    });
  }, { rootMargin: '40% 0px' }).observe(sec);
})();
