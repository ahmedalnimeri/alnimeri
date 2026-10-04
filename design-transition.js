/* alnimeri.com — the still becomes the player.

   Changing pages runs through cross-document view transitions (styles.css,
   "page-to-page"). The page itself only cross-fades; the still that was
   clicked is lifted out of it and carried, as one picture, to where the film
   page's player stands, and the room light comes up once it has landed
   (design-filmpages.css, .vt-film). Leaving a film page, its player is carried
   back into the still it came from: the one last clicked, else the first one
   in view.

   Only one element ever carries the name 'film' (a second one would abort
   the transition: Solana Accelerate is on the front page four times), and
   the name comes off again as soon as the transition is over.

   pagereveal fires before the first frame, before any deferred script has
   run, so this is inlined into the <head> of the pages that take part
   (bin-stamp-assets.py: the front page and About; bin-build-work-pages.py:
   /work/ and every film page). Browsers without cross-document view
   transitions, and reduced motion (@view-transition: none), navigate as
   they always did. */
(function () {
  if (!('onpagereveal' in window) || !window.CSS || !CSS.supports('view-transition-name: a')) return;
  var d = document, root = d.documentElement, on = null, picked = null;
  var keep = function (k, v) {
    try { if (v == null) sessionStorage.removeItem('vt:' + k); else sessionStorage.setItem('vt:' + k, JSON.stringify(v)); } catch (e) {}
  };
  var kept = function (k) { try { return JSON.parse(sessionStorage.getItem('vt:' + k)); } catch (e) { return null; } };
  var path = function (u) { try { return new URL(u, location.href).pathname.replace(/(.)\/$/, '$1'); } catch (e) { return ''; } };
  var name = function (el) {
    if (on) on.style.viewTransitionName = '';
    on = el || null;
    if (on) on.style.viewTransitionName = 'film';
  };
  // the picture a link to a film page stands for: a tile's poster (its name
  // links to the page), a composition's still, the hero's shot on screen, a
  // card on a wall, a pin on About, a frame in the ending's roll
  var still = function (a) {
    var t = a.closest('.tile');
    if (t) return t.querySelector('.tile__link');
    if (a.matches('.twoshot__label')) a = d.querySelector('.twoshot__shot.is-on') || a;
    if (a.matches('.twoshot__shot')) return a.classList.contains('is-on') ? a : null;
    if (a.matches('.cmp__still')) return a;
    return a.querySelector('.fp-card__still, .pin__media, .ending__pic');
  };
  var stills = function (href) {
    var out = [];
    [].forEach.call(d.querySelectorAll('a[href="' + href + '"]'), function (a) {
      var s = still(a);
      if (s && out.indexOf(s) < 0 && s.getClientRects().length) out.push(s);
    });
    return out;
  };
  // on screen: at least two fifths of it in view
  var seen = function (el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) >= r.height * 0.4;
  };
  // the box (its own size, before any transform: the moving frame starts
  // from that), and where the film's picture lies under it, in the same
  // units: the poster's whole rectangle as the box crops it (object-fit:
  // cover, its object-position, any push-in on the image)
  var geo = function (el) {
    var r = el.getBoundingClientRect(), w0 = el.offsetWidth || r.width, h0 = el.offsetHeight || r.height;
    var g = { b: [0, 0, w0, h0] }, im = el.querySelector('img'), s = r.width / w0 || 1;
    if (!im || !im.naturalWidth) return g;
    var q = im.getBoundingClientRect(), k = im.naturalWidth / im.naturalHeight, w = q.width, h = q.height;
    if (w / h > k) h = w / k; else w = h * k;
    var at = getComputedStyle(im).objectPosition.split(' ');
    var off = function (v, free) { return /%$/.test(v) ? free * parseFloat(v) / 100 : parseFloat(v) || 0; };
    g.p = [(q.left + off(at[0], q.width - w) - r.left) / s, (q.top + off(at[1] || '50%', q.height - h) - r.top) / s, w / s, h / s];
    return g;
  };
  // box b, carried from where its picture lies (p) to where the same picture
  // lies on the other side (q)
  var carry = function (b, p, q) {
    return [q[0] + (b[0] - p[0]) / p[2] * q[2], q[1] + (b[1] - p[1]) / p[3] * q[3], b[2] / p[2] * q[2], b[3] / p[3] * q[3]];
  };
  var px = function (v) { return v.toFixed(1) + 'px'; };
  var box = function (a) { return 'left:' + px(a[0]) + ';top:' + px(a[1]) + ';width:' + px(a[2]) + ';height:' + px(a[3]); };
  // the player's picture, cut to the moving frame (w x h) it is seen through
  var cut = function (a, w, h) { return ';clip-path:inset(' + [-a[1], a[0] + a[2] - w, a[1] + a[3] - h, -a[0]].map(px).join(' ') + ' round 12px)'; };
  var frame = function () { return d.querySelector('.fp-hero .fp-frame'); };
  // a picture still waiting on its entrance is shown at once, with nothing
  // left to run: the picture lands on it, so it must already be there
  var show = function (el) {
    var p, all = [], c = el.closest('.cmp__still'), cm = c && c.closest('.cmp');
    // in a composition, focus racks to the film just come back from
    if (cm) {
      [].forEach.call(cm.querySelectorAll('.cmp__still'), function (x) { x.classList.toggle('is-focus', x === c); });
      cm.classList.toggle('is-racked', !c.classList.contains('is-lead'));
    }
    for (p = el; p && p !== d.body; p = p.parentElement) {
      if (p.classList.contains('reveal') || p.classList.contains('cmp')) { p.style.setProperty('--d', '0ms'); p.classList.add('is-in'); }
    }
    void el.offsetWidth;
    for (p = el.parentElement; p && p !== d.body; p = p.parentElement) all = all.concat(p.getAnimations());
    all.concat(el.getAnimations({ subtree: true })).forEach(function (a) {
      try { if (window.CSSTransition && a instanceof CSSTransition) a.finish(); } catch (e) {}
    });
  };

  d.addEventListener('click', function (e) {
    picked = null;
    var a = e.target.closest && e.target.closest('a[href^="/work/"]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var s = still(a), href = a.getAttribute('href');
    if (!s) return;
    picked = { el: s, href: href, t: Date.now() };
    keep('pick:' + location.pathname, { href: href, i: stills(href).indexOf(s) });
  }, true);

  addEventListener('pageswap', function (e) {
    var vt = e.viewTransition, to = e.activation && e.activation.entry && e.activation.entry.url;
    name(null);
    if (!vt) return;
    // the still clicked on the way to its page; else this page's own
    // player; else a still in view of the page being opened
    var el = picked && (to ? path(to) === path(picked.href) : Date.now() - picked.t < 5000) ? picked.el : null;
    if (!el && frame() && seen(frame())) el = frame();
    if (!el && to) el = stills(path(to)).filter(seen)[0];
    if (!el || !seen(el)) return;
    name(el);
    keep('from', { from: path(location.href), to: to ? path(to) : '', g: geo(el), t: Date.now() });
    vt.finished.then(function () { name(null); }, function () { name(null); });
  });

  addEventListener('pagereveal', function (e) {
    var vt = e.viewTransition, came = kept('from');
    keep('from', null);
    name(null);
    // only when the page left behind carried a picture across
    if (!vt || !came || Date.now() - came.t > 10000 || (came.to && came.to !== path(location.href))) return;
    var el = null, f = frame();
    if (came.from !== path(location.href)) {
      // back into the still it came from: the one last clicked here, else
      // the first one in view
      var list = stills(came.from), pick = kept('pick:' + location.pathname);
      var mine = pick && pick.href === came.from ? list[pick.i] : null;
      el = mine && seen(mine) ? mine : list.filter(seen)[0] || null;
    }
    if (!el && f && seen(f)) el = f;
    if (!el) return;
    // Two different pictures (a vertical film's 16:9 card on /work/, cut from
    // its frame, and its 9:16 player) are never drawn into one moving frame:
    // cross-fading them shows two heads. This one is not named, so the picture
    // left behind goes out with its page and this one is simply here.
    var o = came.g, n0 = geo(el), same = function (a, b) { return Math.abs(a[2] / a[3] / (b[2] / b[3]) - 1) < 0.02; };
    if (o && o.p && n0.p && !same(o.p, n0.p)) return;
    // the player lands where it stands: no entrance of its own on top
    if (el === f) root.classList.add('vt-film'); else show(el);
    name(el);
    // One picture all the way: each side's snapshot is drawn where the film's
    // picture lies at that moment, on the frame's own clock (styles.css,
    // .vt-fit), so the still and the player never show as two pictures. The
    // player's picture carries the move; the still lifts off it on the way
    // to the player, and settles back onto it on the way to the still.
    // (Where a side cannot be measured yet, both fill the moving frame and
    // cross-fade.)
    var n = geo(el), fit = null;
    if (o && o.p && n.p && same(o.p, n.p)) {
      var oHere = [0, 0, o.b[2], o.b[3]], nHere = [0, 0, n.b[2], n.b[3]];
      var oThere = carry(oHere, o.p, n.p), nThere = carry(nHere, n.p, o.p);
      var still2 = el !== f;   // back to a still: the player is the page left behind
      fit = d.createElement('style');
      fit.textContent =
        '@keyframes vt-fit-old{from{' + box(oHere) + (still2 ? cut(oHere, o.b[2], o.b[3]) : '') +
          '}to{' + box(oThere) + (still2 ? cut(oThere, n.b[2], n.b[3]) : '') + '}}' +
        '@keyframes vt-fit-new{from{' + box(nThere) + (still2 ? '' : cut(nThere, o.b[2], o.b[3])) +
          '}to{' + box(nHere) + (still2 ? '' : cut(nHere, n.b[2], n.b[3])) + '}}';
      d.head.appendChild(fit);
      root.classList.add('vt-fit');
      if (still2) root.classList.add('vt-to-still');
    }
    var done = function () { name(null); root.classList.remove('vt-fit', 'vt-to-still'); if (fit) fit.remove(); };
    vt.finished.then(done, done);
  });
})();
