/* design-ending.js — the end credits at the foot of the home page.

   The roll is built from the films already on the page (#work), so it can
   never drift from the grid, and each frame reuses the exact file its tile
   has already fetched. Built only as the ending comes near. While the ending
   is on screen one passive scroll listener writes --p on the section (0 as the
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
      // file (currentSrc: the WebP its <picture> chose), so the roll costs no
      // new bytes; otherwise pick from the same sets, WebP first, as the tile does
      var holder = pic;
      if (src.currentSrc) img.src = src.currentSrc;
      else {
        var sizes = '(max-width: 999px) 46vw, 21vw';
        var webp = t.querySelector('.tile__pic source[type="image/webp"]');
        if (webp && webp.getAttribute('srcset')) {
          holder = document.createElement('picture');
          var so = document.createElement('source');
          so.type = 'image/webp'; so.srcset = webp.getAttribute('srcset'); so.sizes = sizes;
          holder.appendChild(so);
          pic.appendChild(holder);
        }
        img.sizes = sizes;
        if (src.getAttribute('srcset')) img.srcset = src.getAttribute('srcset');
        img.src = src.getAttribute('src');
      }
      holder.appendChild(img);
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

  /* ---- the last frame fits the screen ------------------------------------
     The card is not a fixed height: at the edge the page adds a line with the
     visitor's clock beside Dubai's, and some screens are short. When the card
     and the resting rows are taller than the screen under the bar, the top
     of the section, and a row of frames with it, would sit under the bar. So
     the last frame gives way: on narrow screens it rests on one row fewer
     (none on the smallest, where the card holds the screen alone); on wide
     ones the air above and below the card closes up. Measured as the ending
     comes on screen and on resize, never while scrolling. */
  var stage = sec.querySelector('.ending__stage');
  var card = sec.querySelector('.ending__card');
  var mark = card && card.querySelector('.lockup');
  var narrow = window.matchMedia && matchMedia('(max-width: 999px)');
  var AIR = 40;   // the least air left between the bar and the card on a wide screen, in px
  var fit = function () {
    sec.classList.remove('ending--nomark');
    settle();
    // On a wide screen the air around the card may close up only so far: a
    // card whose mark would come to rest against the bar (a short laptop
    // screen, 1366x625, with the visitor's clock in the card) rests without
    // the mark instead, since the bar above already carries it, and the ask
    // leads. Read from layout (offsetTop), so a reveal still in flight does
    // not move the measurement.
    if (mark && !(narrow && narrow.matches)) {
      var room = parseFloat(getComputedStyle(sec).minHeight) || 0;
      var atEnd = card.getBoundingClientRect().top - sec.getBoundingClientRect().top + mark.offsetTop
                  - Math.max(0, sec.offsetHeight - room);
      if (room && atEnd < AIR) { sec.classList.add('ending--nomark'); settle(); }
    }
  };
  var settle = function () {
    sec.style.removeProperty('--stage-pad');
    roll.style.removeProperty('--rows');
    sec.classList.remove('ending--bare');
    var room = parseFloat(getComputedStyle(sec).minHeight) || 0;
    if (!room || !stage || !card) return;
    // how far the section runs past the screen under the bar, and how far it
    // may: as far as the black above the resting rows (or above the card)
    var over = function () { return sec.offsetHeight - room; };
    var clear = function () {
      var top = sec.getBoundingClientRect().top;
      var c = card.getBoundingClientRect().top - top;
      if (sec.classList.contains('ending--bare')) return c;
      var head = parseFloat(getComputedStyle(roll, '::before').height) || 0;
      return Math.min(c, roll.getBoundingClientRect().top - top + head);
    };
    if (over() <= clear() + 1) return;
    if (narrow && narrow.matches) {
      var rows = parseInt(getComputedStyle(roll).getPropertyValue('--rows'), 10) || 1;
      while (rows > 0 && over() > clear() + 1) {
        rows--;
        if (rows) roll.style.setProperty('--rows', rows);
        else sec.classList.add('ending--bare');
      }
    } else {
      var pad = parseFloat(getComputedStyle(stage).paddingTop) || 0;
      sec.style.setProperty('--stage-pad', Math.max(0, pad - over() / 2).toFixed(1) + 'px');
    }
  };
  // after a resize has settled (under reduced motion every size change is a
  // 0.01ms transition, so the first frame after it still has the old sizes)
  var fitting = 0;
  var onResize = function () {
    clearTimeout(fitting);
    fitting = setTimeout(function () { fit(); if (live) paint(); }, 120);
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (near) fit(); });

  var ticking = false, live = false, near = false;
  var paint = function () {
    ticking = false;
    var r = sec.getBoundingClientRect();
    var p = (innerHeight - r.top) / r.height;
    sec.style.setProperty('--p', Math.max(0, Math.min(1, p)).toFixed(4));
  };
  var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(paint); } };

  new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting) {
        if (!built) build();
        if (!near) {
          near = true;
          fit();
          addEventListener('resize', onResize);
        }
        if (!reduce && !live) {
          live = true;
          sec.classList.add('is-rolling');
          addEventListener('scroll', onScroll, { passive: true });
          paint();
        }
      } else {
        if (near) {
          near = false;
          removeEventListener('resize', onResize);
        }
        if (live) {
          live = false;
          sec.classList.remove('is-rolling');
          removeEventListener('scroll', onScroll);
        }
      }
    });
  }, { rootMargin: '40% 0px' }).observe(sec);
})();
