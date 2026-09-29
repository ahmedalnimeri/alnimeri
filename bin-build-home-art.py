#!/usr/bin/env python3
"""Build the home page's four compositions from the real material.

"What are we making?" is answered four times, and each answer is a
composition: three stills from that kind of film, pinned at three depths
around the words, like prints on a director's board. Each still is a link
to its film and carries a small chip naming the film and its reach, exactly
as the film's tile in #work states it (nothing is typed twice, nothing is
invented). design-compositions.js gives every still its own response to the
pointer: a rack focus — the still you point at sharpens and comes forward,
the others fall soft and recede, and its chip follows the pointer.

Letterboxed films are shown at their true picture shape (a scope film as a
scope strip, not a 16:9 poster with black bars): CROP is the picture area in
the 768x432 poster, measured from the bars.

Writes between <!-- ART:CHAPTERS --> markers in index.html. Run
bin-stamp-assets.py afterwards to hash the poster URLs.
"""
import re, html

SRC = open('index.html').read()

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
    'The Greatest Sudanese Sit-In': (0, 52, 768, 328),     # 2.34:1 scope
}

BODY = ('&amp;body=Hi%20Ahmed%2C%0A%0AI%E2%80%99d%20like%20to%20discuss%20a%20project.%0A%0AWhat%20we%E2%80%99re%20making%3A%0A'
        'Audience%20and%20where%20it%20will%20run%3A%0ATiming%20and%20location%3A%0ABudget%20range%20%28if%20known%29%3A%0A%0AName%20%2F%20company%3A%0A')

# (key, title, words, see-all link, enquiry subject, [lead, second, third])
CHAPTERS = [
    ('brand', 'Brand &amp; campaign films',
     'A launch, a brand story or a campaign that needs a film. Direction, cinematography and editing, shaped around your audience.',
     ('/work/#brand', 'See all brand &amp; campaign films'), 'Brand%20%2F%20campaign%20film%20enquiry',
     ['Solana Accelerate', 'Token Supercycle', '60 Secs of New York']),
    ('events', 'Event &amp; conference films',
     'Conferences, launches and summits. Speaker films, multi-camera coverage and recaps cut on site, while the event is still happening.',
     ('/work/#events', 'See all event &amp; conference films'), 'Event%20%2F%20conference%20film%20enquiry',
     ['Solana x All In', 'Solana Solstice', 'SGB — Solana Accelerate HK']),
    ('documentary', 'Documentary &amp; human stories',
     'Real people, places and stories. Documentary and institutional films, with eleven years of work across Sudan and the Gulf.',
     ('/work/#documentary', 'See all documentary work'), 'Documentary%20%2F%20institutional%20film%20enquiry',
     ['Al Doroub', 'Sia x Solana', 'The Greatest Sudanese Sit-In']),
    ('motion', 'Creative direction &amp; post',
     'A concept to develop or footage to shape. Creative direction, editorial, motion, colour and sound for your next piece.',
     ('/work/#motion', 'See all motion &amp; post work'), 'Creative%20direction%20%2F%20post-production%20enquiry',
     ['Solana Developer Platform', 'Assets API', 'Solana Skyline']),
]

# rendered widths at 1440px, as a share of the viewport, for sizes=""
SIZES = {1: '(max-width: 1099px) 88vw, 51vw', 2: '(max-width: 1099px) 54vw, 25vw', 3: '(max-width: 1099px) 70vw, 40vw'}
DEPTH = {1: '1', 2: '.45', 3: '.72'}


def still(f, n):
    x, y, w, h = CROP.get(f['title'], (0, 0, 768, 432))
    shape = f'--ar:{w}/{h}'
    if (x, y, w, h) != (0, 0, 768, 432):
        shape += f';--cw:{768 / w:.4f};--cx:{-x / w:.4f};--cy:{-y / h:.4f}'
    b = f['base']
    reach = f['stat'] or f['kind']
    label = html.escape(f"{f['title']} — {f['kind']}" + (f", {f['stat']}" if f['stat'] else ''), quote=True)
    return (
        f'\n        <a class="cmp__still cmp__still--{n}{" is-lead" if n == 1 else ""}" href="{f["href"]}" data-depth="{DEPTH[n]}" style="{shape}" aria-label="{label}">'
        f'<span class="cmp__frame"><img srcset="{b}-480.jpg 480w, {b}-768.jpg 768w, {b}.jpg 1280w" sizes="{SIZES[n]}" '
        f'src="{b}-768.jpg" alt="" width="768" height="432" loading="lazy" decoding="async"></span>'
        f'<span class="cmp__chip" aria-hidden="true"><b>{html.escape(f["title"])}</b><span>{html.escape(reach)}</span></span></a>')


out = []
for n, (key, title, words, (all_href, all_text), subject, names) in enumerate(CHAPTERS):
    fs = [films[x] for x in names]
    stills = ''.join(still(f, i + 1) for i, f in enumerate(fs))
    c3 = CROP.get(fs[2]['title'], (0, 0, 768, 432))
    h3 = f'{c3[3] / c3[2]:.4f}'                 # the lowest still's height per unit width: the words leave it room
    out.append(f'''
    <article class="cmp cmp--{key}{' cmp--flip' if n % 2 else ''}" style="--h3:{h3}" aria-labelledby="cmp-{key}">
      <div class="cmp__text reveal">
        <h3 class="cmp__title" id="cmp-{key}">{title}</h3>
        <p class="cmp__words">{words}</p>
        <p class="cmp__links"><a href="{all_href}">{all_text} <span aria-hidden="true">&rarr;</span></a><a href="mailto:ahmed@alnimeri.com?subject={subject}{BODY}">Discuss a project <span aria-hidden="true">&rarr;</span></a></p>
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
print('home art: ' + ' | '.join(f'{c[0]}: ' + ', '.join(c[5]) for c in CHAPTERS))
