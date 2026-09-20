#!/usr/bin/env python3
"""Build canonical sitemap URLs with page-specific modification dates.

Use committed page history, or filesystem mtime for a new/modified page.
Rebuilding an unchanged sitemap must not claim all pages changed today.
"""
from pathlib import Path
import datetime
import subprocess
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
pages = [('/', 'index.html'), ('/about', 'about.html'), ('/cv', 'cv.html'),
         ('/work/', 'work/index.html'), ('/privacy', 'privacy.html')]
pages += [(f'/work/{f.stem}', str(f.relative_to(ROOT)))
          for f in sorted((ROOT / 'work').glob('*.html')) if f.stem != 'index']

def lastmod(filename):
    path = ROOT / filename
    try:
        dirty = subprocess.check_output(['git', 'status', '--porcelain', '--', filename], cwd=ROOT, text=True).strip()
        if not dirty:
            stamp = subprocess.check_output(['git', 'log', '-1', '--format=%cs', '--', filename], cwd=ROOT, text=True).strip()
            if stamp:
                return stamp
    except (OSError, subprocess.CalledProcessError):
        pass
    return datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc).date().isoformat()

out = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for url, filename in pages:
    assert (ROOT / filename).is_file(), filename
    out += ['  <url>', f'    <loc>https://alnimeri.com{escape(url)}</loc>',
            f'    <lastmod>{lastmod(filename)}</lastmod>', '  </url>']
out.append('</urlset>')
(ROOT / 'sitemap.xml').write_text('\n'.join(out) + '\n')
print(f'sitemap.xml: {len(pages)} canonical URLs')
