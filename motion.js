/* motion.js — the moments that carry an idea, the way linear.app's hands do.
   Frames assembling into a film. Words resolving from blur. A light that
   follows the eye across the work. Films opening like a letterbox. Depth
   inside each frame. All of it is skipped under reduced motion, and the
   pointer-driven parts only run where there is a real pointer. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  var root = document.documentElement;
  root.classList.add('has-motion');

  /* ---- 1. words resolve one by one ------------------------------------ */
  var name = document.querySelector('.hero__name');
  if (name) {
    var i = 0;
    var wrap = function (node) {
      [].slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) {
          var parts = ch.textContent.split(/(\s+)/), frag = document.createDocumentFragment();
          parts.forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
            var s = document.createElement('span');
            s.className = 'w'; s.textContent = p; s.style.setProperty('--i', i++);
            frag.appendChild(s);
          });
          ch.parentNode.replaceChild(frag, ch);
        } else if (ch.nodeType === 1) { wrap(ch); }
      });
    };
    wrap(name);
    name.classList.add('has-words');
  }

  /* ---- 2. the edit assembles: loose frames drift, swerve around the
          cursor, then converge into the featured film's window ---------- */
  var hero = document.querySelector('.hero--editorial');
  var win = document.querySelector('.hero__feature');
  if (hero && win && fine && innerWidth >= 900 && scrollY < 200) {
    hero.classList.add('has-swarm');
    var layer = document.createElement('div');
    layer.className = 'swarm'; layer.setAttribute('aria-hidden', 'true');
    hero.appendChild(layer);
    var N = 24, frames = [], mouse = { x: -9999, y: -9999 };
    var H = hero.getBoundingClientRect();
    for (var k = 0; k < N; k++) {
      var el = document.createElement('i');
      var w = 54 + Math.random() * 90;
      el.style.width = w + 'px'; el.style.height = (w * 9 / 16) + 'px';
      layer.appendChild(el);
      var side = k % 2 ? 1 : -1;
      frames.push({
        el: el,
        x: H.width / 2 + side * (H.width * (0.28 + Math.random() * 0.34)),
        y: H.height * (0.18 + Math.random() * 0.62),
        vx: 0, vy: 0, r: (Math.random() - 0.5) * 18,
        phase: Math.random() * Math.PI * 2, tx: 0, ty: 0
      });
    }
    hero.addEventListener('pointermove', function (e) {
      var b = hero.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top;
    });
    var t0 = performance.now(), GATHER = 1500, END = 2900;
    var step = function (now) {
      var t = now - t0, b = hero.getBoundingClientRect(), wr = win.getBoundingClientRect();
      frames.forEach(function (f, n) {
      // land on the part of the window you can actually see: its top edge,
      // spread across its width, so the payoff happens on screen
      var cx = wr.left - b.left + wr.width * (0.2 + 0.6 * ((n * 37) % 100) / 100);
      var cy = Math.min(wr.top - b.top + 24, innerHeight - (b.top > 0 ? b.top : 0) - 60);
        if (t < GATHER) {
          // loose drift, a slow wander, and a swerve away from the cursor
          f.vx += Math.cos(f.phase + t / 600) * 0.05; f.vy += Math.sin(f.phase + t / 700) * 0.05;
          var dx = f.x - mouse.x, dy = f.y - mouse.y, d2 = dx * dx + dy * dy;
          if (d2 < 150 * 150) { var d = Math.sqrt(d2) || 1; f.vx += dx / d * 1.1; f.vy += dy / d * 1.1; }
          f.vx *= 0.9; f.vy *= 0.9; f.x += f.vx; f.y += f.vy;
          f.el.style.opacity = Math.min(1, t / 500);
          f.el.style.transform = 'translate(' + f.x + 'px,' + f.y + 'px) rotate(' + f.r + 'deg)';
        } else {
          // converge into the window, shrinking and fading as they land
          var p = Math.min(1, (t - GATHER - n * 12) / (END - GATHER - 300));
          p = p < 0 ? 0 : p; var e = 1 - Math.pow(1 - p, 3);
          var x = f.x + (cx - f.x) * e, y = f.y + (cy - f.y) * e;
          f.el.style.opacity = String(1 - e);
          f.el.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + (f.r * (1 - e)) + 'deg) scale(' + (1 - 0.6 * e) + ')';
        }
      });
      if (t < END + 200) requestAnimationFrame(step); else layer.remove();
    };
    requestAnimationFrame(step);
  }

  /* ---- 3. a light that follows the eye -------------------------------- */
  if (fine) {
    var track = function (container, sel) {
      if (!container) return;
      container.addEventListener('pointermove', function (e) {
        container.querySelectorAll(sel).forEach(function (el) {
          var r = el.getBoundingClientRect();
          el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
          el.style.setProperty('--my', (e.clientY - r.top) + 'px');
        });
      });
    };
    track(document.querySelector('.commission__grid'), '.commission__card, .commission__still');
    track(document.querySelector('#work .grid'), '.tile__link');
  }

  /* ---- 4 & 5. letterbox reveal is CSS; depth needs the scroll ---------- */
  var depthEls = [].slice.call(document.querySelectorAll('#work .tile__img, .commission__still img'));
  if (depthEls.length && 'IntersectionObserver' in window) {
    var live = new Set();
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.isIntersecting ? live.add(e.target) : live.delete(e.target); });
    }, { rootMargin: '10% 0px' });
    depthEls.forEach(function (el) { io.observe(el); });
    var ticking = false;
    var paint = function () {
      ticking = false;
      var vh = innerHeight;
      live.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var p = ((r.top + r.height / 2) - vh / 2) / vh;          // -1 .. 1 across the screen
        el.style.setProperty('--py', (p * -22).toFixed(1) + 'px');
      });
    };
    addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
    paint();
  }
})();
