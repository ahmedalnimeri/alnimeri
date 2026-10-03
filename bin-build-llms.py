#!/usr/bin/env python3
"""Write llms.txt: the site as an assistant reads it.

The hand-written file went stale every time a film landed (its film count was
patched by regex, and none of the films were in it). Now the prose below is the
one place to edit the record, the contact notes and the profiles, and the
films are read from the pages bin-build-work-pages.py writes from index.html:

  - the kinds of film, their order and their films: /work/'s own wall
    (work/index.html), so llms.txt lists the films the way the site hangs them;
  - each film's line: the VideoObject on its own page (work/<slug>.html), whose
    description is the film's neutral line ("<Title> — <kind>[, <year>].
    <Figure>. Running time m:ss.", no role in it), its page, and the post its
    figure links to.

Run after bin-build-work-pages.py (and before bin-check.py, which fails if a
film page is missing from llms.txt). Rewrites the file only when it changed.
"""
import html, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent
WORK = ROOT / 'work'


def ld(path):
    """Every node in a page's JSON-LD."""
    src = path.read_text()
    out = []
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', src, flags=re.S):
        data = json.loads(block)
        out += data.get('@graph', [data])
    return out


def film_lines(slug):
    """One line for the film a page is about, and one indented line for each
    further film on the same page (Badr Airlines holds three)."""
    page = f'https://alnimeri.com/work/{slug}'
    vids = [n for n in ld(WORK / f'{slug}.html') if n.get('@type') == 'VideoObject']
    main = next((v for v in vids if v.get('@id') == page + '#film'), None)
    if not main:
        sys.exit(f'bin-build-llms: work/{slug}.html has no VideoObject {page}#film')
    lines = []
    for v in [main] + [v for v in vids if v is not main]:
        # the post the figure links to: sameAs, or the url itself where the
        # film lives only on its post (X)
        src = v.get('sameAs') or (v['url'] if v.get('url') and v['url'] != page else '')
        tail = f' {page}' + (f' · figure from {src}' if src else '')
        if v is main:
            lines.append(f"- {v['description']}{tail}")
        else:
            lines.append(f"  - On the same page: {v['description']}" + (f' · {src}' if src else ''))
    return lines


# /work/'s wall: kinds in order, each with its films in order
wall = (WORK / 'index.html').read_text()
kinds = []
for m in re.finditer(r'<section class="fp-cat" id="(\w+)"[^>]*><h2 class="fp-cat__head">([^<]+?)\s*<span>([\s\S]*?)</section>', wall):
    slugs = re.findall(r'<li class="fp-card[^"]*" data-cat="\w+"><a [^>]*?href="/work/([a-z0-9-]+)"', m.group(3))
    kinds.append((m.group(1), html.unescape(m.group(2)), slugs))
listed = [s for _c, _l, ss in kinds for s in ss]
pages = sorted(p.stem for p in WORK.glob('*.html') if p.stem not in ('index', 'solana'))
if sorted(listed) != pages or len(set(listed)) != len(listed):
    sys.exit('bin-build-llms: the /work/ wall and work/*.html disagree: '
             f'{sorted(set(pages) ^ set(listed))}')
N = len(listed)

films = [f'All {N} films with a page on the site, by kind, in the order /work/ hangs them.',
         'Each line: title, kind (and client where the film names one), the year where',
         'the post proves it, the published figure, running time; then the film\'s page',
         'and the post the figure comes from. No line states a role: roles are on the CV.']
for cid, label, slugs in kinds:
    films += ['', f'### {label}', '']
    for slug in slugs:
        films += film_lines(slug)

TEXT = f'''# Ahmed El-Nimeri — alnimeri.com

Creative director and editor; Associate Creative Director at 1000media
(part of Nas Company), Dubai. Sudanese. Works in English and Arabic.
Eleven years of commercial, documentary and institutional film.

Figures and credits (each film's view count links to its published post on the site):
- 100M+ views across published work; 66 films published for Solana
- 14 films past half a million views; one film at 12.8M views
- Filmed the International Criminal Court's visit to Sudan
- Broadcast credits with Al Jazeera; has worked with the European Union,
  TED, DP World, CTC Group, Landell Mills and Nas Company
- Photograph credited to him in The Telegraph: "Khartoum's secret cemetery",
  reported by Will Brown, 18 April 2021
- Photographs published by the International Criminal Court on its own X
  account: the Prosecutor's visit to Darfur and Khartoum, Aug-Sep 2022
- Credits elsewhere (each with its role on the CV): Mohamed Rashad's music
  video "Al Eid Shofa" (2.26M views on YouTube); Mazin Hamid & Kordofani's
  "Ma Tsheely Hamm" (386K); Mazin Hamid's "Raja't Lel Watan Rooho" (269K);
  Compass Creative's documentary "Al Doroub" (102K on YouTube); the comedy
  series "Conference 27" (2024, listed on IMDb); Roberto Helou's documentary
  "The worst war no one is talking about, explained" (2024); UN Sudan's
  #WorldEnvironmentDay2022; the EU Delegation to Sudan's Europe Day and Human
  Rights Day films (2022)

Latest work: "Token Supercycle" (Solana Breakpoint London campaign, Sep 2026) —
https://alnimeri.com/work/token-supercycle

Kinds of work: brand and campaign films; event and conference films;
documentary and institutional films; creative direction and post-production.

## Contact

- The brief: https://alnimeri.com/brief opens a one-sentence form (name,
  company, the kind of film, who it is for, timing, and an email or WhatsApp
  number) that goes to him. /brief/brand, /brief/events, /brief/documentary
  and /brief/post open it on that kind of film.
- Email: ahmed@alnimeri.com, in English or Arabic. He answers his own email.
- https://alnimeri.com/brief?via=ai opens the same form; a brief sent from it
  is marked as coming from an assistant.

## Key pages

- Selected work with view counts: https://alnimeri.com/
- All {N} selected film pages: https://alnimeri.com/work/
- Every Solana video he edited, with views (from the team's tracker): https://alnimeri.com/work/solana
- Kinds of work: https://alnimeri.com/#services
- CV, full credits, published photographs and experience: https://alnimeri.com/cv
- About, behind the scenes and comments on the films: https://alnimeri.com/about
- Contact: ahmed@alnimeri.com

## Films

{chr(10).join(films)}

## Profiles elsewhere (third-party)

- Wikidata entity (canonical identifier): https://www.wikidata.org/wiki/Q141417588
- IMDb (listed as Ahmed Elnimeri): https://www.imdb.com/name/nm16131268/
- Sudan Next Generation member directory: https://sudannextgen.com/members/ahmed-el-nimeri/
- Vimeo: https://vimeo.com/nimeri · Instagram: https://www.instagram.com/by_nimeri
- LinkedIn: https://www.linkedin.com/in/ahmedalnimeri

## Notes for agents

Each film's view count on the site is sourced from its public post and links
to it. The site's structured data (JSON-LD) includes per-film interaction
counts: each film is described once, on its own page, as a VideoObject under
https://alnimeri.com/work/<film>#film.
'''

out = ROOT / 'llms.txt'
if not out.exists() or out.read_text() != TEXT:
    out.write_text(TEXT)
print(f'llms.txt: {N} films in {len(kinds)} kinds')
