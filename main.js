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

  /* A keystroke belongs to whatever the visitor is typing in, or to an open
     dialog (the brief, the reel sheet), never to the deck behind it. */
  function busy(e) {
    var t = e.target;
    return e.defaultPrevented || !!document.querySelector('dialog[open], .sheet.is-open') ||
      !!(t && t.closest && t.closest('input, textarea, select, [contenteditable]'));
  }

  /* An aria-modal layer makes the rest of the page inert while it is up, so
     Tab — even out of the player's iframe — cannot reach what is behind it.
     Only what this layer switched off is switched back on. */
  function seal(keep, mark) {
    [].forEach.call(document.body.children, function (el) {
      if (keep.indexOf(el) > -1 || /^(DIALOG|SCRIPT)$/.test(el.tagName) || el.inert) return;
      el.setAttribute(mark, ''); el.inert = true;
    });
  }
  function unseal(mark) {
    [].forEach.call(document.querySelectorAll('[' + mark + ']'), function (el) { el.removeAttribute(mark); el.inert = false; });
  }

  /* ---- lightbox ---------------------------------------------------- */

  var lb      = document.querySelector('.lb');
  var frame   = lb && lb.querySelector('.lb__frame');
  var caption = lb && lb.querySelector('.lb__cap');
  var closeBtn= lb && lb.querySelector('.lb__close');
  var opener  = null;       // what focus returns to when the player closes
  var posterFrom = null;    // a reel's current tile, for its still and source
  var runFrom = null;       // where the visitor was when a reel started

  function open(id, title, portrait) {
    if (!lb) return;
    if (run && !projecting) endRun();
    lb.classList.toggle('is-portrait', !!portrait);
    // Paint the poster the visitor just tapped behind the player. iOS blocks
    // the unmuted autoplay, so the frame would otherwise be black until they
    // press play — the tile's own facade pattern, carried into the dialog.
    var from = posterFrom || opener; posterFrom = null;
    var poster = from && from.querySelector('.tile__img');
    frame.style.backgroundImage = poster ? 'url("' + (poster.currentSrc || poster.src) + '")' : '';
    frame.innerHTML =
      '<iframe src="https://player.vimeo.com/video/' + id +
      '?autoplay=1&title=0&byline=0&portrait=0&dnt=1" ' +
      'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen ' +
      'title="' + title.replace(/"/g, '&quot;') + '"></iframe>';
    caption.textContent = title;
    // The running time, read off the tile's own chip — never invented.
    var dur = from && from.querySelector('.tile__dur');
    if (dur) {
      var src = document.createElement('span');
      src.className = 'lb__src';
      src.textContent = dur.textContent.trim();
      caption.appendChild(src);
    }
    lb.classList.add('is-open');
    document.body.classList.add('is-locked');
    lb.setAttribute('aria-hidden', 'false');
    lb.classList.add('is-visible');
    seal([lb, cutEl], 'data-lb-inert');
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
    unseal('data-lb-inert');
    // Back to where the visitor was, without scrolling: after a reel that is
    // where they started it, not the tile of the last clip played.
    var back = run ? runFrom : opener;
    opener = null; runFrom = null;
    if (back && back !== document.body && back.focus) back.focus({ preventScroll: true });
    if (run) endRun();
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
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close();
  });

  // Keep tab focus inside the lightbox while it's open. The previous version
  // forced focus back to the close button on every Tab, which kept focus in
  // the dialog but made the player itself unreachable — a keyboard user could
  // open a film and never start it. Cycle through what is really there: the
  // close button, the player or the end card's buttons, and the reel's
  // previous/next. Once focus is inside the player's iframe this page no
  // longer sees Tab; the inert page behind (seal) keeps it in the dialog then.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !lb || !lb.classList.contains('is-open')) return;
    if (document.querySelector('dialog[open]')) return;
    var stops = [].filter.call(lb.querySelectorAll('button, a[href], iframe'), function (el) {
      return !el.disabled && !el.closest('[hidden]') && el.getClientRects().length > 0;
    });
    if (!stops.length) return;
    e.preventDefault();
    var i = stops.indexOf(document.activeElement);
    var next = e.shiftKey
      ? stops[(i - 1 + stops.length) % stops.length]
      : stops[(i + 1) % stops.length];
    next.focus();
  });

  /* ---- the screening room -------------------------------------------
     The oldest gap in this repo's own README: "No showreel. The hero is
     built around a featured film because no cut reel exists." There is no
     file to make — the sequence is already an edit, so the deck assembles
     it at runtime. Play all mounts each clip in turn, advances on the
     player's own ended event, and runs ONE timeline across the whole
     sequence with a tick at every cut: forty minutes of work as a single
     reel that was never rendered. If the viewer has pulled selects, it
     screens their cut instead; on /reel/<code> it screens that one.

     The player is spoken to in its own postMessage protocol rather than by
     loading Vimeo's SDK — this site has no dependencies and is not about to
     take one for four messages. Where the protocol is blocked, the transport
     stays visible and the viewer steps the reel by hand. */

  var VIMEO = 'https://player.vimeo.com';
  var run = null, hud = null, projecting = false, patrol = null;

  function mmss(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  // Every clip that can actually play here. Three films live on X and
  // Facebook with no Vimeo copy; a reel that stalled on them would be a
  // broken promise, so they stay in the deck and out of the run.
  function reelClips(order) {
    var all = [].slice.call(document.querySelectorAll('article.tile')).map(function (t) {
      var a = t.querySelector('.tile__link[data-video]');
      if (!a) return null;
      var d = t.querySelector('.tile__dur'), n = t.querySelector('.tile__name');
      var p = (d ? d.textContent.trim() : '0:00').split(':');
      return { link: a, id: a.getAttribute('data-video'),
               title: a.getAttribute('data-title') || (n ? n.textContent.trim() : ''),
               portrait: a.getAttribute('data-portrait') === 'true',
               secs: (+p[0]) * 60 + (+p[1]) };
    });
    if (order && order.length) {
      var picked = order.map(function (i) { return all[i]; }).filter(Boolean);
      if (picked.length) return picked;
    }
    return all.filter(Boolean);
  }

  function buildHud() {
    if (hud) return hud;
    hud = document.createElement('div');
    hud.className = 'lb__hud';
    hud.innerHTML =
      '<div class="lb__track" data-track><span class="lb__head" data-head></span></div>' +
      '<div class="lb__bar">' +
        '<span data-sc></span><span class="screening__sep">·</span>' +
        '<span><b data-at>0:00</b> / <span data-trt></span></span>' +
        '<p class="lb__title" data-title></p>' +
        '<span class="lb__hint">Tap &rsaquo; for the next clip</span>' +
        '<span class="lb__nav">' +
          '<span class="lb__next" data-next></span>' +
          '<button type="button" class="lb__step" data-step="-1" aria-label="Previous clip">&lsaquo;</button>' +
          '<button type="button" class="lb__step" data-step="1" aria-label="Next clip">&rsaquo;</button>' +
        '</span>' +
      '</div>';
    lb.appendChild(hud);
    hud.addEventListener('click', function (e) {
      var b = e.target.closest('.lb__step');
      if (b) { step(run ? run.i + (+b.getAttribute('data-step')) : 0); return; }
      // The track is the sequence, so clicking it cuts to that clip — the
      // same gesture as scrubbing a timeline, quantized to the cut before.
      var t = e.target.closest('.lb__track');
      if (!t || !run) return;
      var r = t.getBoundingClientRect();
      var want = (e.clientX - r.left) / r.width * run.total;
      var i = 0;
      run.offs.forEach(function (o, n) { if (o <= want) i = n; });
      step(i);
    });
    return hud;
  }

  function paintHud(sec) {
    if (!run || !hud || run.i < 0) return;
    var c = run.list[run.i], at = run.offs[run.i] + Math.min(sec || 0, c.secs);
    hud.querySelector('[data-head]').style.width = (at / run.total * 100) + '%';
    hud.querySelector('[data-at]').textContent = mmss(at);
    hud.querySelector('[data-sc]').textContent = (run.i + 1) + ' / ' + run.list.length;
    hud.querySelector('[data-title]').textContent = c.title;
    var nx = run.list[run.i + 1];
    hud.querySelector('[data-next]').textContent = nx ? 'Next · ' + nx.title : 'Last clip';
  }

  function post(msg) {
    var f = frame && frame.querySelector('iframe');
    if (f && f.contentWindow) { try { f.contentWindow.postMessage(JSON.stringify(msg), VIMEO); } catch (e) {} }
  }

  function step(i) {
    if (!run) return;
    if (i >= run.list.length) return finish();
    if (i < 0) i = 0;
    run.i = i; run.seen = 0; run.last = 0; run.lastAt = Date.now(); run.done = false;
    var c = run.list[i];
    lb.classList.add('is-running');
    lb.classList.remove('is-manual');
    var mount = function () {
      projecting = true;
      posterFrom = c.link;          // so the tile's own still paints behind the player
      open(c.id, c.title, c.portrait);
      projecting = false;
      hud.hidden = false;
      lb.appendChild(hud);          // keep it above the freshly mounted frame
      paintHud(0);
    };
    // Between clips, the deck's own cut: one frame of black, like every
    // other jump on this site.
    if (motionOK && lb.classList.contains('is-open')) {
      cutEl.classList.add('is-cutting');
      setTimeout(mount, 42);
      setTimeout(function () { cutEl.classList.remove('is-cutting'); }, 125);
    } else mount();
  }

  function finish() {
    if (!run) return;
    // The end card stays put: the patrol and a late 'ended' must not step
    // past the last clip again and rebuild it (it threw away focus each time).
    run.done = true;
    var total = run.total, n = run.list.length;
    frame.innerHTML = '';
    frame.style.backgroundImage = '';
    var out = document.createElement('div');
    out.className = 'lb__out';
    out.innerHTML =
      '<p class="lb__outslate">' + n + ' films</p>' +
      '<p class="lb__outhead">That was the reel.</p>' +
      '<p class="lb__outsub">I tell stories through visuals.</p>' +
      '<div class="lb__outacts">' +
        '<a class="btn btn--solid" href="/#contact">Send the brief</a>' +
        '<button type="button" class="btn btn--ghost" data-again>Run it again</button>' +
        '<button type="button" class="btn btn--ghost" data-back>Back to the deck</button>' +
      '</div>';
    frame.appendChild(out);
    caption.textContent = '';
    hud.hidden = true;
    out.querySelector('[data-again]').addEventListener('click', function () { step(0); });
    out.querySelector('[data-back]').addEventListener('click', close);
  }

  function endRun() {
    run = null;
    if (patrol) { clearInterval(patrol); patrol = null; }
    if (hud) hud.hidden = true;
    lb.classList.remove('is-running', 'is-manual');
  }

  function startRun(order) {
    if (!lb) return;
    var list = reelClips(order);
    if (list.length < 2) return;
    var offs = [], total = 0;
    list.forEach(function (c) { offs.push(total); total += c.secs; });
    run = { list: list, offs: offs, total: total, i: -1, seen: 0, last: 0, lastAt: Date.now() };
    buildHud();
    hud.querySelector('[data-trt]').textContent = mmss(total);
    var track = hud.querySelector('[data-track]');
    track.innerHTML = '<span class="lb__head" data-head></span>' +
      list.map(function (c, i) {
        return i ? '<span class="lb__tick" style="left:' + (offs[i] / total * 100) + '%"></span>' : '';
      }).join('');
    if (patrol) clearInterval(patrol);
    runFrom = document.activeElement;
    patrol = setInterval(function () {
      if (!run || run.done || !lb.classList.contains('is-open')) return;
      // Nothing from the player at all: the protocol is blocked, so say so
      // rather than guessing when a clip ended.
      if (!run.seen) {
        if (Date.now() - run.lastAt > 4000) lb.classList.add('is-manual');
        return;
      }
      lb.classList.remove('is-manual');
      // Belt and braces for players that report progress but not the end.
      var c = run.list[run.i];
      if (run.last >= c.secs - 1.5 && Date.now() - run.lastAt > 2500) step(run.i + 1);
    }, 1000);

    step(0);
  }

  window.addEventListener('message', function (e) {
    if (!run || e.origin !== VIMEO) return;
    var d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { return; } }
    if (!d || !d.event) return;
    if (d.event === 'ready') {
      ['ended', 'finish', 'timeupdate', 'playProgress'].forEach(function (ev) {
        post({ method: 'addEventListener', value: ev });
      });
      post({ method: 'play' });
      return;
    }
    if (run.done) return;
    if (d.event === 'ended' || d.event === 'finish') { step(run.i + 1); return; }
    var s = d.data && typeof d.data.seconds === 'number' ? d.data.seconds : null;
    if (s === null) return;
    run.seen++; run.last = s; run.lastAt = Date.now();
    paintHud(s);
  });

  document.addEventListener('keydown', function (e) {
    if (!run || !lb.classList.contains('is-open') || busy(e)) return;
    if (e.key === 'ArrowRight' || e.key === 'n') { e.preventDefault(); step(run.i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'p') { e.preventDefault(); step(run.i - 1); }
  });

  // R runs the reel.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'r' || e.metaKey || e.ctrlKey || e.altKey || busy(e)) return;
    if (lb && lb.classList.contains('is-open')) return;
    startRun(null);
  });

  // The end card's "Send the brief" opens the brief (its window listener is
  // registered later, so this one runs first): the player closes under it.
  window.addEventListener('click', function (e) {
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey &&
        e.target.closest && e.target.closest('.lb__out a[href="/#contact"]')) close();
  }, true);

  // The bin lives in another module; it asks for a screening by event.
  document.addEventListener('reel:run', function (e) {
    startRun(e.detail && e.detail.order);
  });

  // Entry points: one on the sequence's own slate, one in the reel page's
  // hero. Injected rather than authored — without JavaScript there is no
  // player to run, so the control should not exist either.
  (function () {
    var list = reelClips(null);
    if (list.length < 2) return;
    var trt = 0;
    list.forEach(function (c) { trt += c.secs; });
    var isCut = document.body.classList.contains('is-reel');
    var label = isCut ? 'Run this cut' : 'Run the reel';

    var grid = document.querySelector('.grid');
    var slate = grid && grid.closest('section') && grid.closest('section').querySelector('.slate');
    if (slate) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'slate__run';
      b.innerHTML = '<span class="slate__runmark" aria-hidden="true"></span>' + label + ' <span aria-hidden="true">→</span>';
      b.addEventListener('click', function () { startRun(null); });
      slate.appendChild(b);
    }
    var cta = document.querySelector('.pagehead--reel .hero__cta');
    if (cta) {
      var h = document.createElement('button');
      h.type = 'button'; h.className = 'btn btn--solid';
      h.textContent = 'Run this cut ▸';
      h.addEventListener('click', function () { startRun(null); });
      cta.insertBefore(h, cta.firstChild);
      var share = cta.querySelector('.reel__share');
      if (share) { share.classList.remove('btn--solid'); share.classList.add('btn--ghost'); }
    }
  })();

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

  /* The hero parallax is gone. It was a faked dolly move — this director
     cuts — and once the mattes went in it broke them: translating the
     footage layer slid the frame's bottom edge out of the gate and painted
     the poster over the black matte. The picture stays in its frame; the
     only motion is the footage's own drift. */

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

    bar.appendChild(track);
    document.body.appendChild(bar);

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
      settleTimer = setTimeout(layout, 150);
    }, { passive: true });

    draw();
    layout();
    // Poster and font arrival can shift offsets after first paint.
    window.addEventListener('load', layout);
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


// ---- Screening clocks ----------------------------------------------------
// The slate is rendered at the edge; this only keeps its two clocks honest.
// Ticks on the minute, in whole frames, like everything else on the deck.
(function () {
  var slate = document.querySelector('.screening');
  if (!slate) return;
  var tz = slate.getAttribute('data-tz');
  function fmt(zone) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
    catch (e) { return null; }
  }
  function tick() {
    document.querySelectorAll('[data-clock]').forEach(function (el) {
      var zone = el.getAttribute('data-clock') === 'local' ? tz : el.getAttribute('data-clock');
      var t = fmt(zone); if (t) el.textContent = t;
    });
  }
  tick();
  setTimeout(function () { tick(); setInterval(tick, 60000); }, (60 - new Date().getSeconds()) * 1000);
})();


// ---- Pull a reel ------------------------------------------------------------
// The viewer marks tiles as selects. The bin at the foot of the screen keeps
// count and TRT, and mints a link that IS the cut: one character per film, in
// the order they chose (the same alphabet the edge uses, keyed to DOM order).
// /reel/<code> renders that cut, with its running time. Nothing about the
// viewer travels with the link; the selection lives in localStorage until
// they clear it.
(function () {
  if (!/^\/(index\.html)?$/.test(location.pathname)) return;
  var tiles = [].slice.call(document.querySelectorAll('article.tile'));
  if (tiles.length < 2) return;
  var ALPHABET = '123456789abcdefghjkmnpqrstuvwxyz';
  var KEY = 'bin', store = null;
  try { store = window.localStorage; } catch (e) {}
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var mmss = function (s) { return Math.floor(s / 60) + ':' + pad(s % 60); };
  var secs = function (t) {
    var d = t.querySelector('.tile__dur'); if (!d) return 0;
    var p = d.textContent.trim().split(':'); return (+p[0]) * 60 + (+p[1]);
  };
  var nameOf = function (t) { var n = t.querySelector('.tile__name'); return n ? n.textContent.trim() : ''; };

  // Selection: an ordered list of keys.
  var sel = [];
  try { sel = (JSON.parse(store && store.getItem(KEY) || '[]') || []).filter(function (k) { return ALPHABET.indexOf(k) > -1 && ALPHABET.indexOf(k) < tiles.length; }); } catch (e) { sel = []; }
  var save = function () { try { sel.length ? store.setItem(KEY, JSON.stringify(sel)) : store.removeItem(KEY); } catch (e) {} };

  // One mark per tile, in the meta row.
  tiles.forEach(function (t, i) {
    var meta = t.querySelector('.tile__meta'); if (!meta) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'tile__mark';
    b.setAttribute('aria-label', 'Add ' + nameOf(t) + ' to your reel');
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var k = ALPHABET[i], at = sel.indexOf(k);
      if (at > -1) sel.splice(at, 1); else sel.push(k);
      save(); render();
    });
    meta.appendChild(b);
  });

  // The bin.
  var bin = document.createElement('div');
  bin.className = 'bin'; bin.setAttribute('role', 'status'); bin.setAttribute('aria-live', 'polite');
  bin.innerHTML = '<span class="bin__word">Bin</span><span class="bin__sep bin__word">·</span>' +
    '<span><b data-n>0</b> selected</span>' +
    '<button type="button" class="bin__clear" aria-label="Clear the bin">Clear</button>' +
    '<span class="bin__break" aria-hidden="true"></span>' +
    '<button type="button" class="btn btn--ghost bin__screen">Screen it</button>' +
    '<button type="button" class="btn btn--solid bin__pull">Pull reel →</button>';
  document.body.appendChild(bin);

  // The sheet.
  var sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Your reel'); sheet.setAttribute('aria-hidden', 'true');
  sheet.innerHTML = '<div class="sheet__card">' +
    '<button type="button" class="sheet__close" aria-label="Close">✕</button>' +
    '<p class="sheet__slate">Reel <b data-code></b> · <b data-n></b> films</p>' +
    '<p class="sheet__title">Your cut, as a link.</p>' +
    '<ol class="sheet__list" data-list></ol>' +
    '<code class="sheet__url" data-url></code>' +
    '<div class="sheet__acts">' +
      '<button type="button" class="btn btn--solid" data-act="share">Send it</button>' +
      '<button type="button" class="btn btn--ghost" data-act="copy">Copy link</button>' +
      '<a class="btn btn--ghost" data-act="open" href="#">Open the reel</a>' +
    '</div>' +
    '<p class="sheet__note">Anyone with the link sees these films, in this order. The link carries the cut and nothing about you.</p>' +
    '</div>';
  document.body.appendChild(sheet);

  function code() { return sel.join(''); }
  function trt() { return sel.reduce(function (s, k) { return s + secs(tiles[ALPHABET.indexOf(k)]); }, 0); }

  function render() {
    tiles.forEach(function (t, i) {
      var at = sel.indexOf(ALPHABET[i]), b = t.querySelector('.tile__mark');
      t.classList.toggle('is-selected', at > -1);
      if (b) {
        b.innerHTML = at > -1 ? 'Selected <b>' + (at + 1) + '</b>' : '+ Select';
        b.setAttribute('aria-pressed', at > -1 ? 'true' : 'false');
      }
    });
    bin.querySelector('[data-n]').textContent = sel.length;
    bin.classList.toggle('is-up', sel.length > 0);
    lift();
    if (!sel.length) closeSheet();
    // An empty bin is invisible (opacity 0), so it leaves the Tab order and
    // the accessibility tree too: Enter on its hidden "Screen it" ran the reel.
    bin.inert = !sel.length;
  }

  // The sheet is aria-modal: while it is up the page behind is inert, and
  // closing it puts focus back where it was ("Pull reel →").
  var sheetFrom = null;
  function sealSheet() {
    var keep = [sheet, document.querySelector('.cut')];
    [].forEach.call(document.body.children, function (el) {
      if (keep.indexOf(el) > -1 || /^(DIALOG|SCRIPT)$/.test(el.tagName) || el.inert) return;
      el.setAttribute('data-sheet-inert', ''); el.inert = true;
    });
  }
  function unsealSheet() {
    [].forEach.call(document.querySelectorAll('[data-sheet-inert]'), function (el) { el.removeAttribute('data-sheet-inert'); el.inert = false; });
  }

  function openSheet() {
    if (!sel.length) return;
    var c = code(), url = location.origin + '/reel/' + c;
    sheet.querySelector('[data-code]').textContent = c.toUpperCase();
    sheet.querySelector('[data-n]').textContent = pad(sel.length);
    sheet.querySelector('[data-url]').textContent = url.replace(/^https?:\/\//, '');
    sheet.querySelector('[data-act="open"]').href = url;
    var list = sheet.querySelector('[data-list]'); list.innerHTML = '';
    sel.forEach(function (k, n) {
      var t = tiles[ALPHABET.indexOf(k)], li = document.createElement('li');
      li.innerHTML = '<span>' + nameOf(t).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }) + '</span><span>' + mmss(secs(t)) + '</span>';
      list.appendChild(li);
    });
    sheet.querySelector('[data-act="share"]').hidden = !navigator.share;
    if (!sheet.classList.contains('is-open')) sheetFrom = document.activeElement;
    sheet.classList.add('is-open'); sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    sealSheet();
    sheet.querySelector('.sheet__close').focus();
  }
  function closeSheet() {
    if (!sheet.classList.contains('is-open')) return;
    sheet.classList.remove('is-open'); sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    unsealSheet();
    var back = sheetFrom; sheetFrom = null;
    // (after Clear the bin is on its way out, so focus is left where it is)
    if (sel.length && back && back !== document.body && back.focus && document.contains(back)) back.focus({ preventScroll: true });
  }

  // The timeline transport already owns the bottom edge. The bin is a tray,
  // so it stacks above it — measured, because the transport's height changes
  // with the viewport and a guessed offset would overlap on some phone.
  var tl = document.querySelector('.tl');
  function lift() {
    var up = tl && tl.classList.contains('is-up');
    bin.style.bottom = up
      ? 'calc(clamp(0.75rem, 2vw, 1.4rem) + env(safe-area-inset-bottom, 0px) + ' +
        Math.round(tl.getBoundingClientRect().height + 10) + 'px)'
      : '';
  }
  if (tl && window.MutationObserver) {
    new MutationObserver(lift).observe(tl, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', lift);
  }

  bin.querySelector('.bin__pull').addEventListener('click', openSheet);
  // Screen the cut before sending it: the projector takes DOM indices.
  bin.querySelector('.bin__screen').addEventListener('click', function () {
    document.dispatchEvent(new CustomEvent('reel:run', {
      detail: { order: sel.map(function (k) { return ALPHABET.indexOf(k); }) } }));
  });
  bin.querySelector('.bin__clear').addEventListener('click', function () { sel = []; save(); render(); });
  sheet.querySelector('.sheet__close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  function flash(btn, text) {
    var was = btn.textContent; btn.textContent = text;
    setTimeout(function () { btn.textContent = was; }, 1500);
  }
  sheet.querySelector('[data-act="copy"]').addEventListener('click', function () {
    var url = location.origin + '/reel/' + code(), b = this;
    var done = function () { flash(b, 'Copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { fallback(); });
    else fallback();
    function fallback() {
      var r = document.createRange(); r.selectNodeContents(sheet.querySelector('[data-url]'));
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      try { document.execCommand('copy'); done(); } catch (e) {}
    }
  });
  sheet.querySelector('[data-act="share"]').addEventListener('click', function () {
    var n = sel.length, url = location.origin + '/reel/' + code();
    var names = sel.map(function (k) { return nameOf(tiles[ALPHABET.indexOf(k)]); });
    navigator.share({ title: n + ' film' + (n > 1 ? 's' : '') + ' by Ahmed El-Nimeri',
      text: 'A ' + mmss(trt()) + ' cut of Ahmed El-Nimeri’s work: ' + names.join(', ') + '.', url: url }).catch(function () {});
  });

  render();
})();


// ---- Share a pulled reel ---------------------------------------------------
// On /reel/<code>: the share button uses the phone's own sheet where there is
// one, and copies the link everywhere else.
(function () {
  var b = document.querySelector('.reel__share'); if (!b) return;
  b.addEventListener('click', function () {
    var url = b.getAttribute('data-url'), title = document.title;
    if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
    var done = function () { var was = b.textContent; b.textContent = 'Link copied'; setTimeout(function () { b.textContent = was; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt('Copy this link', url); });
    else prompt('Copy this link', url);
  });
})();


// ---- The brief, as a sentence to finish ------------------------------------
// Ahmed: "Get in touch" should open a form the visitor builds, "as if filling
// the blanks: Hi, I'm… I want to ask about…". Every contact link on the site
// opens it: #contact, /#contact and the mailto:ahmed@ links (the commission
// cards pre-select their kind of film; a film page names its film). The brief
// is saved to the site's own database (/api/brief); if that fails, the visitor
// gets a link that opens their email app with the same message written out,
// and a copy button covers a machine with no email app. Without JavaScript,
// the links still go to the contact section and the plain address.
(function () {
  if (!window.HTMLDialogElement) return;
  var KINDS = [
    ['brand', 'a brand or campaign film'],
    ['events', 'an event or conference film'],
    ['documentary', 'a documentary'],
    ['post', 'creative direction or post-production', 'post-production'],
    ['other', 'something else']
  ];
  var d = document.createElement('dialog');
  d.className = 'brief';
  d.setAttribute('aria-labelledby', 'brief-title');
  d.innerHTML =
    '<form class="brief__form" novalidate>' +
      '<button class="brief__close" type="button" aria-label="Close">×</button>' +
      '<p class="brief__eyebrow" id="brief-title">Send the brief</p>' +
      '<p class="brief__sentence">' +
        'Hi Ahmed, I’m <input name="name" maxlength="120" placeholder="your name" aria-label="Your name" autocomplete="name" required> ' +
        'from <span class="brief__tie"><input name="org" maxlength="160" placeholder="your company" aria-label="Company or organisation" autocomplete="organization">.</span> ' +
        'I’d like to talk about <select name="kind" aria-label="What it is about">' +
          KINDS.map(function (k) {
            // a phone is too narrow for the long label inside a select; it shows the
            // short one, and the message still carries the full words (data-full)
            var narrow = k[2] && window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
            return '<option value="' + k[0] + '" data-full="' + k[1] + '">' + (narrow ? k[2] : k[1]) + '</option>';
          }).join('') +
        '</select> ' +
        'for <span class="brief__tie"><input name="for" maxlength="300" placeholder="who it’s for" aria-label="Who it is for, or where it will run">.</span> ' +
        'We’re hoping to have it by <span class="brief__tie"><input name="when" maxlength="120" placeholder="a date or a month" aria-label="Timing">.</span> ' +
        'You can reach me at <input name="email" type="email" maxlength="200" placeholder="your email" aria-label="Your email" autocomplete="email"> ' +
        'or <span class="brief__tie"><input name="whatsapp" type="tel" maxlength="40" placeholder="your WhatsApp" aria-label="Your WhatsApp number" autocomplete="tel">.</span>' +
      '</p>' +
      // what happened to it is written here, never over the sentence: the
      // sentence holds the fields, and a retry or a second brief needs them
      '<p class="brief__sentence brief__result" aria-live="polite" hidden></p>' +
      '<input class="brief__trap" type="text" name="_honey" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<p class="brief__error" role="alert" hidden></p>' +
      '<div class="brief__actions">' +
        '<button class="btn btn--solid" type="submit">Send to Ahmed <span aria-hidden="true">↗</span></button>' +
        '<button class="brief__copy" type="button">Copy the message</button>' +
      '</div>' +
      '<p class="brief__note">It comes straight to me. I answer my own email.</p>' +
    '</form>';
  document.body.appendChild(d);

  var f = d.querySelector('form'), err = d.querySelector('.brief__error');
  var field = function (n) { return f.elements[n]; };
  var line = f.querySelector('.brief__sentence'), result = f.querySelector('.brief__result');
  var btn = f.querySelector('button[type=submit]'), copyBtn = f.querySelector('.brief__copy');
  var note = d.querySelector('.brief__note');
  var SEND = btn.innerHTML, COPY = copyBtn.textContent, NOTE = note.textContent;
  // back to the sentence, with what was typed still in it
  var unsend = function () {
    f.classList.remove('is-sent');
    btn.classList.remove('is-done', 'is-busy');
    result.hidden = true; result.textContent = '';
    line.hidden = false;
  };
  var reset = function () {
    unsend();
    btn.innerHTML = SEND; btn.disabled = false;
    copyBtn.hidden = false; copyBtn.textContent = COPY;
    note.textContent = NOTE;
    delete f.dataset.payload; delete f.dataset.mailto; delete f.dataset.delivered;
  };
  var about = '';   // a film named by the page the visitor came from

  // blanks grow with what is typed, so the sentence stays a sentence
  // measured in the sentence's own typeface: Poppins is proportional, so a
  // character count left a gap before every full stop
  var ruler = document.createElement('canvas').getContext('2d');
  var fit = function (el) {
    var cs = getComputedStyle(el);
    ruler.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    var text = el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : (el.value || el.placeholder);
    var pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var icon = el.tagName === 'INPUT' ? 26 : 0;          // Chrome draws its autofill icon inside the field
    el.style.width = Math.ceil(ruler.measureText(text).width + pad + icon + 6) + 'px';
  };
  var fitAll = function () { [].forEach.call(f.querySelectorAll('input, select'), fit); };
  [].forEach.call(f.querySelectorAll('input, select'), function (el) {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { fit(el); err.hidden = true; });
  });

  var kindLabel = function () { var o = field('kind').options[field('kind').selectedIndex]; return o.getAttribute('data-full') || o.text; };
  var reach = function (email, wa) {
    if (email && wa) return 'You can reach me at ' + email + ', or on WhatsApp at ' + wa + '.';
    if (wa) return 'You can reach me on WhatsApp at ' + wa + '.';
    return 'You can reach me at ' + email + '.';
  };
  var message = function () {
    var s = 'Hi Ahmed, I’m ' + field('name').value.trim() +
      (field('org').value.trim() ? ' from ' + field('org').value.trim() : '') + '. ' +
      'I’d like to talk about ' + kindLabel() + (about ? ' (I saw ' + about + ')' : '') +
      (field('for').value.trim() ? ' for ' + field('for').value.trim() : '') + '. ' +
      (field('when').value.trim() ? 'We’re hoping to have it by ' + field('when').value.trim() + '. ' : '') +
      reach(field('email').value.trim(), field('whatsapp').value.trim());
    return s;
  };
  var subject = function () {
    var k = kindLabel().replace(/^(a|an) /, '');
    return k.charAt(0).toUpperCase() + k.slice(1) + ' — ' + field('name').value.trim() +
      (field('org').value.trim() ? ', ' + field('org').value.trim() : '');
  };
  var mailto = function () {
    return 'mailto:ahmed@alnimeri.com?subject=' + encodeURIComponent(subject()) +
      '&body=' + encodeURIComponent(message() + '\n\n—\nSent from alnimeri.com');
  };
  var valid = function () {
    var name = field('name').value.trim(), email = field('email').value.trim(), wa = field('whatsapp').value.trim();
    var say = function (t, el) { err.textContent = t; err.hidden = false; el.focus(); return false; };
    if (!name) return say('Add your name, so Ahmed knows who is writing.', field('name'));
    if (!email && !wa) return say('Add an email or a WhatsApp number Ahmed can reply to.', field('email'));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say('That email address doesn’t look complete.', field('email'));
    if (wa && (wa.replace(/\D/g, '').length < 7)) return say('That WhatsApp number looks too short — include the country code.', field('whatsapp'));
    return true;
  };

  var opener = null;
  var open = function (kind, film) {
    if (d.open) return;
    opener = document.activeElement;
    // a brief whose outcome is known (sent, or not sent): a fresh sentence,
    // the same words in it. One still travelling keeps its "Sent" until it lands.
    if (f.classList.contains('is-sent') && f.dataset.delivered === 'yes') reset();   // a failed one keeps its Try again
    if (kind && field('kind')) field('kind').value = kind;
    about = film || '';
    err.hidden = true;
    d.showModal();
    fitAll();
    document.documentElement.classList.add('has-brief');
    setTimeout(function () { var n = field('name'); if (n && !line.hidden) n.focus(); }, 60);
  };
  var close = function () { d.close(); };
  d.addEventListener('close', function () {
    document.documentElement.classList.remove('has-brief');
    if (opener && opener.focus) opener.focus();
  });
  d.querySelector('.brief__close').addEventListener('click', close);
  d.addEventListener('click', function (e) { if (e.target === d) close(); });   // the backdrop

  // Every brief is saved first to the site's own database (/api/brief), so it
  // never depends on a third party staying up — FormSubmit, the first relay,
  // answered HTTP 500 to everyone. An email notification is a second step: set
  // NOTIFY_KEY to a Web3Forms access key (public by design) to have each brief
  // also emailed to ahmed@alnimeri.com. Only if saving AND emailing both fail
  // is the visitor offered their email app, with the same message ready.
  var ENDPOINT = '/api/brief';
  var NOTIFY_KEY = '';
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (btn.classList.contains('is-busy')) return;
    if (f.classList.contains('is-sent')) {                      // "Try again": the same sentence, sent again
      if (f.dataset.delivered !== 'no') return;
      unsend(); note.textContent = NOTE; copyBtn.textContent = COPY;
    }
    if (!valid()) return;
    if (field('_honey').value) return;                          // only a bot fills the hidden field
    var payload = {
      name: field('name').value.trim(), company: field('org').value.trim(), about: kindLabel(),
      'for': field('for').value.trim(), timing: field('when').value.trim(), email: field('email').value.trim(),
      whatsapp: field('whatsapp').value.trim(),
      film_seen: about, message: message(),
      _subject: subject(), _honey: field('_honey').value
    };
    f.dataset.payload = JSON.stringify(payload);
    var href = mailto(); f.dataset.mailto = href;
    var sent = { first: payload.name.split(' ')[0], email: payload.email, wa: payload.whatsapp };

    // The button reads Sending… and then Sent — the moment the site's own list
    // (/api/brief) confirms it, usually well under a second, and never more
    // than a beat later: keepalive lets the brief finish travelling even if the
    // guest closes the tab. One quick retry; emailed too if NOTIFY_KEY is set.
    // Only if nothing lands does it say so — "that didn't reach me" — with a
    // Try again button and the email app offered instead.
    delete f.dataset.delivered;
    btn.disabled = true; btn.classList.add('is-busy'); btn.textContent = 'Sending…';
    var shown = false;
    var thank = function () {
      if (shown) return; shown = true;
      btn.classList.remove('is-busy'); btn.classList.add('is-done');
      btn.innerHTML = 'Sent <span aria-hidden="true">✓</span>';
      f.classList.add('is-sent');
      result.textContent = 'Thank you, ' + sent.first + '. I’ll reply to ';
      var b = document.createElement('b'); b.textContent = sent.email || ('your WhatsApp, ' + sent.wa); result.appendChild(b);
      result.appendChild(document.createTextNode('.'));
      line.hidden = true; result.hidden = false;
      copyBtn.hidden = true;
      note.textContent = 'I answer my own email, usually the same day.';
    };
    var beat = setTimeout(thank, 1200);

    // Every attempt gives up after 8 s: a stalled connection must end in
    // "that didn't reach me", not in a Sent that never arrived.
    var post = function (url, body, ok) {
      var ctl = window.AbortController ? new AbortController() : null;
      var t = ctl && setTimeout(function () { ctl.abort(); }, 8000);
      return fetch(url, { method: 'POST', keepalive: true, signal: ctl ? ctl.signal : undefined, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { clearTimeout(t); return ok(r, j); }); })
        .catch(function () { clearTimeout(t); return false; });
    };
    var store = function (retry) {
      return post(ENDPOINT, payload, function (r, j) { return !!(r.ok && j.ok); })
        .then(function (done) {
          if (done) { clearTimeout(beat); thank(); }
          return done || !retry ? done : new Promise(function (go) { setTimeout(go, 800); }).then(function () { return store(false); });
        });
    };
    var notify = NOTIFY_KEY ? post('https://api.web3forms.com/submit', { access_key: NOTIFY_KEY, subject: payload._subject, from_name: 'alnimeri.com',
        replyto: payload.email || undefined, name: payload.name, company: payload.company, about: payload.about, 'for': payload['for'],
        timing: payload.timing, email: payload.email, whatsapp: payload.whatsapp, film_seen: payload.film_seen, message: payload.message },
        function (r, j) { return !!j.success; }) : Promise.resolve(false);
    Promise.all([store(true), notify]).then(function (res) {
      if (res[0] || res[1]) { f.dataset.delivered = 'yes'; clearTimeout(beat); thank(); return; }
      clearTimeout(beat); thank();
      f.dataset.delivered = 'no';
      btn.classList.remove('is-done'); btn.textContent = 'Try again'; btn.disabled = false;
      copyBtn.hidden = false;
      result.textContent = 'Sorry, ' + sent.first + ' — that didn’t reach me.';
      note.textContent = 'The connection dropped. ';
      var a = document.createElement('a'); a.href = href; a.textContent = 'Send it from your email app instead';
      note.appendChild(a); note.appendChild(document.createTextNode(' — it’s written out for you.'));
    });
  });
  copyBtn.addEventListener('click', function () {
    // after a send the sentence is put away: copy the message that was sent
    var sentText = null;
    if (f.classList.contains('is-sent') && f.dataset.payload) { try { sentText = JSON.parse(f.dataset.payload).message; } catch (x) {} }
    if (!sentText && !valid()) return;
    var b = this, text = sentText || message();
    var done = function () { b.textContent = 'Copied — paste it into an email to ahmed@alnimeri.com'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (x) {} t.remove(); }
  });

  // every way into contact on the site opens the sentence instead
  var kindFrom = function (s) {
    s = (s || '').toLowerCase();
    if (/brand|campaign/.test(s)) return 'brand';
    if (/event|conference/.test(s)) return 'events';
    if (/documentary|institutional/.test(s)) return 'documentary';
    if (/creative|post/.test(s)) return 'post';
    return '';
  };
  window.addEventListener('click', function (e) {        // window capture runs before the deck's document-level jump
    var a = e.target.closest && e.target.closest('a');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var href = a.getAttribute('href') || '';
    if (href === '#contact' || href === '/#contact') { e.preventDefault(); e.stopPropagation(); open(); return; }
    // only the project links (they carry a subject); a bare address stays an email link
    if (/^mailto:ahmed@alnimeri\.com\?.*subject=/i.test(href)) {
      if (a.classList.contains('contact__mail')) return;       // the plain address stays a plain address
      e.preventDefault(); e.stopPropagation();
      var subj = decodeURIComponent((href.split('subject=')[1] || '').split('&')[0]);
      var film = (subj.match(/Project enquiry — (.+)$/) || [])[1];
      // a film page's button knows its kind of film (data-kind); a subject line only hints at it
      open(a.getAttribute('data-kind') || kindFrom(subj), film && film !== 'alnimeri.com' ? film : '');
    }
  }, true);
})();
