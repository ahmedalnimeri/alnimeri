#!/usr/bin/env python3
"""Content-hash every local asset URL, so immutable caching is safe.

Assets are served immutable, which is only correct if the URL changes whenever
the bytes do. Posters get overwritten in place — an Al Doroub poster was
replaced and Cloudflare kept serving the previous file from its edge
indefinitely.

Covers these reference shapes, because a URL this script misses is a URL that
can go stale behind an immutable header:

  src="assets/..."           in the HTML pages
  poster="assets/..."        video posters (data-poster too)
  href="/assets/..."         root-relative refs (the LCP preload)
  srcset="a 640w, b 1280w"   responsive posters
  url("assets/...")          backgrounds in the stylesheet
  refinement.css?v=, motion.js?v=   the home page's own sheet and script,
                             stamped with md5[:8] (served immutable); the
                             same for design-hover.css / .js (the film hover
                             layer; bin-build-reel.py stamps the reel pages)

Fonts and favicons are excluded by design — see the note at EXCLUDE.
Run this after touching anything under assets/, refinement.css or motion.js.
"""
import re, hashlib, os, sys

PAGES = ("index.html", "about.html", "cv.html", "privacy.html", "404.html")
SHEETS = ("styles.css",)

# Favicons and the Apple touch icon: Google and iOS cache these by URL, and a
# moving hash keeps resetting that cache. Fonts: they never change in place,
# and the @font-face src has to stay byte-identical to the preload href or the
# file downloads twice.
EXCLUDE = re.compile(r'^/?assets/(favicon|fonts|apple-touch-icon)')

def digest(path):
    return hashlib.md5(open(path, 'rb').read()).hexdigest()[:8]

def resolve(url):
    """Strip any existing stamp and map the URL to a file on disk."""
    clean = url.split('?')[0]
    return clean, clean.lstrip('/')

def stamp_url(url, missing):
    clean, path = resolve(url)
    if EXCLUDE.match(clean) or not os.path.exists(path):
        if not EXCLUDE.match(clean):
            missing.append(path)
        return url
    return f'{clean}?h={digest(path)}'

def process(text, missing):
    n = 0

    def attr(m):
        nonlocal n
        new = stamp_url(m.group(2), missing)
        if new != m.group(2):
            n += 1
        return f'{m.group(1)}="{new}"'

    text = re.sub(r'\b(src|href|poster|data-poster)="(/?assets/[^"]+)"', attr, text)

    def srcset(m):
        nonlocal n
        parts = []
        for chunk in m.group(1).split(','):
            bits = chunk.strip().split()
            if not bits:
                continue
            new = stamp_url(bits[0], missing)
            if new != bits[0]:
                n += 1
            parts.append(' '.join([new] + bits[1:]))
        return 'srcset="' + ', '.join(parts) + '"'

    text = re.sub(r'srcset="([^"]+)"', srcset, text)

    def css(m):
        nonlocal n
        new = stamp_url(m.group(1), missing)
        if new != m.group(1):
            n += 1
        return f'url("{new}")'

    text = re.sub(r'url\("(/?assets/[^"]+)"\)', css, text)

    # The home page's own stylesheet and script carry their content hash as
    # ?v=, and _headers serves them immutable on the strength of it. A hand-
    # typed hash has drifted from the bytes before, so it is always rewritten
    # here from the file itself.
    def own(m):
        nonlocal n
        path = m.group(1)
        if not os.path.exists(path):
            missing.append(path)
            return m.group(0)
        new = f'{path}?v={digest(path)}'
        if new != m.group(0):
            n += 1
        return new

    text = re.sub(r'(?<![\w/.-])(refinement\.css|motion\.js|design-hover\.css|design-hover\.js)\?v=[a-f0-9]+', own, text)
    return text, n

total, allmissing = 0, []
for f in PAGES + SHEETS:
    if not os.path.exists(f):
        continue
    src = open(f).read()
    out, n = process(src, allmissing)
    if out != src:
        open(f, 'w').write(out)
    total += n
    print(f"{f}: {n} asset refs hashed")

for p in dict.fromkeys(allmissing):
    print(f"  MISSING: {p}", file=sys.stderr)
print(f"total: {total}")
