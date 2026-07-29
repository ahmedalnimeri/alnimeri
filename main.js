/* alnimeri.com — lightbox + scroll reveal. No dependencies. */
(function () {
  'use strict';

  document.documentElement.classList.remove('no-js');

  /* ---- lightbox ---------------------------------------------------- */

  var lb      = document.querySelector('.lb');
  var frame   = lb && lb.querySelector('.lb__frame');
  var caption = lb && lb.querySelector('.lb__cap');
  var closeBtn= lb && lb.querySelector('.lb__close');
  var opener  = null;

  function open(id, title, portrait) {
    if (!lb) return;
    lb.classList.toggle('is-portrait', !!portrait);
    frame.innerHTML =
      '<iframe src="https://player.vimeo.com/video/' + id +
      '?autoplay=1&title=0&byline=0&portrait=0&dnt=1" ' +
      'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen ' +
      'title="' + title.replace(/"/g, '&quot;') + '"></iframe>';
    caption.textContent = title;
    lb.classList.add('is-open');
    document.body.classList.add('is-locked');
    lb.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { lb.classList.add('is-visible'); });
    closeBtn.focus();
  }

  function close() {
    if (!lb || !lb.classList.contains('is-open')) return;
    lb.classList.remove('is-visible');
    lb.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    // Wait out the fade before tearing down the iframe, so the video
    // doesn't vanish mid-transition.
    setTimeout(function () {
      lb.classList.remove('is-open');
      frame.innerHTML = '';
    }, 400);
    if (opener) { opener.focus(); opener = null; }
  }

  document.querySelectorAll('[data-video]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      // Let modified clicks through to Vimeo in a new tab.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      opener = el;
      open(el.dataset.video, el.dataset.title || '', el.dataset.portrait === 'true');
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', close);
  if (lb) lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  // Keep tab focus inside the lightbox while it's open.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !lb || !lb.classList.contains('is-open')) return;
    e.preventDefault();
    closeBtn.focus();
  });

  /* ---- silent video ------------------------------------------------
     Vimeo background mode: no chrome, muted, looping. Requires a Plus
     account, which this one is. */

  var conn = navigator.connection || {};
  var motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dataOK   = !conn.saveData;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  function bgSrc(id) {
    return 'https://player.vimeo.com/video/' + id +
           '?background=1&autoplay=1&loop=1&muted=1&dnt=1';
  }

  // Only reveal a loop once the player reports it is actually playing.
  // `load` fires even when Vimeo is blocked or the video never starts, so
  // fading in on `load` would drop a black rectangle over the poster —
  // precisely what a locked-down corporate network would see.
  function mountLoop(host, id) {
    var f = document.createElement('iframe');
    f.src = bgSrc(id);
    f.allow = 'autoplay';
    f.setAttribute('tabindex', '-1');
    f.setAttribute('aria-hidden', 'true');

    var settled = false;
    function reveal() {
      if (settled || !f.isConnected) return;
      settled = true;
      window.removeEventListener('message', onMsg);
      host.classList.add('is-playing');
    }

    function onMsg(e) {
      if (e.origin !== 'https://player.vimeo.com' || e.source !== f.contentWindow) return;
      var d = e.data;
      try { if (typeof d === 'string') d = JSON.parse(d); } catch (_) { return; }
      if (d && (d.event === 'playProgress' || d.event === 'play')) reveal();
    }

    window.addEventListener('message', onMsg);

    f.addEventListener('load', function () {
      // Subscribe to playback events via the player's postMessage API.
      ['play', 'playProgress'].forEach(function (ev) {
        try {
          f.contentWindow.postMessage(
            JSON.stringify({ method: 'addEventListener', value: ev }),
            'https://player.vimeo.com'
          );
        } catch (_) {}
      });
    });

    // Give up quietly: poster stays, nothing flashes.
    setTimeout(function () {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMsg);
    }, 4000);

    host.appendChild(f);
    return f;
  }

  /* Hero loop — deferred so it never competes with first paint. */
  var heroBg = document.querySelector('[data-bg-video]');
  if (heroBg && motionOK && dataOK) {
    var startHero = function () { mountLoop(heroBg, heroBg.dataset.bgVideo); };
    if ('requestIdleCallback' in window) requestIdleCallback(startHero, { timeout: 2500 });
    else setTimeout(startHero, 1200);
  }

  /* Tile previews — pointer devices only. Touch has no hover state, and
     autoplaying twelve loops on a phone would be indefensible. */
  if (finePointer && motionOK && dataOK) {
    var active = null;
    var timer = null;

    var stop = function () {
      if (!active) return;
      active.classList.remove('is-playing');
      var host = active;
      active = null;
      setTimeout(function () { if (host !== active) host.innerHTML = ''; }, 700);
    };

    document.querySelectorAll('.tile__link').forEach(function (link) {
      var host = link.querySelector('.tile__preview');
      var id = link.dataset.video;
      if (!host || !id) return;

      link.addEventListener('mouseenter', function () {
        clearTimeout(timer);
        // Hover intent: a cursor crossing the grid shouldn't spawn a player
        // in every tile it passes over.
        timer = setTimeout(function () {
          if (active === host) return;
          stop();
          active = host;
          host.innerHTML = '';
          mountLoop(host, id);
        }, 200);
      });

      link.addEventListener('mouseleave', function () {
        clearTimeout(timer);
        if (active === host) stop();
      });
    });
  }

  /* ---- hero headline: masked word reveal --------------------------- */

  var hero = document.querySelector('.hero');
  var head = document.querySelector('.hero__name');

  if (head && motionOK) {
    var i = 0;
    // Walk child nodes so the <em> keeps its own colour while its words
    // still get wrapped and staggered like the rest.
    var out = [];
    [].slice.call(head.childNodes).forEach(function (node) {
      var isEm = node.nodeType === 1 && node.tagName === 'EM';
      var text = node.textContent || '';
      text.split(/\s+/).filter(Boolean).forEach(function (w) {
        var span = document.createElement('span');
        span.className = 'word';
        var inner = document.createElement('i');
        inner.textContent = w;
        inner.style.setProperty('--d', (i * 55) + 'ms');
        if (isEm) { span.style.color = 'var(--fg-dim)'; }
        span.appendChild(inner);
        out.push(span, document.createTextNode(' '));
        i++;
      });
    });
    head.innerHTML = '';
    out.forEach(function (n) { head.appendChild(n); });

    // Stagger the surrounding furniture in after the headline lands.
    var lifts = [
      document.querySelector('.hero__eyebrow'),
      document.querySelector('.hero__lede'),
      document.querySelector('.hero__cta'),
      document.querySelector('.hero__note')
    ].filter(Boolean);
    lifts.forEach(function (el, n) {
      el.classList.add('lift');
      el.style.setProperty('--d', (i * 55 + 120 + n * 90) + 'ms');
    });

    // Two paths to the same switch. rAF gives a clean first frame, but it is
    // suspended in background tabs — and a link opened in a background tab is
    // exactly how people arrive. Without the timeout, the headline could stay
    // masked indefinitely. Text must never depend on an animation frame.
    var lit = false;
    var light = function () {
      if (lit) return;
      lit = true;
      hero.classList.add('is-lit');
    };
    requestAnimationFrame(function () { requestAnimationFrame(light); });
    setTimeout(light, 500);
  } else if (hero) {
    hero.classList.add('is-lit');
  }

  /* ---- hero parallax ------------------------------------------------ */

  var heroLayer = document.querySelector('.hero__bg');
  if (heroLayer && motionOK) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY;
        if (y < window.innerHeight * 1.2) {
          heroLayer.style.transform = 'translate3d(0,' + (y * 0.28) + 'px,0) scale(' + (1 + y * 0.00012) + ')';
        }
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---- timeline HUD -------------------------------------------------
     Scroll position drives a playhead across a track of clips, one per
     section, with running timecode. Doubles as navigation: click a clip to
     cut to that section. */

  (function () {
    var secs = [].slice.call(document.querySelectorAll('main > section[id]'))
                 .filter(function (s) { return s.id !== 'top'; });
    if (secs.length < 2) return;

    // Read the label off the section's own heading rather than a hardcoded
    // map, so adding a section never leaves a raw id in the HUD.
    var labelFor = function (s) {
      var h = s.querySelector('.section__title, h2');
      return (h && h.textContent.trim()) || s.id;
    };

    var bar = document.createElement('div');
    bar.className = 'tl';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Sequence');

    var tc = document.createElement('div');
    tc.className = 'tl__tc';
    tc.innerHTML = '<span class="tl__rec" aria-hidden="true"></span><span class="tl__now">00:00:00</span>';

    var track = document.createElement('div');
    track.className = 'tl__track';

    var clips = secs.map(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tl__clip';
      var name = labelFor(s);
      b.innerHTML = '<span>' + name + '</span>';
      b.setAttribute('aria-label', 'Go to ' + name);
      b.addEventListener('click', function () {
        s.scrollIntoView({ behavior: motionOK ? 'smooth' : 'auto', block: 'start' });
      });
      track.appendChild(b);
      return b;
    });

    var headEl = document.createElement('div');
    headEl.className = 'tl__head';
    track.appendChild(headEl);

    var pct = document.createElement('div');
    pct.className = 'tl__pct';

    bar.appendChild(tc); bar.appendChild(track); bar.appendChild(pct);
    document.body.appendChild(bar);

    var now = tc.querySelector('.tl__now');
    var RUNTIME = 154; // seconds of notional sequence length
    var FPS = 24;

    function stamp(p) {
      var t = RUNTIME * p;
      var m = Math.floor(t / 60);
      var s = Math.floor(t % 60);
      var f = Math.floor((t * FPS) % FPS);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return pad(m) + ':' + pad(s) + ':' + pad(f);
    }

    // The HUD surfaces while you scroll and retreats once you stop, so it
    // never sits on top of the work. Hovering it holds it open, otherwise
    // reaching for a clip would dismiss the thing you were reaching for.
    var idle = null, hovering = false;

    function wake() {
      bar.classList.add('is-up');
      clearTimeout(idle);
      idle = setTimeout(function () {
        if (!hovering) bar.classList.remove('is-up');
      }, 1500);
    }
    function hide() {
      clearTimeout(idle);
      if (!hovering) bar.classList.remove('is-up');
    }

    bar.addEventListener('mouseenter', function () {
      hovering = true;
      clearTimeout(idle);
      bar.classList.add('is-up');
    });
    bar.addEventListener('mouseleave', function () { hovering = false; wake(); });
    bar.addEventListener('focusin',  function () { hovering = true; bar.classList.add('is-up'); });
    bar.addEventListener('focusout', function () { hovering = false; wake(); });

    var tick = false;
    function draw() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;

      now.textContent = stamp(p);
      pct.textContent = Math.round(p * 100) + '%';
      headEl.style.left = (p * 100) + '%';
      if (window.scrollY > window.innerHeight * 0.35) wake();
      else hide();

      // Mark the clip whose section currently owns the middle of the viewport.
      var mid = window.scrollY + window.innerHeight / 2;
      var live = 0;
      secs.forEach(function (s, n) {
        if (s.offsetTop <= mid) live = n;
      });
      clips.forEach(function (c, n) { c.classList.toggle('is-live', n === live); });
    }

    window.addEventListener('scroll', function () {
      if (tick) return;
      tick = true;
      requestAnimationFrame(function () { draw(); tick = false; });
    }, { passive: true });
    window.addEventListener('resize', draw, { passive: true });
    draw();
  })();

  /* ---- counters -----------------------------------------------------
     Counts up once, when the figure first enters view. */

  (function () {
    var nums = [].slice.call(document.querySelectorAll('[data-to]'));
    if (!nums.length) return;

    var fmt = function (v, dec) {
      return dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US');
    };

    var run = function (el) {
      var to  = parseFloat(el.dataset.to);
      var dec = parseInt(el.dataset.decimals || '0', 10);
      var suf = el.dataset.suffix || '';
      var pre = el.dataset.prefix || '';

      if (!motionOK) { el.textContent = pre + fmt(to, dec) + suf; return; }

      var dur = 1600, t0 = null, done = false;
      var settle = function () {
        if (done) return;
        done = true;
        el.textContent = pre + fmt(to, dec) + suf;
      };
      var step = function (ts) {
        if (done) return;
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        // easeOutExpo — fast start, long settle, like a counter coming to rest
        var e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
        el.textContent = pre + fmt(to * e, dec) + suf;
        if (p < 1) requestAnimationFrame(step); else settle();
      };
      requestAnimationFrame(step);
      // rAF is suspended in background tabs. Without this, a figure that
      // started counting but never got a frame would sit at "0M+" — a wrong
      // number on screen is worse than no animation.
      setTimeout(settle, dur + 600);
    };

    // The markup already contains the real figure. Never blank it up front:
    // if the observer never fires — hidden tab, no IO support, anything — the
    // visitor must still read the true number, not a zero we left behind.
    if (!('IntersectionObserver' in window) || !motionOK) return;

    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        cio.unobserve(e.target);
        // Reserve the settled width so the row doesn't reflow while counting.
        e.target.style.minWidth = e.target.getBoundingClientRect().width + 'px';
        run(e.target);
      });
    }, { threshold: 0.4 });

    nums.forEach(function (el) { cio.observe(el); });
  })();

  /* ---- scroll reveal ----------------------------------------------- */

  var targets = document.querySelectorAll('.reveal');

  if (!('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('is-in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      // --d drives the delay on descendants (clip wipe, meta lift), so set the
      // variable rather than transitionDelay on the element itself.
      el.style.setProperty('--d', (el.dataset.delay || 0) + 'ms');
      el.classList.add('is-in');
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  targets.forEach(function (el) { io.observe(el); });
})();
