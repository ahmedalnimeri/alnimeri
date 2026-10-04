#!/usr/bin/env python3
"""Fail the build if a film's credit, or a director's title for Ahmed, comes
back anywhere it is read.

Ahmed took the credits off every film on 3 Oct 2026: no "directed by", no
schema "director", no role line under a picture. Roles are for /cv only, as
role names. A builder, a hand edit or a merge can bring one back without
anyone seeing it (a meta description or a JSON-LD key is never on screen), so
this runs at the end of the chain (bin-check.py runs it) and exits non-zero on
the first sign of one.

He is also never called a film director (Ahmed, 3 Oct 2026: "I'm not a film
director I'm a creative director"). Every "director" a visitor or a crawler
can read must be "creative director" (his title, "Associate Creative
Director"; the descriptor, "creative director and editor") or a credit role on
/cv ("Assistant Director"). So "film director", "Storyteller", "directed by",
a "Director:" credit line, "Director & Editor", a jobTitle "Director" and any
other bare director fail. A third party's own title in a quote or a credit
("Director of …") goes in THIRD_PARTY below, word for word, or it fails too.

Checked: every .html the site serves, llms.txt, sitemap*.xml, robots.txt and
the other .txt files at the root, any web manifest, the data files in assets/
that pages read (*.json), the stylesheets (their visible content: strings,
comments out), functions/ (the /reel/<code> pages and the edge's lines are
rendered there), the scripts that write text into the page (main.js,
motion.js, design-*.js), the share-card text in bin-build-og.py (it exists
only inside the rendered JPGs), and every PDF in assets/ (its text, through
pdftotext or pypdf, and its title, subject and keywords). The retired files
in RETIRED (old share cards whose pixels say "Film director", the first CV
PDF) and the stale ones in REPLACED (old counts and wording) must stay
deleted, each with its 301 in _redirects to a file that is here. A "director" inside
a JS string is written \\"director\\", so the quotes may be escaped. Run from
anywhere; it reads the repo it sits in.

"Director" is not the only role. Wherever a film is described — a film page,
/work/ and /work/solana, a tile on the front page, a /reel/ page, the video
entries of sitemap.xml and llms.txt, the JSON served from assets/ — any other
role is a credit too ("edited by", "shot by", "Editor", "Cinematographer",
"DP &", ...). The CV is where roles live, and the home page's own line about
him (its title and hero, not a film) is not a film's credit, so neither is
read for those; nor is his descriptor, "creative director and editor", where
a film page's footer or a reel's description names him.
"""
import ast, html, re, shutil, subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SKIP = {'.git', 'node_modules', 'docs', '.claude', '_og'}   # _og: git-ignored; its words are read from bin-build-og.py

# the claim itself, in any text a person or a machine reads
CLAIM = re.compile(r'directed by|\\?"director\\?"', re.I)
# the titles he has been given and does not hold (and "Film direction" as a
# skill, the same claim in the JSON-LD's knowsAbout)
TITLE = re.compile(r'film[\s-]+direct(?:ors?|ion)|storyteller', re.I)
# a credit line: "Director: …", "Directed: …" (also "Creative Director: …";
# roles are for /cv, as role names, never a "Role: name" line)
CREDIT_COLON = re.compile(r'\b(?:directed|directors?)\s*(?:</?[a-z][^>]*>\s*)*:(?!//)', re.I)
# any other director: it passes only as "creative director" or a credit's
# "assistant director" (see allowed())
DIRECTOR = re.compile(r'\bdirectors?\b', re.I)
# the old credit line's wording, and the markup that carried a credit
LEGACY = re.compile(r'directed, shot and edited', re.I)
CREDIT_LINE = re.compile(r'class="fp-credit"')
# a tile that carries a role for the builders to print
ROLE_ATTR = re.compile(r'\sdata-role="')
# any other role, written next to a film
ROLE = re.compile(r'\b(?:edited|shot|filmed|graded|produced|lensed|cut|animated) by\b'
                  r'|\b(?:editor|editors|cinematographer|colou?rist|director of photography|videographer)\b'
                  r'|\bDP\s*(?:&|&amp;|,|and\b)', re.I)
# where films are described (paths from the repo root), and on the front
# page only its tiles
FILM_TEXT = re.compile(r'^(work/.+\.html|sitemap\.xml|llms\.txt|reel\.tpl\.html|functions/_lib/reel\.js|functions/reel/.+\.js|assets/[^/]+\.json)$')
TILE = re.compile(r'<article class="tile[\s\S]*?</article>')
# Someone else's title, exactly as it is printed on the site (a quote's
# author, a credit's client). Empty: no page names one today.
THIRD_PARTY = []
# Retired files that called him a film director where no text check can read
# it (burned into a share card's pixels) or that old links still name. Each
# must stay out of assets/, with a _redirects rule sending its URL to the
# current file.
RETIRED = ['assets/og.jpg', 'assets/og-home.jpg', 'assets/og-home-2.jpg',
           'assets/Ahmed_ElNimeri_CV.pdf', 'assets/Ahmed_ElNimeri_CV-2026-09.pdf']
# Files replaced by a new name because their words or count went stale
# (assets/* is cached immutable for a year, so a changed file is a new name).
# They held no director claim, but the same rule holds: each stays out of
# assets/, with a 301 to the file that replaced it.
REPLACED = ['assets/og-work.jpg', 'assets/og-work-2.jpg', 'assets/og-about.jpg',
            'assets/og-cv.jpg', 'assets/og-solana-90.jpg', 'assets/og-solana-90-2.jpg',
            'assets/og-solana-list-90.jpg']

def allowed(text, m):
    """True if this "director" is "creative director" / "assistant director",
    or inside a THIRD_PARTY phrase."""
    for phrase in THIRD_PARTY:
        for t in re.finditer(re.escape(phrase), text, re.I):
            if t.start() <= m.start() and m.end() <= t.end():
                return True
    before = text[max(0, m.start() - 60):m.start()]
    before = re.sub(r'<[^>]*>', ' ', before)                       # Creative <b>Director</b>
    before = before.replace('\\u00a0', ' ').replace('\\n', ' ')    # inside a JS/JSON string
    before = re.sub(r'\s+', ' ', html.unescape(before).replace(' ', ' '))
    return re.search(r'\b(?:creative|assistant) ?$', before, re.I) is not None

def his_descriptor(text, m):
    """True if this role is his own descriptor, "creative director and editor"
    (the identity line every page's byline uses), not a film's credit."""
    before = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', text[max(0, m.start() - 60):m.start()])))
    return (m.group(0).lower() == 'editor'
            and re.search(r'\bcreative director (?:and|&) ?$', before, re.I) is not None)

def strip_css_comments(text):
    # keep the line count, so a reported line is still the file's line
    return re.sub(r'/\*[\s\S]*?\*/', lambda c: re.sub(r'[^\n]', ' ', c.group(0)), text)

def og_card_strings(path):
    """The string literals of bin-build-og.py that are not docstrings: the
    share cards' lines, which end up only as pixels in assets/og-*.jpg."""
    tree = ast.parse(path.read_text(encoding='utf-8'))
    docs = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)):
            body = getattr(node, 'body', [])
            if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], 'value', None), ast.Constant):
                docs.add(id(body[0].value))
    lines = [''] * (len(path.read_text(encoding='utf-8').splitlines()) + 1)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docs:
            lines[node.lineno - 1] += ' ' + node.value
    return '\n'.join(lines)

def pdf_text(path):
    """A PDF's words and its title/subject/keywords, or None if nothing here
    can read PDFs."""
    if shutil.which('pdftotext') and shutil.which('pdfinfo'):
        body = subprocess.run(['pdftotext', '-enc', 'UTF-8', str(path), '-'], capture_output=True, text=True)
        info = subprocess.run(['pdfinfo', '-enc', 'UTF-8', str(path)], capture_output=True, text=True)
        if body.returncode == 0 and info.returncode == 0:
            meta = [l for l in info.stdout.splitlines() if re.match(r'(Title|Subject|Keywords|Author):', l)]
            return body.stdout + '\n' + '\n'.join(meta)
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    r = PdfReader(str(path))
    meta = r.metadata or {}
    return '\n'.join([p.extract_text() or '' for p in r.pages] +
                     [f'{k[1:]}: {meta.get(k)}' for k in ('/Title', '/Subject', '/Keywords', '/Author') if meta.get(k)])

def files():
    """(label, text) for everything a visitor or a crawler reads."""
    def served(p):
        return not SKIP.intersection(p.relative_to(ROOT).parts)
    for rel in ('llms.txt', 'functions/_lib/reel.js', 'main.js', 'sitemap.xml'):
        if not (ROOT / rel).exists():
            sys.exit(f'bin-check-claims: {rel} is missing')
    for p in sorted(ROOT.rglob('*.html')):
        if served(p):
            yield p, p.read_text(encoding='utf-8')
    for pat in ('*.txt', 'sitemap*.xml', '*.webmanifest', 'manifest*.json', '*.js'):
        for p in sorted(ROOT.glob(pat)):
            yield p, p.read_text(encoding='utf-8')
    for p in sorted((ROOT / 'functions').rglob('*.js')):
        yield p, p.read_text(encoding='utf-8')
    for p in sorted((ROOT / 'assets').glob('*.json')) + sorted((ROOT / 'assets').glob('*.webmanifest')):
        yield p, p.read_text(encoding='utf-8')
    for p in sorted(ROOT.glob('*.css')):
        yield p, strip_css_comments(p.read_text(encoding='utf-8'))
    og = ROOT / 'bin-build-og.py'
    if og.exists():
        yield og, og_card_strings(og)
    for p in sorted((ROOT / 'assets').rglob('*.pdf')):
        t = pdf_text(p)
        if t is None:
            sys.exit(f'bin-check-claims: cannot read {p.relative_to(ROOT)} '
                     '(install poppler for pdftotext, or pip install pypdf)')
        yield p, t

bad = []
n = 0
for p, text in files():
    n += 1
    rel = p.relative_to(ROOT).as_posix()
    if p.suffix == '.pdf':
        rel += ' (its text)'
    elif p.name == 'bin-build-og.py':
        rel += ' (share-card text)'
    hits = []
    checks = [(CLAIM, 'a director claim'), (TITLE, 'a title he does not hold'),
              (CREDIT_COLON, 'a "Director:" credit line'), (LEGACY, 'the old credit line'),
              (CREDIT_LINE, 'a credit line under a film'), (ROLE_ATTR, 'a data-role on a tile')]
    if FILM_TEXT.match(rel):
        for m in ROLE.finditer(text):
            if not his_descriptor(text, m):
                hits.append((m.start(), m.end(), 'a role next to a film'))
    if rel == 'index.html':
        for t in TILE.finditer(text):
            for m in ROLE.finditer(t.group(0)):
                if not his_descriptor(t.group(0), m):
                    hits.append((t.start() + m.start(), t.start() + m.end(), 'a role on a tile'))
    for pat, what in checks:
        for m in pat.finditer(text):
            hits.append((m.start(), m.end(), what))
    for m in DIRECTOR.finditer(text):
        if any(s <= m.start() < e or m.start() <= s < m.end() for s, e, _w in hits):
            continue        # already reported as one of the above
        if not allowed(text, m):
            hits.append((m.start(), m.end(), 'a director, not "creative director"'))
    for s, e, what in sorted(hits):
        line = text.count('\n', 0, s) + 1
        snip = re.sub(r'\s+', ' ', text[max(0, s - 50):e + 30])
        bad.append(f'  {rel}:{line}: {what}: …{snip}…')

redirects = (ROOT / '_redirects').read_text(encoding='utf-8') if (ROOT / '_redirects').exists() else ''
for rel in RETIRED + REPLACED:
    if (ROOT / rel).exists():
        bad.append(f'  {rel}: ' + ('a retired file that calls him a film director is back' if rel in RETIRED
                                   else 'a replaced file is back under its old name'))
    rule = re.search(r'^/' + re.escape(rel) + r'\s+(/\S+)\s+301\s*$', redirects, re.M)
    if not rule:
        bad.append(f'  _redirects: no 301 rule for /{rel}, a retired file old links still name')
    elif not (ROOT / rule.group(1).lstrip('/')).is_file():
        # the 301 must land on a file that is served, not on another retired name
        bad.append(f'  _redirects: /{rel} goes to {rule.group(1)}, which is not a file here')

if bad:
    print(f'bin-check-claims: {len(bad)} claim(s) found — he is a creative director; roles belong on /cv only:',
          file=sys.stderr)
    print('\n'.join(bad[:60]), file=sys.stderr)
    if len(bad) > 60:
        print(f'  … and {len(bad) - 60} more', file=sys.stderr)
    sys.exit(1)
print(f'claims: clean ({n} files incl. PDFs and share-card text; no "directed by", no "director" but '
      f'"creative director", no film director or storyteller, no credit line, no role next to a film, '
      f'no retired card back)')
