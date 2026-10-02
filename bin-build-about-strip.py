#!/usr/bin/env python3
"""Build the About page's film board from the tiles on the front page.

Every film on the front page, pinned as a board: four columns of stills at
their own shape (16:9, or the front page's 3:4 for verticals), each with its
title and kind under it and linking to that film's page. The columns are
balanced here, shortest first, so the board ends level; on the page they drift
at different depths as it scrolls past. Derived from index.html so it can never
drift from the work itself: EVERY film on the front page is on the board.
"""
import re, sys, html, os, subprocess

SRC = open('index.html').read()
# The board is the front page's grid. The films in <template id="more-films">
# are on /work/ (and their own pages) only, so they are counted in the link to
# /work/ but are not pinned here.
_MORE = re.search(r'<template id="more-films">([\s\S]*?)</template>', SRC)
_more_tiles = re.findall(r'<article class="tile[^>]*>', _MORE.group(1)) if _MORE else []
SRC = re.sub(r'<template id="more-films">[\s\S]*?</template>', '', SRC)

# The count in the strip's footer link is derived from the tiles, like every
# other printed number on the site — hand-typing it is how "sixteen" outlived
# the sixteenth film.
WORDS = {14: 'fourteen', 15: 'fifteen', 16: 'sixteen', 17: 'seventeen',
         18: 'eighteen', 19: 'nineteen', 20: 'twenty', 21: 'twenty-one',
         22: 'twenty-two', 23: 'twenty-three', 24: 'twenty-four', 25: 'twenty-five',
         26: 'twenty-six', 27: 'twenty-seven', 28: 'twenty-eight', 29: 'twenty-nine',
         30: 'thirty'}
_n = len(re.findall(r'<article class="tile', SRC))
COUNT = WORDS.get(_n, str(_n))
# every film with a page of its own on /work/ (a data-part-of film is one more
# film on another film's page)
_all = _n + len([t for t in _more_tiles if 'data-part-of=' not in t])
ALL = WORDS.get(_all, str(_all))

# Running order, mixed so the range reads: Sudan documentary next to global
# commercial work, vertical films spread out. A film missing from this list is
# still shown — it joins the end in front-page order — so a new tile can never
# be left out of the strip.
ORDER = ['The Greatest Sudanese Sit-In', 'Solana Accelerate', 'Sia x Solana',
         'Solana Skyline', 'Badr Airlines', '60 Secs of New York', 'Crypto in the UAE',
         'El Fasher City', 'Solana x All In', 'Al Doroub', 'Hadeel Eljeally', 'Press “Generate”',
         'Sugar vs Jaggery', 'Token Supercycle', 'SGB — Solana Accelerate HK',
         'Why Is His Pinky Purple?', 'Solana Solstice',
         'Solana Developer Platform', 'Assets API']

def slugify(t):
    t = html.unescape(t).lower().replace('&', ' and ').replace('“','').replace('”','').replace('"','')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')

def dims(path):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path.split('?')[0]],
                         capture_output=True, text=True).stdout
    w, h = re.search(r'pixelWidth: (\d+)', out), re.search(r'pixelHeight: (\d+)', out)
    if not (w and h):
        sys.exit('cannot read size of ' + path)
    return int(w.group(1)), int(h.group(1))

frames = []
for b in re.findall(r'<article class="tile[\s\S]+?</article>', SRC):
    title = (re.search(r'data-title="([^"]+)"', b) or [None, ''])[1]
    # Anchored on the tile's own <img>: a <picture> puts a WebP <source> first,
    # and the vertical posters' true 768-wide files are -768w.jpg (the old
    # -768.jpg ones are 432 and 576 wide), which only the tile's srcset names.
    srcset = re.search(r'<img\s(?:[^>]*\s)?srcset="([^"]+)"', b)
    full = re.search(r'<img\s(?:[^>]*\s)?src="(assets/posters/[^"?]+\.jpg)', b)
    if not full:
        sys.exit('no poster for ' + title)
    full = full.group(1)
    # Every size of the still the tile offers, by its real width (read off the
    # file, not the name).
    cands = [c.strip().split()[0].split('?')[0] for c in srcset.group(1).split(',') if c.strip()] if srcset else []
    cands = cands or [full.replace('.jpg', '-480.jpg'), full.replace('.jpg', '-768.jpg')]
    # (up to 1280 wide: a pin never needs the 2560 file the full-row scope
    # tile offers for its own size)
    sizes = []
    for path in cands + [full]:
        if os.path.exists(path):
            w, h = dims(path)
            if w not in {x[1] for x in sizes} and w <= 1280:
                sizes.append((path, w, h))
    sizes.sort(key=lambda x: x[1])
    # The same still's WebP set, from the tile's <source>, each by its real
    # width: offered first, it is about a quarter lighter than the JPEGs.
    webp = re.search(r'<source type="image/webp" srcset="([^"]+)"', b)
    wsizes = []
    for c in (webp.group(1).split(',') if webp else []):
        path = c.strip().split()[0].split('?')[0] if c.strip() else ''
        if path and os.path.exists(path):
            w, h = dims(path)
            if w not in {x[1] for x in wsizes} and w <= 1280:
                wsizes.append((path, w, h))
    wsizes.sort(key=lambda x: x[1])
    fw, fh = dims(full)
    # Pin shape follows the film: 16:9, or the front page's 3:4 for verticals.
    tall = fw < fh
    slug = slugify(title)
    if not os.path.exists(f'work/{slug}.html'):
        sys.exit(f'no film page work/{slug}.html for {title}')
    frames.append({'title': title, 'slug': slug, 'sizes': sizes, 'webp': wsizes, 'tall': tall,
                   'kind': (re.search(r'tile__kind">([^<]*)<', b) or [None, ''])[1]})

if len(frames) != _n:
    sys.exit(f'{_n} tiles on the front page, {len(frames)} frames built')
stale = [t for t in ORDER if t not in {html.unescape(f['title']) for f in frames}]
if stale:
    sys.exit('ORDER names films that are not on the front page: ' + ', '.join(stale))
rank = lambda f: (ORDER.index(html.unescape(f['title'])) if html.unescape(f['title']) in ORDER else len(ORDER))
frames.sort(key=rank)   # stable: unlisted films keep front-page order at the end

# Balance the board: each film, in running order, goes to the shortest column.
# Heights in column widths — the still, plus about a sixth for its caption.
COLS = 4
cols, height = [[] for _ in range(COLS)], [0.0] * COLS
for f in frames:
    c = height.index(min(height))
    cols[c].append(f)
    height[c] += (4 / 3 if f['tall'] else 9 / 16) + 0.17

PIN_SIZES = '(max-width: 899px) calc(50vw - 30px), (max-width: 1439px) calc(25vw - 36px), 312px'

def pin(f):
    small = f['sizes'][0]
    srcset = ', '.join(f'/{p} {w}w' for p, w, h in f['sizes'])
    name = html.escape(html.unescape(f['title']), quote=True)
    kind = html.unescape(f['kind'])
    title = f['title']
    img = (f'<img src="/{small[0]}" srcset="{srcset}" sizes="{PIN_SIZES}" alt="Still from {title}" '
           f'width="{small[1]}" height="{small[2]}" loading="lazy" decoding="async">')
    if f['webp']:
        img = ('<picture><source type="image/webp" srcset="' + ', '.join(f'/{p} {w}w' for p, w, h in f['webp'])
               + f'" sizes="{PIN_SIZES}">' + img + '</picture>')
    return f'''
        <a class="pin{' pin--tall' if f['tall'] else ''}" href="/work/{f['slug']}" aria-label="{name} — {html.escape(kind, quote=True)}">
          <span class="pin__media">{img}</span>
          <span class="pin__cap"><span class="pin__t">{f['title']}</span><span class="pin__k">{html.escape(kind)}</span></span>
        </a>'''

board = ''.join(f'''
      <div class="pins__col">{''.join(pin(f) for f in col)}
      </div>''' for col in cols)

strip = f'''
  <!-- Frames from his own films, pinned as a board. Generated by
       bin-build-about-strip.py from the tiles on the front page — never
       hand-maintained. -->
  <section class="pins" aria-label="Frames from {COUNT} films">
    <div class="pins__board">{board}
    </div>
    <p class="pins__note"><a class="btn btn--ghost" href="/work/">All {ALL} films &rarr;</a></p>
  </section>
'''

page = open('about.html').read()
# (removed whole, leading newline included, so a rebuild puts back exactly what
# it took out; replacing it with a newline grew the page by a blank line a run)
page = re.sub(r'\n *<!-- Frames from his own films[\s\S]*?</section>\n', '', page)
# The strip follows the opening plate. Anchor on that section's own close, not
# on the contents of its last paragraph: those change (a CV link, a re-hashed
# PDF), and an exact-text anchor then fails silently on every rebuild.
m = re.search(r'<section class="pagehead pagehead--plate">[\s\S]*?\n  </section>\n', page)
if not m:
    sys.exit('opening plate section not found')
page = page[:m.end()] + strip + page[m.end():]
assert page.count('<section class="pins"') == 1, 'board not written exactly once'
open('about.html', 'w').write(page)
print(f'about board: {len(frames)} films in {COLS} columns — ' + ' | '.join(', '.join(html.unescape(f["title"]) + ('*' if f['tall'] else '') for f in col) for col in cols))
