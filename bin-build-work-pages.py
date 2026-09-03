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
import re, os, json, html, sys

SRC = open('index.html').read()

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
        'poster':  field(b, r'src="(assets/posters/[^"]+)"'),
        'alt':     field(b, r'alt="([^"]+)"'),
        'portrait': field(b, r'data-portrait="(\w+)"') == 'true',
    })

if len(films) != 16:
    sys.exit(f'expected 16 films, found {len(films)}')

def iso_dur(d):
    m, s = (int(x) for x in d.split(':'))
    return f'PT{m}M{s}S'

def source_name(url):
    h = re.sub(r'^https?://(www\.)?', '', url).split('/')[0]
    return {'x.com': 'X', 'vimeo.com': 'Vimeo', 'www.instagram.com': 'Instagram',
            'instagram.com': 'Instagram', 'www.tiktok.com': 'TikTok',
            'www.facebook.com': 'Facebook'}.get(h, h)

HEAD = '''<!doctype html>
<html lang="en" class="no-js">
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
<meta property="og:type" content="video.other">
<meta property="og:title" content="{title} — Ahmed El-Nimeri">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="https://alnimeri.com/work/{slug}">
<meta property="og:image" content="https://alnimeri.com/{poster}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/poppins-600.woff2" crossorigin>
<link rel="stylesheet" href="/styles.css?v={ver}">
<script type="application/ld+json">{schema}</script>
</head>
<body>
<a class="skip" href="#film">Skip to the film</a>
<header class="masthead">
  <a class="masthead__mark" href="/" aria-label="Ahmed El-Nimeri — home"><img class="mark" src="/{mark}" alt="" width="32" height="30" aria-hidden="true"><span>Ahmed El-Nimeri</span></a>
  <nav class="masthead__nav" aria-label="Primary">
    <a href="/">Work</a>
    <a href="/about">About</a>
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

for i, f in enumerate(films):
    prev_f = films[i - 1] if i else None
    next_f = films[i + 1] if i + 1 < len(films) else None
    kind = html.unescape(f['kind'])
    src_name = source_name(f['statref']) if f['statref'] else ''
    stat_txt = html.unescape(f['stat'])
    title_txt = html.unescape(f['title'])

    desc = (f"{title_txt} — {kind} directed by Ahmed El-Nimeri. "
            f"{stat_txt.capitalize()}. " if stat_txt else
            f"{title_txt} — {kind} directed by Ahmed El-Nimeri. ")
    desc += f"Running time {f['dur']}."
    desc = html.escape(desc, quote=True)

    schema = {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "name": title_txt,
        "description": f"{kind} directed, shot and edited by Ahmed El-Nimeri.",
        "duration": iso_dur(f['dur']),
        "thumbnailUrl": f"https://alnimeri.com/{f['poster'].split('?')[0]}",
        "url": f"https://alnimeri.com/work/{f['slug']}",
        "creator": {"@type": "Person", "name": "Ahmed El-Nimeri", "@id": "https://alnimeri.com/#person"},
        "director": {"@type": "Person", "name": "Ahmed El-Nimeri", "@id": "https://alnimeri.com/#person"},
    }
    if f['vid']:
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
    if stat_txt and f['statref']:
        facts.append(('Published', f'<a href="{f["statref"]}" target="_blank" rel="noopener">{stat_txt} <span aria-hidden="true">&#8599;</span></a>'))
    facts.append(('Role', 'Directed, shot and edited'))
    facts_html = ''.join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in facts)

    nav = []
    if prev_f: nav.append(f'<a class="film__nav-prev" href="/work/{prev_f["slug"]}">&larr; {html.escape(html.unescape(prev_f["title"]))}</a>')
    nav.append('<a class="film__nav-all" href="/work/">All films</a>')
    if next_f: nav.append(f'<a class="film__nav-next" href="/work/{next_f["slug"]}">{html.escape(html.unescape(next_f["title"]))} &rarr;</a>')

    body = f'''<section class="film" id="film">
  <div class="slate">
    <span class="slate__tc">{f['idx']}</span>
    <h1 class="slate__title">{f['title']}</h1>
    <span class="slate__meta">TRT {f['dur']}{f' &middot; {src_name}' if src_name else ''}</span>
  </div>
  {player}
  <dl class="film__facts">{facts_html}</dl>
  <p class="film__note">One of sixteen films in the <a href="/">selected work</a> of Ahmed El-Nimeri,
    a film director and Associate Creative Director based in Dubai. Every figure on this site links
    to the published post it came from.</p>
  <nav class="film__nav" aria-label="Films">{''.join(nav)}</nav>
</section>
'''
    page = (HEAD.format(title=html.escape(title_txt, quote=True), desc=desc, slug=f['slug'],
                        poster=f['poster'].split('?')[0], ver=VER, mark=MARK,
                        schema=json.dumps(schema, ensure_ascii=False))
            + body + FOOT.format(ver=VER))
    open(f"work/{f['slug']}.html", 'w').write(page)

# ---- the index -----------------------------------------------------------
rows = ''.join(
    f'''<li class="filmlist__item"><a href="/work/{f['slug']}">
      <span class="filmlist__idx">{f['idx']}</span>
      <span class="filmlist__name">{f['title']}</span>
      <span class="filmlist__kind">{f['kind']}</span>
      <span class="filmlist__dur">{f['dur']}</span></a></li>''' for f in films)

total = sum(int(f['dur'].split(':')[0]) * 60 + int(f['dur'].split(':')[1]) for f in films)
idx_schema = {
    "@context": "https://schema.org", "@type": "CollectionPage",
    "name": "All films — Ahmed El-Nimeri",
    "url": "https://alnimeri.com/work/",
    "about": {"@id": "https://alnimeri.com/#person"},
    "hasPart": [{"@type": "VideoObject", "name": html.unescape(f['title']),
                 "url": f"https://alnimeri.com/work/{f['slug']}"} for f in films]}

idx = (HEAD.format(title='All films', slug='', poster=films[0]['poster'].split('?')[0], ver=VER, mark=MARK,
                   desc='Every film by Ahmed El-Nimeri on this site — sixteen pieces, 42:18 total running time, each with its published view count and source.',
                   schema=json.dumps(idx_schema, ensure_ascii=False))
       .replace('<link rel="canonical" href="https://alnimeri.com/work/">',
                '<link rel="canonical" href="https://alnimeri.com/work/">')
       + f'''<section class="film" id="film">
  <div class="slate">
    <span class="slate__tc">SEQ 2026</span>
    <h1 class="slate__title">All films</h1>
    <span class="slate__meta">16 clips &middot; TRT {total // 60}:{total % 60:02d}</span>
  </div>
  <ol class="filmlist">{rows}</ol>
  <p class="film__note">The same sixteen films as the <a href="/">front page</a>, as a list.
    Each page carries the film, its running time and the published post its view count came from.
    The machine-readable cut list is at <a href="/selects.edl">/selects.edl</a>.</p>
</section>
''' + FOOT.format(ver=VER))
open('work/index.html', 'w').write(idx)

print(f'work/: {len(films)} film pages + index, TRT {total // 60}:{total % 60:02d}')
