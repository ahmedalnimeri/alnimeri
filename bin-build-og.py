#!/usr/bin/env python3
"""Write the share cards' HTML, one per page, for rendering at 1200x630.

The card that shipped said "16 CLIPS · TRT 42:18" long after the seventeenth
film landed: every number here is derived from index.html, like every other
printed number on the site. Render with bin-render-og.sh, which screenshots
these through the local server so the cards use the site's own typeface.
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
    ('og', '/assets/posters/843280565.jpg', 'Some of it was a brief.', 'Some of it was my country.',
     'AHMED EL-NIMERI · FILM DIRECTOR &amp; EDITOR · DUBAI', 'A-ROLL 001'),
    ('og-work', '/assets/posters/1058181870.jpg', f'{WORDS.get(N, N)} films.', f'{TRT} on the record.',
     'BRAND · EVENT · DOCUMENTARY · MOTION', 'B-ROLL 002'),
    ('og-about', '/assets/portrait/beach-1280.jpg', 'Rooms, rigs and monitors.', 'And what people said after.',
     'AHMED EL-NIMERI · ABOUT · DUBAI', 'A-ROLL 003'),
    ('og-cv', '/assets/onset/2020-monitor.jpg', 'Eleven years of film.', 'Sudan, the Gulf, and further out.',
     'AHMED EL-NIMERI · CV &amp; EXPERIENCE · DUBAI', 'A-ROLL 004'),
]

TPL = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@font-face {{ font-family: P; src: url("/assets/fonts/poppins-600.woff2") format("woff2"); font-weight: 600; font-display: block; }}
@font-face {{ font-family: P; src: url("/assets/fonts/poppins-400.woff2") format("woff2"); font-weight: 400; font-display: block; }}
* {{ margin: 0; box-sizing: border-box; }}
body {{ width: 1200px; height: 630px; overflow: hidden; background: #0a0a0c; font-family: P, system-ui, sans-serif; }}
.card {{ position: relative; width: 1200px; height: 630px; }}
.plate {{ position: absolute; inset: 70px 0; width: 1200px; height: 490px; object-fit: cover; filter: grayscale(1) contrast(1.02); opacity: .38; }}
.bar {{ position: absolute; left: 0; right: 0; height: 70px; background: #000; display: flex; align-items: center;
       justify-content: space-between; padding: 0 40px; color: #8b8992;
       font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 15px; letter-spacing: .12em; }}
.bar--top {{ top: 0; }} .bar--bot {{ bottom: 0; }}
.bar b {{ color: #e9e8ee; font-weight: 400; }}
.mid {{ position: absolute; inset: 70px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 70px; }}
h1 {{ font-size: 56px; font-weight: 600; letter-spacing: -.035em; line-height: 1.12; color: #fff; }}
h1 span {{ color: #b9b7c4; display: block; }}
.who {{ margin-top: 30px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 17px;
        letter-spacing: .14em; color: #cfced6; }}
.dot {{ width: 9px; height: 9px; border-radius: 50%; background: #fff; display: inline-block; margin-right: 12px; vertical-align: 1px; }}
</style></head><body><div class="card">
  <img class="plate" src="{plate}" alt="">
  <div class="bar bar--top"><span><i class="dot"></i>{roll} &middot; 24 FPS</span><span>ALNIMERI.COM</span></div>
  <div class="mid"><h1>{line1}<span>{line2}</span></h1><p class="who">{who}</p></div>
  <div class="bar bar--bot"><span>SEQ 2026 &middot; {n} CLIPS &middot; TRT {trt}</span><span><b>100M+</b> VIEWS &middot; ON THE RECORD</span></div>
</div></body></html>'''

out = []
for name, plate, l1, l2, who, roll in CARDS:
    p = pathlib.Path(f'_{name}.html')
    p.write_text(TPL.format(plate=plate, line1=html.escape(l1), line2=html.escape(l2), who=who, roll=roll, n=N, trt=TRT))
    out.append(str(p))
print(f'{len(out)} share cards written for rendering ({N} clips, TRT {TRT}): ' + ', '.join(out))
