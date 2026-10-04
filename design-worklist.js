/* alnimeri.com — /work/ as a list: Grid | List.

   The switch sits at the end of the kinds of film. Which view shows is set
   before the first paint by a few lines inlined right after the switch
   (bin-build-work-pages.py writes them, with this file's KEY): ?view=list or
   ?view=grid in the address, else the visitor's own last choice, else the
   wall. This file does the rest: the switch itself (the choice is kept in
   this browser only, and the address follows it, so a copied link opens the
   same view), the list's rows coming in as the view changes or a kind is
   chosen, and a figure followed to its post, counted like the grid's.
   Without JavaScript there is no switch: the wall, as it always was. */
(function () {
  'use strict';
  var KEY = 'alnimeri.workView';
  var d = document;
  var page = d.querySelector('.fp-index[data-view]');
  if (!page) return;
  var wall = page.querySelector('.fp-wall'), list = page.querySelector('.fp-list');
  var bar = page.querySelector('.fp-tabs'), sw = page.querySelector('.fp-view');
  if (!wall || !list || !sw) return;
  var still = matchMedia('(prefers-reduced-motion: reduce)');
  var buttons = [].slice.call(sw.querySelectorAll('button[data-view]'));
  var view = function () { return page.getAttribute('data-view') === 'list' ? 'list' : 'grid'; };

  // the rows on screen come in from the top, as an index is read
  var arrive = function () {
    if (still.matches) return;
    var i = 0;
    [].forEach.call(list.querySelectorAll('.fp-row'), function (r) {
      if (!r.getClientRects().length) return;
      var b = r.getBoundingClientRect();
      if (b.top > innerHeight || b.bottom < 0) return;
      r.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
                { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)', delay: Math.min(i++, 12) * 24, fill: 'backwards' });
    });
  };

  var set = function (v) {
    if (v === view()) return;
    // where the visitor is: if the views' top has gone up under the bar, the
    // new view starts under the bar too; otherwise the page stays put
    var shown = v === 'list' ? wall : list;
    var stick = parseFloat(getComputedStyle(bar).top) || 0;
    var top = shown.getBoundingClientRect().top + scrollY - stick - bar.offsetHeight - 16;
    var back = scrollY > top + 4;
    page.setAttribute('data-view', v);
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === v ? 'true' : 'false'); });
    if (back) scrollTo({ top: top, behavior: 'instant' });
    try { localStorage.setItem(KEY, v); } catch (e) {}
    // the address carries the view (the wall needs no word), and keeps the kind
    try {
      var q = location.search.replace(/^\?/, '').split('&').filter(function (p) { return p && !/^view=/.test(p); });
      if (v === 'list') q.push('view=list');
      history.replaceState(history.state, '', location.pathname + (q.length ? '?' + q.join('&') : '') + location.hash);
    } catch (e) {}
    // the wall measures its last row again now that it is on screen
    // (design-filmpages.js)
    page.dispatchEvent(new CustomEvent('fp:view', { bubbles: true, detail: { view: v } }));
    if (v === 'list') arrive();
    else if (!still.matches) wall.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
  };

  sw.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (b) set(b.getAttribute('data-view'));
  });

  // a kind chosen above (design-filmpages.js marks the wall): the list's
  // rows for it come in the same way
  if ('MutationObserver' in window) {
    new MutationObserver(function () { if (view() === 'list') arrive(); })
      .observe(wall, { attributes: true, attributeFilter: ['data-filter'] });
  }

  // a figure followed to its post: the same event as from a tile or a film
  // page (main.js sends it), with the film's own page as the film
  list.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.fp-row__reach');
    if (!a || !e.isTrusted || e.button !== 0) return;
    var film = a.closest('.fp-row').querySelector('.fp-row__film');
    d.dispatchEvent(new CustomEvent('site:event', { detail: { t: 'proof_click', films: [film.getAttribute('href').replace(/^\/work\//, '')] } }));
  });
})();
