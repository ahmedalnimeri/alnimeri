#!/usr/bin/env python3
"""Build the About page's filmstrip from the tiles on the front page.

The About page opened as a wall of text on a film director's site. This is a
band of real frames from his own work — monochrome at rest like the rest of
the archive, developing to colour when engaged, each linking to that film's
page. Derived from index.html so it can never drift from the work itself:
EVERY film on the front page is in the strip.
"""
import re, sys, html, os, subprocess

SRC = open('index.html').read()

# The count in the strip's footer link is derived from the tiles, like every
# other printed number on the site — hand-typing it is how "sixteen" outlived
# the sixteenth film.
WORDS = {14: 'fourteen', 15: 'fifteen', 16: 'sixteen', 17: 'seventeen',
         18: 'eighteen', 19: 'nineteen', 20: 'twenty'}
_n = len(re.findall(r'<article class="tile', SRC))
COUNT = WORDS.get(_n, str(_n))

# Running order, mixed so the range reads: Sudan documentary next to global
# commercial work, vertical films spread out. A film missing from this list is
# still shown — it joins the end in front-page order — so a new tile can never
# be left out of the strip.
ORDER = ['The Greatest Sudanese Sit-In', 'Solana Accelerate', 'Sia x Solana',
         'Solana Skyline', '60 Secs of New York', 'Crypto in the UAE',
         'El Fasher City', 'Solana x All In', 'Al Doroub', 'Press “Generate”',
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

# The gates are small (a 16:9 gate is 78vw on phones, 260px on tablets and
# small laptops, 22.2vw up to 420px), so each frame carries the tile's whole
# srcset and a sizes that says so: a 1440 desktop takes the 480 file, a DPR3
# phone still gets the 1280. Tall gates are 3:4 at the same height, 0.42x as
# wide, and the vertical posters are narrower than 3:4, so their width is what
# has to be covered.
SIZES_WIDE = '(max-width: 560px) 78vw, (max-width: 1168px) 260px, (max-width: 1888px) 22.2vw, 420px'
SIZES_TALL = '(max-width: 560px) 33vw, (max-width: 1168px) 110px, (max-width: 1888px) 9.4vw, 177px'

def rooted_srcset(ss):
    return ', '.join('/' + c.strip() for c in ss.split(',') if c.strip())

frames = []
for b in re.findall(r'<article class="tile[\s\S]+?</article>', SRC):
    title = (re.search(r'data-title="([^"]+)"', b) or [None, ''])[1]
    # Anchored on the tile's own <img>, and on the -768 file wherever it sits
    # in the srcset: the srcsets lead with -480, and a regex that wanted -768
    # first silently fell back to the 1280 poster for every frame. The vertical
    # posters' true 768-wide files are -768w.jpg (the old -768.jpg ones were
    # 432 and 576 wide).
    srcset = re.search(r'<img\s(?:[^>]*\s)?srcset="([^"]+)"', b)
    poster = re.search(r'(assets/posters/[^ ",]+-768w?\.jpg\?h=[a-f0-9]+) \d+w', srcset.group(1) if srcset else '')
    full   = re.search(r'<img\s(?:[^>]*\s)?src="(assets/posters/[^"]+)"', b)
    if not full:
        sys.exit('no poster for ' + title)
    small = poster.group(1) if poster else full.group(1)
    w, h = dims(small)
    # Gate shape follows the film: 16:9, or the front page's 3:4 for verticals.
    shape = '' if w > h else ' reel__frame--tall'
    slug = slugify(title)
    if not os.path.exists(f'work/{slug}.html'):
        sys.exit(f'no film page work/{slug}.html for {title}')
    frames.append({'title': title, 'slug': slug, 'small': small, 'w': w, 'h': h,
                   'shape': shape,
                   'srcset': (f' srcset="{rooted_srcset(srcset.group(1))}" sizes="{SIZES_TALL if shape else SIZES_WIDE}"'
                              if srcset and poster else ''),
                   'kind': (re.search(r'tile__kind">([^<]*)<', b) or [None, ''])[1]})

if len(frames) != _n:
    sys.exit(f'{_n} tiles on the front page, {len(frames)} frames built')
stale = [t for t in ORDER if t not in {html.unescape(f['title']) for f in frames}]
if stale:
    sys.exit('ORDER names films that are not on the front page: ' + ', '.join(stale))
rank = lambda f: (ORDER.index(html.unescape(f['title'])) if html.unescape(f['title']) in ORDER else len(ORDER))
frames.sort(key=rank)   # stable: unlisted films keep front-page order at the end

items = ''.join(f'''
      <a class="reel__frame{f['shape']}" href="/work/{f['slug']}" aria-label="{html.escape(html.unescape(f['title']), quote=True)} — {html.unescape(f['kind'])}">
        <img src="/{f['small']}"{f['srcset']} alt="Still from {f['title']}" width="{f['w']}" height="{f['h']}" loading="lazy" decoding="async">
        <span class="reel__label">{f['title']}</span>
      </a>''' for f in frames)

strip = f'''
  <!-- Frames from his own films: monochrome at rest like the rest of the
       archive, colour when engaged. Generated by bin-build-about-strip.py
       from the tiles on the front page — never hand-maintained. -->
  <section class="reel" aria-label="Frames from all {COUNT} films">
    <div class="reel__track">{items}
    </div>
    <p class="reel__note"><a href="/work/">All {COUNT} films &rarr;</a></p>
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
assert page.count('<section class="reel"') == 1, 'strip not written exactly once'
open('about.html', 'w').write(page)
print(f'about strip: {len(frames)} frames — ' + ', '.join(html.unescape(f['title']) + ('*' if f['shape'] else '') for f in frames))
