#!/usr/bin/env python3
"""Compile the film list and the reel page template into one edge module.

/reel/<code> is a viewer's own cut of the selects: an ordered subset of the
tiles, rendered at the edge with its running time summed by the same rule the
home page uses. The function that renders it needs the films and the template
as code, because a Pages Function cannot read the repository.

Everything here is lifted from index.html — titles, durations, posters (with
their content hashes), figures. Nothing is typed twice. Run after any change to
the tiles, before bin-stamp-assets.py has to be re-run for anything else.

Output: functions/_lib/reel.js  (underscore: not routed, only imported)

Keys: a cut's link is one character per film, and people have sent those
links. A film's character is therefore its own for good, not its place in the
grid: assets/reel-keys.json holds every character ever given (character ->
the film's page slug), a film new to the grid takes the next character no
film has ever had, and a film that leaves keeps its character out of use.
The keys are written onto the tiles (data-key) for main.js's bin, so the grid
can be re-hung without changing what any link means.

Only the front page's grid is the sequence: the films in
<template id="more-films"> are never rendered there, so they are not in it.
"""
import re, json, sys, html, os

SRC = open('index.html').read()
TPL = open('reel.tpl.html').read()

VER  = re.search(r'styles\.css\?v=(\d+)', SRC).group(1)
VERJ = re.search(r'main\.js\?v=(\d+)', SRC).group(1)
MARK = re.search(r'src="(assets/logo-96\.png\?h=[a-f0-9]+)"', SRC).group(1)
# the film hover layer is served immutable, so its ?v= is its own md5[:8]
import hashlib
HOVER = {k: hashlib.md5(open(f, 'rb').read()).hexdigest()[:8]
         for k, f in (('{{HOVER_CSS}}', 'design-hover.css'), ('{{HOVER_JS}}', 'design-hover.js'))}

# One character per film, in DOM order. No 0/o/1-vs-l confusion: the code is
# something a producer reads out over the phone.
ALPHABET = '123456789abcdefghjkmnpqrstuvwxyz'

def field(b, pat, default=''):
    m = re.search(pat, b)
    return m.group(1) if m else default

def slugify(t):
    # the film pages' own rule (bin-build-work-pages.py)
    t = html.unescape(t).lower()
    t = t.replace('&', ' and ').replace('“', '').replace('”', '').replace('"', '')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')

_more = re.search(r'<template id="more-films">[\s\S]*?</template>', SRC)
MORE_AT = _more.span() if _more else (len(SRC), len(SRC))
TILES = [m for m in re.finditer(r'<article class="tile[\s\S]+?</article>', SRC)
         if not MORE_AT[0] <= m.start() < MORE_AT[1]]

REG_PATH = 'assets/reel-keys.json'
REG = json.load(open(REG_PATH))            # key -> slug, every key ever given
if any(k not in ALPHABET for k in REG) or len(set(REG.values())) != len(REG):
    sys.exit(f'{REG_PATH}: a key outside the alphabet, or a film with two keys')
KEY_OF = {slug: k for k, slug in REG.items()}

films = []
for m_ in TILES:
    b = m_.group(0)
    dur = field(b, r'tile__dur">(\d+):(\d\d)<')
    m = re.search(r'tile__dur">(\d+):(\d\d)<', b)
    if not m:
        sys.exit('tile without a duration: ' + b[:100])
    secs = int(m.group(1)) * 60 + int(m.group(2))
    # The tile's own <img>, not a WebP <source> the <picture> may lead with;
    # up to 1280w (the full-row scope tile offers a 2560 file for its own
    # size on the front page, which a reel's thirds never need).
    srcset = ', '.join(c.strip() for c in field(b, r'<img\s(?:[^>]*\s)?srcset="([^"]+)"').split(',')
                       if c.strip() and not (c.split()[-1].endswith('w') and int(c.split()[-1][:-1]) > 1280))
    films.append({
        'title':    field(b, r'data-title="([^"]+)"'),
        'vid':      field(b, r'data-video="(\d+)"'),
        'portrait': field(b, r'data-portrait="(\w+)"') == 'true',
        'href':     field(b, r'class="tile__link" href="([^"]+)"'),
        'kind':     field(b, r'tile__kind">([^<]*)<'),
        'secs':     secs,
        'stat':     field(b, r'tile__stat"[^>]*>\s*([^<]+?)\s*<'),
        'statref':  field(b, r'tile__stat"[^>]*href="([^"]+)"'),
        'poster':   field(b, r'<img\s(?:[^>]*\s)?src="(assets/posters/[^"]+)"'),
        'srcset':   srcset,
        'alt':      field(b, r'alt="([^"]+)"'),
        'w':        field(b, r'width="(\d+)"'),
        'h':        field(b, r'height="(\d+)"'),
    })
    if not films[-1]['title'] or not films[-1]['poster']:
        sys.exit('tile missing title or poster')

if not 10 <= len(films) <= len(ALPHABET):
    sys.exit(f'unexpected film count: {len(films)}')
for f in films:
    slug = slugify(f['title'])
    if slug not in KEY_OF:
        free = [c for c in ALPHABET if c not in REG]
        if not free:
            sys.exit('the reel alphabet is spent')
        REG[free[0]] = slug
        KEY_OF[slug] = free[0]
    f['key'] = KEY_OF[slug]
if len({f['key'] for f in films}) != len(films):
    sys.exit('two tiles share a reel key')

reg = json.dumps({k: REG[k] for k in ALPHABET if k in REG}, indent=2) + '\n'
if reg != open(REG_PATH).read():
    open(REG_PATH, 'w').write(reg)

# the keys onto the tiles, for the bin (main.js)
page = SRC
for m_, f in sorted(zip(TILES, films), key=lambda x: -x[0].start()):
    tag = re.match(r'<article [^>]*>', m_.group(0)).group(0)
    new = re.sub(r' data-key="[^"]*"', '', tag)[:-1] + f' data-key="{f["key"]}">'
    page = page[:m_.start()] + new + page[m_.start() + len(tag):]
if page != SRC:
    open('index.html', 'w').write(page)

os.makedirs('functions/_lib', exist_ok=True)
out = ('// GENERATED by bin-build-reel.py from index.html + reel.tpl.html — do not edit.\n'
       f'export const VER = {json.dumps(VER)};\n'
       f'export const ALPHABET = {json.dumps(ALPHABET)};\n'
       f'export const FILMS = {json.dumps(films, ensure_ascii=False, indent=1)};\n'
       f'export const TEMPLATE = {json.dumps(TPL.replace("{{VER}}", VER).replace("{{VER_JS}}", VERJ).replace("{{MARK}}", MARK).replace("{{HOVER_CSS}}", HOVER["{{HOVER_CSS}}"]).replace("{{HOVER_JS}}", HOVER["{{HOVER_JS}}"]), ensure_ascii=False)};\n')
open('functions/_lib/reel.js', 'w').write(out)
print(f'functions/_lib/reel.js: {len(films)} films, keys {ALPHABET[:len(films)]}, styles v{VER}, main v{VERJ}')
