#!/usr/bin/env python3
"""Rebuild index.html's JSON-LD graph from whatever tiles are currently present.

The film list must be derived from the DOM, not maintained by hand — swapping
two tiles once left the schema advertising films that were no longer on the
page. It lists each film by the @id its own page describes it under
(/work/<slug>#film), so run this after bin-build-work-pages.py.
"""
import re, json, os
import html as _html

s = open('index.html').read()

def slugify(t):
    # the film pages' own rule (bin-build-work-pages.py)
    t = _html.unescape(t).lower()
    t = t.replace('&', ' and ').replace('“', '').replace('”', '').replace('"', '').replace('’', '').replace("'", '')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')

# The front page's own films, as a list of the films' @ids. Each film is
# described once, in full, on its own page (bin-build-work-pages.py:
# /work/<slug>#film, with its player, still, date, running time and figure);
# repeating all of that here was about 14 KB of head on every visit to the
# front page, and two descriptions of one film that could drift apart.
# The films in <template id="more-films"> are not on this page.
_grid = re.sub(r'<template id="more-films">[\s\S]*?</template>', '', s)
films = []
for blk in re.findall(r'<article class="tile[\s\S]+?</article>', _grid):
    title = _html.unescape(re.search(r'data-title="([^"]*)"', blk).group(1))
    # No role is named and nothing claims a director (Ahmed, 2026-10-03);
    # the relation each film may claim lives on its page. Checked here too,
    # so a tile with an unknown data-credit stops this build as well.
    credit = re.search(r'data-credit="([^"]*)"', blk)
    if credit and credit.group(1) not in ('contributor', 'none'):
        raise SystemExit(f'{title}: data-credit="{credit.group(1)}" (contributor or none)')
    slug = slugify(title)
    if not os.path.exists(f'work/{slug}.html'):
        raise SystemExit(f'{title}: no film page work/{slug}.html (run bin-build-work-pages.py first)')
    films.append((title, slug))

film_list = {
    "@type": "ItemList", "@id": "https://alnimeri.com/#films",
    "name": "Selected films", "url": "https://alnimeri.com/#work",
    "numberOfItems": len(films),
    "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": title,
         "item": {"@id": f"https://alnimeri.com/work/{slug}#film"}}
        for i, (title, slug) in enumerate(films)]}

person = {
  "@type": "Person", "@id": "https://alnimeri.com/#person",
  "name": "Ahmed El-Nimeri",
  # "Ahmed Elnimeri" is the spelling IMDb lists him under (nm16131268).
  "alternateName": ["Ahmed Al-Nimeri", "Ahmed Nimeri", "Ahmed Alnimeri",
                    "Ahmed Elnimeri", "Ahmed Amin El-Nimeri", "أحمد النميري"],
  "url": "https://alnimeri.com",
  "image": "https://alnimeri.com/assets/portrait/studio-1280.jpg",
  "email": "mailto:ahmed@alnimeri.com",
  # his formal title at 1000media (Nas Company). He is a creative director,
  # never a film director (Ahmed, 3 Oct 2026); the descriptor is "creative
  # director and editor".
  "jobTitle": "Associate Creative Director",
  "description": "Creative director and editor in Dubai. Eleven years of commercial, documentary and institutional film.",
  "address": {"@type": "PostalAddress", "addressLocality": "Dubai", "addressCountry": "AE"},
  "nationality": {"@type": "Country", "name": "Sudan"},
  "worksFor": {"@type": "Organization", "name": "1000media",
               "parentOrganization": {"@type": "Organization", "name": "Nas Company"}},
  "alumniOf": {"@type": "CollegeOrUniversity", "name": "University of Khartoum"},
  "knowsLanguage": [{"@type": "Language", "name": "English"},
                    {"@type": "Language", "name": "Arabic"}],
  "knowsAbout": ["Storytelling", "Film direction", "Documentary filmmaking",
                 "Event filmmaking",
                 "Cinematography", "Video editing", "Colour grading",
                 "Motion graphics", "Animation", "Brand storytelling"],
  "sameAs": ["https://vimeo.com/nimeri", "https://www.instagram.com/by_nimeri",
             "https://sudannextgen.com/members/ahmed-el-nimeri/",
             "https://www.wikidata.org/wiki/Q141417588",
             "https://www.imdb.com/name/nm16131268/",
             "https://www.linkedin.com/in/ahmedalnimeri"],
}

graph = {"@context": "https://schema.org", "@graph": [
  person,
  {"@type": "WebSite", "@id": "https://alnimeri.com/#website",
   "url": "https://alnimeri.com", "name": "Ahmed El-Nimeri",
   "publisher": {"@id": "https://alnimeri.com/#person"}, "inLanguage": "en"},
  {"@type": "ProfilePage", "@id": "https://alnimeri.com/#page",
   "url": "https://alnimeri.com",
   "name": "Ahmed El-Nimeri | Creative Director & Editor in Dubai",
   "isPartOf": {"@id": "https://alnimeri.com/#website"},
   "about": {"@id": "https://alnimeri.com/#person"},
   "mainEntity": {"@id": "https://alnimeri.com/#person"},
   "hasPart": {"@id": "https://alnimeri.com/#films"}},
] + [{"@type": "Service", "@id": "https://alnimeri.com/#service-" + key,
      "name": name, "serviceType": name, "description": description,
      "provider": {"@id": "https://alnimeri.com/#person"},
      "url": "https://alnimeri.com/#services", "areaServed": "Dubai, UAE"}
     for key, name, description in [
       ("campaign", "Brand and campaign films", "Direction, cinematography and editing for launches, brand stories and campaigns."),
       ("events", "Event and conference films", "Speaker films, multi-camera coverage and recaps cut on site, for conferences, launches and summits."),
       ("documentary", "Documentary and institutional films", "Documentary and institutional films in English and Arabic, across Sudan and the Gulf."),
       ("post", "Creative direction and post-production", "Creative direction, editorial, motion, colour and sound.")
     ]] + [film_list]}

block = '<script type="application/ld+json">' + json.dumps(graph, ensure_ascii=False, indent=2) + '</script>'
s = re.sub(r'<script type="application/ld\+json">.*?</script>', block, s, count=1, flags=re.S)
open('index.html', 'w').write(s)
print(f"schema rebuilt: {len(films)} films listed by @id, {len(graph['@graph'])} nodes")

# /about and /cv carry the same Person (@id #person) in their own graphs, so a
# page read on its own still resolves AboutPage/ProfilePage.mainEntity. It is
# the same node, so it comes from the same dict: names, sameAs, employer, and
# one jobTitle ("Associate Creative Director", his title at 1000media), so
# search engines see one descriptor, not three. The visible copy on each
# page is its own and is not touched.
for page in ('about.html', 'cv.html'):
    src = open(page).read()
    m = re.search(r'(<script type="application/ld\+json">)(.*?)(</script>)', src, flags=re.S)
    if not m:
        raise SystemExit(f'{page}: no JSON-LD block')
    data = json.loads(m.group(2))
    nodes = data.get('@graph', [])
    at = [i for i, n in enumerate(nodes) if n.get('@type') == 'Person' and n.get('@id') == person['@id']]
    if len(at) != 1:
        raise SystemExit(f'{page}: expected one Person node, found {len(at)}')
    node = dict(person)
    nodes[at[0]] = node
    out = src[:m.start(2)] + json.dumps(data, ensure_ascii=False, indent=2) + src[m.end(2):]
    if out != src:
        open(page, 'w').write(out)
    print(f"{page}: Person node synced with the home graph (jobTitle: {node['jobTitle']})")
