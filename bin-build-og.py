#!/usr/bin/env python3
"""Write the share cards' HTML, one per page, for rendering at 1200x630.

The first cards carried fake edit-suite furniture — roll numbers, SEQ, 24 FPS,
a clip count that had been wrong since the seventeenth film. A card should
carry the line, the name and the picture. The film count is still derived from
index.html rather than typed. Render by screenshotting these through the local
server, so the cards use the site's own typeface.
"""
import re, html, pathlib

SRC = open('index.html').read()
# every film with a page of its own on /work/: the front page's grid and the
# films in <template id="more-films">, but not a data-part-of film (one more
# film on another film's page)
films = [b for b in re.findall(r'<article class="tile[\s\S]+?</article>', SRC) if 'data-part-of=' not in b]
durs = [re.search(r'tile__dur">([\d:]+)<', b).group(1) for b in films]
secs = sum(int(d.split(':')[0]) * 60 + int(d.split(':')[1]) for d in durs)
TRT = f'{secs // 60}:{secs % 60:02d}'
N = len(films)
_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
         'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
WORDS = {n: (_ONES[n] if n < 20 else _TENS[n // 10] + ('-' + _ONES[n % 10] if n % 10 else '')).capitalize()
         for n in range(1, 100)}

# The Solana list's card: its count, read from the same file the page is
# built from (bin-build-solana.py). The total views stay on the page.
import json
_sol = json.load(open('assets/solana-edits.json'))['videos']
SOL_N = len(_sol)

CARDS = [
    # He is a creative director, never a film director (Ahmed, 3 Oct 2026). The
    # cards that said so were og-home.jpg and og-home-2.jpg (removed; _redirects
    # sends both here); a new line is a new file name, so no cache goes on
    # showing the old one.
    ('og-home-3', '/assets/posters/843280565.jpg', 'I tell stories', 'through visuals.',
     'Ahmed El-Nimeri &middot; Creative director &amp; editor &middot; Dubai'),
    # a new count is a new file name (og-work-3.jpg), so no cache keeps the old one
    ('og-work-3', '/assets/posters/1058181870.jpg', f'{WORDS.get(N, N)} films.', 'Brand, event, documentary, music, motion.',
     'Ahmed El-Nimeri &middot; Selected work &middot; Dubai'),
    # the same rule: a new count is a new file name
    (f'og-solana-{SOL_N}', '/assets/posters/solana-in-2025.jpg', f'{WORDS.get(SOL_N, SOL_N)} Solana videos.',
     'Each linked to its post on X.', 'Ahmed El-Nimeri &middot; Every Solana video I edited'),
    ('og-about', '/assets/portrait/beach-1280.jpg', 'Rooms, rigs and monitors.', 'And public comments on the films.',
     'Ahmed El-Nimeri &middot; About &middot; Dubai'),
    ('og-cv', '/assets/onset/2020-monitor.jpg', 'Eleven years of film.', 'Sudan and the Gulf.',
     'Ahmed El-Nimeri &middot; Experience &amp; CV &middot; Dubai'),
]

TPL = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@font-face {{ font-family: P; src: url("/assets/fonts/poppins-600.woff2") format("woff2"); font-weight: 600; font-display: block; }}
@font-face {{ font-family: P; src: url("/assets/fonts/poppins-400.woff2") format("woff2"); font-weight: 400; font-display: block; }}
* {{ margin: 0; box-sizing: border-box; }}
body {{ width: 1200px; height: 630px; overflow: hidden; background: #0a0a0c; font-family: P, system-ui, sans-serif; }}
.card {{ position: relative; width: 1200px; height: 630px; overflow: hidden; }}
.plate {{ position: absolute; inset: 0; width: 1200px; height: 630px; object-fit: cover; filter: grayscale(1) contrast(1.03); opacity: .5; }}
.scrim {{ position: absolute; inset: 0; background: linear-gradient(100deg, #0a0a0ce8 0%, #0a0a0cc4 46%, #0a0a0c5c 100%); }}
.mid {{ position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 86px; }}
h1 {{ font-size: 58px; font-weight: 600; letter-spacing: -.038em; line-height: 1.1; color: #fff; max-width: 17ch; }}
h1 span {{ color: #b9b7c4; display: block; }}
.who {{ margin-top: 34px; font-size: 20px; letter-spacing: -.01em; color: #cfced6; }}
.rule {{ width: 54px; height: 3px; background: #fff; margin-bottom: 34px; }}
</style></head><body><div class="card">
  <img class="plate" src="{plate}" alt="">
  <div class="scrim"></div>
  <div class="mid"><div class="rule"></div><h1>{line1}<span>{line2}</span></h1><p class="who">{who}</p></div>
</div></body></html>'''

out = []
for name, plate, l1, l2, who in CARDS:
    p = pathlib.Path(f'_{name}.html')
    p.write_text(TPL.format(plate=plate, line1=html.escape(l1), line2=html.escape(l2), who=who))
    out.append(str(p))
print(f'{len(out)} share cards written for rendering ({N} clips, TRT {TRT}): ' + ', '.join(out))
