#!/usr/bin/env python3
"""Fail the build if a film's credit comes back anywhere it is read.

Ahmed took the credits off every film on 3 Oct 2026: no "directed by", no
schema "director", no role line under a picture. Roles are for /cv only, as
role names. A builder, a hand edit or a merge can bring one back without
anyone seeing it (a meta description or a JSON-LD key is never on screen), so
this runs last in the chain and exits non-zero on the first sign of one.

Checked: every .html the site serves, llms.txt, functions/_lib/reel.js and
the rest of functions/ (the /reel/<code> pages are rendered there), and the
scripts that write text into the page (main.js, motion.js, design-*.js).
A "director" inside a JS string is written \\"director\\", so the quotes
may be escaped. Run from anywhere; it reads the repo it sits in.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SKIP = {'.git', 'node_modules', 'docs'}

# the claim itself, in any text a person or a machine reads
CLAIM = re.compile(r'directed by|\\?"director\\?"', re.I)
# the old credit line's wording, and the markup that carried a credit
LEGACY = re.compile(r'directed, shot and edited', re.I)
CREDIT_LINE = re.compile(r'class="fp-credit"')
# a tile that carries a role for the builders to print
ROLE_ATTR = re.compile(r'\sdata-role="')

def files():
    for p in sorted(ROOT.rglob('*.html')):
        if not SKIP.intersection(p.relative_to(ROOT).parts):
            yield p
    for rel in ('llms.txt', 'functions/_lib/reel.js', 'main.js'):
        if not (ROOT / rel).exists():
            sys.exit(f'bin-check-claims: {rel} is missing')
    yield ROOT / 'llms.txt'
    for p in sorted((ROOT / 'functions').rglob('*.js')):
        yield p
    for p in sorted(ROOT.glob('*.js')):
        yield p

bad = []
n = 0
for p in files():
    n += 1
    rel = p.relative_to(ROOT).as_posix()
    text = p.read_text(encoding='utf-8')
    checks = [(CLAIM, 'a director claim'), (LEGACY, 'the old credit line'),
              (CREDIT_LINE, 'a credit line under a film'), (ROLE_ATTR, 'a data-role on a tile')]
    for pat, what in checks:
        for m in pat.finditer(text):
            line = text.count('\n', 0, m.start()) + 1
            snip = re.sub(r'\s+', ' ', text[max(0, m.start() - 50):m.end() + 30])
            bad.append(f'  {rel}:{line}: {what}: …{snip}…')

if bad:
    print(f'bin-check-claims: {len(bad)} claim(s) found — roles belong on /cv only:', file=sys.stderr)
    print('\n'.join(bad[:60]), file=sys.stderr)
    if len(bad) > 60:
        print(f'  … and {len(bad) - 60} more', file=sys.stderr)
    sys.exit(1)
print(f'claims: clean ({n} files, no "directed by", no "director", no credit line)')
