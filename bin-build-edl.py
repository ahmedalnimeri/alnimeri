#!/usr/bin/env python3
"""Export the Selects sequence as a real CMX3600-shaped EDL.

The site claims to be an edit sequence; /selects.edl is the export that
proves it. Every figure is lifted from the page, never typed here: titles,
durations, sources from the tiles; record IN/OUT computed by the same
cumulative sum that produced the SC/IN stamps. The build FAILS if the two
disagree — chrome that prints a real number must stay real.
"""
import re, sys

s = open('index.html').read()

blocks = re.findall(r'<article class="tile[\s\S]+?</article>', s)
tiles = []
for b in blocks:
    href  = re.search(r'<a class="tile__link" href="([^"]+)"', b)
    vid   = re.search(r'data-video="(\d+)"', b)
    title = re.search(r'data-title="([^"]+)"', b)
    dur   = re.search(r'class="tile__dur"[^>]*>(\d+:\d{2})<', b)
    idx   = re.search(r'class="tile__idx">([^<]+)<', b)
    stat  = re.search(r'class="tile__stat"[^>]*>\s*([^<]+?)\s*<', b)
    if not (href and title and dur and idx):
        sys.exit('tile missing a required field: ' + b[:120])
    tiles.append((href.group(1), vid.group(1) if vid else 'AX',
                  title.group(1), dur.group(1), idx.group(1),
                  stat.group(1) if stat else ''))
if len(tiles) != 16:
    sys.exit(f'expected 16 tiles, matched {len(tiles)}')

def tc(sec):
    return f'{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}:00'

lines = ['TITLE: ALNIMERI_SELECTS_2026', 'FCM: NON-DROP FRAME', '']
tot = 0
for n, (href, vid, title, dur, idx, stat) in enumerate(tiles, 1):
    m, ss = map(int, dur.split(':'))
    d = m * 60 + ss
    # cross-check the DOM stamp against the recomputed IN point
    stamp_in = re.search(r'IN (\d+):(\d{2})', idx.replace('&middot;', '·'))
    if stamp_in and (int(stamp_in.group(1)) * 60 + int(stamp_in.group(2))) != tot:
        sys.exit(f'STAMP MISMATCH at event {n}: DOM says {idx!r}, sum says {tot}s')
    lines.append(f'{n:03d}  {vid:<10}  V  C  {tc(0)} {tc(d)} {tc(tot)} {tc(tot + d)}')
    lines.append(f'* FROM CLIP NAME: {title.upper()}')
    host = re.sub(r'^https?://(www\.)?', '', href).split('/')[0].upper()
    lines.append(f'* SOURCE: {host} — {stat.strip().upper()}')
    lines.append('')
    tot += d

lines += [f'* TRT {tc(tot)} · 16 EVENTS · 24 FPS',
          '* SOME OF IT WAS A BRIEF. SOME OF IT WAS MY COUNTRY.',
          '* SEND THE BRIEF: AHMED@ALNIMERI.COM', '']
open('selects.edl', 'w').write('\n'.join(lines))
print(f'selects.edl: 16 events, TRT {tc(tot)}')
