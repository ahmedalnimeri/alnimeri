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
films = re.findall(r'<article class="tile[\s\S]+?</article>', SRC)
durs = [re.search(r'tile__dur">([\d:]+)<', b).group(1) for b in films]
secs = sum(int(d.split(':')[0]) * 60 + int(d.split(':')[1]) for d in durs)
TRT = f'{secs // 60}:{secs % 60:02d}'
N = len(films)
WORDS = {14: 'Fourteen', 15: 'Fifteen', 16: 'Sixteen', 17: 'Seventeen', 18: 'Eighteen', 19: 'Nineteen', 20: 'Twenty'}

CARDS = [
    ('og-home', '/assets/posters/843280565.jpg', 'Some of it was a brief.', 'Some of it was my country.',
     'Ahmed El-Nimeri &middot; Film director &amp; editor &middot; Dubai'),
    ('og-work', '/assets/posters/1058181870.jpg', f'{WORDS.get(N, N)} films.', 'Brand, event, documentary, motion.',
     'Ahmed El-Nimeri &middot; Selected work &middot; Dubai'),
    ('og-about', '/assets/portrait/beach-1280.jpg', 'Rooms, rigs and monitors.', 'And what people said after.',
     'Ahmed El-Nimeri &middot; About &middot; Dubai'),
    ('og-cv', '/assets/onset/2020-monitor.jpg', 'Eleven years of film.', 'Sudan, the Gulf, and further out.',
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
