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

def card(f, eager_first=0):
    """The first card on /work/ is on screen when the page opens (the LCP on a
    phone); lazy-loading it delays the very thing the visitor came to look at.
    Only that one is eager: three more eager posters competed with it for the
    phone's bandwidth, and the cards beside it load lazily in time anyway.
    Cards are 270-312px wide from 1024px up (the column is 1320px of content,
    like the masthead's), about 44vw from 600 to 900px and about 90vw below
    that, which is what sizes says."""
    alt = html.escape(html.unescape(f['title']), quote=True)
    n = _card_n[0]; _card_n[0] += 1
    eager = n < eager_first
    img = ''
    if f['srcset']:
        img = ('<img srcset="' + rooted_srcset(f['srcset']) + '" sizes="(max-width: 560px) 90vw, (max-width: 900px) 44vw, 312px"'
               ' src="' + rooted(f['poster']) + '" alt="Still from ' + alt + '"'
               ' width="1280" height="720" ' + ('loading="eager"' + (' fetchpriority="high"' if n == 0 else '') if eager else 'loading="lazy"') + ' decoding="async">')
    yr = year_of(f)
    bits = [f['kind'], f['dur']] + ([yr] if yr else []) + ([nowrap_last(f['stat'])] if f['stat'] else [])
    return ('<li class="filmcard"><a href="/work/' + f['slug'] + '">' + img
            + '<span class="filmcard__name">' + f['title'] + '</span>'
            + '<span class="filmcard__meta">' + '&nbsp;&middot; '.join(bits) + '</span></a></li>')   # no line starts with ·


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

    # the film itself
    if f['vid']:
        player = (f'<div class="film__frame{" film__frame--portrait" if f["portrait"] else ""}">'
                  f'<iframe src="https://player.vimeo.com/video/{f["vid"]}?title=0&amp;byline=0&amp;portrait=0&amp;dnt=1" '
                  f'title="{html.escape(title_txt, quote=True)}" loading="lazy" '
                  f'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>')
    else:
        player = (f'<div class="film__frame"><img src="/{f["poster"]}" alt="{f["alt"]}" '
                  f'width="1280" height="720" fetchpriority="high"></div>')

    facts = [('Type', kind), ('Running time', f['dur'])]
    _yr = year_of(f)
    if _yr:
        facts.append(('Year', _yr))
    if stat_txt and f['statref']:
        facts.append(('Published', f'<a href="{f["statref"]}" target="_blank" rel="noopener">{stat_txt} <span aria-hidden="true">&#8599;</span></a>'))
    facts.append(('Role', 'Directed, shot and edited'))
    facts_html = ''.join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in facts)

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
        reception = f'''<section class="reception" aria-labelledby="said-{f['slug']}">
    <h2 class="reception__head" id="said-{f['slug']}">What people said</h2>
    <p class="reception__sub">Unedited comments on the <a href="{rec['url']}" target="_blank" rel="noopener">original post</a>
      &mdash; {rec['stat']}. Comments written in Arabic are shown in translation.</p>
    <div class="reception__grid">{''.join(items)}</div>
  </section>'''

    nav = []
    if prev_f: nav.append(f'<a class="film__nav-prev" href="/work/{prev_f["slug"]}">&larr; {html.escape(html.unescape(prev_f["title"]))}</a>')
    nav.append('<a class="film__nav-all" href="/work/">All films</a>')
    if next_f: nav.append(f'<a class="film__nav-next" href="/work/{next_f["slug"]}">{html.escape(html.unescape(next_f["title"]))} &rarr;</a>')

    # More of the same kind of work: a client who liked this one is asking
    # whether there are others like it, and the answer is one click away.
    _cid = category_of(f['kind'])
    _siblings = [g for g in films if category_of(g['kind']) == _cid and g['slug'] != f['slug']][:3]
    related = ''
    if _siblings:
        related = ('<section class="related" aria-labelledby="related-head">'
                   '<h2 class="filmcat__head" id="related-head">More ' + label_of(_cid).lower()
                   + ' <span><a href="/work/#' + _cid + '">see all &#8599;</a></span></h2>'
                   '<ol class="filmcards">' + ''.join(card(g) for g in _siblings) + '</ol></section>')

    body = f'''<section class="film" id="film">
  <div class="slate">
    <h1 class="slate__title">{f['title']}</h1>
  </div>
  {player}
  <dl class="film__facts">{facts_html}</dl>
  {reception}
  <p class="film__note">One of {COUNT} films in the <a href="/">selected work</a> of Ahmed El-Nimeri,
    a film director and Associate Creative Director based in Dubai. Every figure on this site links
    to the published post it came from.</p>
  {related}
  <div class="film__note"><h2>Have a project in mind?</h2><p>Tell me what you’re making and when you need it. A few lines are enough.</p><!--email_off--><a class="btn btn--solid" href="{enquiry}">Send the brief ↗</a><!--/email_off--></div>
  <nav class="film__nav" aria-label="Films">{''.join(nav)}</nav>
</section>
'''
    _poster = f['poster'].split('?')[0]
    ogw, ogh = pixels(_poster)
    page = (HEAD.format(title=html.escape(title_txt, quote=True), desc=desc, slug=f['slug'],
                        poster=_poster, ogw=ogw, ogh=ogh, og_type='video.other', skip='Skip to the film',
                        ver=VER, mark=MARK,
                        schema=json.dumps(schema, ensure_ascii=False))
            + body + FOOT.format(ver=VER))
    open(f"work/{f['slug']}.html", 'w').write(page)

# ---- the index -----------------------------------------------------------
_card_n[0] = 0   # the film pages' related blocks ran first; the index starts fresh
groups = {cid: [f for f in films if category_of(f['kind']) == cid] for cid, _l, _n in CATEGORIES}
nav = ''.join('<a href="#' + cid + '">' + label + ' <span>' + str(len(groups[cid])) + '</span></a>'
              for cid, label, _n in CATEGORIES if groups[cid])
sections = []
for cid, label, _n in CATEGORIES:
    if not groups[cid]:
        continue
    count = str(len(groups[cid])) + (' film' if len(groups[cid]) == 1 else ' films')
    sections.append('<section class="filmcat" id="' + cid + '">'
                    '<h2 class="filmcat__head">' + label + ' <span>' + count + '</span></h2>'
                    '<ol class="filmcards">' + ''.join(card(f, eager_first=1) for f in groups[cid]) + '</ol></section>')
rows = '<nav class="filmcats" aria-label="Kinds of film">' + nav + '</nav>' + ''.join(sections)

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
                   og_type='website', skip='Skip to the films', ver=VER, mark=MARK,
                   desc=f'Every film by Ahmed El-Nimeri on this site — {COUNT} pieces, {TRT} total running time, each with its running time and, where published, its view count and source.',
                   schema=json.dumps(idx_schema, ensure_ascii=False))
       + f'''<section class="film" id="film">
  <div class="slate">
    <h1 class="slate__title">All films</h1>
  </div>
  {rows}
  <p class="film__note">The same {COUNT} films as the <a href="/">front page</a>, as a list.
    Each page carries the film, its running time and the published post its view count came from.</p>
</section>
''' + FOOT.format(ver=VER))
open('work/index.html', 'w').write(idx)

print(f'work/: {len(films)} film pages + index, TRT {total // 60}:{total % 60:02d}')
