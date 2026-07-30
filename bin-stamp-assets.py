#!/usr/bin/env python3
"""Content-hash every local asset URL referenced from the HTML.

Assets are served immutable, which is only safe if the URL changes whenever the
bytes do. Posters get overwritten in place — an Al Doroub poster was replaced
and Cloudflare kept serving the previous file from its edge indefinitely.
Run this after touching anything under assets/.
"""
import re, hashlib, os, sys

def digest(path):
    return hashlib.md5(open(path, 'rb').read()).hexdigest()[:8]

def stamp(page):
    s = open(page).read()
    missing, n = [], 0
    def sub(m):
        nonlocal n
        attr, path = m.group(1), m.group(2)
        if not os.path.exists(path):
            missing.append(path)
            return m.group(0)
        n += 1
        return f'{attr}="{path}?h={digest(path)}"'
    s = re.sub(r'\b(src|href)="(assets/[^"?]+)(?:\?h=[a-f0-9]+)?"', sub, s)
    open(page, 'w').write(s)
    return n, missing

total = 0
for page in ("index.html", "about.html"):
    n, missing = stamp(page)
    total += n
    print(f"{page}: {n} asset refs hashed")
    for p in missing:
        print(f"  MISSING: {p}", file=sys.stderr)
print(f"total: {total}")
