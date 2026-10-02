#!/usr/bin/env python3
"""Build canonical sitemap URLs with page-specific modification dates.

Use committed page history, or filesystem mtime for a new/modified page.
Rebuilding an unchanged sitemap must not claim all pages changed today.
"""
from pathlib import Path
import datetime
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

out = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for url, filename in pages:
    assert (ROOT / filename).is_file(), filename
    out += ['  <url>', f'    <loc>https://alnimeri.com{escape(url)}</loc>',
            f'    <lastmod>{lastmod(filename)}</lastmod>', '  </url>']
out.append('</urlset>')
(ROOT / 'sitemap.xml').write_text('\n'.join(out) + '\n')
print(f'sitemap.xml: {len(pages)} canonical URLs')
