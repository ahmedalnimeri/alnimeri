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

WORDS = {14: 'fourteen', 15: 'fifteen', 16: 'sixteen', 17: 'seventeen',
         18: 'eighteen', 19: 'nineteen', 20: 'twenty'}

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
MARK = re.search(r'src="(assets/logo-96\.png\?h=[a-f0-9]+)"', SRC).group(1)

def field(block, pat, default=''):
    m = re.search(pat, block)
    return m.group(1) if m else default

def slugify(t):
    t = html.unescape(t).lower()
    t = t.replace('&', ' and ').replace('“', '').replace('”', '').replace('"', '')
    t = re.sub(r'[^a-z0-9]+', '-', t)
    return t.strip('-')

films = []
for b in re.findall(r'<article class="tile[\s\S]+?</article>', SRC):
    title = field(b, r'data-title="([^"]+)"')
    if not title:
        sys.exit('tile without a title')
    films.append({
        'title':   title,
        'slug':    slugify(title),
        'vid':     field(b, r'data-video="(\d+)"'),
        'kind':    field(b, r'tile__kind">([^<]*)<'),
        'dur':     field(b, r'tile__dur">([^<]+)<'),
        'idx':     field(b, r'tile__idx">([^<]+)<'),
        'stat':    field(b, r'tile__stat"[^>]*>\s*([^<]+?)\s*<'),
        'statref': field(b, r'tile__stat"[^>]*href="([^"]+)"'),
        'href':    field(b, r'class="tile__link" href="([^"]+)"'),
        # Anchored on the tile's <img>: a <picture> may put a WebP <source>
        # first, and its srcset is not the one the cards are built from.
        'poster':  field(b, r'<img\s(?:[^>]*\s)?src="(assets/posters/[^"]+)"'),
        'srcset':  field(b, r'<img\s(?:[^>]*\s)?srcset="([^"]+)"'),
        'alt':     field(b, r'alt="([^"]+)"'),
        'portrait': field(b, r'data-portrait="(\w+)"') == 'true',
    })

if len(films) < 10 or len(films) not in WORDS:
    sys.exit(f'unexpected film count: {len(films)} (add it to WORDS)')

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
            'www.facebook.com': 'Facebook'}.get(h, h)

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
    <a class="btn btn--solid" href="/#contact">Get in touch</a>
  </nav>
</header>
<main id="top">
'''

FOOT = '''</main>
<script src="/main.js?v={ver}" defer></script>
<script src="/design-filmpages.js?v={djver}" defer></script>
</body>
</html>
'''

os.makedirs('work', exist_ok=True)

# Counts printed in prose are derived, never typed: adding a tile to
# index.html must move every 'one of N films' line with it.
_secs = sum(int(f['dur'].split(':')[0]) * 60 + int(f['dur'].split(':')[1]) for f in films)
COUNT = WORDS.get(len(films), str(len(films)))
TRT   = f'{_secs // 60}:{_secs % 60:02d}'

# ---- categories, shared by the film pages and the index ----------------
# A client arrives knowing the KIND of film they need. Both the index and the
# "more like this" block at the foot of every film page group the work the same
# way the commission cards on the front page do.
CATEGORIES = [
    ('brand',       'Brand &amp; campaign films',      ('Campaign film', 'Brand film', 'Explainer')),
    ('events',      'Event &amp; conference films',    ('Event promo', 'Event film')),
    ('documentary', 'Documentary &amp; human stories', ('Documentary', 'Feature documentary')),
    ('motion',      'Motion, animation &amp; post',    ('Animation', 'Motion graphics', 'Visuals')),
]

# the brief's own names for the kinds of film (main.js, KINDS)
BRIEF_KIND = {'brand': 'brand', 'events': 'events', 'documentary': 'documentary', 'motion': 'post'}

def category_of(kind):
    k = html.unescape(kind).lower()
    for cid, _label, needles in CATEGORIES:
        if any(n.lower() in k for n in needles):
            return cid
    return 'brand'

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

def year_of(f):
    """The year the film was PUBLISHED, and only when the post the view count
    links to proves it: X snowflakes, Instagram shortcodes and TikTok ids all
    carry their own timestamp. Vimeo's uploadDate is when the file was put on
    Vimeo, which is not the same thing — The Greatest Sudanese Sit-In is about
    2019 and was uploaded in 2025 — so it is never used for a printed year."""
    import time
    ref = f.get('statref') or ''
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
        return ''
    if not secs or not (1.2e9 < secs < 2.2e9):
        return ''
    return time.strftime('%Y', time.gmtime(secs))


_card_n = [0]

def still(f, sizes, eager=False, high=False):
    """The film's one still, at its own shape: the vertical films are 9:16."""
    alt = html.escape(html.unescape(f['title']), quote=True)
    w, h = ('720', '1280') if f['portrait'] else ('1280', '720')
    if not f['srcset']:
        return ''
    return ('<img srcset="' + rooted_srcset(f['srcset']) + '" sizes="' + sizes + '"'
            ' src="' + rooted(f['poster']) + '" alt="Still from ' + alt + '"'
            ' width="' + w + '" height="' + h + '" '
            + ('loading="eager"' + (' fetchpriority="high"' if high else '') if eager else 'loading="lazy"')
            + ' decoding="async">')

def card(f, eager_first=0, sizes='(max-width: 700px) 46vw, (max-width: 1100px) 31vw, 320px', short=False, delay=0, shown_first=0):
    """The first card on /work/ is on screen when the page opens (the LCP on a
    phone); lazy-loading it delays the very thing the visitor came to look at.
    Only that one is eager: more eager posters competed with it for the
    phone's bandwidth, and the cards beside it load lazily in time anyway.
    The first shown_first cards skip the scroll reveal, so what is on screen
    at open is there from the first frame."""
    n = _card_n[0]; _card_n[0] += 1
    eager = n < eager_first
    shown = n < max(eager_first, shown_first)
    img = still(f, sizes, eager=eager, high=eager and n == 0)
    yr = year_of(f)
    if short:
        bits = [kind_and_client(f['kind'])[0]] + ([yr] if yr else [])
    else:
        bits = [f['kind'], f['dur']] + ([yr] if yr else []) + ([nowrap_last(f['stat'])] if f['stat'] else [])
    shape = ' fp-card--portrait' if f['portrait'] else ''
    return ('<li class="fp-card' + shape + '" data-cat="' + category_of(f['kind']) + '">'
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


for i, f in enumerate(films):
    prev_f = films[i - 1] if i else None
    next_f = films[i + 1] if i + 1 < len(films) else None
    kind = html.unescape(f['kind'])
    src_name = source_name(f['statref']) if f['statref'] else ''
    stat_txt = html.unescape(f['stat'])
    title_txt = html.unescape(f['title'])

    desc = (f"{title_txt} — {kind} directed by Ahmed El-Nimeri. "
            f"{stat_txt[:1].upper() + stat_txt[1:]}. " if stat_txt else
            f"{title_txt} — {kind} directed by Ahmed El-Nimeri. ")
    desc += f"Running time {f['dur']}."
    desc = html.escape(desc, quote=True)

    schema = {
        "@context": "https://schema.org",
        "@type": "VideoObject" if f["vid"] else "Movie",
        "name": title_txt,
        "description": f"{kind} directed, shot and edited by Ahmed El-Nimeri.",
        "duration": iso_dur(f['dur']),
        "thumbnailUrl": f"https://alnimeri.com/{f['poster'].split('?')[0]}",
        "url": f"https://alnimeri.com/work/{f['slug']}",
        "creator": {"@type": "Person", "name": "Ahmed El-Nimeri", "@id": "https://alnimeri.com/#person"},
        "director": {"@type": "Person", "name": "Ahmed El-Nimeri", "@id": "https://alnimeri.com/#person"},
    }
    if f['vid']:
        schema['uploadDate'] = METADATA[f['vid']]['uploadDate']
        schema['embedUrl'] = f"https://player.vimeo.com/video/{f['vid']}"
    if f['statref']:
        schema['sameAs'] = f['statref']
    m = re.match(r'([\d.]+)([KM]?)', stat_txt)
    if m:
        n = float(m.group(1)) * {'K': 1e3, 'M': 1e6, '': 1}[m.group(2)]
        kindword = 'LikeAction' if 'reaction' in stat_txt else 'WatchAction'
        schema['interactionStatistic'] = {
            "@type": "InteractionCounter",
            "interactionType": {"@type": kindword},
            "userInteractionCount": int(n)}

    schema = {"@context": "https://schema.org", "@graph": [schema, {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Ahmed El-Nimeri", "item": "https://alnimeri.com/"},
            {"@type": "ListItem", "position": 2, "name": "All films", "item": "https://alnimeri.com/work/"},
            {"@type": "ListItem", "position": 3, "name": title_txt}]}]}
    schema["@graph"][0].pop("@context", None)

    enquiry = html.escape("mailto:ahmed@alnimeri.com?" + urlencode({"subject": "Project enquiry — " + title_txt, "body": "Hi Ahmed,\n\nI saw " + title_txt + " on your website and would like to discuss a project.\n\nWhat we’re making:\nTiming and location:\nBudget range (if known):\n\nName / company:\n"}, quote_via=quote), quote=True)

    # the film itself. The page opens on the film's own still; pressing play
    # turns that still into the player (design-filmpages.js), so the Vimeo
    # player and its scripts load only for a visitor who asked for them.
    # Without JavaScript the button is a plain link to the film on Vimeo.
    _kind, _client = kind_and_client(f['kind'])
    _yr = year_of(f)
    _t = html.escape(title_txt, quote=True)
    _sizes = ('(max-width: 700px) 70vw, 440px' if f['portrait']
              else '(max-width: 700px) 92vw, (max-width: 1400px) 80vw, 1180px')
    _still = still(f, _sizes, eager=True, high=True)
    # the same file as the still (same srcset, same sizes), so the light it
    # throws on the page costs no second download
    _light = still(f, _sizes, eager=True).replace(' alt="Still from ' + _t + '"', ' alt=""')
    _icon = '<span class="fp-play__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg></span>'
    if f['vid']:
        play = (f'<a class="fp-play" href="https://vimeo.com/{f["vid"]}" data-vid="{f["vid"]}" data-title="{_t}">'
                f'{_icon}<span class="fp-play__label">Play film</span><span class="fp-play__dur">{f["dur"]}</span></a>')
    elif f['statref']:
        play = (f'<a class="fp-play" href="{f["statref"]}" target="_blank" rel="noopener">'
                f'{_icon}<span class="fp-play__label">Watch on {source_name(f["statref"])}</span>'
                f'<span class="fp-play__dur" aria-hidden="true">&#8599;</span></a>')
    else:
        play = ''
    shape = ' fp-film--portrait' if f['portrait'] else ''
    player = (f'<div class="fp-stage">'
              f'<div class="fp-light" aria-hidden="true">{_light}</div>'
              f'<div class="fp-frame">{_still}{play}</div></div>')

    # One line of facts under the title, in the tile's own words (kind, and
    # the client where the tile names one), then year, running time and the
    # published figure with its source. Nothing is inferred.
    meta = [f'<span>{html.escape(part.strip())}</span>' for part in html.unescape(f['kind']).split('·') if part.strip()]
    if _yr:
        meta.append(f'<span>{_yr}</span>')
    meta.append(f'<span>{f["dur"]}</span>')
    if stat_txt and f['statref']:
        meta.append(f'<a href="{f["statref"]}" target="_blank" rel="noopener">{stat_txt} <span aria-hidden="true">&#8599;</span></a>')

    # and under the picture, the one credit, the way a film ends
    credit = '<span>Directed, shot and edited by</span> <a href="/about">Ahmed El-Nimeri</a>'

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
        reception = (f'<section class="reception reveal" aria-labelledby="said-{f["slug"]}">\n'
                     f'    <h2 class="reception__head" id="said-{f["slug"]}">What people said</h2>\n'
                     f'    <p class="reception__sub">Unedited comments on the <a href="{rec["url"]}" target="_blank" rel="noopener">original post</a>\n'
                     f'      &mdash; {rec["stat"]}. Comments written in Arabic are shown in translation.</p>\n'
                     f'    <div class="reception__grid">{"".join(items)}</div>\n'
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
    _cid = category_of(f['kind'])
    _siblings = [g for g in films if category_of(g['kind']) == _cid and g['slug'] != f['slug']]
    _more = (_siblings + [g for g in films[i + 1:] + films[:i] if g not in _siblings])[:3]
    _head = ('More ' + label_of(_cid).lower()) if len(_siblings) >= 3 else 'More films'
    _all = (f'<a href="/work/#{_cid}">All {label_of(_cid).lower()} <span aria-hidden="true">&#8599;</span></a>'
            if _siblings else '<a href="/work/">All films <span aria-hidden="true">&#8599;</span></a>')
    _hang = []
    for k, g in enumerate(_more):
        grow = 9 / 16 if g['portrait'] else 16 / 9
        _hang.append(card(g, short=True, delay=k * 125,
                          sizes='(max-width: 700px) 60vw, 300px' if g['portrait'] else '(max-width: 700px) 88vw, 520px')
                     .replace('<li class="fp-card', f'<li style="--g:{grow:.3f}" class="fp-card', 1))
    related = (f'<section class="fp-more" aria-labelledby="related-head">'
               f'<div class="fp-more__head reveal"><h2 id="related-head">{_head}</h2>{_all}</div>'
               f'<ol class="fp-hang fp-lights">' + ''.join(_hang) + '</ol></section>')

    body = f'''<section class="fp fp-film{shape}" id="film">
  <div class="fp-hero">
    <header class="fp-head">
      <p class="fp-crumbs"><a href="/work/">All films</a><span aria-hidden="true">/</span><a href="/work/#{_cid}">{label_of(_cid)}</a></p>
      <h1 class="fp-title">{f['title']}</h1>
      <p class="fp-meta">{''.join(meta)}</p>
    </header>
    {player}
    <p class="fp-credit">{credit}</p>
  </div>
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
    <p class="fp-note">One of {COUNT} films in the <a href="/">selected work</a> of Ahmed El-Nimeri,
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
# One wall of stills, each at its own shape, and the kinds of film as tabs
# above it. Choosing a kind re-hangs the wall (design-filmpages.js); the
# sections and their ids stay in the markup, so /work/#documentary still
# opens on the documentaries, with or without JavaScript.
_card_n[0] = 0   # the film pages' related blocks ran first; the index starts fresh
groups = {cid: [f for f in films if category_of(f['kind']) == cid] for cid, _l, _n in CATEGORIES}
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
                    '<ol class="fp-cards">' + ''.join(card(f, eager_first=1, shown_first=5, delay=_delay()) for f in groups[cid]) + '</ol></section>')
# the first film on the wall is hung large (and asks for a picture that size);
# the script moves this with the tabs
LEAD_SIZES = '(max-width: 700px) 92vw, (max-width: 1100px) 64vw, 660px'
_wall = ''.join(sections).replace('<li class="fp-card"', '<li class="fp-card is-lead"', 1)
_wall = re.sub(r'sizes="[^"]*"', 'sizes="' + LEAD_SIZES + '"', _wall, count=1)
rows = ('<nav class="fp-tabs" aria-label="Kinds of film"><div class="fp-tabs__row">' + nav + '</div></nav>'
        + '<div class="fp-wall fp-lights" id="all" data-lead-sizes="' + LEAD_SIZES + '">' + _wall + '</div>')

total = sum(int(f['dur'].split(':')[0]) * 60 + int(f['dur'].split(':')[1]) for f in films)
idx_schema = {
    "@context": "https://schema.org", "@type": "CollectionPage",
    "name": "All films — Ahmed El-Nimeri",
    "url": "https://alnimeri.com/work/",
    "about": {"@id": "https://alnimeri.com/#person"},
    "hasPart": [{"@type": "WebPage", "name": html.unescape(f['title']),
                 "url": f"https://alnimeri.com/work/{f['slug']}"} for f in films]}

_ogw, _ogh = pixels('assets/og-work.jpg')
idx = (HEAD.format(title='All films', slug='', poster='assets/og-work.jpg', ogw=_ogw, ogh=_ogh,
                   og_type='website', skip='Skip to the films', ver=VER, mark=MARK, dver=DVER,
                   desc=f'Every film by Ahmed El-Nimeri on this site — {COUNT} pieces, {TRT} total running time, each with its running time and, where published, its view count and source.',
                   schema=json.dumps(idx_schema, ensure_ascii=False))
       + f'''<section class="fp fp-index" id="film">
  <header class="fp-head">
    <h1 class="fp-title">All films</h1>
    <p class="fp-lede">The same {COUNT} films as the <a href="/">front page</a>, by kind.
      Each page carries the film, its running time and, where published, the post its view count came from.</p>
  </header>
  {rows}
</section>
''' + FOOT.format(ver=VER, djver=DJVER))
open('work/index.html', 'w').write(idx)

print(f'work/: {len(films)} film pages + index, TRT {total // 60}:{total % 60:02d}')
