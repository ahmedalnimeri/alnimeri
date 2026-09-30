/* design-hover.js — films answer the pointer. The idea is written up at the
   top of design-hover.css; this file only measures and moves.

   Cost: no work at rest. Pointer events only mark a target; one rAF loop
   eases the frames that are moving and stops the moment they settle (and
   the browser pauses it in a hidden tab). Everything it writes is a custom
   property that feeds a transform, so nothing lays out or repaints. */
(function () {
  'use strict';
  if (!document.querySelector || !window.requestAnimationFrame) return;
  var mq = function (q) { return !!(window.matchMedia && matchMedia(q).matches); };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var touchFirst = mq('(hover: none)');

  var PUSH = 1.06;        // how far the camera leans in
  var PLAY = '<i><svg viewBox="0 0 8 10" aria-hidden="true"><path d="M0 0l8 5-8 5z"/></svg></i>';

  var text = function (el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
  var runtime = function (s) { var m = /\b\d{1,2}:\d{2}\b/.exec(s || ''); return m ? m[0] : ''; };

  // What a tile's link does, as its own label says it ("Play …", or "Watch
  // … on X" for the one that opens the post), and how long the film runs.
  var verb = function (a) {
    var l = (a && a.getAttribute('aria-label')) || '', on = / on (\w+), \d/.exec(l);
    return (/^Watch\b/.test(l) ? 'Watch' : 'Play') + (on ? ' on ' + on[1] : '');
  };
  // the running time of a film by its page, read from its tile on this page
  var runOf = function (href) {
    var a = href && document.querySelector('.tile__name a[href="' + href + '"]');
    var t = a && a.closest('.tile');
    return t ? runtime(text(t.querySelector('.tile__dur'))) : '';
  };

  // Where film stills live, and what each one's cue says. The cue carries
  // only what the tile does not already print beside the picture.
  var SETS = [
    { room: '#work .grid, #selects .grid', card: 'article.tile', frame: '.tile__link', pic: '.tile__img',
      cue: function (c) { var a = c.querySelector('.tile__link'); return [verb(a), runtime(text(c.querySelector('.tile__dur')))]; } },
    { room: '.commission__grid', card: '.commission__card', frame: '.commission__still', pic: 'img',
      cue: function (c) { return ['Watch', runOf(this.go(c))]; },
      go: function (c) { var a = c.querySelector('.commission__example'); return a ? a.getAttribute('href') : ''; } }
  ];

  var rooms = [];
  SETS.forEach(function (set) {
    [].forEach.call(document.querySelectorAll(set.room), function (roomEl) {
      var room = { el: roomEl, set: set, hot: null, t: 0, cards: [] };
      [].forEach.call(roomEl.querySelectorAll(set.card), function (card) {
        var frame = set.frame ? card.querySelector(set.frame) : card;
        var pic = frame && frame.querySelector(set.pic);
        if (!pic) return;
        var st = { room: room, card: card, frame: frame, pic: pic, built: false, hot: false,
                   s: 1, px: 0, py: 0, tpx: 0, tpy: 0, lx: 0, ly: 0, tlx: 0, tly: 0, w: 0, h: 0, rect: null, stamp: -1 };
        card.classList.add('hv-card'); frame.classList.add('hv-frame'); pic.classList.add('hv-pic');
        card._hv = st;
        room.cards.push(st);
        if (set.go) {
          var href = set.go(card);
          if (href) {
            frame.setAttribute('data-hv-go', '');
            frame.addEventListener('click', function (e) {
              if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(href, '_blank', 'noopener');
              else location.href = href;
            });
          }
        }
      });
      if (!room.cards.length) return;
      roomEl.classList.add('hv-room');
      rooms.push(room);
    });
  });
  if (!rooms.length) return;
  document.documentElement.classList.add('hv-on');

  /* The frame's light and the cue are made the first time a film comes up,
     so a page nobody points at carries no extra nodes. */
  var build = function (st) {
    if (st.built) return;
    st.built = true;
    var rim = document.createElement('span'); rim.className = 'hv-rim'; rim.setAttribute('aria-hidden', 'true');
    st.frame.appendChild(rim);
    var words = st.room.set.cue(st.card);
    if (words && words[0]) {
      var cue = document.createElement('span'); cue.className = 'hv-cue'; cue.setAttribute('aria-hidden', 'true');
      var b = document.createElement('b'); b.textContent = words[0];
      cue.innerHTML = PLAY; cue.appendChild(b);
      if (words[1]) { var s = document.createElement('span'); s.textContent = words[1]; cue.appendChild(s); }
      st.frame.appendChild(cue);
      st.cue = cue;
    }
  };

  // Rects are read once per scroll position, never per frame.
  var scrollStamp = 0;
  addEventListener('scroll', function () { scrollStamp++; }, { passive: true, capture: true });
  addEventListener('resize', function () { scrollStamp++; }, { passive: true });
  var measure = function (st) {
    if (st.stamp !== scrollStamp || !st.rect) {
      st.rect = st.frame.getBoundingClientRect();
      st.w = st.rect.width; st.h = st.rect.height; st.stamp = scrollStamp;
    }
    return st.rect;
  };
  var aim = function (st, x, y) {
    var r = measure(st);
    var fx = Math.min(1, Math.max(0, (x - r.left) / (r.width || 1)));
    var fy = Math.min(1, Math.max(0, (y - r.top) / (r.height || 1)));
    st.tpx = fx - 0.5; st.tpy = fy - 0.5;
    st.tlx = fx * st.w; st.tly = fy * st.h;
  };

  /* ---- the loop: only while something is moving ----------------------- */
  var moving = new Set(), raf = 0, last = 0;
  var ease = function (k, dt) { return 1 - Math.pow(1 - k, dt / 16.667); };
  var paint = function (st) {
    var head = st.s - 1;
    var f = st.frame.style;
    f.setProperty('--hv-s', st.s.toFixed(4));
    f.setProperty('--hv-x', (-st.px * head * st.w).toFixed(2) + 'px');
    f.setProperty('--hv-y', (-st.py * head * st.h).toFixed(2) + 'px');
    f.setProperty('--hv-lx', st.lx.toFixed(1) + 'px');
    f.setProperty('--hv-ly', st.ly.toFixed(1) + 'px');
  };
  var tick = function (now) {
    var dt = Math.min(64, now - (last || now - 16.667)); last = now;
    moving.forEach(function (st) {
      var ts = st.hot ? PUSH : 1;
      // the push is slow going in and a little quicker coming back
      st.s += (ts - st.s) * ease(st.hot ? 0.022 : 0.06, dt);
      // the camera drifts after the eye; the light on the frame keeps up with it
      var tpx = st.hot ? st.tpx : 0, tpy = st.hot ? st.tpy : 0;
      st.px += (tpx - st.px) * ease(0.05, dt); st.py += (tpy - st.py) * ease(0.05, dt);
      st.lx += (st.tlx - st.lx) * ease(0.16, dt); st.ly += (st.tly - st.ly) * ease(0.16, dt);
      paint(st);
      var still = Math.abs(ts - st.s) < 0.0004 && Math.abs(tpx - st.px) < 0.002 && Math.abs(tpy - st.py) < 0.002 &&
                  Math.abs(st.tlx - st.lx) < 0.5 && Math.abs(st.tly - st.ly) < 0.5;
      if (still) {
        st.s = ts; st.px = tpx; st.py = tpy; st.lx = st.tlx; st.ly = st.tly; paint(st);
        moving.delete(st);
        if (!st.hot) st.card.classList.remove('is-live');
      }
    });
    raf = moving.size ? requestAnimationFrame(tick) : 0;
    if (!raf) last = 0;
  };
  var wake = function (st) {
    if (reduce) return;
    st.card.classList.add('is-live');
    moving.add(st);
    if (!raf) raf = requestAnimationFrame(tick);
  };

  /* ---- a film comes up, a film goes down ------------------------------ */
  var up = function (st, x, y) {
    var room = st.room;
    if (room.hot && room.hot !== st) down(room.hot);
    clearTimeout(room.t);
    build(st);
    st.stamp = -1;
    if (x == null) { measure(st); x = st.rect.left + st.w / 2; y = st.rect.top + st.h * 0.45; }
    aim(st, x, y);
    if (!st.hot) { st.lx = st.tlx; st.ly = st.tly; }   // the light starts where you came in, it never sweeps across
    // a smaller cue on small frames, and none on a frame too small to carry
    // one without covering the picture (the offers at tablet width)
    if (st.cue) { st.cue.classList.toggle('hv-cue--s', st.w < 440); st.cue.classList.toggle('hv-cue--off', st.w < 240); }
    st.hot = true; room.hot = st;
    st.card.classList.add('is-hot');
    room.el.classList.add('is-lit');
    if (reduce) paint(st); else wake(st);
  };
  var down = function (st) {
    if (!st.hot) return;
    var room = st.room;
    st.hot = false;
    st.card.classList.remove('is-hot');
    if (room.hot === st) {
      room.hot = null;
      // crossing the gutter to the next film (or a film scrolling out from
      // under a resting pointer) should not bring the lights up in between
      room.t = setTimeout(function () { if (!room.hot) room.el.classList.remove('is-lit'); }, 320);
    }
    wake(st);
  };

  var keyed = function (el) {
    try { return el.matches(':focus-visible'); } catch (e) { return true; }   // no :focus-visible: as before
  };
  rooms.forEach(function (room) {
    room.cards.forEach(function (st) {
      var c = st.card;
      c.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse' || e.pointerType === 'pen') up(st, e.clientX, e.clientY); });
      c.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' || e.pointerType === 'pen') down(st); });
      // a press brings up the film under the finger, lit where it landed
      c.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch') up(st, e.clientX, e.clientY); });
      // keyboard focus only: a film closed with the mouse hands focus back to
      // its tile, and that must not leave the room dimmed
      c.addEventListener('focusin', function (e) { if (!st.hot && keyed(e.target)) up(st); });
      c.addEventListener('focusout', function (e) { if (!c.contains(e.relatedTarget) && !c.matches(':hover')) down(st); });
    });
    room.el.addEventListener('pointermove', function (e) {
      var st = room.hot;
      if (!st || e.pointerType === 'touch') return;
      aim(st, e.clientX, e.clientY);
      wake(st);
    }, { passive: true });
  });

  /* ---- phones: the film crossing the middle of the screen comes up ----- */
  if (touchFirst && 'IntersectionObserver' in window) {
    rooms.forEach(function (room) {
      var inBand = new Set(), n = 0;
      var band = new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          var st = en.target._hv || en.target.closest('.hv-card')._hv;
          if (en.isIntersecting) { st.seen = ++n; inBand.add(st); } else inBand.delete(st);
        });
        var pick = null;
        inBand.forEach(function (st) { if (!pick || st.seen > pick.seen) pick = st; });
        if (pick && pick !== room.hot) up(pick);          // between two films, the last one stays up
      }, { rootMargin: '-36% 0px -36% 0px' });
      room.cards.forEach(function (st) { band.observe(st.frame); });
      // when the whole room leaves the screen its lights come back up
      new IntersectionObserver(function (es) {
        if (!es[es.length - 1].isIntersecting && room.hot) down(room.hot);
      }).observe(room.el);
    });
  }
})();
