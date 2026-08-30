/* alnimeri.com — lightbox + scroll reveal. No dependencies. */
(function () {
  'use strict';

  document.documentElement.classList.remove('no-js');

  /* One frame at 24fps. Every authored delay is quantized onto this grid, in
     one place, so the whole page cuts on the same clock. */
  var FRAME = 1000 / 24;
  function onGrid(ms) { return Math.round(ms / FRAME) * FRAME; }

  /* The cut: a one-frame drop to black that covers hard jumps, so navigation
     reads as a splice rather than a broken anchor. Created here, not in the
     markup — it is pure chrome and works identically on every page. */
  var cutEl = document.createElement('div');
  cutEl.className = 'cut';
  cutEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cutEl);

  /* ---- lightbox ---------------------------------------------------- */

  var lb      = document.querySelector('.lb');
  var frame   = lb && lb.querySelector('.lb__frame');
  var caption = lb && lb.querySelector('.lb__cap');
  var closeBtn= lb && lb.querySelector('.lb__close');
  var opener  = null;

  function open(id, title, portrait) {
    if (!lb) return;
    lb.classList.toggle('is-portrait', !!portrait);
    // Paint the poster the visitor just tapped behind the player. iOS blocks
    // the unmuted autoplay, so the frame would otherwise be black until they
    // press play — the tile's own facade pattern, carried into the dialog.
    var poster = opener && opener.querySelector('.tile__img');
    frame.style.backgroundImage = poster ? 'url("' + (poster.currentSrc || poster.src) + '")' : '';
    frame.innerHTML =
      '<iframe src="https://player.vimeo.com/video/' + id +
      '?autoplay=1&title=0&byline=0&portrait=0&dnt=1" ' +
      'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen ' +
      'title="' + title.replace(/"/g, '&quot;') + '"></iframe>';
    caption.textContent = title;
    // Source metadata, read off the tile's own chip — never invented.
    var dur = opener && opener.querySelector('.tile__dur');
    if (dur) {
      var src = document.createElement('span');
      src.className = 'lb__src';
      src.textContent = 'SRC ' + dur.textContent.trim();
      caption.appendChild(src);
    }
    lb.classList.add('is-open');
    document.body.classList.add('is-locked');
    lb.setAttribute('aria-hidden', 'false');
    lb.classList.add('is-visible');
    closeBtn.focus();
  }

  function close() {
    if (!lb || !lb.classList.contains('is-open')) return;
    lb.classList.remove('is-visible');
    lb.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    // One frame of grace so the class flip paints before teardown.
    setTimeout(function () {
      lb.classList.remove('is-open');
      frame.innerHTML = '';
      frame.style.backgroundImage = '';
    }, 60);
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

  // Keep tab focus inside the lightbox while it's open. The previous version
  // forced focus back to the close button on every Tab, which kept focus in
  // the dialog but made the player itself unreachable — a keyboard user could
  // open a film and never start it. Cycle between the two real stops instead.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !lb || !lb.classList.contains('is-open')) return;
    var stops = [closeBtn, frame.querySelector('iframe')].filter(Boolean);
    if (!stops.length) return;
    e.preventDefault();
    var i = stops.indexOf(document.activeElement);
    var next = e.shiftKey
      ? stops[(i - 1 + stops.length) % stops.length]
      : stops[(i + 1) % stops.length];
    next.focus();
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

  /* ---- hero headline: two shots ------------------------------------
     The clause spans are real text in the markup; CSS holds them at opacity 0
     only under .hero (armed below) and cuts them in on the frame grid once
     is-lit lands. No masks, no walkers, nothing rises. */

  var hero = document.querySelector('.hero');
  var head = document.querySelector('.hero__name');

  if (head && motionOK) {
    // Arm the cut only now that the code that fires it is running.
    hero.classList.add('is-armed');
    // The furniture cuts in after the reverse shot, three beats on the grid.
    var lifts = [
      document.querySelector('.hero__eyebrow'),
      document.querySelector('.hero__lede'),
      document.querySelector('.hero__cta'),
      document.querySelector('.hero .burnin')
    ].filter(Boolean);
    lifts.forEach(function (el, n) {
      el.classList.add('lift');
      el.style.setProperty('--d', onGrid(920 + n * 125) + 'ms');
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

  /* ---- hard-cut navigation ------------------------------------------
     Editors cut; templates glide. Any in-page jump drops one frame to black,
     moves under it, and comes back two frames later — a splice, not a scroll. */

  function headerOffset() {
    var m = document.querySelector('.masthead');
    if (!m) return 0;
    var r = m.getBoundingClientRect();
    return r.height + r.top + 12;
  }

  function cutTo(y) {
    y = Math.max(0, y);
    if (!motionOK) { window.scrollTo(0, y); return; }
    cutEl.classList.add('is-cutting');
    setTimeout(function () { window.scrollTo(0, y); }, 42);
    setTimeout(function () { cutEl.classList.remove('is-cutting'); }, 125);
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.classList.contains('skip')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    var target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    cutTo(target.offsetTop - headerOffset());
  });

  /* ---- masthead contracts on scroll --------------------------------- */

  (function () {
    var bar = document.querySelector('.masthead');
    if (!bar) return;
    var pending = false;
    function apply() {
      // Separate thresholds for shrinking and growing, so a scroll position
      // resting near the boundary cannot make the bar flicker.
      var y = window.scrollY;
      var on = bar.classList.contains('is-compact');
      if (!on && y > 140) bar.classList.add('is-compact');
      else if (on && y < 90) bar.classList.remove('is-compact');
    }
    window.addEventListener('scroll', function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { apply(); pending = false; });
    }, { passive: true });
    apply();
  })();

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
        // Offset by the fixed masthead's height so the slate lands clear.
        cutTo(s.offsetTop - headerOffset());
      });
      track.appendChild(b);
      return b;
    });

    var headEl = document.createElement('div');
    headEl.className = 'tl__head';
    track.appendChild(headEl);

    bar.appendChild(tc); bar.appendChild(track);
    document.body.appendChild(bar);

    var now = tc.querySelector('.tl__now');
    // The timebase is real: the sequence length is the summed running time of
    // the films actually on this page (42:18 on the index at last count).
    // Scrolling the page plays the reel. Pages without duration chips fall
    // back to a notional length; the maths is identical.
    var RUNTIME = [].reduce.call(document.querySelectorAll('.tile__dur'), function (t, d) {
      var m = d.textContent.trim().split(':');
      return t + (parseInt(m[0], 10) || 0) * 60 + (parseInt(m[1], 10) || 0);
    }, 0) || 154;
    var FPS = 24;

    function stamp(p) {
      var t = RUNTIME * p;
      var m = Math.floor(t / 60);
      var s = Math.floor(t % 60);
      var f = Math.floor((t * FPS) % FPS);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return pad(m) + ':' + pad(s) + ':' + pad(f);
    }

    // On a desktop with a real pointer the deck stays up once you are in the
    // sequence — an editor doesn't hide the timeline panel. On touch it still
    // retreats, because the bar sits where thumbs scroll.
    var persist = window.matchMedia('(hover: hover) and (min-width: 721px)');
    var idle = null, hovering = false;
    // A thumb has further to travel than a cursor, and on touch there is no
    // hover to hold the bar open once it starts closing.
    var IDLE = window.matchMedia('(pointer: coarse)').matches ? 3200 : 1500;

    function wake() {
      bar.classList.add('is-up');
      clearTimeout(idle);
      if (persist.matches) return;
      idle = setTimeout(function () {
        if (!hovering) bar.classList.remove('is-up');
      }, IDLE);
    }
    function hide() {
      clearTimeout(idle);
      if (!hovering) bar.classList.remove('is-up');
    }

    // Hover-hold is a pointer concept. On touch, mouseleave may never fire, so
    // a single tap pinned the bar open on top of the work with no way back.
    if (finePointer) {
      bar.addEventListener('mouseenter', function () {
        hovering = true;
        clearTimeout(idle);
        bar.classList.add('is-up');
      });
      bar.addEventListener('mouseleave', function () { hovering = false; wake(); });
    }
    bar.addEventListener('focusin',  function () { hovering = true; bar.classList.add('is-up'); });
    bar.addEventListener('focusout', function () { hovering = false; wake(); });

    var tick = false;
    function draw() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;

      now.textContent = stamp(p);
      headEl.style.left = (p * 100) + '%';
      bar.classList.toggle('is-out', p >= 0.999);
      if (window.scrollY > window.innerHeight * 0.35) wake();
      else hide();

      // Mark the clip whose section currently owns the middle of the viewport.
      // Probe just below the masthead, not the viewport centre. Using the
      // centre marked the NEXT section as live whenever a section was shorter
      // than half a screen — so clicking a clip appeared to jump you forward.
      var probe = window.scrollY + headerOffset() + 24;
      var live = 0;
      secs.forEach(function (s, n) {
        if (s.offsetTop <= probe) live = n;
      });
      // The final section can never reach the probe line — the document runs
      // out of scroll first — so it would never light up. At the bottom of the
      // page, it is by definition the one you are looking at.
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) {
        live = secs.length - 1;
      }
      clips.forEach(function (c, n) {
        c.classList.toggle('is-live', n === live);
        if (n === live) c.setAttribute('aria-current', 'true');
        else c.removeAttribute('aria-current');
      });
    }

    window.addEventListener('scroll', function () {
      if (tick) return;
      tick = true;
      requestAnimationFrame(function () { draw(); tick = false; });
    }, { passive: true });

    /* An honest minimap: each clip's width is its section's real share of the
       sequence, so Selects is visibly the long clip. Desktop only — on phones
       the live clip grows to fit its label, and an inline flex would trump
       that tuned behaviour. */
    function layout() {
      var docH = document.documentElement.scrollHeight;
      var wide = window.matchMedia('(min-width: 721px)').matches;
      clips.forEach(function (c, n) {
        if (!wide) { c.style.flex = ''; c.style.minWidth = ''; return; }
        c.style.flex = Math.max(8, secs[n].offsetHeight / docH * 100) + ' 1 0px';
        c.style.minWidth = '44px';
      });
    }

    /* The slates carry the same timebase: the stamp printed at each cut line
       agrees with the HUD readout the moment you scroll past it. Hardcoded
       defaults ship in the markup; this only refines them. */
    function stampSlates() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      secs.forEach(function (sec) {
        var el = sec.querySelector('.slate__tc[data-tc]');
        if (el) el.textContent = 'TC ' + stamp(Math.min(1, sec.offsetTop / max));
      });
    }

    /* Scrubbing: the track is a jog strip. Drag anywhere on it and the page
       is the transport — instant scrollTo, never smooth, because a playhead
       is finger-tracked. An 8px threshold keeps taps working as cuts. */
    (function () {
      var down = null, dragged = false;
      track.style.touchAction = 'none';
      function seek(e) {
        var r = track.getBoundingClientRect();
        var p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        window.scrollTo(0, p * (document.documentElement.scrollHeight - window.innerHeight));
      }
      track.addEventListener('pointerdown', function (e) {
        down = e.clientX; dragged = false;
      });
      track.addEventListener('pointermove', function (e) {
        if (down === null) return;
        if (!dragged && Math.abs(e.clientX - down) <= 8) return;
        if (!dragged) {
          dragged = true;
          try { track.setPointerCapture(e.pointerId); } catch (_) {}
          hovering = true;
          bar.classList.add('is-up');
        }
        seek(e);
      });
      function release() {
        if (down === null) return;
        down = null;
        hovering = false;
        wake();
      }
      track.addEventListener('pointerup', release);
      track.addEventListener('pointercancel', release);
      // A drag must not fire the clip underneath when the finger lets go.
      track.addEventListener('click', function (e) {
        if (!dragged) return;
        dragged = false;
        e.stopPropagation();
        e.preventDefault();
      }, true);
    })();

    var settleTimer = null;
    window.addEventListener('resize', function () {
      draw();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () { layout(); stampSlates(); }, 150);
    }, { passive: true });

    draw();
    layout();
    stampSlates();
    // Poster and font arrival can shift offsets after first paint.
    window.addEventListener('load', function () { layout(); stampSlates(); });
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

      var dur = 1600, t0 = null, done = false, lastQ = -1;
      var settle = function () {
        if (done) return;
        done = true;
        el.textContent = pre + fmt(to, dec) + suf;
      };
      var step = function (ts) {
        if (done) return;
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        // Same easeOutExpo reach, but the display only updates on 24fps
        // boundaries — the figure ratchets like a burnt-in counter instead
        // of easing like a dashboard.
        var q = Math.floor((ts - t0) / FRAME);
        if (q === lastQ && p < 1) { requestAnimationFrame(step); return; }
        lastQ = q;
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

  /* ---- copy the email ----------------------------------------------
     mailto: often has no handler inside Instagram's in-app browser, which is
     how most visitors arrive — the tap silently does nothing and the site's
     one ask dead-ends. The link keeps working where it works; this adds a
     second route rather than replacing the first. */

  (function () {
    var mail = document.querySelector('.contact__mail');
    if (!mail || !navigator.clipboard) return;

    var note = document.createElement('span');
    note.className = 'copied';
    note.setAttribute('role', 'status');
    note.textContent = 'Copied';
    mail.insertAdjacentElement('afterend', note);

    var hideTimer = null;
    mail.addEventListener('click', function (e) {
      // Let a real mail client win when one exists: only intercept the
      // modifier-free left click, and never block the default on desktop
      // where mailto: is reliable.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      // writeText resolves asynchronously — only claim success once it does,
      // or a failed copy would still show "Copied".
      navigator.clipboard.writeText(mail.textContent.trim()).then(function () {
        note.classList.add('is-on');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () { note.classList.remove('is-on'); }, 1800);
      }).catch(function () {});
    });
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
      // --d drives the delay on the element and its descendants, quantized to
      // the 24fps grid so every entrance lands on a frame boundary.
      el.style.setProperty('--d', onGrid(parseFloat(el.dataset.delay) || 0) + 'ms');
      el.classList.add('is-in');
      io.unobserve(el);
    });
    // Positive bottom margin: start un-hiding a screen-and-a-bit before the
    // element arrives. The old -8% waited until it was already on screen, so
    // a fast scroll outran the 0.85s fade and the evidence — a 12.8M-view
    // poster — rendered as a blank card.
  }, { rootMargin: '0px 0px 40% 0px', threshold: 0.01 });

  targets.forEach(function (el) { io.observe(el); });

  // Same doctrine as the headline and the counters: nothing the visitor can
  // actually see may sit hidden waiting on a callback that might not come.
  // Scoped to the viewport on purpose — a blanket reveal would un-hide the
  // whole document and delete the scroll choreography. Anything at or above
  // the fold that is still masked gets shown, with its stagger dropped since
  // the moment it was choreographed for has passed.
  var failOpen = function () {
    var h = window.innerHeight;
    targets.forEach(function (el) {
      if (el.classList.contains('is-in')) return;
      var r = el.getBoundingClientRect();
      if (r.top < h && r.bottom > 0) {
        el.style.setProperty('--d', '0ms');
        el.classList.add('is-in');
        io.unobserve(el);
      }
    });
  };
  setTimeout(failOpen, 2200);
  // Also catch the case where the tab was hidden for the whole load.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) setTimeout(failOpen, 400);
  });
})();
