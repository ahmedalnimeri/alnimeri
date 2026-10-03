#!/usr/bin/env python3
"""Build /work/solana: every Solana video he edited, as one calm list.

The wall on /work/ shows the films that have a page of their own; the team's
tracker knows every Solana video he cut, ninety and counting. This page is
that tracker, read: grouped by year like a changelog, one line per video
(when, what, what kind, and how many people watched it, linked to the post
the figure was read from). Nothing is typed here: every count, total and
date comes from assets/solana-edits.json, the tracker rows as exported, so a
new row there moves every number on the page, on /work/ and on its card.

A video that also has a film page on this site (matched by its X post) is
named as that page names it and links to it.

Writes work/solana.html. Run after bin-build-work-pages.py (it shares that
page's design layer, stamped the same way) and before bin-build-sitemap.py.
"""
import re, os, json, html, sys, hashlib, datetime, subprocess

SRC = open('index.html').read()
DATA = json.load(open('assets/solana-edits.json'))
VIDEOS = DATA['videos']
AS_OF = datetime.date.fromisoformat(DATA['as_of'] + '-01')

VER = re.search(r'styles\.css\?v=(\d+)', SRC).group(1)
MARK = re.search(r'src="(assets/logo-96\.png\?h=[a-f0-9]+)"', SRC).group(1)
def _md5(path):
    return hashlib.md5(open(path, 'rb').read()).hexdigest()[:8]
DVER, DJVER = _md5('design-filmpages.css'), _md5('design-filmpages.js')

_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
         'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
def words(n):
    if not 0 < n < 100:
        return str(n)
    return _ONES[n] if n < 20 else _TENS[n // 10] + ('-' + _ONES[n % 10] if n % 10 else '')

def views(n):
    """The site's own short form: 934K, 1.4M, 26M (bin-build-og.py rounds the
    card's total the same way)."""
    if n >= 1e6:
        return f'{n / 1e6:.1f}'.rstrip('0').rstrip('.') + 'M'
    if n >= 1e3:
        return f'{round(n / 1e3)}K'
    return str(n)

# ---- checks: the file is the record, so it has to be whole ---------------
seen = set()
for v in VIDEOS:
    for k in ('id', 'account', 'title', 'type', 'date', 'views', 'views_label'):
        if k not in v or v[k] in ('', None):
            sys.exit(f'assets/solana-edits.json: a video without {k}: {v}')
    if not re.fullmatch(r'\d{15,20}', v['id']) or not re.fullmatch(r'\w{1,15}', v['account']):
        sys.exit(f"assets/solana-edits.json: not an X post: {v['account']}/{v['id']}")
    if v['id'] in seen:
        sys.exit(f"assets/solana-edits.json: {v['id']} twice")
    seen.add(v['id'])
    datetime.date.fromisoformat(v['date'])
    if views(v['views']) != v['views_label']:
        sys.exit(f"assets/solana-edits.json: {v['title']}: views {v['views']} vs label {v['views_label']}")

# ---- the films that also have a page here, by their X post ---------------
def slugify(t):
    # the film pages' own rule (bin-build-work-pages.py)
    t = html.unescape(t).lower()
    t = t.replace('&', ' and ').replace('“', '').replace('”', '').replace('"', '').replace('’', '').replace("'", '')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')

PAGES = {}
for b in re.findall(r'<article class="tile[\s\S]+?</article>', SRC):
    if 'data-part-of=' in b:
        continue
    title = html.unescape(re.search(r'data-title="([^"]+)"', b).group(1))
    for pid in set(re.findall(r'x\.com/\w+/status/(\d+)', b)):
        PAGES[pid] = (title, slugify(title))
if os.path.exists('work/solana.html') and any(s == 'solana' for _t, s in PAGES.values()):
    sys.exit('a film page is already called /work/solana')

TYPE = {'Event Promo': 'Event promo', 'Event Summary': 'Event summary', 'Explainer': 'Explainer',
        'Product': 'Product', 'Interviews': 'Interview', "People's Stories": 'People’s story'}

def name_of(v):
    if v['id'] in PAGES:
        return PAGES[v['id']][0]
    return v['title'].replace(' | ', ' — ')

def post_of(v):
    return f"https://x.com/{v['account']}/status/{v['id']}"

def short_date(d):
    return f'{d.day} {d:%b}'

# ---- the page -------------------------------------------------------------
vids = sorted(VIDEOS, key=lambda v: (v['date'], v['id']), reverse=True)
years = {}
for v in vids:
    years.setdefault(v['date'][:4], []).append(v)

N, TOTAL = len(vids), sum(v['views'] for v in vids)
first = datetime.date.fromisoformat(vids[-1]['date'])
last = datetime.date.fromisoformat(vids[0]['date'])
SPAN = f'{first:%B %Y} to {last:%B %Y}'
AS_OF_TXT = f'{AS_OF:%b %Y}'
ON_SITE = sum(1 for v in vids if v['id'] in PAGES)

blocks = []
for k, (yr, vs) in enumerate(years.items()):
    rows = []
    for v in vs:
        d = datetime.date.fromisoformat(v['date'])
        name = html.escape(name_of(v))
        title = (f'<a href="/work/{PAGES[v["id"]][1]}">{name}</a>' if v['id'] in PAGES else name)
        label = html.escape(f"{v['views_label']} views on X — {name_of(v)}", quote=True)
        rows.append(
            f'<li class="sl-row">'
            f'<time class="sl-date" datetime="{v["date"]}">{short_date(d)}</time>'
            f'<span class="sl-title">{title}</span>'
            f'<span class="sl-type">{TYPE.get(v["type"], html.escape(v["type"]))}</span>'
            f'<a class="sl-views" href="{post_of(v)}" target="_blank" rel="noopener" aria-label="{label}">'
            f'{v["views_label"]} <span aria-hidden="true">&#8599;</span></a></li>')
    yv = sum(v['views'] for v in vs)
    blocks.append(
        f'<section class="sl-year{"" if k == 0 else " reveal"}" id="y{yr}" aria-labelledby="y{yr}-h">'
        f'<header class="sl-year__head"><h2 id="y{yr}-h">{yr}</h2>'
        f'<p>{len(vs)} video{"s" if len(vs) != 1 else ""} &middot; {views(yv)} views</p></header>'
        f'<ol class="sl-list">{"".join(rows)}</ol></section>')

LEDE = (f'{words(N).capitalize()} videos, {views(TOTAL)} views between them, from {SPAN}. '
        f'Views as of {AS_OF_TXT}, from the team’s tracker; each figure links to its post on X. '
        f'The {words(ON_SITE)} with a page of their own on this site carry an arrow.')
DESC = (f'Every Solana video Ahmed El-Nimeri edited: {words(N)} videos, {views(TOTAL)} views on X between them '
        f'(from the team’s tracker, {AS_OF_TXT}), each linked to its post.')

URL = 'https://alnimeri.com/work/solana'
schema = {"@context": "https://schema.org", "@graph": [
    {"@type": "CollectionPage", "@id": URL + "#page", "url": URL,
     "name": "Every Solana video I edited — Ahmed El-Nimeri",
     "description": DESC,
     "isPartOf": {"@id": "https://alnimeri.com/#website"},
     "about": {"@id": "https://alnimeri.com/#person"},
     "mainEntity": {
         "@type": "ItemList", "numberOfItems": N,
         "itemListOrder": "https://schema.org/ItemListOrderDescending",
         "itemListElement": [
             {"@type": "ListItem", "position": i + 1,
              "item": {"@type": "VideoObject", "name": name_of(v), "url": post_of(v),
                       "uploadDate": v['date'],
                       "contributor": {"@id": "https://alnimeri.com/#person"},
                       "interactionStatistic": {"@type": "InteractionCounter",
                                                "interactionType": {"@type": "WatchAction"},
                                                "userInteractionCount": v['views']}}}
             for i, v in enumerate(vids)]}},
    {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Ahmed El-Nimeri", "item": "https://alnimeri.com/"},
        {"@type": "ListItem", "position": 2, "name": "All films", "item": "https://alnimeri.com/work/"},
        {"@type": "ListItem", "position": 3, "name": "Every Solana video I edited"}]}]}

# the share card prints the count and the total (bin-build-og.py); a new
# count is a new file name
OG = f'assets/og-solana-{N}.jpg'
if not os.path.exists(OG):
    sys.exit(f'{OG} is missing: render bin-build-og.py\'s card for {N} videos first')
_o = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', OG], capture_output=True, text=True).stdout
OGW, OGH = re.search(r'pixelWidth: (\d+)', _o).group(1), re.search(r'pixelHeight: (\d+)', _o).group(1)

T = 'Every Solana video I edited — Ahmed El-Nimeri'
D = html.escape(DESC, quote=True)
page = f'''<!doctype html>
<html lang="en" class="no-js" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{T}</title>
<meta name="description" content="{D}">
<link rel="canonical" href="{URL}">
<meta name="theme-color" content="#0a0a0c">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48.png">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon-192.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="{T}">
<meta property="og:description" content="{D}">
<meta property="og:url" content="{URL}">
<meta property="og:image" content="https://alnimeri.com/{OG}">
<meta property="og:image:width" content="{OGW}">
<meta property="og:image:height" content="{OGH}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{T}">
<meta name="twitter:description" content="{D}">
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/poppins-600.woff2" crossorigin>
<link rel="stylesheet" href="/styles.css?v={VER}">
<link rel="stylesheet" href="/design-filmpages.css?v={DVER}">
<script type="application/ld+json">{json.dumps(schema, ensure_ascii=False)}</script>
</head>
<body>
<a class="skip" href="#film">Skip to the list</a>
<header class="masthead">
  <a class="masthead__mark" href="/" aria-label="Ahmed El-Nimeri — home"><img class="mark" src="/{MARK}" alt="" width="32" height="30" aria-hidden="true"><span>Ahmed El-Nimeri</span></a>
  <nav class="masthead__nav" aria-label="Primary">
    <a href="/">Work</a>
    <a href="/about">About</a>
    <a href="/cv">CV</a>
    <a class="btn btn--solid" href="/#contact"><span class="masthead__long">Get in touch</span><span class="masthead__short">Brief</span></a>
  </nav>
</header>
<main id="top">
<section class="fp sl" id="film">
  <header class="fp-head">
    <p class="fp-crumbs"><a href="/work/">All films</a><span aria-hidden="true">/</span><span>Solana</span></p>
    <h1 class="fp-title">Every Solana video I edited</h1>
    <p class="fp-lede">{LEDE}</p>
  </header>
  <div class="sl-years">{"".join(blocks)}</div>
  <footer class="fp-foot sl-foot">
    <nav class="fp-nav" aria-label="Films"><a class="fp-nav__all" href="/work/">All films</a></nav>
    <p class="fp-note">Every figure on this site links to the published post it came from.</p>
  </footer>
</section>
</main>
<script src="/main.js?v={VER}" defer></script>
<script src="/design-filmpages.js?v={DJVER}" defer></script>
</body>
</html>
'''
open('work/solana.html', 'w').write(page)
print(f'work/solana.html: {N} videos, {views(TOTAL)} views, {len(years)} years ({", ".join(f"{y}: {len(v)}" for y, v in years.items())}), {ON_SITE} with a film page')
