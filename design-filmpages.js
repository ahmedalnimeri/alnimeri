/* alnimeri.com — the film pages and the work index. No dependencies.

   House lights: the still becomes the film when you press play, and the page
   around it goes dark until you come back to it; on the walls of stills the
   picture you point at is the one the camera moves in on; on the index the
   kinds of film re-hang the wall in place. Everything here is transform,
   opacity and clip-path; nothing runs while nothing is moving. */
(function () {
  'use strict';
  var d = document, root = d.documentElement;
  var still = matchMedia('(prefers-reduced-motion: reduce)');
  var mouse = matchMedia('(hover: hover) and (pointer: fine)');
  var EASE = 'cubic-bezier(.22,.61,.36,1)';

  /* ---- the still becomes the film ------------------------------------ */
  var frame = d.querySelector('.fp-frame');
  var play = frame && frame.querySelector('.fp-play');
  if (frame && play) {
    var vid = play.getAttribute('data-vid');
    var lights = function (down) { root.classList.toggle('fp-lights-down', !!down); };
    var playing = false;

    var start = function () {
      if (playing) return;
      playing = true;
      var f = d.createElement('iframe');
      f.src = 'https://player.vimeo.com/video/' + vid + '?title=0&byline=0&portrait=0&dnt=1&autoplay=1';
      f.title = play.getAttribute('data-title') || 'Film';
      f.allow = 'autoplay; fullscreen; picture-in-picture';
      f.setAttribute('allowfullscreen', '');
      f.addEventListener('load', function () { frame.classList.add('is-loaded'); try { f.focus(); } catch (e) {} });
      frame.appendChild(f);
      frame.classList.add('is-playing');
      // if the player is slow to answer, the still steps aside anyway
      setTimeout(function () { frame.classList.add('is-loaded'); }, 2600);
      lights(true);
    };

    frame.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // a new tab stays a new tab
      if (!vid) { if (e.target.closest('.fp-play') !== play) play.click(); return; }
      e.preventDefault();
      start();
    });

    if (vid) {
      // The lights follow the visitor's attention. Up: the pointer leaves the
      // picture for a moment, a click or a tap anywhere else, Escape, or the
      // film scrolled away. Down again: back onto the picture, or into the
      // player's own controls.
      var upTimer = 0;
      var up = function () { clearTimeout(upTimer); lights(false); };
      d.addEventListener('keydown', function (e) { if (e.key === 'Escape') up(); });
      d.addEventListener('click', function (e) { if (playing && !frame.contains(e.target)) up(); });
      frame.addEventListener('mouseleave', function () {
        if (!playing) return;
        clearTimeout(upTimer); upTimer = setTimeout(function () { lights(false); }, 900);
      });
      frame.addEventListener('mouseenter', function () { if (playing) { clearTimeout(upTimer); lights(true); } });
      window.addEventListener('blur', function () {
        setTimeout(function () { if (playing && d.activeElement === frame.querySelector('iframe')) { clearTimeout(upTimer); lights(true); } }, 0);
      });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) {
          es.forEach(function (en) { if (en.intersectionRatio < 0.45) up(); });
        }, { threshold: [0, 0.45] }).observe(frame);
      }
    }

    // on a mouse, the control follows the pointer across the picture
    if (mouse.matches && !still.matches) {
      var tx = 0, ty = 0, x = 0, y = 0, raf = 0;
      var place = function () {
        x += (tx - x) * 0.14; y += (ty - y) * 0.14;
        play.style.transform = 'translate(-50%, -50%) translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
        raf = (Math.abs(tx - x) > 0.3 || Math.abs(ty - y) > 0.3) ? requestAnimationFrame(place) : 0;
      };
      var aim = function (nx, ny) { tx = nx; ty = ny; if (!raf) raf = requestAnimationFrame(place); };
      frame.addEventListener('pointermove', function (e) {
        if (playing || e.pointerType !== 'mouse') return;
        var r = frame.getBoundingClientRect(), pw = play.offsetWidth / 2 + 16, ph = play.offsetHeight / 2 + 16;
        var cx = Math.max(pw, Math.min(r.width - pw, e.clientX - r.left));
        var cy = Math.max(ph, Math.min(r.height - ph, e.clientY - r.top));
        aim(cx - r.width / 2, cy - r.height / 2);
      });
      frame.addEventListener('pointerleave', function () { aim(0, 0); });
    }
  }

  /* ---- the brief, with this kind of film already chosen ---------------- */
  // main.js opens the brief from the button's subject line and names the
  // film; the page also knows what kind of film it is, so the blank for the
  // kind is filled in too (the visitor can still change it).
  var ask = d.querySelector('.fp-close .btn[data-kind]');
  if (ask) ask.addEventListener('click', function () {
    var kind = ask.getAttribute('data-kind');
    setTimeout(function () {
      var dlg = d.querySelector('dialog.brief[open]'), sel = dlg && dlg.querySelector('select[name="kind"]');
      if (!sel || !sel.querySelector('option[value="' + kind + '"]')) return;
      sel.value = kind;
      sel.dispatchEvent(new Event('change'));
    }, 0);
  });

  /* ---- the camera moves where you look -------------------------------- */
  // Over a still, the pointer's place in the frame (-1..1) pans the picture
  // gently toward it; the push-in itself is CSS. One rAF per move, at most.
  if (mouse.matches && !still.matches) {
    var pending = null, tick = 0;
    var flush = function () {
      tick = 0;
      if (!pending) return;
      var a = pending.a, r = pending.r;
      a.style.setProperty('--px', (((pending.x - r.left) / r.width) * 2 - 1).toFixed(3));
      a.style.setProperty('--py', (((pending.y - r.top) / r.height) * 2 - 1).toFixed(3));
      pending = null;
    };
    d.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var a = e.target.closest && e.target.closest('.fp-card > a');
      if (!a) return;
      var s = a.querySelector('.fp-card__still');
      pending = { a: a, r: s.getBoundingClientRect(), x: e.clientX, y: e.clientY };
      if (!tick) tick = requestAnimationFrame(flush);
    }, { passive: true });
    d.addEventListener('pointerout', function (e) {
      var a = e.target.closest && e.target.closest('.fp-card > a');
      if (a && !a.contains(e.relatedTarget)) { a.style.removeProperty('--px'); a.style.removeProperty('--py'); }
    });
  }

  /* ---- the index: kinds of film re-hang the wall ----------------------- */
  var wall = d.querySelector('.fp-wall');
  var bar = d.querySelector('.fp-tabs');
  if (!wall || !bar) return;
  var row = bar.querySelector('.fp-tabs__row');
  var tabs = [].slice.call(row.querySelectorAll('a[data-cat]'));
  var cards = [].slice.call(wall.querySelectorAll('.fp-card'));
  var cats = tabs.map(function (t) { return t.getAttribute('data-cat'); });

  // the lit copy of the row that the pill reveals
  var ink = d.createElement('div');
  ink.className = 'fp-tabs__ink';
  ink.setAttribute('aria-hidden', 'true');
  tabs.forEach(function (t) { var s = d.createElement('span'); s.innerHTML = t.innerHTML; ink.appendChild(s); });
  row.appendChild(ink);

  var current = null;
  var pill = function (cat) {
    var t = tabs[cats.indexOf(cat)];
    var w = ink.offsetWidth;
    ink.style.setProperty('--il', t.offsetLeft + 'px');
    ink.style.setProperty('--ir', Math.max(0, w - t.offsetLeft - t.offsetWidth) + 'px');
    tabs.forEach(function (x) { if (x === t) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
    // keep the chosen tab in view on a phone, where the row scrolls
    var l = t.offsetLeft - row.scrollLeft, rr = l + t.offsetWidth;
    if (l < 0 || rr > row.clientWidth) row.scrollTo({ left: t.offsetLeft - 24, behavior: still.matches ? 'auto' : 'smooth' });
  };

  var shown = function () { return cards.filter(function (c) { return c.getClientRects().length > 0; }); };

  var apply = function (cat, animate) {
    if (cat === current) return;
    var first = new Map();
    var before = animate ? shown() : [];
    var wr = wall.getBoundingClientRect();
    before.forEach(function (c) { first.set(c, c.getBoundingClientRect()); });

    // the ones leaving: held where they were, out of the flow, fading
    var leaving = animate ? before.filter(function (c) { return cat !== 'all' && c.getAttribute('data-cat') !== cat; }) : [];
    leaving.forEach(function (c) {
      var r = first.get(c);
      c.classList.add('is-leaving');
      c.style.left = (r.left - wr.left) + 'px'; c.style.top = (r.top - wr.top) + 'px';
      c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
    });

    current = cat;
    wall.setAttribute('data-filter', cat);
    // the first landscape film of what is showing is hung large
    var lead = cards.filter(function (c) {
      return (cat === 'all' || c.getAttribute('data-cat') === cat) && !c.classList.contains('fp-card--portrait');
    })[0];
    cards.forEach(function (c) { c.classList.toggle('is-lead', c === lead); });
    pill(cat);
    if (!animate) return;

    wall.classList.add('is-rehanging');
    clearTimeout(apply.t); apply.t = setTimeout(function () { wall.classList.remove('is-rehanging'); }, 1100);
    var wr2 = wall.getBoundingClientRect();
    leaving.forEach(function (c) {
      // re-anchor against the wall's new top, then let it go
      var r = first.get(c);
      c.style.top = (r.top - wr2.top) + 'px'; c.style.left = (r.left - wr2.left) + 'px';
      var an = c.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94)' }],
                         { duration: 300, easing: 'ease-out', fill: 'forwards' });
      an.onfinish = function () { c.classList.remove('is-leaving'); c.style.left = c.style.top = c.style.width = c.style.height = ''; an.cancel(); };
    });
    shown().forEach(function (c, i) {
      if (c.classList.contains('is-leaving')) return;
      var a = first.get(c), b = c.getBoundingClientRect();
      // a card that changed size (hung large, or no longer) cross-fades in
      // place rather than stretching on its way there
      if (a && (Math.abs(a.width - b.width) > 2 || Math.abs(a.height - b.height) > 2)) a = null;
      // and one that was out of sight, or would cross most of the screen,
      // arrives where it belongs instead of flying in from afar
      if (a && (a.top > innerHeight || a.bottom < 0 || Math.abs(a.top - b.top) > innerHeight * 0.55)) a = null;
      if (a) {
        var dx = a.left - b.left, dy = a.top - b.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        c.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
                  { duration: 760, easing: EASE, delay: Math.min(i, 8) * 22, fill: 'backwards' });
      } else {
        c.animate([{ opacity: 0, transform: 'translateY(18px) scale(.98)' }, { opacity: 1, transform: 'none' }],
                  { duration: 620, easing: 'cubic-bezier(.16,1,.3,1)', delay: 90 + Math.min(i, 8) * 36, fill: 'backwards' });
      }
    });
  };

  var fromHash = function () {
    var h = (location.hash || '').slice(1);
    return cats.indexOf(h) > -1 ? h : 'all';
  };

  row.addEventListener('click', function (e) {
    var t = e.target.closest('a[data-cat]');
    if (!t || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();   // main.js would jump to the section; here the wall re-hangs instead
    var cat = t.getAttribute('data-cat');
    history.replaceState(null, '', cat === 'all' ? location.pathname + location.search : '#' + cat);
    // if the wall's top has scrolled away, bring it back under the tabs first
    var top = wall.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(bar).top) || 0) - bar.offsetHeight - 16;
    var go = function () { apply(cat, !still.matches); };
    if (scrollY > top + 4) { scrollTo({ top: top, behavior: still.matches ? 'auto' : 'smooth' }); setTimeout(go, still.matches ? 0 : 320); }
    else go();
  });
  window.addEventListener('hashchange', function () { apply(fromHash(), !still.matches); });

  var edge = function () {
    row.classList.add('is-measured');
    row.classList.toggle('is-more', row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
  };
  row.addEventListener('scroll', edge, { passive: true });
  window.addEventListener('resize', edge);

  apply(fromHash(), false);
  edge();
  // the ink sits under the row's text only once the fonts have their widths
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { pill(current); edge(); });
  window.addEventListener('resize', function () { pill(current); });

  // the tab bar draws its hairline only once it is holding its place
  if ('IntersectionObserver' in window) {
    var mark = d.createElement('div');
    mark.style.cssText = 'position:absolute;height:1px;width:1px;margin-top:-1px;pointer-events:none';
    bar.parentNode.insertBefore(mark, bar);
    new IntersectionObserver(function (es) {
      bar.classList.toggle('is-stuck', !es[0].isIntersecting && es[0].boundingClientRect.top < 100);
    }, { rootMargin: '-60px 0px 0px 0px' }).observe(mark);
  }
})();
