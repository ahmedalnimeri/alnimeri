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
    if (run && !projecting) endRun();
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

  /* ---- 1-bit -----------------------------------------------------------
     A dither engine, about forty lines. Everything drawn through it is
     thresholded against an 8x8 Bayer matrix, so greys become patterns and
     the whole picture collapses to black and white — the look of a picture
     that has been through a machine, which is what this deck claims to be.
     Drawn small (192x108) and scaled up with smoothing off, so the pixels
     stay square and honest at any size. No assets, no library. */

  var BAYER = [
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
  ];
  function thresholdAt(x, y) { return (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64; }

  function bitmap(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h; cv.className = 'bmp'; cv.setAttribute('aria-hidden', 'true');
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    return {
      el: cv, ctx: ctx, w: w, h: h,
      // Collapse whatever has been drawn to one bit per pixel.
      // erase (0..1) knocks pixels out by the same matrix, so the picture
      // can break up and let whatever is behind it through.
      dither: function (erase) {
        var img = ctx.getImageData(0, 0, w, h), d = img.data, x, y, i, l, t;
        for (y = 0; y < h; y++) {
          for (x = 0; x < w; x++) {
            i = (y * w + x) * 4;
            t = thresholdAt(x, y);
            l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
            l = l > t ? 255 : 0;
            d[i] = d[i + 1] = d[i + 2] = l;
            d[i + 3] = (erase && t < erase) ? 0 : 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      },
      // A dissolve to black that is itself dithered: pixels tip over one
      // matrix step at a time, so the picture breaks up rather than fades.
      veil: function (density) {
        var img = ctx.createImageData(w, h), d = img.data, x, y, i, on;
        for (y = 0; y < h; y++) {
          for (x = 0; x < w; x++) {
            i = (y * w + x) * 4;
            on = thresholdAt(x, y) < density;
            d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = on ? 255 : 0;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
    };
  }

  /* ---- the leader ------------------------------------------------------
     Before the reel runs, the thing that runs before every reel: an Academy
     countdown, drawn at 192x108 and dithered to one bit. Sweep hand, circle,
     crosshair, numeral, and the sequence's own slate along the bottom. Three
     counts at eighteen frames each — long enough to read as a leader, short
     enough that nobody waits for their film. */

  function leader(sub, done) {
    var bmp = bitmap(192, 108), c = bmp.ctx, W = 192, H = 108;
    var cx = W / 2, cy = H / 2, R = 34;
    frame.innerHTML = '';
    frame.style.backgroundImage = '';
    frame.appendChild(bmp.el);

    var COUNTS = ['3', '2', '1'], PER = 18, total = COUNTS.length * PER + 2, f = 0;

    function draw() {
      var n = Math.min(COUNTS.length - 1, Math.floor(f / PER));
      var t = (f % PER) / PER;                       // 0..1 within this count
      var weave = (f % 6 === 0) ? 1 : 0;             // gate weave, one pixel

      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      c.save();
      c.translate(0, weave);

      // The swept wedge: mid grey, so the dither turns it into a 50% screen.
      c.fillStyle = '#8a8a8a';
      c.beginPath(); c.moveTo(cx, cy);
      c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
      c.closePath(); c.fill();

      // Crosshair to the edges of the frame, and the circle.
      c.strokeStyle = '#b4b4b4'; c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cx + 0.5, 0); c.lineTo(cx + 0.5, H);
      c.moveTo(0, cy + 0.5); c.lineTo(W, cy + 0.5);
      c.stroke();
      c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(cx, cy, R - 6, 0, Math.PI * 2); c.stroke();

      // Registration ticks at the quarters.
      c.fillStyle = '#fff';
      [[cx, 6], [cx, H - 7], [6, cy], [W - 7, cy]].forEach(function (p) {
        c.fillRect(p[0] - 3, p[1] - 1, 6, 2);
      });

      // The numeral, punched out of the wedge.
      c.fillStyle = '#fff';
      c.font = 'bold 46px ui-monospace, Menlo, monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(COUNTS[n], cx, cy + 2);

      // Slate type stays pure white: anything grey would be thresholded into
      // a pattern and the glyphs would dissolve with it. The rings and the
      // wedge are the greys — they are meant to break up.
      c.font = 'bold 8px ui-monospace, Menlo, monospace';
      c.fillStyle = '#fff';
      c.textAlign = 'left';   c.fillText('ALNIMERI', 6, 10);
      c.textAlign = 'right';  c.fillText('24 FPS', W - 6, 10);
      c.textAlign = 'center'; c.fillText(sub, cx, H - 7);

      c.restore();
      bmp.dither();

      f++;
      if (f >= total) { done(); return; }
      setTimeout(draw, FRAME);
    }
    draw();
  }

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
    hud.querySelector('[data-sc]').textContent = 'SC ' + (run.i + 1 < 10 ? '0' : '') + (run.i + 1) + '/' + run.list.length;
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
    run.i = i; run.seen = 0; run.last = 0; run.lastAt = Date.now();
    var c = run.list[i];
    lb.classList.add('is-running');
    lb.classList.remove('is-manual');
    var mount = function () {
      projecting = true;
      opener = c.link;              // so the tile's own still paints behind the player
      open(c.id, c.title, c.portrait);
      projecting = false;
      hud.hidden = false;
      lb.appendChild(hud);          // keep it above the freshly mounted frame
      paintHud(0);
    };
    // Between clips the picture breaks up rather than cutting: the dither
    // veil tips pixel by pixel to black, the next clip is mounted behind it,
    // and it tips back. Eight frames each way, on the same 24fps grid.
    if (motionOK && lb.classList.contains('is-open')) {
      dissolve(mount);
    } else mount();
  }

  // A dithered dissolve across the source monitor. The canvas is re-attached
  // after the mount, because mounting replaces the frame's contents.
  function dissolve(mid) {
    var veil = bitmap(160, 90);
    veil.el.className = 'bmp bmp--veil';
    frame.appendChild(veil.el);
    var STEPS = 8, f = 0;
    (function tip() {
      f++;
      veil.veil(f / STEPS);
      if (f < STEPS) { setTimeout(tip, FRAME); return; }
      mid();
      frame.appendChild(veil.el);
      (function clear() {
        f--;
        veil.veil(f / STEPS);
        if (f > 0) { setTimeout(clear, FRAME); return; }
        if (veil.el.parentNode) veil.el.parentNode.removeChild(veil.el);
      })();
    })();
  }

  function finish() {
    if (!run) return;
    var total = run.total, n = run.list.length;
    frame.innerHTML = '';
    frame.style.backgroundImage = '';
    var out = document.createElement('div');
    out.className = 'lb__out';
    out.innerHTML =
      '<p class="lb__outslate">OUT &middot; ' + n + ' CLIPS &middot; TRT ' + mmss(total) + ' &middot; 24 FPS</p>' +
      '<p class="lb__outhead">That was the reel.</p>' +
      '<p class="lb__outsub">Some of it was a brief. Some of it was my country.</p>' +
      '<div class="lb__outacts">' +
        '<a class="btn btn--solid" href="mailto:ahmed@alnimeri.com">Send the brief</a>' +
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
    patrol = setInterval(function () {
      if (!run || !lb.classList.contains('is-open')) return;
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

    // Roll the leader, then the first clip. Reduced motion gets the picture
    // straight away — a countdown is motion for its own sake.
    if (!motionOK) { step(0); return; }
    lb.classList.add('is-open', 'is-visible', 'is-running');
    lb.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    caption.textContent = '';
    hud.hidden = false;
    lb.appendChild(hud);
    paintHud(0);
    var label = (document.body.classList.contains('is-reel') ? 'PULLED CUT' : 'SELECTS') +
                ' · ' + list.length + ' CLIPS · TRT ' + mmss(total);
    leader(label, function () { step(0); });
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
    if (d.event === 'ended' || d.event === 'finish') { step(run.i + 1); return; }
    var s = d.data && typeof d.data.seconds === 'number' ? d.data.seconds : null;
    if (s === null) return;
    run.seen++; run.last = s; run.lastAt = Date.now();
    paintHud(s);
  });

  document.addEventListener('keydown', function (e) {
    if (!run || !lb.classList.contains('is-open')) return;
    if (e.key === 'ArrowRight' || e.key === 'n') { e.preventDefault(); step(run.i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'p') { e.preventDefault(); step(run.i - 1); }
  });

  // R runs the reel, the way E exports it.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'r' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (lb && lb.classList.contains('is-open')) return;
    startRun(null);
  });

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
    var label = (isCut ? 'Run this cut' : 'Run the reel') + ' · ' + list.length + ' clips · ' + mmss(trt);

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

  /* Hero loop — deferred so it never competes with first paint. */
  var heroBg = document.querySelector('[data-bg-video]');
  if (heroBg && motionOK && dataOK) {
    var startHero = function () { mountLoop(heroBg, heroBg.dataset.bgVideo); };
    if ('requestIdleCallback' in window) requestIdleCallback(startHero, { timeout: 2500 });
    else setTimeout(startHero, 1200);
  }

  /* ---- boot ------------------------------------------------------------
     The first thing on the screen. The hero opens as a 1-bit machine
     picture — carrier noise resolving into a horizon grid with a reticle
     over it — and then breaks up, pixel by pixel along the same dither
     matrix, to reveal the footage underneath. Drawn at 256 across and
     scaled up with smoothing off, so it is genuinely a bitmap and not a
     photograph of one.

     It runs once per browsing session, skips on the first touch of the
     screen, and holds a single still frame instead of moving for anyone
     who asked for reduced motion. Everything it prints is either fixed
     fact or read off the page — the sequence line comes from the Selects
     slate, so it can never drift from what the deck actually holds. */

  (function () {
    var hero = document.querySelector('.hero');
    if (!hero || !window.requestAnimationFrame) return;

    var force = /(^|[?&#])boot\b/.test(location.search + location.hash);
    try {
      if (!force && sessionStorage.getItem('boot') === '1') return;
      sessionStorage.setItem('boot', '1');
    } catch (e) {}

    var gate = hero.querySelector('.hero__bg') || hero;
    var r = gate.getBoundingClientRect();
    if (!r.width || !r.height) return;

    var W = 256, H = Math.max(72, Math.min(420, Math.round(W * r.height / r.width)));
    var bmp = bitmap(W, H), c = bmp.ctx;
    bmp.el.className = 'hero__boot';
    var grain = hero.querySelector('.hero__grain');
    if (grain && grain.parentNode === hero) hero.insertBefore(bmp.el, grain.nextSibling);
    else hero.insertBefore(bmp.el, hero.firstChild);

    // What the deck is actually holding, read off its own slate.
    var meta = document.querySelector('#work .slate__meta');
    var seq = meta ? meta.textContent.replace(/^\s*\d+\s*[^\w]+\s*/, '').trim().toUpperCase() : '';

    var cx = W / 2, hy = Math.round(H * 0.78);
    var ry = Math.round(H * 0.44);              // the bloom sits here
    var SEEDS = 340, GOLD = Math.PI * (3 - Math.sqrt(5));   // 137.5°, the angle plants use

    function scene(f) {
      var t = f / 24, i;
      c.globalAlpha = 1;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);

      // Carrier noise, thinning as the picture locks up.
      var snow = Math.max(0, 1 - f / 15);
      if (snow > 0) {
        c.fillStyle = '#fff';
        var n = Math.round(snow * W * H * 0.05);
        for (i = 0; i < n; i++) c.fillRect((Math.random() * W) | 0, (Math.random() * H) | 0, 1, 1);
      }

      c.lineWidth = 1;

      // A ground plane, kept faint: the bloom is the subject, this is only
      // the floor it stands on.
      var grid = Math.min(1, Math.max(0, (f - 6) / 20));
      if (grid > 0) {
        c.strokeStyle = '#6e6e6e';
        var M = 10, k, u, y;
        for (k = 0; k < M; k++) {
          u = ((k + t * 1.4) % M) / M;
          y = hy + (H - hy) * u * u;
          c.globalAlpha = Math.min(1, u * 3) * grid * 0.3;
          c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke();
        }
        var K = 7;
        for (k = -K; k <= K; k++) {
          if (Math.abs(k) > K * grid) continue;
          c.globalAlpha = grid * 0.3;
          c.beginPath(); c.moveTo(cx + k * (W * 0.3), H); c.lineTo(cx + k * 1.1, hy); c.stroke();
        }
        c.globalAlpha = 1;
      }

      // The instrument: rings and a tick collar, irising open around the
      // thing it is about to watch.
      var ret = Math.min(1, Math.max(0, (f - 4) / 14));
      var R = Math.min(W, H) * 0.34;
      if (ret > 0) {
        var RR = R * 1.18 * ret, a, ang;
        c.strokeStyle = '#c8c8c8'; c.globalAlpha = 0.9;
        c.beginPath(); c.arc(cx, ry, RR, 0, Math.PI * 2); c.stroke();
        for (a = 0; a < 24; a++) {
          ang = a / 24 * Math.PI * 2 - t * 0.35;
          c.beginPath();
          c.moveTo(cx + Math.cos(ang) * RR * 1.06, ry + Math.sin(ang) * RR * 1.06);
          c.lineTo(cx + Math.cos(ang) * RR * (a % 6 === 0 ? 1.18 : 1.12), ry + Math.sin(ang) * RR * (a % 6 === 0 ? 1.18 : 1.12));
          c.stroke();
        }
        c.globalAlpha = 1;
      }

      // The bloom. Seeds are laid down on the golden angle — the packing a
      // sunflower head uses — so the form grows outward as a spiral and
      // arrives as a flower rather than a circle of dots. Each seed eases
      // out from the centre as it is laid, and the whole head turns.
      var grow = (f - 7) / 40;
      if (grow > 0) {
        var shown = Math.min(SEEDS, grow * SEEDS * 1.15);
        var blow = Math.max(0, (f - (TOTAL - OUT)) / OUT);   // the dispersal
        for (i = 0; i < shown; i++) {
          var age = Math.min(1, (shown - i) / 30);
          age = 1 - (1 - age) * (1 - age);                   // ease out
          var ang2 = i * GOLD + t * 0.3;
          var rad = R * Math.sqrt(i / SEEDS) * age + blow * blow * 90;
          var x = cx + Math.cos(ang2) * rad;
          var y2 = ry + Math.sin(ang2) * rad;
          // Outer seeds carry more light, so the head reads as a bloom and
          // the dither opens up toward the rim.
          var lum = (0.35 + 0.65 * (i / SEEDS)) * age * (1 - blow * 0.65);
          var g = Math.round(255 * Math.max(0, Math.min(1, lum)));
          c.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
          var sz = i > SEEDS * 0.55 ? 2 : 1;
          c.fillRect(Math.round(x), Math.round(y2), sz, sz);
        }
        // The stem, drawn once the head has something to hold up.
        if (grow > 0.35) {
          c.strokeStyle = '#8c8c8c';
          c.globalAlpha = Math.min(1, (grow - 0.35) * 3) * (1 - blow);
          c.beginPath();
          c.moveTo(cx + 0.5, ry + R * 0.55);
          c.quadraticCurveTo(cx + 4, (ry + hy) / 2, cx + 0.5, hy);
          c.stroke();
          c.globalAlpha = 1;
        }
      }

      // Hold the middle band back, so the headline keeps its contrast over
      // the pattern rather than fighting it.
      var band = c.createLinearGradient(0, H * 0.16, 0, H * 0.86);
      band.addColorStop(0, 'rgba(0,0,0,0)');
      band.addColorStop(0.45, 'rgba(0,0,0,0.34)');
      band.addColorStop(0.75, 'rgba(0,0,0,0.3)');
      band.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = band; c.fillRect(0, H * 0.16, W, H * 0.7);

      // One bright line sweeping the gate.
      var sy = ((t * 0.5) % 1) * H;
      var sweep = c.createLinearGradient(0, sy - 9, 0, sy + 9);
      sweep.addColorStop(0, 'rgba(255,255,255,0)');
      sweep.addColorStop(0.5, 'rgba(255,255,255,0.26)');
      sweep.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = sweep; c.fillRect(0, sy - 9, W, 18);

      // Readouts. White, always — grey type dithers into a pattern and the
      // letters go with it.
      c.font = 'bold 8px ui-monospace, Menlo, monospace';
      c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
      if (f > 16) { c.textAlign = 'left';  c.fillText('ALNIMERI', 6, 12); }
      if (f > 20) { c.textAlign = 'right'; c.fillText('24 FPS', W - 6, 12); }
      if (f > 26) { c.textAlign = 'left';  c.fillText('DUBAI 25.2N 55.3E', 6, H - 6); }
      if (f > 30 && seq) { c.textAlign = 'right'; c.fillText(seq, W - 6, H - 6); }
    }

    var TOTAL = 78, OUT = 20, f = 0, running = true;

    // The words are held back while the bloom has the frame, and cut in as
    // it disperses — a title sequence, not a curtain. Belt and braces: the
    // hold is released by done(), by the dispersal, and by a timer, so no
    // single failure can leave the hero blank.
    hero.classList.add('is-booting');
    function words() { hero.classList.remove('is-booting'); }
    setTimeout(words, 6000);

    function done() {
      running = false;
      words();
      offSkip();
      if (bmp.el.parentNode) bmp.el.parentNode.removeChild(bmp.el);
    }

    function skip() {
      if (!running) return;
      if (f < TOTAL - OUT) f = TOTAL - OUT;   // cut straight to the break-up
    }
    function offSkip() {
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
        window.removeEventListener(ev, skip);
      });
    }
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, skip, { passive: true });
    });

    // Reduced motion: one still frame of the same picture, held, then cut.
    if (!motionOK) {
      scene(58);
      bmp.dither(0);
      setTimeout(done, 900);
      return;
    }

    (function tick() {
      if (!running) return;
      scene(f);
      bmp.dither(f > TOTAL - OUT ? (f - (TOTAL - OUT)) / OUT : 0);
      if (f === TOTAL - OUT) words();
      f++;
      if (f > TOTAL) { done(); return; }
      setTimeout(tick, FRAME);
    })();
  })();

  /* ---- the deck reads every frame --------------------------------------
     Every still on the site is shown twice: once as the machine reads it —
     one bit per pixel, thresholded through the same Bayer matrix as the
     leader — and once as the photograph, when you engage with it. The
     dithered plate sits on a canvas over the real <img>, so the photograph
     is always the thing that loaded, the thing a crawler sees and the thing
     that prints. The pattern is only ever paint on top of it.

     Resolving is a cut, not a fade: hover on a pointer device, and on a
     phone the frame nearest the middle of the screen — the one you are
     actually looking at — locks in as you scroll. */

  (function () {
    var shots = [].slice.call(document.querySelectorAll(
      '.tile__img, .pagehead__plate img, .film__frame > img'));
    if (!shots.length) return;

    var coarse = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    function plate(img) {
      var host = img.parentNode;
      if (!host || img.dataset.read) return;
      var w = 300, nw = img.naturalWidth || 16, nh = img.naturalHeight || 9;
      var h = Math.max(40, Math.round(w * nh / nw));
      var bmp = bitmap(w, h);
      bmp.el.className = 'read';
      try {
        bmp.ctx.drawImage(img, 0, 0, w, h);
        // Push the contrast before thresholding. A straight threshold of a
        // graded film still collapses to two blobs; steepening it first is
        // what keeps a face readable at one bit.
        // drawImage samples the file, not the styled element — the CSS
        // filter on a plate (brightness .72) never reaches the canvas, so a
        // bright sky came through blown out and the dot field buried the
        // headline. Carry the same gain here, and take it further for a
        // plate, which has to sit under type.
        var isPlate = host.classList.contains('pagehead__plate');
        var gain = isPlate ? 0.45 : 1, bias = isPlate ? -12 : 10;
        var d = bmp.ctx.getImageData(0, 0, w, h), p = d.data, i, v;
        for (i = 0; i < p.length; i += 4) {
          v = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) * gain;
          v = Math.max(0, Math.min(255, (v - 128) * 1.45 + 128 + bias));
          p[i] = p[i + 1] = p[i + 2] = v;
        }
        bmp.ctx.putImageData(d, 0, 0);
        bmp.dither(0);
      } catch (e) { return; }   // a cross-origin still simply stays a still
      img.dataset.read = '1';
      host.insertBefore(bmp.el, img.nextSibling);
      host.classList.add('has-read');
    }

    // Only pay for a frame once it is worth looking at.
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          var img = e.target;
          if (img.complete && img.naturalWidth) plate(img);
          else img.addEventListener('load', function () { plate(img); }, { once: true });
        });
      }, { rootMargin: '300px' });
      shots.forEach(function (img) { io.observe(img); });
    } else {
      shots.forEach(function (img) { if (img.complete) plate(img); });
    }

    // On a phone there is no hover, so the deck locks onto whatever is in
    // the middle of the screen and lets that one frame resolve.
    if (coarse) {
      var tiles = [].slice.call(document.querySelectorAll('article.tile, .pagehead__plate')), pending = false;
      if (tiles.length) {
        var lock = function () {
          pending = false;
          var mid = window.innerHeight / 2, best = null, bestD = 1e9;
          tiles.forEach(function (t) {
            var b = t.getBoundingClientRect();
            if (b.bottom < 0 || b.top > window.innerHeight) { t.classList.remove('is-locked'); return; }
            var d = Math.abs(b.top + b.height / 2 - mid);
            if (d < bestD) { bestD = d; best = t; }
          });
          tiles.forEach(function (t) { if (t !== best) t.classList.remove('is-locked'); });
          if (best && bestD < window.innerHeight * 0.34) best.classList.add('is-locked');
        };
        window.addEventListener('scroll', function () {
          if (pending) return; pending = true;
          (window.requestAnimationFrame || setTimeout)(lock);
        }, { passive: true });
        lock();
      }
    }
  })();

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

  /* E exports the sequence — the same muscle memory as an edit bay. The
     colophon carries the visible link; this is for the hands that know. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'e' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (lb && lb.classList.contains('is-open')) return;
    cutEl.classList.add('is-cutting');
    setTimeout(function () { location.href = document.documentElement.getAttribute('data-edl') || '/selects.edl'; }, 42);
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
    var lastP = 0;
    function draw() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      lastP = p;

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

    /* A hidden tab is a parked deck: the title becomes the timecode where
       the playhead stopped, from the same stamp() as the HUD. A recruiter
       triaging twelve candidate tabs sees eleven names and one timecode.
       Never stamped on tabs that were opened in the background and never
       engaged — same threshold the HUD uses to wake. */
    var baseTitle = document.title;
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { document.title = baseTitle; return; }
      if (window.scrollY <= window.innerHeight * 0.35) return;
      document.title = 'PARKED ' + stamp(lastP) + ' \u2014 Ahmed El-Nimeri';
    });
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


// ---- The reel remembers where you stopped ---------------------------------
// Phones are where a viewer leaves mid-sequence. Keep the clip they were on —
// on this device only, in localStorage, nothing sent anywhere — and offer to
// cut back to it next time: RESUME · SC 07 · SOLANA SOLSTICE →. Watching to
// OUT clears it. The link is a plain #anchor so the deck's own hard-cut
// handler does the jump, one frame of black and all.
(function () {
  if (!/^\/(index\.html)?$/.test(location.pathname)) return; // the home sequence only
  var tiles = [].slice.call(document.querySelectorAll('article.tile'));
  if (!tiles.length) return;
  var KEY = 'reel', store;
  try { store = window.localStorage; } catch (e) { return; }
  if (!store) return;

  tiles.forEach(function (t, n) { if (!t.id) t.id = 'sc-' + (n < 9 ? '0' : '') + (n + 1); });
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  // Offer the resume, before the viewer has moved.
  var saved = null;
  try { saved = JSON.parse(store.getItem(KEY) || 'null'); } catch (e) {}
  if (saved && saved.sc > 1 && document.getElementById(saved.id)) {
    var host = document.querySelector('.screening') || document.querySelector('.hero__eyebrow');
    if (host) {
      var p = document.createElement('p');
      p.className = 'resume';
      p.innerHTML = '<span>Resume</span><span class="screening__sep">\u00b7</span>' +
        '<a href="#' + saved.id + '">SC ' + pad(saved.sc) + ' \u00b7 ' + saved.name + ' \u2192</a>';
      host.insertAdjacentElement('afterend', p);
      // A tile's offsetTop is relative to its section, so the deck's generic
      // #anchor cut would land on the section. Cut to the tile's true position
      // with the same one-frame overlay.
      p.querySelector('a').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation(); // the deck's generic #anchor cut would fire too, and land on the section
        var t = document.getElementById(saved.id), cut = document.querySelector('.cut');
        var mast = document.querySelector('.masthead');
        var pad = mast ? mast.getBoundingClientRect().height + 24 : 24;
        var y = Math.max(0, t.getBoundingClientRect().top + window.scrollY - pad);
        if (!cut) { window.scrollTo(0, y); return; }
        cut.classList.add('is-cutting');
        setTimeout(function () { window.scrollTo(0, y); }, 42);
        setTimeout(function () { cut.classList.remove('is-cutting'); }, 125);
      });
    }
  }

  // Remember the clip under the masthead as the viewer scrolls.
  var pending = false, lastId = null;
  function remember() {
    pending = false;
    var probe = window.scrollY + 120;
    var atOut = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    if (atOut) { try { store.removeItem(KEY); } catch (e) {} lastId = null; return; }
    var live = null, n = 0;
    tiles.forEach(function (t, i) { if (t.offsetTop <= probe) { live = t; n = i; } });
    if (!live || live.id === lastId) return;
    lastId = live.id;
    var name = live.querySelector('.tile__name');
    try {
      store.setItem(KEY, JSON.stringify({ id: live.id, sc: n + 1,
        name: name ? name.textContent.trim() : live.id, at: Date.now() }));
    } catch (e) {}
  }
  window.addEventListener('scroll', function () {
    if (pending) return; pending = true;
    (window.requestAnimationFrame || setTimeout)(remember);
  }, { passive: true });
})();


// ---- Pull a reel ------------------------------------------------------------
// The viewer marks tiles as selects. The bin at the foot of the screen keeps
// count and TRT, and mints a link that IS the cut: one character per film, in
// the order they chose (the same alphabet the edge uses, keyed to DOM order).
// /reel/<code> renders that cut with its own stamps and EDL. Nothing about the
// viewer travels with the link; the selection lives in localStorage until
// they clear it or reach OUT with a reel already sent.
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
    '<span><b data-n>0</b> selects</span><span class="bin__sep">·</span><span>TRT <b data-trt>0:00</b></span>' +
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
    '<p class="sheet__slate">Reel <b data-code></b> · <b data-n></b> clips · TRT <b data-trt></b></p>' +
    '<p class="sheet__title">Your cut, as a link.</p>' +
    '<ol class="sheet__list" data-list></ol>' +
    '<code class="sheet__url" data-url></code>' +
    '<div class="sheet__acts">' +
      '<button type="button" class="btn btn--solid" data-act="share">Send it</button>' +
      '<button type="button" class="btn btn--ghost" data-act="copy">Copy link</button>' +
      '<a class="btn btn--ghost" data-act="open" href="#">Open the reel</a>' +
      '<a class="btn btn--ghost" data-act="edl" href="#">EDL ↓</a>' +
    '</div>' +
    '<p class="sheet__note">Anyone with the link sees these films, in this order, with the stamps recomputed. The link carries the cut and nothing about you.</p>' +
    '</div>';
  document.body.appendChild(sheet);

  function code() { return sel.join(''); }
  function trt() { return sel.reduce(function (s, k) { return s + secs(tiles[ALPHABET.indexOf(k)]); }, 0); }

  function render() {
    tiles.forEach(function (t, i) {
      var at = sel.indexOf(ALPHABET[i]), b = t.querySelector('.tile__mark');
      t.classList.toggle('is-selected', at > -1);
      if (b) {
        b.innerHTML = at > -1 ? 'SEL <b>' + pad(at + 1) + '</b>' : '+ Select';
        b.setAttribute('aria-pressed', at > -1 ? 'true' : 'false');
      }
    });
    bin.querySelector('[data-n]').textContent = sel.length;
    bin.querySelector('[data-trt]').textContent = mmss(trt());
    bin.classList.toggle('is-up', sel.length > 0);
    lift();
    if (!sel.length) closeSheet();
  }

  function openSheet() {
    if (!sel.length) return;
    var c = code(), url = location.origin + '/reel/' + c;
    sheet.querySelector('[data-code]').textContent = c.toUpperCase();
    sheet.querySelector('[data-n]').textContent = pad(sel.length);
    sheet.querySelector('[data-trt]').textContent = mmss(trt());
    sheet.querySelector('[data-url]').textContent = url.replace(/^https?:\/\//, '');
    sheet.querySelector('[data-act="open"]').href = url;
    sheet.querySelector('[data-act="edl"]').href = url + '.edl';
    var list = sheet.querySelector('[data-list]'); list.innerHTML = '';
    sel.forEach(function (k, n) {
      var t = tiles[ALPHABET.indexOf(k)], li = document.createElement('li');
      li.innerHTML = '<span>SC ' + pad(n + 1) + '</span><span>' + nameOf(t).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }) + '</span><span>' + mmss(secs(t)) + '</span>';
      list.appendChild(li);
    });
    sheet.querySelector('[data-act="share"]').hidden = !navigator.share;
    sheet.classList.add('is-open'); sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    sheet.querySelector('.sheet__close').focus();
  }
  function closeSheet() {
    if (!sheet.classList.contains('is-open')) return;
    sheet.classList.remove('is-open'); sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
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
