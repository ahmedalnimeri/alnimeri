#!/usr/bin/env python3
"""Build the home page's four compositions from the real material.

The four kinds of work under "Commissions" are each a
composition: three stills from that kind of film, pinned at three depths
around the words, like prints on a board. Each still is a link
to its film and carries a small chip naming the film and its reach, exactly
as the film's tile in #work states it (nothing is typed twice, nothing is
invented). design-compositions.js gives every still its own response to the
pointer: a rack focus — the still you point at sharpens and comes forward,
the others fall soft and recede, and its chip comes into focus with it.

Each composition shows only films from that chapter's own group on /work/
(the "All …" link must lead to the same films), and only stills that read
as pictures: a white UI frame or a near-black frame is left out. Events and
motion have two such films, so they are two-still compositions (the lead and
the near plane); that difference is the real material, not a variation.

Letterboxed films are shown at their true picture shape (a scope film as a
scope strip, not a 16:9 poster with black bars): CROP is the picture area in
the 768x432 poster, measured from the bars.

Writes between <!-- ART:CHAPTERS --> markers in index.html. Run
bin-stamp-assets.py afterwards to hash the poster URLs.
"""
import ast, os, re, html

SRC = open('index.html').read()
# the front page's own films: <template id="more-films"> is never rendered
SRC = re.sub(r'<template id="more-films">[\s\S]*?</template>', '', SRC)

films = {}
for b in re.findall(r'<article class="tile[\s\S]+?</article>', SRC):
    g = lambda p, d='': (re.search(p, b).group(1) if re.search(p, b) else d)
    title = html.unescape(g(r'data-title="([^"]+)"'))
    films[title] = {
        'title': title,
        'base': g(r'\bsrc="(assets/posters/[^"?]+)\.jpg'),
        'href': g(r'tile__name"><a href="([^"]+)"'),
        'kind': html.unescape(g(r'tile__kind">([^<]*)<')),
        'stat': html.unescape(g(r'tile__stat"[^>]*>\s*([^<]+?)\s*<')),
    }

# picture area inside the 768x432 poster (x, y, w, h) for letterboxed films
CROP = {
    '60 Secs of New York': (0, 54, 768, 324),              # 2.37:1 scope
    'Solana x All In': (0, 35, 768, 362),                  # 2.12:1, bars top and bottom
    'Solana Skyline': (12, 12, 744, 373),                  # the collage and its mark, off the wide black ground
    'The Greatest Sudanese Sit-In': (0, 52, 768, 328),     # 2.34:1 scope
}

# On a phone the chip is two lines in the still's lower left corner, which is
# where two of these films carry their own words: 60 Secs of New York has its
# title burned into the lower middle of the frame, and Sia x Solana a name card
# in the lower left. Looked at still by still at 360-430px; every other chip
# keeps the corner. 'under': the chip hangs just below the picture, in the open
# black under the lowest still (only ever the lowest: plane 3); 'end': the
# chip takes the lower right corner instead.
PHONE_CHIP = {
    '60 Secs of New York': 'under',
    'Sia x Solana': 'end',
}

# No enquiry link on the cards (Ahmed, 3 Oct 2026): the masthead and the
# Contact section ask for the brief; a card says what the work is and leads
# to it. The film pages still pre-select the brief's kind (data-kind).

# A card's "All …" link names what it opens: the /work/ category of the same
# key, by the name /work/ gives it (bin-build-work-pages.py CATEGORIES, read
# from that file so the two never drift), as the film pages' own "All …" link
# does. The card's title may differ ("Creative direction & post" opens
# "Motion, animation & post").
def _work_categories():
    tree = ast.parse(open('bin-build-work-pages.py').read())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') == 'CATEGORIES' for t in node.targets):
            return {key: label for key, label, _kinds in ast.literal_eval(node.value)}
    raise SystemExit('bin-build-work-pages.py: no CATEGORIES list to name the cards\' links from')
WORK_CATEGORIES = _work_categories()


def all_link(key):
    if key not in WORK_CATEGORIES:
        raise SystemExit(f'no /work/ category "{key}" for its card to link to')
    label = WORK_CATEGORIES[key]
    return (f'/work/#{key}', 'All ' + label[0].lower() + label[1:])


# (key, title, words, all-films link, [lead, second, third])
CHAPTERS = [
    ('brand', 'Brand &amp; campaign films',
     'Launches, brand stories and campaigns. Direction, cinematography and editing.',
     all_link('brand'),
     ['Solana Accelerate', 'Badr Airlines', '60 Secs of New York']),
    ('events', 'Event &amp; conference films',
     'Conferences, launches and summits. Speaker films, multi-camera coverage and recaps cut on site.',
     all_link('events'),
     ['Solana x All In', 'Solana Solstice']),
    ('documentary', 'Documentary &amp; institutional films',
     'People and places, from eleven years of work across Sudan and the Gulf.',
     all_link('documentary'),
     ['Al Doroub', 'Sia x Solana', 'The Greatest Sudanese Sit-In']),
    ('motion', 'Creative direction &amp; post',
     'Creative direction, editorial, motion, colour and sound.',
     all_link('motion'),
     ['Solana Developer Platform', 'Solana Skyline']),
]

# rendered widths, as a share of the viewport, for sizes="" (desktop from 960px)
SIZES = {1: '(max-width: 959px) 88vw, 51vw', 2: '(max-width: 959px) 54vw, 25vw', 3: '(max-width: 959px) 70vw, 38vw'}
DEPTH = {1: '1', 2: '.45', 3: '.72'}


def still(f, n):
    x, y, w, h = CROP.get(f['title'], (0, 0, 768, 432))
    shape = f'--ar:{w}/{h}'
    if (x, y, w, h) != (0, 0, 768, 432):
        shape += f';--cw:{768 / w:.4f};--cx:{-x / w:.4f};--cy:{-y / h:.4f}'
    b = f['base']
    reach = f['stat'] or f['kind']
    # every home poster has a WebP set (the #work tiles and the hero use it),
    # so offer the same files: the browser reuses what the page already
    # loaded instead of fetching the JPEG as well
    webp = ''
    if os.path.exists(f'{b}-768.webp'):
        webp = (f'<source type="image/webp" srcset="{b}-480.webp 480w, {b}-768.webp 768w, {b}-1280.webp 1280w" '
                f'sizes="{SIZES[n]}">')
    label = html.escape(f"{f['title']} — {f['kind']}" + (f", {f['stat']}" if f['stat'] else ''), quote=True)
    chip = PHONE_CHIP.get(f['title'], '')
    if chip == 'under' and n != 3:
        raise SystemExit(f"PHONE_CHIP: {f['title']} can hang its chip under the picture only as the lowest still")
    chip = f' cmp__still--chip-{chip}' if chip else ''
    return (
        f'\n        <a class="cmp__still cmp__still--{n}{" is-lead" if n == 1 else ""}{chip}" href="{f["href"]}" data-depth="{DEPTH[n]}" style="{shape}" aria-label="{label}">'
        f'<span class="cmp__frame">{"<picture>" + webp if webp else ""}<img srcset="{b}-480.jpg 480w, {b}-768.jpg 768w, {b}.jpg 1280w" sizes="{SIZES[n]}" '
        f'src="{b}-768.jpg" alt="" width="768" height="432" loading="lazy" decoding="async">{"</picture>" if webp else ""}</span>'
        f'<span class="cmp__chip" aria-hidden="true"><b>{html.escape(f["title"])}</b><span>{html.escape(reach)}</span></span></a>')


out = []
for n, (key, title, words, (all_href, all_text), names) in enumerate(CHAPTERS):
    fs = [films[x] for x in names]
    # planes: 1 = the lead, 2 = the far plane, 3 = the near plane (the lowest
    # still). A two-still composition is the lead and the near plane.
    planes = [1, 2, 3] if len(fs) == 3 else [1, 3]
    stills = ''.join(still(f, n) for f, n in zip(fs, planes))
    c3 = CROP.get(fs[-1]['title'], (0, 0, 768, 432))
    h3 = f'{c3[3] / c3[2]:.4f}'                 # the lowest still's height per unit width: the words leave it room
    out.append(f'''
    <article class="cmp cmp--{key}{' cmp--flip' if n % 2 else ''}{' cmp--duo' if len(fs) == 2 else ''}" style="--h3:{h3}" aria-labelledby="cmp-{key}">
      <div class="cmp__text reveal">
        <h3 class="cmp__title" id="cmp-{key}">{title}</h3>
        <p class="cmp__words">{words}</p>
        <p class="cmp__links"><a href="{all_href}">{all_text} <span aria-hidden="true">&rarr;</span></a></p>
      </div>
      <div class="cmp__art">{stills}
      </div>
    </article>''')
block = '\n    <div class="cmps">' + ''.join(out) + '\n    </div>'

page = open('index.html').read()
a, z = '<!-- ART:CHAPTERS -->', '<!-- /ART:CHAPTERS -->'
if a not in page:
    raise SystemExit(f'marker {a} missing from index.html')
page = re.sub(re.escape(a) + r'[\s\S]*?' + re.escape(z), lambda m: a + block + '\n    ' + z, page)
open('index.html', 'w').write(page)
print('home art: ' + ' | '.join(f'{c[0]}: ' + ', '.join(c[4]) for c in CHAPTERS))
