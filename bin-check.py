#!/usr/bin/env python3
"""The last step before any deploy: fail if the built site says something
untrue or points at nothing. It changes nothing; it exits non-zero and lists
every problem.

Read: every page the site serves (the .html files, and one /reel/<code> page
rendered through the real Function in Node), llms.txt, sitemap.xml and the
generated functions/_lib files. Checked:

  1. JSON-LD: every block parses; every alnimeri.com @id a page points to is
     described somewhere; every film page describes its film as a VideoObject
     (/work/<slug>#film, with a name, description, still, date and running
     time), and every still it names is a file here.
  2. Every work/*.html is in sitemap.xml and in llms.txt, and every sitemap URL
     is a page.
  3. Film counts in words or digits ("One of thirty-four films", "The twenty
     films on the front page and fourteen more", "All 34 selected film pages")
     match the films: all of them, the front page's, or the rest. Two counts
     are not counts of these pages and pass only in their own sentence: the
     66 published for Solana (a hand-kept fact, from the CV) and the films
     past half a million views, which is counted here from the data: every
     film page's published figures and assets/solana-edits.json's rows, one
     film per post (a tracker row with a page here is that page's film).
     Those two phrases ("N films past half a million", "N films published
     for Solana") are checked on their own first, so a wrong figure fails
     even when it equals one of the page counts.
  4. Claims: bin-check-claims.py (no "directed by", no "director" but
     "creative director", no film director or storyteller, no credit line, in
     the pages, data, scripts, share-card text and the CV PDF), run as it is.
  5. Internal links: every href, src, srcset and poster on a page reaches a file,
     a pretty URL or a Function route, and every #fragment an id on its page;
     so do the ones a script puts on the wire later (the hero's lazy stills,
     data-src / data-srcset, and its loops, data-loop-webm / data-loop-mp4),
     and every loop in assets/loops/ is named by md5[:8] of its own bytes.
  6. Share images: every og:image and twitter:image is a file here.
  7. styles.css and main.js carry one and the same ?v= on every page.
  8. One Cloudflare Web Analytics beacon on every page, with one token.
  9. The still becomes the player: the front page, About, /work/ and every
     film page carry design-transition.js inlined once, as it stands now
     (bin-stamp-assets.py, bin-build-work-pages.py), above the first
     stylesheet, and reduced motion still turns page transitions off in
     styles.css.
 10. No fixed or sticky bar is ever dimmed whole: a rule that gives the
     masthead (or the timeline, the tray, /work/'s tabs, a sticky year) an
     opacity between 0 and 1 makes its glass clear too, and whatever scrolls
     under it reads through its words as double text. Dim the bar's children
     (design-filmpages.css, .fp-lights-down .masthead > *); hiding it outright
     (opacity 0) is not dimming.

Run from anywhere; it reads the repo it sits in. Needs node for the reel page.
"""
import html, json, pathlib, re, subprocess, sys
from urllib.parse import urljoin, urlsplit, unquote
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent
SITE = 'https://alnimeri.com'
problems = []

def bad(where, what):
    problems.append(f'  {where}: {what}')

# ---- the pages ------------------------------------------------------------
# path on disk -> the URL it is served at (Pages strips .html). 404.html is
# served at whatever path was asked for, so it is read from a deep one: a
# relative URL in it would break there.
SKIP_DIRS = {'.git', 'node_modules', 'docs', 'assets', '.claude', '_og'}   # _og: bin-build-og.py's cards, git-ignored
NOT_SERVED = {'reel.tpl.html'}            # blocked in the middleware; rendered below

def url_of(rel):
    if rel == 'index.html':
        return '/'
    if rel == '404.html':
        return '/some/missing/page'
    if rel.endswith('/index.html'):
        return '/' + rel[:-len('index.html')]
    return '/' + rel[:-len('.html')]

PAGES = {}   # url -> (label, text)
for p in sorted(ROOT.rglob('*.html')):
    rel = p.relative_to(ROOT).as_posix()
    if SKIP_DIRS.intersection(p.relative_to(ROOT).parts) or rel in NOT_SERVED:
        continue
    PAGES[url_of(rel)] = (rel, p.read_text(encoding='utf-8'))

# one pulled reel, every film in it, rendered by the Function itself
REEL_JS = r'''
import(process.argv[1]).then(async (m) => {
  const lib = await import(process.argv[2]);
  const code = lib.FILMS.map((f) => f.key).join('');
  const res = await m.onRequestGet({ params: { code }, env: {}, request: new Request('https://alnimeri.com/reel/' + code) });
  process.stdout.write(JSON.stringify({ code, status: res.status, html: await res.text() }));
}).catch((e) => { console.error(e.stack || e); process.exit(1); });
'''
try:
    out = subprocess.run(['node', '--input-type=module', '-e', REEL_JS,
                          (ROOT / 'functions/reel/[code].js').as_uri(), (ROOT / 'functions/_lib/reel.js').as_uri()],
                         capture_output=True, text=True, timeout=60)
    if out.returncode:
        bad('functions/reel/[code].js', 'could not render a reel page: ' + out.stderr.strip()[:300])
    else:
        r = json.loads(out.stdout)
        if r['status'] != 200:
            bad(f"/reel/{r['code']}", f"answered {r['status']}")
        PAGES[f"/reel/{r['code']}"] = (f"/reel/{r['code']} (rendered)", r['html'])
except (OSError, subprocess.TimeoutExpired) as e:
    bad('node', f'cannot render the reel page ({e})')

FILM_PAGES = sorted(p.stem for p in (ROOT / 'work').glob('*.html') if p.stem not in ('index', 'solana'))
N = len(FILM_PAGES)
_index = PAGES['/'][1]
_grid = re.sub(r'<template id="more-films">[\s\S]*?</template>', '', _index)
H = len(re.findall(r'<article class="tile[\s"]', _grid))
M = N - H

def visible(text):
    """A page's words: comments, scripts and styles out, tags out, entities read."""
    t = re.sub(r'<!--[\s\S]*?-->', ' ', text)
    t = re.sub(r'<(script|style|template)\b[\s\S]*?</\1>', ' ', t, flags=re.I)
    t = re.sub(r'<[^>]+>', ' ', t)
    return re.sub(r'\s+', ' ', html.unescape(t))

def meta(text, attr, name):
    m = re.search(rf'<meta\s+{attr}="{re.escape(name)}"\s+content="([^"]*)"', text)
    return html.unescape(m.group(1)) if m else None

# ---- 1. JSON-LD -----------------------------------------------------------
defined, refs = {}, []
def walk(node, where):
    if isinstance(node, dict):
        if '@id' in node and len(node) == 1:
            refs.append((node['@id'], where))
        elif '@id' in node:
            defined.setdefault(node['@id'], []).append(where)
        for v in node.values():
            walk(v, where)
    elif isinstance(node, list):
        for v in node:
            walk(v, where)

def asset_exists(u):
    """An https://alnimeri.com/<file> URL that names a file in this repo."""
    if not u.startswith(SITE + '/'):
        return True
    return (ROOT / unquote(urlsplit(u).path).lstrip('/')).is_file()

LD = {}
for url, (label, text) in PAGES.items():
    nodes = []
    for block in re.findall(r'<script type="application/ld\+json">([\s\S]*?)</script>', text):
        try:
            data = json.loads(block)
        except ValueError as e:
            bad(label, f'JSON-LD does not parse ({e})')
            continue
        if not isinstance(data, dict) or data.get('@context') not in ('https://schema.org', 'http://schema.org'):
            bad(label, 'JSON-LD without @context https://schema.org')
        walk(data, label)
        nodes += data.get('@graph', [data]) if isinstance(data, dict) else []
    LD[url] = nodes
    for n in nodes:
        for k in ('thumbnailUrl', 'image'):
            v = n.get(k)
            for u in (v if isinstance(v, list) else [v]):
                if isinstance(u, str) and not asset_exists(u):
                    bad(label, f'{n.get("@type")} {n.get("name", "")!r}: {k} {u} is not a file here')
for rid, where in refs:
    if rid.startswith(SITE) and rid not in defined:
        bad(where, f'JSON-LD points to {rid}, which no page describes')
for slug in FILM_PAGES:
    url = f'/work/{slug}'
    want = f'{SITE}{url}#film'
    film = next((n for n in LD.get(url, []) if n.get('@id') == want), None)
    if not film:
        bad(f'work/{slug}.html', f'no JSON-LD node {want}')
        continue
    if film.get('@type') != 'VideoObject':
        bad(f'work/{slug}.html', f'{want} is a {film.get("@type")}, not a VideoObject')
    for k in ('name', 'description', 'thumbnailUrl', 'uploadDate', 'duration', 'url'):
        if not film.get(k):
            bad(f'work/{slug}.html', f'its VideoObject has no {k}')

# ---- 2. sitemap and llms.txt ---------------------------------------------
try:
    NS = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    locs = [u.findtext('s:loc', namespaces=NS) for u in ET.parse(ROOT / 'sitemap.xml').getroot().findall('s:url', NS)]
except (ET.ParseError, OSError) as e:
    bad('sitemap.xml', f'does not parse ({e})')
    locs = []
llms = (ROOT / 'llms.txt').read_text(encoding='utf-8') if (ROOT / 'llms.txt').exists() else ''
if not llms:
    bad('llms.txt', 'missing or empty')
for p in sorted((ROOT / 'work').glob('*.html')):
    u = SITE + ('/work/' if p.stem == 'index' else f'/work/{p.stem}')
    if u not in locs:
        bad('sitemap.xml', f'{p.relative_to(ROOT)} is not in it ({u})')
    if not re.search(re.escape(u) + r'(?![\w/-])', llms):
        bad('llms.txt', f'{p.relative_to(ROOT)} is not in it ({u})')
for u in locs:
    if not u.startswith(SITE) or urlsplit(u).path not in PAGES:
        bad('sitemap.xml', f'{u} is not a page')

# ---- 3. film counts -------------------------------------------------------
_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
         'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
WORD = {(_ONES[n] if n < 20 else _TENS[n // 10] + ('-' + _ONES[n % 10] if n % 10 else '')): n for n in range(1, 100)}
NUM = r'(\d+|' + '|'.join(sorted(WORD, key=len, reverse=True)) + r')'
COUNT = re.compile(r'(?<![:.\d])\b' + NUM + r'((?:[\s-]+(?:selected|more|published|other))*)[\s-]+(films?|film pages|pieces)\b', re.I)
# Films past half a million views, from the data: each film page's figures (its
# VideoObjects' view counts, keyed by the post they link to) and the Solana
# tracker's rows (keyed by their X post), so a film on both is counted once.
_figures = {}
for _p in sorted((ROOT / 'work').glob('*.html')):
    for _b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', _p.read_text(), re.S):
        _d = json.loads(_b)
        for _n in _d.get('@graph', [_d]):
            if _n.get('@type') != 'VideoObject':
                continue
            _st = _n.get('interactionStatistic')
            for _s in (_st if isinstance(_st, list) else [_st] if _st else []):
                if (_s.get('interactionType') or {}).get('@type') == 'WatchAction':
                    _key = _n.get('sameAs') or _n.get('url') or _n.get('@id')
                    _x = re.search(r'x\.com/\w+/status/(\d+)', _key or '')
                    _figures[_x.group(1) if _x else _key] = _s['userInteractionCount']
for _v in json.load(open(ROOT / 'assets' / 'solana-edits.json'))['videos']:
    _figures.setdefault(_v['id'], _v['views'])
HALF = sum(1 for _n in _figures.values() if _n > 500_000)
# facts that are not counts of these pages, each only in its own sentence
KEPT = [(66, re.compile(r'Solana', re.I)), (HALF, re.compile(r'half a million', re.I))]
SOURCES = dict((u, (label, visible(t))) for u, (label, t) in PAGES.items())
SOURCES['llms.txt'] = ('llms.txt', llms)
# Each of the two stated on its own, first: a wrong figure that happens to
# equal a count of these pages (14, 20, 34) must not pass as that count.
_SAID = [(HALF, 'films past half a million views, counted from the data',
          re.compile(r'(?<![:.\d])\b' + NUM + r'[\s-]+films?[\s-]+past[\s-]+half[\s-]+a[\s-]+million\b', re.I)),
         (66, 'films published for Solana, the hand-kept fact from the CV',
          re.compile(r'(?<![:.\d])\b' + NUM + r'[\s-]+(?:published[\s-]+films?|films?[\s-]+published)[\s-]+for[\s-]+Solana\b', re.I))]
for u, (label, words) in SOURCES.items():
    for want, what, rx in _SAID:
        for m in rx.finditer(words):
            raw = m.group(1).lower()
            n = int(raw) if raw.isdigit() else WORD[raw]
            if n != want:
                bad(label, f'"{m.group(0)}" says {n}; {what}: {want}')
for u, (label, words) in SOURCES.items():
    if u == '/work/':
        # the wall's own per-kind counts ("Brand & campaign films 15 films") are
        # checked against the cards in each kind below, not against N
        words = re.sub(r'\b\d+ films? (?=\S)', lambda m: '', words)
    for m in COUNT.finditer(words):
        raw = m.group(1).lower()
        n = int(raw) if raw.isdigit() else WORD[raw]
        if m.group(3).lower() == 'film' and n == 1:
            continue
        if n in (N, H, M):
            continue
        around = words[max(0, m.start() - 160):m.end() + 160]
        if any(n == k and ctx.search(around) for k, ctx in KEPT):
            continue
        bad(label, f'"{m.group(0)}" counts {n} films; the site has {N} (front page {H}, the rest {M})')
for sec in re.finditer(r'<section class="fp-cat" id="(\w+)"[^>]*><h2 class="fp-cat__head">[^<]*<span>(\d+) films?</span>([\s\S]*?)</section>',
                       PAGES['/work/'][1]):
    cards = len(re.findall(r'<li class="fp-card', sec.group(3)))
    if int(sec.group(2)) != cards:
        bad('work/index.html', f'#{sec.group(1)} says {sec.group(2)} films and hangs {cards}')

# ---- 4. claims ------------------------------------------------------------
r = subprocess.run([sys.executable, str(ROOT / 'bin-check-claims.py')], capture_output=True, text=True)
if r.returncode:
    problems.append(r.stderr.rstrip() or r.stdout.rstrip())

# ---- 5. internal links ----------------------------------------------------
BLOCKED = re.compile(r'^/(reel\.tpl(\.html)?/?|wrangler\.(jsonc|toml|json)|package(-lock)?\.json|README\.md|bin-[^/]*\.py|schema\.sql|\.gitignore)$|^/(docs|\.claude|\.git)(/|$)', re.I)
ATTR = re.compile(r'\s(href|src|srcset|poster|data-src|data-srcset|data-poster|data-loop-webm|data-loop-mp4)="([^"]*)"')
IDS = {u: set(re.findall(r'\s(?:id|name)="([^"]+)"', t)) for u, (_l, t) in PAGES.items()}
# fragments that main.js answers without an element of that name
JS_FRAGMENTS = {'brief'}

def target(path):
    """The page URL a path is served as, or True for a file or a Function, or None."""
    path = unquote(path)
    if BLOCKED.search(path):
        return None
    if path in PAGES:
        return path
    f = ROOT / path.lstrip('/')
    if path.endswith('/'):
        return path if (f / 'index.html').is_file() and path in PAGES else None
    if f.is_file():
        return True
    if (ROOT / (path.lstrip('/') + '.html')).is_file():
        return path if path in PAGES else True
    if re.fullmatch(r'/reel/?', path) or re.fullmatch(r'/reel/[a-z1-9]{1,32}', path):
        return True
    if re.fullmatch(r'/brief(/[a-z]+)?/?', path) and (ROOT / 'functions/brief/[[kind]].js').is_file():
        return True
    m = re.fullmatch(r'/api/(\w+)', path)
    if m and (ROOT / f'functions/api/{m.group(1)}.js').is_file():
        return True
    return None

for url, (label, text) in PAGES.items():
    body = re.sub(r'<!--[\s\S]*?-->', '', text)
    body = re.sub(r'<script\b(?![^>]*\bsrc=)[\s\S]*?</script>', '', body)   # inline scripts' strings are not links
    seen = set()
    for attr, val in ATTR.findall(body):
        val = html.unescape(val).strip()
        cands = [c.strip().split()[0] for c in val.split(',') if c.strip()] if attr.endswith('srcset') else [val]
        for c in cands:
            if not c or c in seen or re.match(r'(mailto|tel|sms|javascript|data|blob):', c, re.I) or c.startswith('//'):
                continue
            seen.add(c)
            if re.match(r'https?://', c, re.I) and not c.lower().startswith(SITE):
                continue
            absu = urljoin(SITE + url, c)
            parts = urlsplit(absu)
            if parts.netloc != 'alnimeri.com':
                continue
            if c.startswith('#'):
                frag = unquote(c[1:])
                if frag and frag not in IDS[url] and frag not in JS_FRAGMENTS:
                    bad(label, f'{attr}="{c}": no id "{frag}" on this page')
                continue
            t = target(parts.path or '/')
            if t is None:
                bad(label, f'{attr}="{c}" reaches nothing ({parts.path})')
            elif parts.fragment and isinstance(t, str):
                frag = unquote(parts.fragment)
                if frag not in IDS.get(t, set()) and frag not in JS_FRAGMENTS:
                    bad(label, f'{attr}="{c}": no id "{frag}" on {t}')

# the loops are cached for a year under a name that must change with the bytes
import hashlib
for f in sorted((ROOT / 'assets/loops').glob('*')):
    m = re.fullmatch(r'.+-([0-9a-f]{8})\.(webm|mp4)', f.name)
    if not m:
        bad(f'assets/loops/{f.name}', 'a loop is named <film>-<md5[:8]>.webm or .mp4')
    elif hashlib.md5(f.read_bytes()).hexdigest()[:8] != m.group(1):
        bad(f'assets/loops/{f.name}', 'its name is not the md5[:8] of its bytes: a changed loop takes a new name')

# ---- 6. share images ------------------------------------------------------
for url, (label, text) in PAGES.items():
    for attr, name in (('property', 'og:image'), ('name', 'twitter:image')):
        u = meta(text, attr, name)
        if u is None:
            continue
        if not u.startswith(SITE + '/') or not asset_exists(u):
            bad(label, f'{name} {u} is not a file here')
    if url != '/some/missing/page' and meta(text, 'property', 'og:image') is None and 'noindex' not in (meta(text, 'name', 'robots') or ''):
        bad(label, 'no og:image')

# ---- 7. one ?v= for styles.css and main.js --------------------------------
vers = {}
for url, (label, text) in PAGES.items():
    for name, v in re.findall(r'/?(styles\.css|main\.js)\?v=([\w.]+)', text):
        vers.setdefault(v, set()).add(f'{label} ({name})')
for rel in ('functions/_lib/reel.js',):
    for name, v in re.findall(r'(styles\.css|main\.js)\?v=([\w.]+)', (ROOT / rel).read_text()):
        vers.setdefault(v, set()).add(f'{rel} ({name})')
if len(vers) > 1:
    bad('?v=', 'styles.css and main.js are not on one version: ' +
        '; '.join(f'v={v}: {len(w)} refs, e.g. {sorted(w)[0]}' for v, w in sorted(vers.items())))
elif not vers:
    bad('?v=', 'no styles.css?v= or main.js?v= found')

# ---- 8. one analytics beacon per page -------------------------------------
tokens = {}
for url, (label, text) in PAGES.items():
    beacons = re.findall(r'<script[^>]+static\.cloudflareinsights\.com/beacon\.min\.js[^>]*>', text)
    if len(beacons) != 1:
        bad(label, f'{len(beacons)} Cloudflare Web Analytics beacons (want exactly one)')
    for b in beacons:
        m = re.search(r'"token":\s*"([0-9a-f]+)"', b)
        tokens.setdefault(m.group(1) if m else '(none)', []).append(label)
if len(tokens) > 1:
    bad('beacon', 'more than one token: ' + ', '.join(f'{t} on {len(l)} pages' for t, l in tokens.items()))

# ---- 9. the still becomes the player --------------------------------------
# the same reduction bin-stamp-assets.py inlines: no comments, lines trimmed
_vt = re.sub(r'/\*[\s\S]*?\*/', '', (ROOT / 'design-transition.js').read_text())
_vt = '\n'.join(l for l in (x.strip() for x in _vt.split('\n')) if l and not l.startswith('//'))
for url, (label, text) in PAGES.items():
    blocks = re.findall(r'<!-- design-transition\.js, inlined[^>]*-->\s*<script>\n([\s\S]*?)\n</script>\s*<!-- /design-transition\.js -->', text)
    takes_part = url in ('/', '/about', '/work/') or (label.startswith('work/') and label != 'work/solana.html')
    if takes_part and len(blocks) != 1:
        bad(label, f'{len(blocks)} inlined design-transition.js blocks (want exactly one)')
    if not takes_part and blocks:
        bad(label, 'carries design-transition.js but is not one of the pages that take part')
    for b in blocks:
        if b != _vt:
            bad(label, 'its inlined design-transition.js is not the current file (run bin-stamp-assets.py, then bin-build-work-pages.py)')
    # above the first stylesheet: an inline script after one waits for the CSS
    # and holds the parser (DOMContentLoaded ~100ms later on every such page)
    if blocks:
        _at, _css = text.find('<!-- design-transition.js, inlined'), text.find('<link rel="stylesheet"')
        if _css != -1 and _css < _at:
            bad(label, 'its inlined design-transition.js comes after a stylesheet (move it above the first <link rel="stylesheet">)')
if not re.search(r'@media \(prefers-reduced-motion: reduce\)\s*\{\s*@view-transition\s*\{\s*navigation:\s*none;\s*\}', (ROOT / 'styles.css').read_text()):
    bad('styles.css', 'reduced motion no longer turns page transitions off (@view-transition { navigation: none; })')

# ---- 10. no bar dimmed whole ----------------------------------------------
# the bars that stay on screen while the page scrolls under them; a selector
# that ends on one of them (no descendant after it) styles the bar itself
BARS = r'\.(?:masthead|tl|bin|fp-tabs|sl-year__head|set__yr)'
_bar_sel = re.compile(BARS + r'(?:[.:#\[][^\s>+~,]*)?$')
for css in sorted(ROOT.glob('*.css')):
    _src = re.sub(r'/\*[\s\S]*?\*/', lambda c: re.sub(r'[^\n]', ' ', c.group(0)), css.read_text())
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', _src):
        _vals = [float(v) for v in re.findall(r'(?<![\w-])opacity\s*:\s*([\d.]+)', m.group(2))]
        if not any(0 < v < 1 for v in _vals):
            continue
        for sel in (x.strip() for x in m.group(1).split(',')):
            if '::' not in sel and _bar_sel.search(sel):   # a pseudo-element is not the bar
                bad(css.name, f'line {_src.count(chr(10), 0, m.start()) + 1}: "{sel}" dims a bar whole (opacity '
                    f'{min(v for v in _vals if 0 < v < 1)}); dim its children instead, so its glass stays')

# ---------------------------------------------------------------------------
if problems:
    print(f'bin-check: {len(problems)} problem(s) — do not deploy:', file=sys.stderr)
    print('\n'.join(problems[:120]), file=sys.stderr)
    if len(problems) > 120:
        print(f'  … and {len(problems) - 120} more', file=sys.stderr)
    sys.exit(1)
print(f'check: clean ({len(PAGES)} pages incl. one rendered reel; {N} films, {H} on the front page; '
      f'{len(defined)} JSON-LD @ids; one ?v= ({next(iter(vers))}); one beacon per page; the transition inlined where it belongs; '
      f'no bar dimmed whole; {HALF} films past half a million, from the data)')
