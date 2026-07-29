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

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { hero.classList.add('is-lit'); });
    });
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

  /* ---- cursor ------------------------------------------------------- */

  if (finePointer && motionOK) {
    var dot = document.createElement('div');
    dot.className = 'cursor';
    dot.innerHTML = '<span class="cursor__label">PLAY</span>';
    document.body.appendChild(dot);

    var tx = 0, ty = 0, cx = 0, cy = 0, awake = false;

    window.addEventListener('mousemove', function (e) {
      tx = e.clientX; ty = e.clientY;
      if (!awake) { cx = tx; cy = ty; awake = true; dot.classList.add('is-awake'); }
    }, { passive: true });

    // Lerp toward the pointer so the dot trails slightly — instant tracking
    // reads as a UI element, a little lag reads as considered.
    (function loop() {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      dot.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0) translate(-50%,-50%)';
      requestAnimationFrame(loop);
    })();

    document.querySelectorAll('.tile__link').forEach(function (el) {
      el.addEventListener('mouseenter', function () { dot.classList.add('is-play'); });
      el.addEventListener('mouseleave', function () { dot.classList.remove('is-play'); });
    });
    document.addEventListener('mouseleave', function () { dot.classList.remove('is-awake'); });
    document.addEventListener('mouseenter', function () { dot.classList.add('is-awake'); });
  }

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
