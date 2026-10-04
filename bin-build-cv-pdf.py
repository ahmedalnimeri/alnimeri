#!/usr/bin/env python3
"""Print the downloadable CV (assets/Ahmed_ElNimeri_CV-2026-10.pdf) from /cv.

Every "Download CV (PDF)" link opens this file, and it used to be made by hand,
so it drifted: it went on saying "Eight Days of Sudan" and "Commissioned by"
after the page had moved on. Now nothing in it is typed here. The words are
read from cv.html as it stands (its sections, in the page's own wording and
headings), plus three things the page says elsewhere:

  - his title and name: the Person in cv.html's JSON-LD (bin-build-schema.py),
    "Associate Creative Director"
  - the opening line: the first paragraph of the home page's "Behind the work"
    (index.html #about), the line the old PDF opened with
  - the contact lines: the email, the city and the profiles in cv.html's
    Contact section

and laid out as a quiet A4 document (two to three pages) in the site's own
typeface: Poppins, from assets/fonts, embedded in the template, and for the
Arabic the same system fallback the site uses (the site ships no Arabic face).
Every link on the page is a link in the PDF. The ↗ marks (aria-hidden on the
page) are left out.

Printed by headless Chrome over the DevTools pipe (Page.printToPDF; no port,
so it never collides with a dev server or another browser). Chrome is
$CHROME_BIN, else Playwright's chrome-headless-shell, else Google Chrome.

The title, author, subject and keywords are written into the PDF as an
incremental update (stdlib only). The file is rewritten only when what Chrome
prints has changed: a second run leaves the bytes, and so the ?h= stamp, as
they are. The page fails the build instead of printing if anything runs past
the right margin, or if a font fails to load.

Run it before bin-stamp-assets.py, which stamps the new bytes into every link
(index.html, about.html, cv.html; bin-build-work-pages.py copies the home
page's into /work/). The ?h= moves the cache for every link on the site; a
bare link to the file has none, so when the words change, give OUT a new name
(the month), point the links at it, and 301 the old name to it in _redirects.

A list item on /cv that is only a link to a page here is printed with its
address after it (on_paper), since a link cannot be seen on paper.

  python3 bin-build-cv-pdf.py            # rewrite the PDF if it changed
  python3 bin-build-cv-pdf.py --html F   # also write the print template to F, to look at
"""
import base64, datetime, fcntl, glob, hashlib, html, json, os, re, select, shutil
import subprocess, sys, tempfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parent
# assets/* is served immutable for a year, and a bare link to the PDF (an old
# link, a _redirects target, a link sent by hand) carries no ?h=, so a CV
# whose words change is a new file name: the month it was printed in. The old
# names are 301s in _redirects. -2026-09 went live as the hand-made PDF
# ("Storyteller · Film Director · …"), so that URL may sit in a cache for a
# year with those words; the CV printed from /cv is -2026-10.
OUT = ROOT / 'assets' / 'Ahmed_ElNimeri_CV-2026-10.pdf'
SITE = 'https://alnimeri.com/'
FONTS = {400: 'poppins-400', 500: 'poppins-500', 600: 'poppins-600', 700: 'poppins-700'}


# ---------------------------------------------------------------- reading ---

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
        'source', 'track', 'wbr'}


class Node:
    def __init__(self, tag, attrs, parent=None):
        self.tag, self.attrs, self.parent, self.kids = tag, attrs, parent, []

    @property
    def cls(self):
        return set((self.attrs.get('class') or '').split())

    def find_all(self, tag=None, cls=None, id=None):
        for k in self.kids:
            if isinstance(k, Node):
                if ((tag is None or k.tag == tag) and (cls is None or cls in k.cls)
                        and (id is None or k.attrs.get('id') == id)):
                    yield k
                yield from k.find_all(tag, cls, id)

    def find(self, tag=None, cls=None, id=None):
        return next(self.find_all(tag, cls, id), None)

    def children(self, tag=None, cls=None):
        return [k for k in self.kids if isinstance(k, Node)
                and (tag is None or k.tag == tag) and (cls is None or cls in k.cls)]


class Tree(HTMLParser):
    def __init__(self, src):
        super().__init__(convert_charrefs=True)
        self.root = self.cur = Node('#root', {})
        self.feed(src)
        self.close()

    def handle_starttag(self, tag, attrs):
        n = Node(tag, {k: (v if v is not None else '') for k, v in attrs}, self.cur)
        self.cur.kids.append(n)
        if tag not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(Node(tag, {k: (v or '') for k, v in attrs}, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.kids.append(data)


def squash(s):
    # collapse the source's line breaks and indents; keep no-break spaces
    return re.sub(r'[ \t\r\n\f]+', ' ', s).strip()


def hidden(n):
    return n.attrs.get('aria-hidden') == 'true'


def text(n):
    """The words a reader sees: no ↗ marks (aria-hidden), whitespace collapsed."""
    def walk(x):
        if isinstance(x, str):
            return x
        if hidden(x) or x.tag in ('script', 'style'):
            return ''
        return ''.join(walk(k) for k in x.kids)
    return squash(walk(n)) if n is not None else ''


def absolute(href):
    if href.startswith(('mailto:', 'tel:')):
        return href
    return urljoin(SITE + 'cv', href)


HYPHENATED = re.compile(r"[\w’']+(?:-[\w’']+)+")


def inline(n):
    """The words as HTML: links (absolute), bold, and an Arabic span's lang and
    dir survive; every other tag gives way to its text."""
    def walk(x):
        if isinstance(x, str):
            # a hyphenated word (al-Kabli, on-tone, 19-second) never breaks at its hyphen
            return HYPHENATED.sub(r'<span class="nw">\g<0></span>', html.escape(x, quote=False))
        if hidden(x) or x.tag in ('script', 'style'):
            return ''
        inner = ''.join(walk(k) for k in x.kids)
        if x.tag == 'a' and x.attrs.get('href'):
            return f'<a href="{html.escape(absolute(x.attrs["href"]))}">{inner}</a>'
        if x.tag in ('b', 'strong', 'em', 'i'):
            return f'<{x.tag}>{inner}</{x.tag}>'
        if x.tag == 'span' and x.attrs.get('lang'):
            d = f' dir="{x.attrs["dir"]}"' if x.attrs.get('dir') else ''
            return f'<span lang="{html.escape(x.attrs["lang"])}"{d}>{inner}</span>'
        return inner
    return squash(walk(n)) if n is not None else ''


def on_paper(n):
    """A list item that is nothing but a link to a page here ("Solana videos
    I edited", on /cv) says nothing on paper, where a link cannot be seen:
    print it with its address, "Solana videos I edited:
    alnimeri.com/work/solana", the address being the link. Anything else is
    inline(n)."""
    kids = [k for k in n.kids if not (isinstance(k, Node) and hidden(k))]
    links = [k for k in kids if isinstance(k, Node)]
    loose = squash(''.join(k for k in kids if isinstance(k, str)))
    if len(links) == 1 and links[0].tag == 'a' and not loose and links[0].attrs.get('href'):
        href = absolute(links[0].attrs['href'])
        u = urlsplit(href)
        if u.netloc == urlsplit(SITE).netloc and not u.query and not u.fragment:
            shown = u.netloc + u.path.rstrip('/')
            return (f'{html.escape(text(links[0]), quote=False)}: '
                    f'<a href="{html.escape(href)}"><span class="nw">{html.escape(shown, quote=False)}</span></a>')
    return inline(n)


def need(x, what):
    if x is None or x == '' or x == []:
        sys.exit(f'bin-build-cv-pdf: cv.html has no {what} (the page changed shape; '
                 'update the reader in bin-build-cv-pdf.py)')
    return x


def read_cv():
    cv = Tree((ROOT / 'cv.html').read_text(encoding='utf-8')).root
    home = Tree((ROOT / 'index.html').read_text(encoding='utf-8')).root

    person = None
    for s in cv.find_all('script'):
        if s.attrs.get('type') == 'application/ld+json':
            data = json.loads(''.join(k for k in s.kids if isinstance(k, str)))
            for node in data.get('@graph', [data]):
                if node.get('@type') == 'Person':
                    person = node
    need(person, 'Person in its JSON-LD')

    def section(id_):
        return need(cv.find('section', id=id_), f'section #{id_}')

    def heading(sec):
        return text(need(sec.find(cls='slate__title'), 'section heading'))

    d = {'name': need(person.get('name'), 'Person name'),
         'title': need(person.get('jobTitle'), 'jobTitle')}

    # contact: the page's own Contact section
    contact = section('contact')
    mail = need(contact.find('a', cls='contact__mail'), 'contact email')
    d['email'] = mail.attrs['href'].split('?')[0].replace('mailto:', '')
    colophon = need(contact.find(cls='colophon'), 'colophon')
    d['city'] = text(colophon.children('span')[-1]).split(' · ')[0]
    d['profiles'] = []
    for a in need(contact.find(cls='contact__links'), 'contact links').find_all('a'):
        href = a.attrs.get('href', '')
        if href.startswith('http'):
            u = urlsplit(href)
            d['profiles'].append((u.netloc.replace('www.', '') + u.path.rstrip('/'), href))

    # the opening line: the home page's "Behind the work"
    about = need(home.find('section', id='about'), 'index.html #about')
    d['summary'] = inline(need(about.find('p', cls='about__body'), 'index.html #about paragraph'))

    # Worked with: the marquee's label and its logos' names
    marquee = need(cv.find('section', cls='marquee'), 'Worked with marquee')
    d['worked_label'] = text(marquee.find(cls='marquee__label'))
    d['worked'] = [i.attrs['alt'] for i in marquee.find(cls='marquee__track').find_all('img')
                   if i.attrs.get('alt')]

    # Experience
    sec = section('experience')
    d['experience_head'] = heading(sec)
    d['experience'] = []
    for li in need(sec.find('ol', cls='track'), 'experience list').children('li'):
        if 'track__aside' in li.cls:
            d['experience'].append({'aside': inline(li)})
            continue
        role = li.find(cls='track__role')
        tag = role.find(cls='tag')
        d['experience'].append({
            'years': text(li.find(cls='track__years')),
            'where': text(li.find(cls='track__where')),
            'city': text(li.find(cls='track__city')),
            'role': squash(text(role)[: len(text(role)) - len(text(tag))] if tag else text(role)),
            'tag': text(tag),
            'brief': inline(li.find(cls='track__brief')),
            'points': [on_paper(p) for p in (li.find(cls='track__points') or Node('ul', {})).children('li')],
        })
    need([e for e in d['experience'] if 'role' in e], 'experience entries')

    # Selected Projects
    sec = section('projects')
    d['projects_head'] = heading(sec)
    d['projects'] = []
    for card in sec.find_all('article', cls='card'):
        stat = card.find(cls='credit__stat')
        posts = []
        for li in (card.find(cls='card__posts') or Node('ul', {})).children('li'):
            posts.append({'what': text(li.find(cls='card__posts-what')),
                          'role': text(li.find(cls='card__posts-role')),
                          'via': [(text(a), a.attrs['href']) for a in li.find(cls='card__posts-via').find_all('a')]})
        d['projects'].append({
            'year': text(card.find(cls='card__year')),
            'title': text(card.find(cls='card__title')),
            'org': text(card.find(cls='card__org')),
            'body': inline(card.find(cls='card__body')),
            'stat': (text(stat), stat.attrs['href']) if stat is not None and stat.tag == 'a' else None,
            'posts_head': text(card.find(cls='card__posts-head')),
            'posts': posts,
        })
    need(d['projects'], 'project cards')

    def credits(id_):
        sec = section(id_)
        rows = []
        for li in sec.find_all('li', cls='credit'):
            stat = li.find(cls='credit__stat')
            if stat is not None and stat.tag == 'a':
                link = {'text': text(stat), 'href': stat.attrs['href']}
            elif stat is not None:
                # a set of posts: "On X 1 2 3 4 5", each number its own link
                links = [(text(a), a.attrs['href']) for a in stat.find_all('a')]
                lead = squash(''.join(k for k in stat.kids if isinstance(k, str)))
                link = {'lead': lead, 'links': links}
            else:
                link = None
            rows.append({'client': text(li.find(cls='credit__client')),
                         'title': inline(li.find(cls='credit__title')),
                         'role': text(li.find(cls='credit__role')),
                         'stat': link})
        return {'head': heading(sec), 'note': inline(sec.find(cls='credits__note')),
                'rows': need(rows, f'credits in #{id_}')}
    d['published'] = credits('published')
    d['credits'] = credits('credits')

    # Craft
    sec = section('craft')
    d['craft_head'] = heading(sec)
    d['craft'] = [(text(g.find('h3')), [text(li) for li in g.find('ul').children('li')])
                  for g in sec.find_all(cls='skills__group')]
    need(d['craft'], 'craft groups')
    langs = [items for head, items in d['craft'] if head.lower() == 'languages']
    d['languages'] = ' & '.join(i.split(' — ')[0] for i in langs[0]) if langs else ''

    # Education (and the volunteer card beside it)
    sec = section('more')
    d['education_head'] = heading(sec)
    d['education'] = []
    for card in need(sec.find(cls='about__grid'), 'education grid').children(cls='card'):
        d['education'].append({
            'title': text(card.find(cls='card__title')),
            'org': text(card.find(cls='card__org')),
            'body': inline(card.find(cls='card__body')),
            'points': [on_paper(p) for p in (card.find('ul') or Node('ul', {})).children('li')],
        })
    return d


# ---------------------------------------------------------------- the page ---

def esc(s):
    return html.escape(s, quote=True)


def link(label, href):
    return f'<a href="{esc(absolute(href))}">{esc(label)}</a>'


CSS = r'''
@page {
  size: A4; margin: 15mm 17mm 17mm;
  @bottom-left  { content: "%(name)s"; font: 400 6.8pt/1 P, sans-serif; color: #8a8a8a; vertical-align: top; padding-top: 5mm; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 400 6.8pt/1 P, sans-serif; color: #8a8a8a; vertical-align: top; padding-top: 5mm; }
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 400 8.6pt/1.5 P, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
       color: #141414; background: #fff; font-kerning: normal; }
p, li { orphans: 3; widows: 3; }
a { color: inherit; text-decoration: underline; text-decoration-thickness: 0.4pt;
    text-decoration-color: #b9b9b9; text-underline-offset: 1.6pt; }
b, strong { font-weight: 500; }
[lang="ar"] { font-size: 1.06em; white-space: nowrap; }
.nw { white-space: nowrap; }
.dim { color: #6e6e6e; }
.sep { color: #b0b0b0; }

header h1 { margin: 0; font: 700 23pt/1.05 P, sans-serif; letter-spacing: -0.02em; }
header .title { margin: 4pt 0 9pt; font: 500 10.5pt/1.3 P, sans-serif; }
header .contact { margin: 0; font-size: 7.8pt; line-height: 1.65; color: #555; }
header .contact a { text-decoration: none; }
.rule { border: 0; border-top: 0.75pt solid #141414; margin: 11pt 0 10pt; }
.summary { margin: 0; font-size: 9.6pt; line-height: 1.55; max-width: 152mm; }

h2 { margin: 15pt 0 6pt; font: 600 6.4pt/1 P, sans-serif; letter-spacing: 0.17em;
     text-transform: uppercase; break-after: avoid; page-break-after: avoid; }
.list { margin: 0; color: #2a2a2a; }

.job, .project, .school { break-inside: avoid; page-break-inside: avoid; margin: 0 0 8.5pt; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 10pt; }
.row .when { flex: none; font-size: 7.6pt; color: #555; font-variant-numeric: tabular-nums; }
.role { margin: 0; font: 600 9.3pt/1.35 P, sans-serif; }
.role .tag { font-weight: 400; font-size: 7.6pt; color: #7a7a7a; }
.org { margin: 0.5pt 0 2.5pt; font-size: 7.8pt; color: #333; }
.org .city { color: #7a7a7a; }
.brief { margin: 0 0 2pt; }
ul { margin: 0; padding: 0; list-style: none; }
ul.points li { position: relative; padding-left: 9pt; margin: 0 0 1pt; }
ul.points li::before { content: ""; position: absolute; left: 1.5pt; top: 0.62em; width: 2.6pt; height: 2.6pt;
                       border-radius: 50%%; background: #8a8a8a; }
.aside { margin: 2pt 0 8.5pt; padding: 3.5pt 0; border-top: 0.4pt solid #dcdcdc; border-bottom: 0.4pt solid #dcdcdc;
         font-size: 7.6pt; color: #6e6e6e; break-inside: avoid; }

.project .body { margin: 1pt 0 0; }
.project .stat { white-space: nowrap; }
.posts { margin: 3.5pt 0 0; padding-left: 9pt; border-left: 0.6pt solid #dcdcdc; font-size: 7.8pt; }
.posts .head { margin: 0 0 1pt; color: #6e6e6e; }
.posts li { margin: 0; }

.credits-note { margin: 0 0 4pt; color: #6e6e6e; font-size: 7.8pt; }
.credits { margin: 0; padding: 0; list-style: none; border-top: 0.4pt solid #dcdcdc; }
.credit { display: grid; grid-template-columns: minmax(0, 1fr) 36mm 39mm; gap: 8pt; align-items: baseline;
          padding: 3.2pt 0; border-bottom: 0.4pt solid #dcdcdc; font-size: 8pt; line-height: 1.4;
          break-inside: avoid; page-break-inside: avoid; }
.credit .client { font-weight: 500; }
.credit .what { color: #3a3a3a; }
.credit .crole { color: #3a3a3a; }
.credit .cstat { text-align: right; color: #3a3a3a; font-variant-numeric: tabular-nums; }
.credit .cstat .lead { margin-right: 4.5pt; }
.credit .cstat a + a { margin-left: 3.5pt; }

.craft { display: grid; grid-template-columns: 35mm minmax(0, 1fr); column-gap: 8pt; row-gap: 3pt; margin: 0; }
.craft dt { margin: 0; font-weight: 500; break-after: avoid; }
.craft dd { margin: 0; color: #2a2a2a; }

.school .title { margin: 0; font: 600 9.3pt/1.35 P, sans-serif; }
.school .org { margin: 0.5pt 0 1.5pt; }
.school .body { margin: 0; color: #444; }
section { break-inside: auto; }
.keep { break-inside: avoid; page-break-inside: avoid; }
'''


def font_faces():
    out = []
    for weight, name in FONTS.items():
        data = base64.b64encode((ROOT / 'assets' / 'fonts' / f'{name}.woff2').read_bytes()).decode()
        out.append(f'@font-face {{ font-family: P; font-weight: {weight}; font-style: normal; '
                   f'font-display: block; src: url(data:font/woff2;base64,{data}) format("woff2"); }}')
    return '\n'.join(out)


def page(d):
    # a list breaks between its items, never inside one, and never before a dot
    S = '\u00a0<span class="sep">·</span> '

    def whole(s):
        return f'<span class="nw">{s}</span>'
    contact1 = [link(d['email'], 'mailto:' + d['email']), link('alnimeri.com', SITE), esc(d['city'])]
    if d['languages']:
        contact1.append(esc(d['languages']))
    contact2 = [link(label, href) for label, href in d['profiles']]

    jobs = []
    for e in d['experience']:
        if 'aside' in e:
            jobs.append(f'<p class="aside">{e["aside"]}</p>')
            continue
        tag = f' <span class="tag">· {esc(e["tag"])}</span>' if e['tag'] else ''
        city = f'{S}<span class="city">{esc(e["city"])}</span>' if e['city'] else ''
        brief = f'<p class="brief">{e["brief"]}</p>' if e['brief'] else ''
        pts = ''.join(f'<li>{p}</li>' for p in e['points'])
        jobs.append(f'<div class="job"><div class="row"><h3 class="role">{esc(e["role"])}{tag}</h3>'
                    f'<span class="when">{esc(e["years"])}</span></div>'
                    f'<p class="org">{esc(e["where"])}{city}</p>{brief}'
                    + (f'<ul class="points">{pts}</ul>' if pts else '') + '</div>')

    projects = []
    for p in d['projects']:
        bits = [f'<span class="dim">{esc(p["org"])}</span>'] if p['org'] else []
        if p['stat']:
            bits.append(f'<span class="stat">{link(*p["stat"])}</span>')
        head = f'<h3 class="role">{esc(p["title"])}' + ''.join(
            f'{S}<span style="font-weight:400;font-size:8pt">{b}</span>' for b in bits) + '</h3>'
        posts = ''
        if p['posts']:
            items = ''.join(
                f'<li>{esc(x["what"])}{S}<span class="dim">{esc(x["role"])}</span>{S}'
                + S.join(link(lbl, h) for lbl, h in x['via']) + '</li>' for x in p['posts'])
            posts = (f'<div class="posts"><p class="head">{esc(p["posts_head"])}</p>'
                     f'<ul>{items}</ul></div>')
        projects.append(f'<div class="project"><div class="row">{head}'
                        f'<span class="when">{esc(p["year"])}</span></div>'
                        f'<p class="body">{p["body"]}</p>{posts}</div>')

    def credit_rows(c):
        rows = []
        for r in c['rows']:
            st = r['stat']
            if st is None:
                stat = ''
            elif 'href' in st:
                stat = link(st['text'], st['href'])
            else:
                stat = (f'<span class="lead">{esc(st["lead"])}</span>' if st['lead'] else '') + ' '.join(link(t, h) for t, h in st['links'])
            rows.append(f'<li class="credit"><span><span class="client">{esc(r["client"])}</span>'
                        f'<br><span class="what">{r["title"]}</span></span>'
                        f'<span class="crole">{esc(r["role"])}</span><span class="cstat">{stat}</span></li>')
        note = f'<p class="credits-note">{c["note"]}</p>' if c['note'] else ''
        # the heading, the note and the first row never part
        first, rest = rows[0], ''.join(rows[1:])
        return (f'<section><div class="keep"><h2>{esc(c["head"])}</h2>{note}'
                f'<ul class="credits">{first}</ul></div><ul class="credits" style="border-top:0">{rest}</ul></section>')

    craft = ''.join(f'<dt>{esc(h)}</dt><dd>{S.join(whole(esc(i)) for i in items)}</dd>' for h, items in d['craft'])

    schools = []
    for s in d['education']:
        org = f'<p class="org">{esc(s["org"])}</p>' if s['org'] else ''
        body = f'<p class="body">{s["body"]}</p>' if s['body'] else ''
        pts = ''.join(f'<li>{p}</li>' for p in s['points'])
        schools.append(f'<div class="school"><h3 class="title">{esc(s["title"])}</h3>{org}{body}'
                       + (f'<ul class="points" style="margin-top:2pt">{pts}</ul>' if pts else '') + '</div>')

    title = f'{d["name"]} — CV'
    css = CSS % {'name': d['name'].replace('"', '\\"')}
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{esc(title)}</title>
<style>
{font_faces()}
{css}
</style></head>
<body>
<header>
  <h1>{esc(d["name"])}</h1>
  <p class="title">{esc(d["title"])}</p>
  <p class="contact">{S.join(map(whole, contact1))}<br>{S.join(map(whole, contact2))}</p>
</header>
<hr class="rule">
<p class="summary">{d["summary"]}</p>

<section><h2>{esc(d["worked_label"])}</h2>
<p class="list">{S.join(whole(esc(n)) for n in d["worked"])}</p></section>

<section><h2>{esc(d["experience_head"])}</h2>
{"".join(jobs)}</section>

<section><h2>{esc(d["projects_head"])}</h2>
{"".join(projects)}</section>

{credit_rows(d["published"])}
{credit_rows(d["credits"])}

<section class="keep"><h2>{esc(d["craft_head"])}</h2>
<dl class="craft">{craft}</dl></section>

<section class="keep"><h2>{esc(d["education_head"])}</h2>
{"".join(schools)}</section>
</body></html>
'''


# --------------------------------------------------------------- printing ---

def chrome():
    env = os.environ.get('CHROME_BIN')
    if env:
        return env
    shells = glob.glob(os.path.expanduser(
        '~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell'))
    shells += glob.glob(os.path.expanduser(
        '~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell'))
    if shells:
        return max(shells, key=lambda p: int(re.search(r'shell-(\d+)', p).group(1)))
    for p in ('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              shutil.which('google-chrome') or '', shutil.which('chromium') or ''):
        if p and os.path.exists(p):
            return p
    sys.exit('bin-build-cv-pdf: no Chrome found (set CHROME_BIN, or: npx playwright install chromium-headless-shell)')


class Pipe:
    """Chrome's DevTools protocol over --remote-debugging-pipe (fd 3 in, fd 4 out)."""

    def __init__(self, binary):
        self.prof = tempfile.mkdtemp(prefix='cv-pdf-')
        cmd_r, self.cmd_w = os.pipe()
        self.res_r, res_w = os.pipe()

        def fds():
            a = fcntl.fcntl(cmd_r, fcntl.F_DUPFD, 10)
            b = fcntl.fcntl(res_w, fcntl.F_DUPFD, 10)
            os.dup2(a, 3)
            os.dup2(b, 4)
        args = [binary, '--remote-debugging-pipe', f'--user-data-dir={self.prof}', '--no-first-run',
                '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio']
        if 'headless-shell' not in binary:
            args.append('--headless=new')
        self.proc = subprocess.Popen(args + ['about:blank'], preexec_fn=fds, close_fds=False,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
        os.close(cmd_r)
        os.close(res_w)
        self.buf, self.n = b'', 0

    def send(self, method, params=None, session=None, timeout=60):
        self.n += 1
        msg = {'id': self.n, 'method': method, 'params': params or {}}
        if session:
            msg['sessionId'] = session
        os.write(self.cmd_w, json.dumps(msg).encode() + b'\0')
        while True:
            while b'\0' not in self.buf:
                ready, _, _ = select.select([self.res_r], [], [], timeout)
                if not ready:
                    raise RuntimeError(f'Chrome did not answer {method} in {timeout}s')
                chunk = os.read(self.res_r, 1 << 20)
                if not chunk:
                    raise RuntimeError(f'Chrome closed the pipe during {method}')
                self.buf += chunk
            raw, self.buf = self.buf.split(b'\0', 1)
            m = json.loads(raw)
            if m.get('id') == self.n:
                if 'error' in m:
                    raise RuntimeError(f'{method}: {m["error"].get("message")}')
                return m['result']

    def close(self):
        try:
            self.send('Browser.close', timeout=5)
        except Exception:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        for fd in (self.cmd_w, self.res_r):
            try:
                os.close(fd)
            except OSError:
                pass
        shutil.rmtree(self.prof, ignore_errors=True)


# what the page must pass before it is printed: every font loaded, nothing
# past the right margin, no date, tag or figure broken over two lines
CHECK = r'''(async () => {
  await document.fonts.ready;
  const faces = [...document.fonts].map(f => f.weight + ':' + f.status);
  const W = document.documentElement.clientWidth, bad = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > W + 0.5) bad.push(el.tagName + '.' + el.className + ': ' + (el.textContent || '').trim().slice(0, 60));
  }
  for (const el of document.querySelectorAll('.when, .tag, .cstat a, .project .stat')) {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 12;
    if (el.getClientRects().length > 1 || el.getBoundingClientRect().height > lh * 1.5)
      bad.push('wraps: ' + el.textContent.trim());
  }
  return { faces, bad };
})()'''


def render(doc):
    c = Pipe(chrome())
    try:
        targets = c.send('Target.getTargets')['targetInfos']
        page_t = next((t for t in targets if t['type'] == 'page'), None)
        tid = page_t['targetId'] if page_t else c.send('Target.createTarget', {'url': 'about:blank'})['targetId']
        sid = c.send('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
        c.send('Page.enable', session=sid)
        c.send('Runtime.enable', session=sid)
        # lay the page out at A4's text width (210 - 2 x 17 mm), in print media,
        # so the check below measures what will be printed
        c.send('Emulation.setEmulatedMedia', {'media': 'print'}, session=sid)
        c.send('Emulation.setDeviceMetricsOverride',
               {'width': round(176 / 25.4 * 96), 'height': 1100, 'deviceScaleFactor': 1, 'mobile': False},
               session=sid)
        frame = c.send('Page.getFrameTree', session=sid)['frameTree']['frame']['id']
        c.send('Page.setDocumentContent', {'frameId': frame, 'html': doc}, session=sid)
        res = c.send('Runtime.evaluate', {'expression': CHECK, 'awaitPromise': True, 'returnByValue': True},
                     session=sid)['result']['value']
        if any(not f.endswith(':loaded') and not f.endswith(':unloaded') for f in res['faces']):
            sys.exit(f'bin-build-cv-pdf: a font did not load: {res["faces"]}')
        if res['bad']:
            sys.exit('bin-build-cv-pdf: the page does not fit:\n  ' + '\n  '.join(res['bad'][:20]))
        pdf = c.send('Page.printToPDF', {'printBackground': True, 'preferCSSPageSize': True,
                                          'displayHeaderFooter': False, 'generateTaggedPDF': True,
                                          'transferMode': 'ReturnAsBase64'}, session=sid, timeout=120)
        return base64.b64decode(pdf['data'])
    finally:
        c.close()


# ----------------------------------------------------------- the metadata ---

def pdf_string(s):
    if all(32 <= ord(ch) < 127 for ch in s):
        return '(' + s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)') + ')'
    return '<FEFF' + s.encode('utf-16-be').hex().upper() + '>'


def pdf_date(t):
    off = t.utcoffset() or datetime.timedelta(0)
    mins = int(off.total_seconds() // 60)
    sign = '+' if mins >= 0 else '-'
    return f"D:{t:%Y%m%d%H%M%S}{sign}{abs(mins) // 60:02d}'{abs(mins) % 60:02d}'"


DATE = re.compile(rb"D:\d{14}[+\-Z]\d{2}'\d{2}'")


def finish(raw, meta, created, modified):
    """Chrome's PDF with its own dates set to ours (same length, so no offset
    moves), then one incremental update that replaces its Info dictionary
    with the CV's title, author, subject and keywords, and gives the file an
    /ID from its content."""
    m = re.search(rb'trailer\s*<<(.*?)>>\s*startxref\s*(\d+)\s*%%EOF\s*$', raw, re.S)
    if not m:
        sys.exit('bin-build-cv-pdf: Chrome wrote a PDF this script cannot read (no classic trailer)')
    trailer, prev = m.group(1), int(m.group(2))
    size = int(re.search(rb'/Size\s+(\d+)', trailer).group(1))
    root = re.search(rb'/Root\s+(\d+\s+\d+\s+R)', trailer).group(1).decode()
    info = re.search(rb'/Info\s+(\d+)\s+(\d+)\s+R', trailer)
    producer = re.search(rb'/Producer\s*\(([^)]*)\)', raw)
    num, gen = (int(info.group(1)), int(info.group(2))) if info else (size, 0)
    if info:
        # Chrome's own Info dictionary (the only place it writes a date):
        # its dates become ours, byte for byte the same length
        o = re.search(rb'(?:^|\n)%d %d obj\s*<<.*?>>\s*endobj' % (num, gen), raw, re.S)
        if o:
            raw = raw[:o.start()] + DATE.sub(created.encode(), o.group(0)) + raw[o.end():]
    if not raw.endswith(b'\n'):
        raw += b'\n'
    fields = dict(meta, Producer=producer.group(1).decode('latin-1') if producer else 'Skia/PDF')
    body = ''.join(f'/{k} {pdf_string(v)}\n' for k, v in fields.items())
    body += f'/CreationDate ({created})\n/ModDate ({modified})\n'
    obj = f'{num} {gen} obj\n<<{body}>>\nendobj\n'.encode()
    digest = hashlib.md5(raw).hexdigest().upper()
    at = len(raw)
    xref_at = at + len(obj)
    tail = (f'xref\n0 1\n0000000000 65535 f \n{num} 1\n{at:010d} {gen:05d} n \n'
            f'trailer\n<</Size {max(size, num + 1)}\n/Root {root}\n/Info {num} {gen} R\n'
            f'/ID [<{digest}> <{digest}>]\n/Prev {prev}>>\nstartxref\n{xref_at}\n%%EOF\n').encode()
    return raw + obj + tail


def dates_of(pdf):
    """CreationDate and ModDate of the file as it stands (the last Info wins)."""
    c = re.findall(rb'/CreationDate\s*\((D:[^)]*)\)', pdf)
    m = re.findall(rb'/ModDate\s*\((D:[^)]*)\)', pdf)
    return (c[-1].decode(), m[-1].decode()) if c and m else (None, None)


def main():
    d = read_cv()
    doc = page(d)
    if '--html' in sys.argv:
        Path(sys.argv[sys.argv.index('--html') + 1]).write_text(doc, encoding='utf-8')
    raw = render(doc)
    meta = {
        'Title': f'{d["name"]} — CV',
        'Author': d['name'],
        'Subject': f'CV — {d["title"]}. {d["city"]}.',
        'Keywords': f'{d["name"]}, CV, {d["title"]}, creative director, editor, {d["city"].split(",")[0]}',
        'Creator': 'alnimeri.com',
    }
    old = OUT.read_bytes() if OUT.exists() else b''
    created, modified = dates_of(old)
    if created and DATE.fullmatch(created.encode()) and DATE.fullmatch(modified.encode()):
        if finish(raw, meta, created, modified) == old:
            print(f'cv-pdf: {OUT.relative_to(ROOT)} unchanged')
            return
    now = pdf_date(datetime.datetime.now().astimezone().replace(microsecond=0))
    out = finish(raw, meta, now, now)
    OUT.write_bytes(out)
    pages = len(re.findall(rb'/Type\s*/Page\b', out))
    print(f'cv-pdf: wrote {OUT.relative_to(ROOT)} ({pages} pages, {len(out):,} bytes); '
          'run bin-stamp-assets.py to stamp the new bytes into the links')


if __name__ == '__main__':
    main()
