#!/usr/bin/env python3
"""Build canonical sitemap URLs with page-specific modification dates.

Use committed page history, or filesystem mtime for a new/modified page.
Rebuilding an unchanged sitemap must not claim all pages changed today.

Each film page also lists the films it plays (Google's video sitemap
extension): still, title, description, player, running time and date, read
from the VideoObjects bin-build-work-pages.py wrote into that page, so the
sitemap can never describe a film differently from its page, and a film new
to index.html gets its entry with no edit here. A film with no player on the
site (one that lives only on X) has no entry: there is nothing here to play.
"""
from pathlib import Path
import datetime
import json
import re
import subprocess
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
pages = [('/', 'index.html'), ('/about', 'about.html'), ('/cv', 'cv.html'),
         ('/work/', 'work/index.html'), ('/privacy', 'privacy.html')]
pages += [(f'/work/{f.stem}', str(f.relative_to(ROOT)))
          for f in sorted((ROOT / 'work').glob('*.html')) if f.stem != 'index']

# Every release bumps ?v= (and re-stamps ?h=) on every page, so "the last
# commit that touched the file" is always the last commit. A change counts only
# if something other than those stamps moved.
STAMP = re.compile(r'\?(?:v|h)=[0-9a-f]+')

def meaningful(diff):
    plus, minus = [], []
    for line in diff.splitlines():
        if line.startswith(('+++', '---')):
            continue
        if line.startswith('+'):
            plus.append(STAMP.sub('', line[1:]))
        elif line.startswith('-'):
            minus.append(STAMP.sub('', line[1:]))
    return sorted(plus) != sorted(minus)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True)

def lastmod(filename):
    path = ROOT / filename
    # the local date, as git's %cs gives a commit's: a page edited at 00:16 in
    # Dubai is that day's change, before and after it is committed
    mtime = datetime.date.fromtimestamp(path.stat().st_mtime).isoformat()
    try:
        if git('status', '--porcelain', '--', filename).strip() and meaningful(git('diff', 'HEAD', '--', filename)):
            return mtime
        # Newest first: the first commit whose diff is more than stamps.
        first = None
        for chunk in git('log', '--format=@@@ %cs', '-p', '--', filename).split('\n@@@ ')[0:]:
            chunk = chunk[4:] if chunk.startswith('@@@ ') else chunk
            date, _, diff = chunk.partition('\n')
            first = date.strip() or first
            if meaningful(diff):
                return date.strip()
        if first:
            return first            # only ever stamp changes: its first commit
    except (OSError, subprocess.CalledProcessError):
        pass
    return mtime

def seconds(iso):
    m = re.fullmatch(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', iso or '')
    if not m or not any(m.groups()):
        raise SystemExit(f'sitemap: cannot read duration {iso!r}')
    h, mi, se = (int(x or 0) for x in m.groups())
    return h * 3600 + mi * 60 + se

def videos(filename):
    """The films a page plays, from its own JSON-LD: VideoObjects with a player."""
    if not filename.startswith('work/'):
        return []
    src = (ROOT / filename).read_text()
    out = []
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', src, flags=re.S):
        data = json.loads(block)
        for node in data.get('@graph', [data]):
            if node.get('@type') != 'VideoObject' or not node.get('embedUrl'):
                continue
            missing = [k for k in ('thumbnailUrl', 'name', 'description', 'duration', 'uploadDate') if not node.get(k)]
            if missing:
                raise SystemExit(f'sitemap: {filename}: {node.get("name")} has no {", ".join(missing)}')
            out.append(node)
    return out

out = ['<?xml version="1.0" encoding="UTF-8"?>',
       '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
       ' xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">']
n_vid = 0
for url, filename in pages:
    assert (ROOT / filename).is_file(), filename
    out += ['  <url>', f'    <loc>https://alnimeri.com{escape(url)}</loc>',
            f'    <lastmod>{lastmod(filename)}</lastmod>']
    for v in videos(filename):
        n_vid += 1
        out += ['    <video:video>',
                f'      <video:thumbnail_loc>{escape(v["thumbnailUrl"])}</video:thumbnail_loc>',
                f'      <video:title>{escape(v["name"])}</video:title>',
                f'      <video:description>{escape(v["description"])}</video:description>',
                f'      <video:player_loc>{escape(v["embedUrl"])}</video:player_loc>',
                f'      <video:duration>{seconds(v["duration"])}</video:duration>',
                f'      <video:publication_date>{escape(v["uploadDate"])}</video:publication_date>',
                '    </video:video>']
    out.append('  </url>')
out.append('</urlset>')
(ROOT / 'sitemap.xml').write_text('\n'.join(out) + '\n')
print(f'sitemap.xml: {len(pages)} canonical URLs, {n_vid} films with a player')
