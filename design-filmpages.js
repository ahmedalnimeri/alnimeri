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
  // Every frame on the page with a play control: the page's own film and, on
  // an entry with more than one film, each of the others. One plays at a
  // time (starting another puts the first back to its still), and the house
  // lights follow the one that is playing.
  var frames = [].slice.call(d.querySelectorAll('.fp-frame')).filter(function (f) { return f.querySelector('.fp-play'); });
  var lights = function (down) { root.classList.toggle('fp-lights-down', !!down); };
  var on = null, upTimer = 0;   // the frame that is playing
  var up = function () { clearTimeout(upTimer); lights(false); };
  // what the lights stay on: the film's stage, or a further film's block
  var holder = function (frame) { return frame.closest('.fp-stage, .fp-also__film') || frame; };

  var stop = function (frame) {
    [].forEach.call(frame.querySelectorAll('iframe'), function (f) { f.parentNode.removeChild(f); });
    frame.classList.remove('is-playing', 'is-loaded');
    holder(frame).classList.remove('is-on');
    if (on === frame) on = null;
  };

  // The player, from the start or from a second of the film (from: a frame
  // pressed under it, below): Vimeo's own #t=, YouTube's start=.
  var player = function (play, from) {
    var f = d.createElement('iframe'), id = encodeURIComponent(play.getAttribute('data-vid'));
    from = Math.max(0, Math.floor(+from || 0));
    // Vimeo, or a film on YouTube (data-provider): its privacy-enhanced
    // player, no related videos at the end, sent the page's origin (YouTube
    // refuses an embed that arrives with no referrer at all)
    if (play.getAttribute('data-provider') === 'youtube') {
      f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1&playsinline=1' + (from ? '&start=' + from : '');
      f.referrerPolicy = 'strict-origin-when-cross-origin';
    } else {
      f.src = 'https://player.vimeo.com/video/' + id + '?title=0&byline=0&portrait=0&dnt=1&autoplay=1' + (from ? '#t=' + from + 's' : '');
    }
    f.title = play.getAttribute('data-title') || 'Film';
    f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
    f.setAttribute('allowfullscreen', '');
    f.addEventListener('load', function () { f.setAttribute('data-up', ''); });
    return f;
  };

  var start = function (frame, play, from) {
    if (on === frame) return;
    if (on) stop(on);
    on = frame;
    var f = player(play, from);
    // focus stays on the page, so Escape still brings the lights up; Tab
    // is the next step into the player's own controls
    f.addEventListener('load', function () { if (f.parentNode === frame) frame.classList.add('is-loaded'); });
    frame.appendChild(f);
    frame.classList.add('is-playing');
    holder(frame).classList.add('is-on');
    // if the player is slow to answer, the still steps aside anyway
    setTimeout(function () { if (f.parentNode === frame) frame.classList.add('is-loaded'); }, 2600);
    lights(true);
  };

  frames.forEach(function (frame) {
    var play = frame.querySelector('.fp-play');
    var vid = play.getAttribute('data-vid');
    frame.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // a new tab stays a new tab
      if (!vid) { if (e.target.closest('.fp-play') !== play) play.click(); return; }
      e.preventDefault();
      start(frame, play);
    });
    if (!vid) return;
    // The lights follow the visitor's attention: the pointer leaving the
    // picture for a moment brings them up, coming back takes them down.
    frame.addEventListener('mouseleave', function () {
      if (on !== frame || gliding) return;   // (the page moving under a still pointer is not leaving)
      clearTimeout(upTimer); upTimer = setTimeout(function () { lights(false); }, 900);
    });
    frame.addEventListener('mouseenter', function () { if (on === frame) { clearTimeout(upTimer); lights(true); } });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        // (not while the page is on its way back up to it from a frame below)
        es.forEach(function (en) { if (on === frame && en.intersectionRatio < 0.45 && !gliding) up(); });
      }, { threshold: [0, 0.45] }).observe(frame);
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
        if (on === frame || e.pointerType !== 'mouse') return;
        var r = frame.getBoundingClientRect(), pw = play.offsetWidth / 2 + 16, ph = play.offsetHeight / 2 + 16;
        var cx = Math.max(pw, Math.min(r.width - pw, e.clientX - r.left));
        var cy = Math.max(ph, Math.min(r.height - ph, e.clientY - r.top));
        aim(cx - r.width / 2, cy - play.offsetTop);   // from where the control rests
      });
      frame.addEventListener('pointerleave', function () { aim(0, 0); });
    }
  });

  /* ---- a frame below the film plays it from there --------------------- */
  // The Frames under the player (bin-build-work-pages.py): each is a link to
  // the film at its second (data-from), for a visitor without JavaScript.
  // Here a press takes the page back up to the player, takes the lights down
  // and plays the film from that second, as the play button would from the
  // start. A film already playing is given a new player that starts there,
  // over the old one, which goes once the new one has loaded.
  var own = frames.filter(function (f) { return f.closest('.fp-stage') && f.querySelector('.fp-play[data-vid]'); })[0];
  var gliding = 0, landed = null;   // the way back up: its timer, and its end
  var glide = function () {
    clearTimeout(gliding);
    if (landed) removeEventListener('scrollend', landed);
    landed = function () {
      removeEventListener('scrollend', landed);
      clearTimeout(gliding); gliding = 0; landed = null;
      // arrived: if the film is still mostly out of view, the lights come up
      var r = own.getBoundingClientRect(), seenH = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (on === own && seenH < r.height * 0.45) up();
    };
    gliding = setTimeout(landed, 1600);
    if ('onscrollend' in window) addEventListener('scrollend', landed);
  };
  var from = function (a, e) {
    var play = own.querySelector('.fp-play'), t = +a.getAttribute('data-from') || 0;
    own.scrollIntoView({ behavior: still.matches ? 'auto' : 'smooth', block: 'center' });
    glide();
    if (on === own) {
      var old = [].slice.call(own.querySelectorAll('iframe')), f = player(play, t);
      f.classList.add('is-next');
      var drop = function () {
        // (an old one that went before it loaded never let the still step aside: this one does, as start() would)
        if (f.parentNode === own) own.classList.add('is-loaded');
        f.classList.remove('is-next');   // fades in over the old one, which then goes
        setTimeout(function () { old.forEach(function (o) { if (o.parentNode) o.parentNode.removeChild(o); }); }, 900);
      };
      f.addEventListener('load', drop);
      setTimeout(drop, 2600);
      // the old player stops talking while the new one loads
      // (one still loading has nothing to show yet, and would start on its own once loaded: it goes now)
      old.forEach(function (o) { if (!o.hasAttribute('data-up')) { o.parentNode.removeChild(o); return; } try { o.contentWindow.postMessage('{"method":"pause"}', 'https://player.vimeo.com'); } catch (x) {} });
      own.appendChild(f);
      clearTimeout(upTimer); lights(true);
    } else {
      d.dispatchEvent(new CustomEvent('site:event', { detail: { t: 'play', via: 'page' } }));   // main.js: a Play
      start(own, play, t);
    }
    // a keyboard press takes the keyboard with it, to the player
    if (e.detail === 0) { own.setAttribute('tabindex', '-1'); own.focus({ preventScroll: true }); }
  };

  // Up: Escape, a click or a tap anywhere else, or focus moving on to the
  // rest of the page. Down again: into the player's own controls.
  if (frames.length) {
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape') up(); });
    d.addEventListener('focusin', function (e) { if (on && !on.contains(e.target)) up(); });
    d.addEventListener('click', function (e) {
      var a = own && e.target.closest && e.target.closest('a[data-from]');
      if (a && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) { e.preventDefault(); from(a, e); return; }
      if (on && !on.contains(e.target)) up();
    });
    window.addEventListener('blur', function () {
      setTimeout(function () { if (on && d.activeElement === on.querySelector('iframe')) { clearTimeout(upTimer); lights(true); } }, 0);
    });
  }

  /* ---- the brief, with this kind of film already chosen ---------------- */
  // main.js opens the brief from the button's subject line, names the film
  // and reads the button's data-kind, so the blank for the kind of film is
  // filled in too (the visitor can still change it). Its listener runs in the
  // capture phase and stops the click there, so nothing is needed here.

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
  var lead_sizes = wall.getAttribute('data-lead-sizes');

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

  // The wall ends whole. A film that would be left alone in the last row
  // hangs across the row instead (is-wide); a last row one film short gives
  // its last film two cells, at the row's height (is-pair).
  var ends = function (mine, few) {
    // the list showing (design-worklist.js): the wall has no rows to measure;
    // it measures them when it comes back (fp:view, below)
    if (!wall.getClientRects().length) return;
    var cs = getComputedStyle(wall);
    var tracks = cs.gridTemplateColumns.split(' ').filter(Boolean);
    var cols = tracks.length;
    var cells = few ? mine.length : mine.length + 3;   // the lead takes four cells
    var rem = cells % cols, end = mine[mine.length - 1];
    var wide = cols > 1 && rem === 1 ? end : null;
    var pair = cols > 2 && rem === cols - 1 ? end : null;
    // The still's shape: a pair is exactly as tall as its row's 16:9 stills
    // (two cells and the gap between them, over one cell's height), so the
    // row's pictures and names stay on one line; a film across a wider wall
    // takes the scope shape of the front page's full-row film, not a 16:9
    // larger than the lead; on a phone, the 16:9 of every card.
    var cw = parseFloat(tracks[0]) || 0, gap = parseFloat(cs.columnGap) || 0;
    cards.forEach(function (c) {
      c.classList.toggle('is-wide', c === wide);
      c.classList.toggle('is-pair', c === pair);
      var st = c.querySelector('.fp-card__still');
      if (st) st.style.aspectRatio = c === pair && cw ? ((2 * cw + gap) / (cw * 9 / 16)).toFixed(4)
        : c === wide && cols > 2 ? '768 / 324' : '';
    });
    // a film across the whole row asks for a picture that wide, not the lead's
    var want = wide ? '(max-width: 1480px) 92vw, 1320px' : lead_sizes;
    if ((wide || pair) && want) sized(wide || pair, want);
  };
  // a card's picture asks for its size on the WebP <source> and the <img> alike
  // (the browser picks from the <source>, so an <img> alone would change nothing)
  var sized = function (c, want) {
    [].forEach.call(c.querySelectorAll('picture source, img'), function (x) {
      if (x.getAttribute('sizes') !== want) x.setAttribute('sizes', want);
    });
  };

  var apply = function (cat, animate, to) {
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
    // a kind of four films or fewer hangs two to a row, all large; otherwise
    // the first landscape film of what is showing is hung large
    var mine = cards.filter(function (c) { return cat === 'all' || c.getAttribute('data-cat') === cat; });
    var few = mine.length <= 4;
    if (few) wall.setAttribute('data-few', mine.length); else wall.removeAttribute('data-few');
    var lead = few ? null : mine.filter(function (c) { return !c.classList.contains('fp-card--portrait'); })[0];
    cards.forEach(function (c) { c.classList.toggle('is-lead', c === lead); });
    ends(mine, few);
    // a card hung large asks for a picture that size (the browser only ever
    // trades up, so going back to small costs nothing)
    mine.forEach(function (c) {
      if ((few || c === lead) && lead_sizes) sized(c, lead_sizes);
    });
    pill(cat);
    // the wall's top back under the tabs, in the same frame as the re-hang
    // (the leavers are re-anchored below, the rest measured after it)
    if (to != null) scrollTo({ top: to, behavior: 'instant' });
    if (!animate) return;

    wall.classList.add('is-rehanging');
    clearTimeout(apply.t); apply.t = setTimeout(function () { wall.classList.remove('is-rehanging'); }, 1100);
    var wr2 = wall.getBoundingClientRect();
    leaving.forEach(function (c) {
      // re-anchor against the wall's new top, then let it go
      var r = first.get(c);
      c.style.top = (r.top - wr2.top) + 'px'; c.style.left = (r.left - wr2.left) + 'px';
      var an = c.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }],
                         { duration: 280, easing: 'ease-out', fill: 'forwards' });
      an.onfinish = function () { c.classList.remove('is-leaving'); c.style.left = c.style.top = c.style.width = c.style.height = ''; an.cancel(); };
    });
    // stagger by place on the new wall (the leavers are still in the DOM and
    // must not push the newcomers' turn back)
    shown().filter(function (c) { return !c.classList.contains('is-leaving'); }).forEach(function (c, i) {
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
        // arrivals start while the leavers are still fading, so the wall is
        // never empty between one hang and the next
        c.animate([{ opacity: 0, transform: 'translateY(14px) scale(.98)' }, { opacity: 1, transform: 'none' }],
                  { duration: 560, easing: 'cubic-bezier(.16,1,.3,1)', delay: 40 + Math.min(i, 8) * 30, fill: 'backwards' });
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
    // if the wall's top has scrolled away, it comes back under the tabs as
    // the wall re-hangs: the answer to a click starts on the next frame (the
    // list's top, when the list is the view showing: design-worklist.js)
    var list = d.querySelector('.fp-list'), shown = list && list.getClientRects().length ? list : wall;
    var top = shown.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(bar).top) || 0) - bar.offsetHeight - 16;
    apply(cat, !still.matches, scrollY > top + 4 ? top : null);
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
  var rehang = function () {
    var mine = cards.filter(function (c) { return current === 'all' || c.getAttribute('data-cat') === current; });
    ends(mine, mine.length <= 4);
  };
  window.addEventListener('resize', function () { pill(current); rehang(); });
  // back from the list to the wall (design-worklist.js): its last row again
  d.addEventListener('fp:view', rehang);

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
