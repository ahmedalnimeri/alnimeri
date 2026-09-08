#!/usr/bin/env python3
"""Regenerate sitemap.xml from what actually exists on disk.

It was hand-maintained, which is the same trap the SC/IN stamps were in: add
a film and the sitemap silently falls a URL behind. The film pages are
already derived from index.html, so the sitemap should be too.
"""
import os, glob, datetime

TODAY = datetime.date.today().isoformat()
FIXED = [('/', '1.0', 'monthly'), ('/about', '0.8', 'monthly'),
         ('/work/', '0.7', 'monthly'), ('/privacy', '0.2', 'yearly')]

urls = [(p, pr, cf) for p, pr, cf in FIXED]
urls += [(f"/work/{os.path.basename(f)[:-5]}", '0.6', 'yearly')
         for f in sorted(glob.glob('work/*.html'))
         if os.path.basename(f) != 'index.html']

out = ['<?xml version="1.0" encoding="UTF-8"?>',
       '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for path, pr, cf in urls:
    out += ['  <url>', f'    <loc>https://alnimeri.com{path}</loc>',
            f'    <lastmod>{TODAY}</lastmod>',
            f'    <changefreq>{cf}</changefreq>',
            f'    <priority>{pr}</priority>', '  </url>']
out.append('</urlset>')
open('sitemap.xml', 'w').write('\n'.join(out) + '\n')
print(f'sitemap.xml: {len(urls)} URLs')
