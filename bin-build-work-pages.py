#!/usr/bin/env python3
"""Generate one indexable page per film, plus the /work index.

Sixteen films with 100M+ views between them existed only as lightboxes — no
URL, nothing on the open web connecting the work to his name. Each film now
has a page carrying its own VideoObject schema, its verified figure with the
link that proves it, and prev/next links so a crawler can walk the whole reel.

Derived from index.html, never hand-maintained: the tiles are the source of
truth, so a film added or reordered there regenerates correctly here. Asset
URLs are copied already-stamped, since bin-stamp-assets.py does not reach
into this directory.
"""
import re, os, json, html, sys, subprocess
from urllib.parse import urlencode, quote

_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
         'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
WORDS = {n: _ONES[n] if n < 20 else _TENS[n // 10] + ('-' + _ONES[n % 10] if n % 10 else '') for n in range(1, 100)}
NUMBER = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

SRC = open('index.html').read()
METADATA = json.load(open('assets/video-metadata.json'))

# Audience comments on the original posts, harvested by hand. Only what is in
# this file is ever published, and only comments about the work itself — the
# threads also carry grief and politics that are not this site's to reprint.
try:
    RECEPTION = json.load(open('assets/reception.json'))
except Exception:
    RECEPTION = {}

VER = re.search(r'styles\.css\?v=(\d+)', SRC).group(1)

# The film pages' own design layer (design-filmpages.css / .js), versioned by
# content like the home page's refinement files.
import hashlib
def _md5(path):
    return hashlib.md5(open(path, 'rb').read()).hexdigest()[:8]
DVER, DJVER = _md5('design-filmpages.css'), _md5('design-filmpages.js')
# the home page's ending (design-ending.css / .js), which /work/ ends on too
EVER, EJVER = _md5('design-ending.css'), _md5('design-ending.js')
MARK = re.search(r'src="(assets/logo-96\.png\?h=[a-f0-9]+)"', SRC).group(1)
# Cloudflare Web Analytics: the front page's own beacon (one token, kept in
# index.html), on every film page and on /work/ too. bin-check.py fails if a
# page has none, or two.
BEACON = re.search(r'<!-- Cloudflare Web Analytics -->[\s\S]*?<!-- End Cloudflare Web Analytics -->', SRC)
if not BEACON or BEACON.group(0).count('beacon.min.js') != 1:
    sys.exit('index.html: no single Cloudflare Web Analytics beacon to copy')
BEACON = BEACON.group(0)

def field(block, pat, default=''):
    m = re.search(pat, block)
    return m.group(1) if m else default

def slugify(t):
    t = html.unescape(t).lower()
    # an apostrophe joins its word (Israel’s Taqueria -> israels-taqueria)
    t = t.replace('&', ' and ').replace('“', '').replace('”', '').replace('"', '').replace('’', '').replace("'", '')
    t = re.sub(r'[^a-z0-9]+', '-', t)
    return t.strip('-')

# The films on the front page are the grid's tiles. The rest wait in
# <template id="more-films"> (never rendered on the front page, so neither
# the grid, its reel nor its bin sees them): films that are on /work/ and
# have their own page, and, marked data-part-of, the further films on an
# entry's page. Every one is the same tile, read the same way.
_more = re.search(r'<template id="more-films">([\s\S]*?)</template>', SRC)
MORE_AT = _more.span() if _more else (len(SRC), len(SRC))

def upto1280(ss):
    """A tile's srcset, without the candidates wider than 1280w: the front
    page's full-row scope tile offers a 2560 file for its own size, and a
    film page or a card asking for that much would only get heavier."""
    keep = []
    for cand in ss.split(','):
        bits = cand.strip().split()
        if bits and not (len(bits) > 1 and bits[1].endswith('w') and int(bits[1][:-1]) > 1280):
            keep.append(' '.join(bits))
    return ', '.join(keep)

films, parts = [], []
for m_ in re.finditer(r'<article class="tile[\s\S]+?</article>', SRC):
    b = m_.group(0)
    title = field(b, r'data-title="([^"]+)"')
    if not title:
        sys.exit('tile without a title')
    # Which relation to Ahmed the film's data may claim. No role is printed
    # or written anywhere for any film (his decision, 2026-10-03: roles are
    # for /cv only), so the tile carries no role, only this:
    #   no data-credit         one of his own films: schema creator
    #   data-credit="contributor"  he worked on it: schema contributor
    #   data-credit="none"     nothing is stated anywhere: no relation at all
    credit = field(b, r'data-credit="([^"]*)"') or None
    if credit not in (None, 'contributor', 'none'):
        sys.exit(f'{title}: data-credit="{credit}" (contributor or none)')
    part_of = field(b, r'data-part-of="([^"]+)"')
    (parts if part_of else films).append({
        'home':    m_.start() < MORE_AT[0],
        'part_of': part_of,
        'credit':  credit,
        'catx':    field(b, r'data-cat="(\w+)"'),
        'title':   title,
        'slug':    slugify(title),
        # the film the site can play: a Vimeo id (digits) or, with
        # data-provider="youtube", a YouTube id; neither on a film that lives
        # only on its post (X), which the page links to instead
        'vid':     field(b, r'data-video="([\w-]+)"'),
        'provider': (field(b, r'data-provider="(\w+)"') or 'vimeo') if field(b, r'data-video="([\w-]+)"') else '',
        'kind':    field(b, r'tile__kind">([^<]*)<'),
        'dur':     field(b, r'tile__dur">([^<]+)<'),
        'idx':     field(b, r'tile__idx">([^<]+)<'),
        'stat':    field(b, r'tile__stat"[^>]*>\s*([^<]+?)\s*<'),
        'statref': field(b, r'tile__stat"[^>]*href="([^"]+)"'),
        'href':    field(b, r'class="tile__link" href="([^"]+)"'),
        # Anchored on the tile's <img>: a <picture> may put a WebP <source>
        # first, and its srcset is not the one the cards are built from.
        'poster':  field(b, r'<img\s(?:[^>]*\s)?src="(assets/posters/[^"]+)"'),
        'srcset':  upto1280(field(b, r'<img\s(?:[^>]*\s)?srcset="([^"]+)"')),
        # and the WebP set of the same still, from that <source>
        'webp':    upto1280(field(b, r'<source type="image/webp" srcset="([^"]+)"')),
        'alt':     field(b, r'alt="([^"]+)"'),
        'portrait': field(b, r'data-portrait="(\w+)"') == 'true',
    })

for f in films + parts:
    ok = {'vimeo': r'\d+', 'youtube': r'[\w-]{11}', '': ''}.get(f['provider'])
    if ok is None or not re.fullmatch(ok, f['vid']):
        sys.exit(f"{f['title']}: data-video=\"{f['vid']}\" does not fit provider \"{f['provider']}\" (vimeo digits, or youtube)")

if len(films) < 10 or len(films) not in WORDS:
    sys.exit(f'unexpected film count: {len(films)} (add it to WORDS)')
HOME = [f for f in films if f['home']]

# An entry's further films hang on its page. The one that is the entry's own
# film (the tile's data-video) is not shown twice: it gives the page its own
# still, where the front page may lead with another frame (Badr Airlines
# leads with the Captain still and plays the brand film).
for f in films:
    f['main'], f['more'] = f, []
for p in parts:
    host = next((f for f in films if f['slug'] == p['part_of']), None)
    if not host:
        sys.exit(f"data-part-of=\"{p['part_of']}\": no such film")
    if p['vid'] and p['vid'] == host['vid']:
        if p['dur'] != host['dur']:
            sys.exit(f"{host['title']}: its own film runs {host['dur']} on the tile and {p['dur']} in its part")
        host['main'] = p
    else:
        host['more'].append(p)

def pixels(path):
    """The real size of a share image, read off the file (as the about
    builder does), so og:image:width/height never guess."""
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path],
                         capture_output=True, text=True).stdout
    w, h = re.search(r'pixelWidth: (\d+)', out), re.search(r'pixelHeight: (\d+)', out)
    if not (w and h):
        sys.exit('cannot read size of ' + path)
    return int(w.group(1)), int(h.group(1))

AR_SCRIPT = re.compile('[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]')

def named(t):
    """A name written in Arabic script is marked as Arabic, so a screen reader
    does not read it with an English voice. Inline, so the caption's own
    alignment is untouched; isolated (dir=auto) only when the name has no Latin
    letters, so a mixed name keeps the order it is shown in today."""
    if not AR_SCRIPT.search(t):
        return t
    return '<span lang="ar"' + ('' if re.search('[A-Za-z]', t) else ' dir="auto"') + '>' + t + '</span>'

def nowrap_last(stat):
    """'293K views on X' must not leave the X alone on a line."""
    head, _, tail = stat.rpartition(' ')
    return head + '&nbsp;' + tail if head else stat

def iso_dur(d):
    m, s = (int(x) for x in d.split(':'))
    return f'PT{m}M{s}S'

def source_name(url):
    h = re.sub(r'^https?://(www\.)?', '', url).split('/')[0]
    return {'x.com': 'X', 'vimeo.com': 'Vimeo', 'www.instagram.com': 'Instagram',
            'instagram.com': 'Instagram', 'www.tiktok.com': 'TikTok',
            'www.facebook.com': 'Facebook', 'youtube.com': 'YouTube',
            'youtu.be': 'YouTube'}.get(h, h)

# Where each provider's film is watched, embedded (schema) and played (the
# facade in design-filmpages.js and main.js turns into this on Play).
def watch_url(rec):
    return (f"https://www.youtube.com/watch?v={rec['vid']}" if rec['provider'] == 'youtube'
            else f"https://vimeo.com/{rec['vid']}")

def embed_url(rec):
    return (f"https://www.youtube.com/embed/{rec['vid']}" if rec['provider'] == 'youtube'
            else f"https://player.vimeo.com/video/{rec['vid']}")

HEAD = '''<!doctype html>
<html lang="en" class="no-js" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Ahmed El-Nimeri</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://alnimeri.com/work/{slug}">
<meta name="theme-color" content="#0a0a0c">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48.png">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon-192.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="{og_type}">
<meta property="og:title" content="{title} — Ahmed El-Nimeri">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="https://alnimeri.com/work/{slug}">
<meta property="og:image" content="https://alnimeri.com/{poster}">
<meta property="og:image:width" content="{ogw}">
<meta property="og:image:height" content="{ogh}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title} — Ahmed El-Nimeri">
<meta name="twitter:description" content="{desc}">
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/poppins-600.woff2" crossorigin>
<link rel="stylesheet" href="/styles.css?v={ver}">
<link rel="stylesheet" href="/design-filmpages.css?v={dver}">
<script type="application/ld+json">{schema}</script>
</head>
<body>
<a class="skip" href="#film">{skip}</a>
<header class="masthead">
  <a class="masthead__mark" href="/" aria-label="Ahmed El-Nimeri — home"><img class="mark" src="/{mark}" alt="" width="32" height="30" aria-hidden="true"><span>Ahmed El-Nimeri</span></a>
  <nav class="masthead__nav" aria-label="Primary">
    <a href="/">Work</a>
    <a href="/about">About</a>
    <a href="/cv">CV</a>
    <a class="btn btn--solid" href="/#contact"><span class="masthead__long">Get in touch</span><span class="masthead__short">Brief</span></a>
  </nav>
</header>
<main id="top">
'''

FOOT = '''</main>
<script src="/main.js?v={ver}" defer></script>
<script src="/design-filmpages.js?v={djver}" defer></script>
''' + BEACON.replace('{', '{{').replace('}', '}}') + '''
</body>
</html>
'''

os.makedirs('work', exist_ok=True)

# Counts printed in prose are derived, never typed: adding a tile to
# index.html must move every 'one of N films' line with it.
# The running time is every film the site plays: each entry's own film and
# the further films on its page (Badr Airlines holds three), so 'twenty-four
# pieces' and the time beside it describe the same wall.
EVERY = films + [p for f in films for p in f['more']]
_secs = sum(int(f['dur'].split(':')[0]) * 60 + int(f['dur'].split(':')[1]) for f in EVERY)
COUNT = WORDS.get(len(films), str(len(films)))
TRT   = f'{_secs // 60}:{_secs % 60:02d}'
# the front page shows some of them; /work/ shows them all
HOME_COUNT, MORE_COUNT = WORDS.get(len(HOME), str(len(HOME))), len(films) - len(HOME)

# ---- categories, shared by the film pages and the index ----------------
# A client arrives knowing the KIND of film they need. Both the index and the
# "more like this" block at the foot of every film page group the work the same
# way the commission cards on the front page do.
CATEGORIES = [
    ('brand',       'Brand &amp; campaign films',      ('Campaign film', 'Brand film', 'Explainer')),
    ('events',      'Event &amp; conference films',    ('Event promo', 'Event film')),
    ('documentary', 'Documentary &amp; human stories', ('Documentary', 'Feature documentary')),
    ('motion',      'Motion, animation &amp; post',    ('Animation', 'Motion graphics', 'Visuals')),
    # last: the wall's last film is hung across its row, and a music video
    # is the picture that carries a row best
    ('music',       'Music videos',                    ('Music video',)),
]

# the brief's own names for the kinds of film (main.js, KINDS)
BRIEF_KIND = {'brand': 'brand', 'events': 'events', 'documentary': 'documentary', 'music': 'other', 'motion': 'post'}

def category_of(kind):
    k = html.unescape(kind).lower()
    for cid, _label, needles in CATEGORIES:
        if any(n.lower() in k for n in needles):
            return cid
    return 'brand'

# A film whose kind names no category says which one it belongs to on its
# tile (data-cat): Stim is a TV commercial, shown for its post-production.
for f in films:
    f['cat'] = f['catx'] or category_of(f['kind'])
    if f['cat'] not in BRIEF_KIND:
        sys.exit(f"{f['title']}: no category '{f['cat']}'")

def label_of(cid):
    return next(label for c, label, _n in CATEGORIES if c == cid)

def rooted(url):
    """Tiles on the front page use relative asset URLs; under /work/ those
    resolve to /work/assets/... and 404. Root them."""
    u = url.strip()
    return u if u.startswith(('/', 'http')) else '/' + u

def rooted_srcset(ss):
    out = []
    for cand in ss.split(','):
        parts = cand.strip().split(' ')
        if not parts or not parts[0]:
            continue
        out.append(rooted(parts[0]) + (' ' + ' '.join(parts[1:]) if len(parts) > 1 else ''))
    return ', '.join(out)

def posted_at(ref):
    """When the post at ref went up, in seconds since 1970, read off its own id:
    X snowflakes, Instagram shortcodes and TikTok ids all carry their
    timestamp. None for any other link, or an id that decodes to nonsense.
    (Checked against the team's tracker: every one of its 90 X posts decodes
    to the date it lists, in UTC or in Dubai.)"""
    ref = ref or ''
    secs = None
    try:
        m = re.search(r'x\.com/[^/]+/status/(\d+)', ref)
        if m:
            secs = ((int(m.group(1)) >> 22) + 1288834974657) / 1000
        if secs is None:
            m = re.search(r'instagram\.com/(?:p|reel)/([A-Za-z0-9_-]+)', ref)
            if m:
                A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
                mid = 0
                for ch in m.group(1)[:11]:
                    mid = mid * 64 + A.index(ch)
                secs = ((mid >> 23) + 1314220021721) / 1000
        if secs is None:
            m = re.search(r'tiktok\.com/[^/]+/video/(\d+)', ref)
            if m:
                secs = int(m.group(1)) >> 32
    except Exception:
        return None
    if not secs or not (1.2e9 < secs < 2.2e9):
        return None
    return secs

def year_of(f):
    """The year the film was PUBLISHED, and only when the post the view count
    links to proves it: X snowflakes, Instagram shortcodes and TikTok ids all
    carry their own timestamp. Vimeo's uploadDate is when the file was put on
    Vimeo, which is not the same thing — The Greatest Sudanese Sit-In is about
    2019 and was uploaded in 2025 — so it is never used for a printed year."""
    import time
    # A YouTube film's date is the one its own watch page shows as published
    # (assets/video-metadata.json, read off the page), so it may be printed.
    if f.get('provider') == 'youtube' and f.get('vid') in METADATA:
        return METADATA[f['vid']]['uploadDate'][:4]
    secs = posted_at(f.get('statref'))
    return time.strftime('%Y', time.gmtime(secs)) if secs else ''


_card_n = [0]

def still(f, sizes, eager=False, high=False, webp=False):
    """The film's one still, at its own shape: the vertical films are 9:16.
    webp: offered first as the tile's WebP set (about a third lighter), for
    the film page's own picture and its light, which share one download."""
    alt = html.escape(html.unescape(f['title']), quote=True)
    w, h = ('720', '1280') if f['portrait'] else ('1280', '720')
    if not f['srcset']:
        return ''
    img = ('<img srcset="' + rooted_srcset(f['srcset']) + '" sizes="' + sizes + '"'
           ' src="' + rooted(f['poster']) + '" alt="Still from ' + alt + '"'
           ' width="' + w + '" height="' + h + '" '
           + ('loading="eager"' + (' fetchpriority="high"' if high else '') if eager else 'loading="lazy"')
           + ' decoding="async">')
    if webp and f['webp']:
        return ('<picture><source type="image/webp" srcset="' + rooted_srcset(f['webp']) + '" sizes="' + sizes + '">'
                + img + '</picture>')
    return img

def wall_still(f):
    """On the /work/ wall every film sits in the same 16:9 frame, and a
    vertical film's 9:16 poster cut down to that is a face filling the card.
    Where the vertical film has its own 16:9 still (<poster>-card.jpg and its
    -480/-768 sizes, cut from the same frame), the wall shows that instead;
    the film's page and the "more films" line keep the 9:16 poster."""
    if not f['portrait'] or not f['poster']:
        return f
    base = f['poster'].split('?')[0][:-len('.jpg')] + '-card'
    files = [(f'{base}-480.jpg', 480), (f'{base}-768.jpg', 768), (f'{base}.jpg', 1280)]
    if not all(os.path.exists(p) for p, _w in files):
        return f
    # stamped here: bin-stamp-assets.py does not reach into work/
    stamp = lambda p: f'{p}?h={_md5(p)}'
    return dict(f, portrait=False, poster=stamp(f'{base}.jpg'), webp='',
                srcset=', '.join(f'{stamp(p)} {w}w' for p, w in files))

def card(f, eager_first=0, sizes='(max-width: 700px) 46vw, (max-width: 1100px) 31vw, 320px', short=False, delay=0, shown_first=0, wall=False):
    """The first card on /work/ is on screen when the page opens (the LCP on a
    phone); lazy-loading it delays the very thing the visitor came to look at.
    Only that one is eager: more eager posters competed with it for the
    phone's bandwidth, and the cards beside it load lazily in time anyway.
    The first shown_first cards skip the scroll reveal, so what is on screen
    at open is there from the first frame."""
    n = _card_n[0]; _card_n[0] += 1
    eager = n < eager_first
    shown = n < max(eager_first, shown_first)
    img = still(wall_still(f) if wall else f, sizes, eager=eager, high=eager and n == 0)
    yr = year_of(f)
    if short:
        bits = [kind_and_client(f['kind'])[0]] + ([yr] if yr else [])
    else:
        bits = [f['kind'], f['dur']] + ([yr] if yr else []) + ([nowrap_last(f['stat'])] if f['stat'] else [])
    shape = ' fp-card--portrait' if f['portrait'] else ''
    return ('<li class="fp-card' + shape + '" data-cat="' + f['cat'] + '">'
            # the cards on screen when the page opens are there from the first
            # frame: the picture a visitor came for never waits on a script
            + ('<a href="/work/' + f['slug'] + '">' if shown else
               '<a class="reveal" data-delay="' + str(delay) + '" href="/work/' + f['slug'] + '">')
            + '<span class="fp-card__still">' + img + '</span>'
            '<span class="fp-card__name">' + f['title'] + '</span>'
            '<span class="fp-card__meta">' + '&nbsp;&middot; '.join(bits) + '</span></a></li>')   # no line starts with ·


def kind_and_client(kind):
    """'Explainer · FITTR' is a kind and the client it was made for. A part
    that names a kind of film stays with the kind ('Animation · Motion
    graphics'); anything else is the client the tile already names."""
    kinds, clients = [], []
    for part in (p.strip() for p in html.unescape(kind).split('·')):
        if not part:
            continue
        is_kind = any(n.lower() in part.lower() for _c, _l, needles in CATEGORIES for n in needles)
        (kinds if is_kind or not kinds else clients).append(part)
    return ' · '.join(kinds), ' · '.join(clients)


PERSON = {"@type": "Person", "name": "Ahmed El-Nimeri", "@id": "https://alnimeri.com/#person"}

def neutral(title, kind, yr, stat, dur):
    """What a film is, in its own facts and no one's role: the words a search
    result or a shared link shows (meta, og and twitter descriptions), the
    film's schema description and its line in llms.txt.
    '<Title> — <kind>[, <year>]. <Figure>. Running time m:ss.'"""
    d = title + (f" — {kind}" if kind else '') + (f", {yr}" if yr else '') + '. '
    if stat:
        d += f"{stat[:1].upper() + stat[1:]}. "
    return d + f"Running time {dur}."

def video_object(rec, name, kind, credit, page_url, frag='film'):
    """One film as schema.org data, under its own @id on its page
    (/work/<slug>#film), which the front page's list and /work/ point to.
    No role is named, and nothing claims a director (Ahmed, 2026-10-03): his
    own films have him as creator, a film he worked on as contributor, and a
    film that states nothing has no relation to him at all.

    A film the site plays is at its page, embedded from Vimeo or YouTube. A
    film that lives only on its post (X) is a VideoObject too: its url is the
    post, it has no embedUrl, and its uploadDate is read off the post's id."""
    v = {"@type": "VideoObject", "@id": f"{page_url}#{frag}", "name": name,
         "description": neutral(name, kind, year_of(rec), html.unescape(rec['stat']), rec['dur']),
         "thumbnailUrl": f"https://alnimeri.com/{rec['poster'].split('?')[0]}",
         "duration": iso_dur(rec['dur'])}
    meta = METADATA.get(rec['vid'], {}) if rec['vid'] else {}
    if rec['vid']:
        v.update({"url": page_url, "embedUrl": embed_url(rec), "uploadDate": meta['uploadDate']})
    elif rec['statref']:
        v["url"] = rec['statref']
        secs = posted_at(rec['statref'])
        if secs:
            import time
            v["uploadDate"] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(int(secs)))
    else:
        v["url"] = page_url
    if meta.get('inLanguage'):
        v["inLanguage"] = meta['inLanguage']
    if credit is None:
        v["creator"] = dict(PERSON)
    elif credit == 'contributor':
        v["contributor"] = dict(PERSON)
    if rec['statref'] and rec['statref'] != v["url"]:
        v['sameAs'] = rec['statref']
    st = html.unescape(rec['stat'])
    m = re.match(r'([\d.]+)([KM]?)', st)
    if m:
        n = float(m.group(1)) * {'K': 1e3, 'M': 1e6, '': 1}[m.group(2)]
        v['interactionStatistic'] = {
            "@type": "InteractionCounter",
            "interactionType": {"@type": 'LikeAction' if 'reaction' in st else 'WatchAction'},
            "userInteractionCount": int(n)}
    return v

PLAY_ICON = '<span class="fp-play__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg></span>'

def play_of(rec):
    """Play: the still becomes the player (design-filmpages.js): Vimeo's, or
    YouTube's privacy-enhanced one for a film on YouTube (data-provider).
    Without JavaScript, a plain link to the film there. A film with neither
    (on X only) opens its post instead."""
    t = html.escape(html.unescape(rec['title']), quote=True)
    if rec['vid']:
        prov = f' data-provider="{rec["provider"]}"' if rec['provider'] != 'vimeo' else ''
        return (f'<a class="fp-play" href="{watch_url(rec)}" data-vid="{rec["vid"]}"{prov} data-title="{t}">'
                f'{PLAY_ICON}<span class="fp-play__label">Play film</span><span class="fp-play__dur">{rec["dur"]}</span></a>')
    if rec['statref']:
        return (f'<a class="fp-play" href="{rec["statref"]}" target="_blank" rel="noopener">'
                f'{PLAY_ICON}<span class="fp-play__label">Watch on {source_name(rec["statref"])}</span>'
                f'<span class="fp-play__dur" aria-hidden="true">&#8599;</span></a>')
    return ''

def facts(rec, yr=''):
    """The tile's own words (kind, and the client where it names one), then
    year, running time and the published figure with its source."""
    out = [f'<span>{html.escape(part.strip())}</span>' for part in html.unescape(rec['kind']).split('·') if part.strip()]
    if yr:
        out.append(f'<span>{yr}</span>')
    out.append(f'<span>{rec["dur"]}</span>')
    st = html.unescape(rec['stat'])
    if st and rec['statref']:
        out.append(f'<a href="{rec["statref"]}" target="_blank" rel="noopener">{st} <span aria-hidden="true">&#8599;</span></a>')
    return ''.join(out)


for i, f in enumerate(films):
    prev_f = films[i - 1] if i else None
    next_f = films[i + 1] if i + 1 < len(films) else None
    kind = html.unescape(f['kind'])
    src_name = source_name(f['statref']) if f['statref'] else ''
    stat_txt = html.unescape(f['stat'])
    title_txt = html.unescape(f['title'])

    # What a search result or a shared link says: the film's own facts, as
    # the page shows them, and no role (no "directed by", nothing a credit
    # would say). "<Title> — <kind>[, <year>]. <Figure>. Running time m:ss."
    desc = html.escape(neutral(title_txt, kind, year_of(f), stat_txt, f['dur']), quote=True)

    _url = f"https://alnimeri.com/work/{f['slug']}"
    # the page's own film, its still from that film; then any further films,
    # each under its own @id on this page (#film-<its id>)
    schema = video_object(dict(f, poster=f['main']['poster']), title_txt, kind, f['credit'], _url)
    # (a further film whose tile names no kind is that entry's film: Captain
    # is "Badr Airlines film.", claiming nothing its Vimeo title does not)
    _others = [video_object(p, html.unescape(p['title']), html.unescape(p['kind']) or f"{title_txt} film", p['credit'], _url,
                            frag=f"film-{p['vid'] or n + 2}")
               for n, p in enumerate(f['more'])]

    schema = {"@context": "https://schema.org", "@graph": [schema] + _others + [{
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Ahmed El-Nimeri", "item": "https://alnimeri.com/"},
            {"@type": "ListItem", "position": 2, "name": "All films", "item": "https://alnimeri.com/work/"},
            {"@type": "ListItem", "position": 3, "name": title_txt}]}]}

    enquiry = html.escape("mailto:ahmed@alnimeri.com?" + urlencode({"subject": "Project enquiry — " + title_txt, "body": "Hi Ahmed,\n\nI saw " + title_txt + " on your website and would like to discuss a project.\n\nWhat we’re making:\nTiming and location:\nBudget range (if known):\n\nName / company:\n"}, quote_via=quote), quote=True)

    # the film itself. The page opens on the film's own still; pressing play
    # turns that still into the player (design-filmpages.js), so the Vimeo or YouTube
    # player and its scripts load only for a visitor who asked for them.
    # Without JavaScript the button is a plain link to the film there.
    _kind, _client = kind_and_client(f['kind'])
    _yr = year_of(f)
    _t = html.escape(title_txt, quote=True)
    _sizes = ('(max-width: 700px) 70vw, 440px' if f['portrait']
              else '(max-width: 700px) 92vw, (max-width: 1400px) 80vw, 1180px')
    # (an entry's own film may have its own still, apart from its tile's: main)
    _still = still(f['main'], _sizes, eager=True, high=True, webp=True)
    # the same file as the still (same srcset, same sizes), so the light it
    # throws on the page costs no second download
    _light = still(f['main'], _sizes, eager=True, webp=True).replace(' alt="Still from ' + _t + '"', ' alt=""')
    play = play_of(f)
    shape = ' fp-film--portrait' if f['portrait'] else ''
    player = (f'<div class="fp-stage">'
              f'<div class="fp-light" aria-hidden="true">{_light}</div>'
              f'<div class="fp-frame">{_still}{play}</div></div>')

    # One line of facts under the title, in the tile's own words (kind, and
    # the client where the tile names one), then year, running time and the
    # published figure with its source. Nothing is inferred.
    meta = facts(f, _yr)

    # No credit line under the picture: Ahmed asked for the credits to come off
    # every film (2026-10-03), so nothing here states a role.

    # Further films on this entry's page (data-part-of): each its own frame,
    # its own play and its own facts. No credit, as on the entry's own film.
    also = ''
    if f['more']:
        _items = []
        for p in f['more']:
            _items.append(
                f'<article class="fp-also__film reveal">'
                f'<div class="fp-frame">{still(p, "(max-width: 700px) 92vw, (max-width: 1400px) 46vw, 640px", webp=True)}{play_of(p)}</div>'
                f'<h3 class="fp-also__name">{p["title"]}</h3>'
                f'<p class="fp-meta">{facts(p, year_of(p))}</p>'
                '</article>')
        _n = len(f['more'])
        also = (f'\n  <section class="fp-also" aria-labelledby="also-head">\n'
                f'    <h2 class="fp-also__head reveal" id="also-head">{NUMBER[_n].capitalize()} more {f["title"]} film{"s" if _n > 1 else ""}</h2>\n'
                f'    <div class="fp-also__films">{"".join(_items)}</div>\n'
                f'  </section>')

    # What the audience said, in their own words, off the original post.
    rec = RECEPTION.get(f['slug'])
    reception = ''
    if rec and rec.get('quotes'):
        items = []
        for q in rec['quotes']:
            en = q.get('en', '').strip()
            # Translation only on the page; the Arabic original stays in
            # assets/reception.json for the record.
            items.append(
                f'<figure class="said">'
                f'<blockquote class="said__en">{html.escape(en)}</blockquote>'
                f'<figcaption class="said__by">{named(html.escape(q.get("by", "")))}</figcaption></figure>')
        # A long thread (Al Doroub has two dozen) shows its first six and keeps
        # the rest in a native <details>: it opens without JavaScript and does
        # not animate, and the count on it is the thread's own.
        SHOWN = 6
        grid = f'    <div class="reception__grid">{"".join(items[:SHOWN])}</div>\n'
        if len(items) > SHOWN:
            grid += (f'    <details class="reception__more">'
                     f'<summary><span class="reception__open">Read all {len(items)} comments</span>'
                     f'<span class="reception__fewer">Show fewer comments</span></summary>'
                     f'<div class="reception__grid">{"".join(items[SHOWN:])}</div></details>\n')
        reception = (f'<section class="reception reveal" aria-labelledby="said-{f["slug"]}">\n'
                     f'    <h2 class="reception__head" id="said-{f["slug"]}">What people said</h2>\n'
                     f'    <p class="reception__sub">Unedited comments on the <a href="{rec["url"]}" target="_blank" rel="noopener">original post</a>\n'
                     f'      &mdash; {rec["stat"]}. Comments written in Arabic are shown in translation.</p>\n'
                     + grid +
                     f'  </section>')

    nav = []
    if prev_f: nav.append(f'<a class="fp-nav__prev" href="/work/{prev_f["slug"]}"><span>Previous</span>{html.escape(html.unescape(prev_f["title"]))}</a>')
    nav.append('<a class="fp-nav__all" href="/work/">All films</a>')
    if next_f: nav.append(f'<a class="fp-nav__next" href="/work/{next_f["slug"]}"><span>Next</span>{html.escape(html.unescape(next_f["title"]))}</a>')

    # More of the same kind of work: a client who liked this one is asking
    # whether there are others like it, and the answer is one click away.
    # Hung on one line at one height, every still at its own shape, so a
    # vertical film stands as a vertical film. A kind with fewer than three
    # others is topped up from the rest of the work.
    _cid = f['cat']
    _siblings = [g for g in films if g['cat'] == _cid and g['slug'] != f['slug']]
    _more = (_siblings + [g for g in films[i + 1:] + films[:i] if g not in _siblings])[:3]
    _head = ('More ' + label_of(_cid).lower()) if len(_siblings) >= 3 else 'More films'
    _all = (f'<a href="/work/#{_cid}">All {label_of(_cid).lower()} <span aria-hidden="true">&#8599;</span></a>'
            if _siblings else '<a href="/work/">All films <span aria-hidden="true">&#8599;</span></a>')
    _hang = []
    for k, g in enumerate(_more):
        grow = 9 / 16 if g['portrait'] else 16 / 9
        c = (card(g, short=True, delay=k * 125,
                  sizes='(max-width: 700px) 60vw, 300px' if g['portrait'] else '(max-width: 700px) 88vw, 520px')
             .replace('<li class="fp-card', f'<li style="--g:{grow:.3f}" class="fp-card', 1))
        # Under a landscape film with nothing between it and this block, the
        # first card's top already shows at the foot of a phone's first
        # screen, and waiting on lazy-loading and on the scroll reveal made it
        # the page's last paint. So it is eager (it is fetched before load
        # either way, so that costs nothing extra) and, on a phone, there from
        # the first frame (is-peek, design-filmpages.css); on a wider screen,
        # where it is well below the fold, it still arrives with the others.
        # (Not card()'s eager_first/shown_first: those count across every page.)
        if k == 0 and not f['portrait'] and not reception and not also:
            c = (c.replace('loading="lazy"', 'loading="eager"', 1)
                  .replace('class="fp-card', 'class="fp-card is-peek', 1))
        _hang.append(c)
    related = (f'<section class="fp-more" aria-labelledby="related-head">'
               f'<div class="fp-more__head reveal"><h2 id="related-head">{_head}</h2>{_all}</div>'
               f'<ol class="fp-hang fp-lights">' + ''.join(_hang) + '</ol></section>')

    body = f'''<section class="fp fp-film{shape}" id="film">
  <div class="fp-hero">
    <header class="fp-head">
      <p class="fp-crumbs"><a href="/work/">All films</a><span aria-hidden="true">/</span><a href="/work/#{_cid}">{label_of(_cid)}</a></p>
      <h1 class="fp-title">{f['title'].replace(' — ', '&nbsp;— ').replace(' &mdash; ', '&nbsp;&mdash; ')}</h1>
      <p class="fp-meta">{meta}</p>
    </header>
    {player}
  </div>{also}
  {reception}
  {related}
  <section class="fp-close reveal" aria-labelledby="brief-head">
    <div class="fp-light fp-light--end" aria-hidden="true">{_light.replace('loading="eager"', 'loading="lazy"')}</div>
    <h2 id="brief-head">Have a project in mind?</h2>
    <p>Tell me what you’re making and when you need it. A few lines are enough.</p>
    <!--email_off--><a class="btn btn--solid" href="{enquiry}" data-kind="{BRIEF_KIND[_cid]}">Send the brief <span aria-hidden="true">↗</span></a><!--/email_off-->
  </section>
  <footer class="fp-foot">
    <nav class="fp-nav" aria-label="Films">{''.join(nav)}</nav>
    <p class="fp-note">One of {COUNT} films in the <a href="/work/">selected work</a> of Ahmed El-Nimeri,
      a film director and Associate Creative Director based in Dubai. Every figure on this site links
      to the published post it came from.</p>
  </footer>
</section>
'''
    _poster = f['poster'].split('?')[0]
    ogw, ogh = pixels(_poster)
    page = (HEAD.format(title=html.escape(title_txt, quote=True), desc=desc, slug=f['slug'],
                        poster=_poster, ogw=ogw, ogh=ogh, og_type='video.other', skip='Skip to the film',
                        ver=VER, mark=MARK, dver=DVER,
                        schema=json.dumps(schema, ensure_ascii=False))
            + body + FOOT.format(ver=VER, djver=DJVER))
    open(f"work/{f['slug']}.html", 'w').write(page)

# ---- the index -----------------------------------------------------------
# The Solana videos he edited have a list of their own (/work/solana, from
# assets/solana-edits.json, bin-build-solana.py); the lede points to it with
# the count read from the same file.
_sol = json.load(open('assets/solana-edits.json'))['videos']
SOLANA_LINE = (f' The {WORDS.get(len(_sol), len(_sol))} Solana videos I edited are'
               f' <a href="/work/solana">listed with their views</a>.')
LEDE = (f'The same {COUNT} films as the <a href="/">front page</a>' if not MORE_COUNT else
        f'The {HOME_COUNT} films on the <a href="/">front page</a> and {WORDS.get(MORE_COUNT, MORE_COUNT)} more')
# One wall of stills, each at its own shape, and the kinds of film as tabs
# above it. Choosing a kind re-hangs the wall (design-filmpages.js); the
# sections and their ids stay in the markup, so /work/#documentary still
# opens on the documentaries, with or without JavaScript.
_card_n[0] = 0   # the film pages' related blocks ran first; the index starts fresh
groups = {cid: [f for f in films if f['cat'] == cid] for cid, _l, _n in CATEGORIES}
nav = ('<a href="#all" data-cat="all">All films <span>' + str(len(films)) + '</span></a>'
       + ''.join('<a href="#' + cid + '" data-cat="' + cid + '">' + label + ' <span>' + str(len(groups[cid])) + '</span></a>'
                 for cid, label, _n in CATEGORIES if groups[cid]))
sections = []
_k = [0]
def _delay():
    d = (_k[0] % 4) * 83 + (_k[0] // 4) * 42 if _k[0] < 8 else 0
    _k[0] += 1
    return d
for cid, label, _n in CATEGORIES:
    if not groups[cid]:
        continue
    count = str(len(groups[cid])) + (' film' if len(groups[cid]) == 1 else ' films')
    # a kind of four films or fewer is hung large, as many to a row as make
    # it whole (three in a row for three, two for two or four), instead of
    # leaving most of a four-column wall empty (data-few)
    few = ' data-few="' + str(len(groups[cid])) + '"' if len(groups[cid]) <= 4 else ''
    sections.append('<section class="fp-cat" id="' + cid + '"' + few + '>'
                    '<h2 class="fp-cat__head">' + label + ' <span>' + count + '</span></h2>'
                    '<ol class="fp-cards">' + ''.join(card(f, eager_first=1, shown_first=5, delay=_delay(), wall=True) for f in groups[cid]) + '</ol></section>')
# the first film on the wall is hung large (and asks for a picture that size);
# the script moves this with the tabs
LEAD_SIZES = '(max-width: 700px) 92vw, (max-width: 1100px) 64vw, 660px'
_wall = ''.join(sections).replace('<li class="fp-card"', '<li class="fp-card is-lead"', 1)
_wall = re.sub(r'sizes="[^"]*"', 'sizes="' + LEAD_SIZES + '"', _wall, count=1)
rows = ('<nav class="fp-tabs" aria-label="Kinds of film"><div class="fp-tabs__row">' + nav + '</div></nav>'
        + '<div class="fp-wall fp-lights" id="all" data-lead-sizes="' + LEAD_SIZES + '">' + _wall + '</div>')

total = _secs
# hasPart names each film by the @id its own page gives it (the front page's
# list points to the same ones), so every film is one node however it is reached
idx_schema = {
    "@context": "https://schema.org", "@type": "CollectionPage",
    "@id": "https://alnimeri.com/work/#page",
    "name": "All films — Ahmed El-Nimeri",
    "url": "https://alnimeri.com/work/",
    "isPartOf": {"@id": "https://alnimeri.com/#website"},
    "about": {"@id": "https://alnimeri.com/#person"},
    "hasPart": [{"@id": f"https://alnimeri.com/work/{f['slug']}#film"} for f in films]}

# the share card prints the count (bin-build-og.py); a new count is a new
# file name, so no cache can go on showing the old number
OG_WORK = 'assets/og-work-3.jpg'
_ogw, _ogh = pixels(OG_WORK)
idx = (HEAD.format(title='All films', slug='', poster=OG_WORK, ogw=_ogw, ogh=_ogh,
                   og_type='website', skip='Skip to the films', ver=VER, mark=MARK, dver=DVER,
                   desc=f'Every film on Ahmed El-Nimeri’s site — {COUNT} pieces, {TRT} total running time, each with its running time and, where published, its view count and source.',
                   schema=json.dumps(idx_schema, ensure_ascii=False))
       + f'''<section class="fp fp-index" id="film">
  <header class="fp-head">
    <h1 class="fp-title">All films</h1>
    <p class="fp-lede">{LEDE}, by kind.
      Each page carries the film, its running time and, where published, the post its view count came from.{SOLANA_LINE}</p>
  </header>
  {rows}
</section>
''' + FOOT.format(ver=VER, djver=DJVER))
# /work/ ends the way the front page does, not on its last card: the same
# end credits, lifted from index.html so the two can never drift (the same
# ask, the same button, the address and the colophon). design-ending.js rolls
# the wall's own landscape stills past it; the vertical films stay out, as
# they do on the front page.
_end = re.search(r'<section class="contact ending" id="contact">[\s\S]*?</section>', SRC)
if not _end:
    sys.exit('index.html: no <section class="contact ending"> to end /work/ on')
ENDING = _end.group(0)
ENDING = re.sub(r'<!-- The end credits\.[\s\S]*?-->',
                '<!-- The end credits, as on the front page (lifted from index.html by\n'
                '         bin-build-work-pages.py). design-ending.js fills the roll from the\n'
                '         landscape stills on this wall. -->', ENDING, count=1)
# the front page's relative asset URLs, rooted for /work/
ENDING = re.sub(r'(src|href)="assets/', r'\1="/assets/', ENDING)
if re.search(r'(src|href)="(?![/#]|https?:|mailto:)', ENDING):
    sys.exit('the ending carries a relative URL that /work/ would break')
idx = idx.replace('</section>\n</main>\n',
                  '</section>\n'
                  '<!-- the ending\'s own styles, here rather than in the head so they never\n'
                  '     hold up the first paint of the wall -->\n'
                  f'<link rel="stylesheet" href="/design-ending.css?v={EVER}">\n'
                  + ENDING + '\n</main>\n', 1)
idx = idx.replace(f'<script src="/design-filmpages.js?v={DJVER}" defer></script>\n',
                  f'<script src="/design-filmpages.js?v={DJVER}" defer></script>\n'
                  f'<script src="/design-ending.js?v={EJVER}" defer></script>\n', 1)
if 'design-ending.js' not in idx or 'class="contact ending"' not in idx:
    sys.exit('work/index.html: the ending did not go in')
open('work/index.html', 'w').write(idx)

# /brief?film=<slug> (functions/brief) accepts only a film that has a page
# here: the edge reads the list from this generated module.
_slugs = '// GENERATED by bin-build-work-pages.py from index.html — do not edit.\n' \
         '// Every film with a page under /work/: the films a /brief link may name,\n' \
         '// and the only films an event (/api/e) may record.\n' \
         'export const SLUGS = ' + json.dumps(sorted(f['slug'] for f in films), indent=1) + ';\n' \
         '// Each one\'s title, for the event log\'s reader (the Events tab).\n' \
         'export const TITLES = ' + json.dumps({f['slug']: html.unescape(f['title']) for f in sorted(films, key=lambda f: f['slug'])},
                                               ensure_ascii=False, indent=1) + ';\n'
os.makedirs('functions/_lib', exist_ok=True)
if not os.path.exists('functions/_lib/films.js') or open('functions/_lib/films.js').read() != _slugs:
    open('functions/_lib/films.js', 'w').write(_slugs)

# (llms.txt, with its count and one line per film, is bin-build-llms.py's,
# from these pages)

print(f'work/: {len(films)} film pages ({len(HOME)} on the front page, {sum(len(g["more"]) for g in films)} further films on their pages) + index, TRT {total // 60}:{total % 60:02d}')
