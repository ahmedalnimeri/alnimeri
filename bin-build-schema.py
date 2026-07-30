#!/usr/bin/env python3
"""Rebuild index.html's JSON-LD graph from whatever tiles are currently present.

The VideoObject list must be derived from the DOM, not maintained by hand —
swapping two tiles once left the schema advertising films that were no longer
on the page.
"""
import re, json

s = open('index.html').read()

def iso(d):
    p = [int(x) for x in d.split(':')]
    m, sec = (p[0], p[1]) if len(p) == 2 else (p[0]*60 + p[1], p[2])
    return f"PT{m}M{sec}S"

videos = []
for m in re.finditer(r'<a class="tile__link"[^>]*?data-title="([^"]*)"', s, re.S):
    title = m.group(1)
    head  = s[max(0, m.start()-400):m.end()]
    vm    = re.search(r'data-video="(\d+)"', m.group(0)) or re.search(r'data-video="(\d+)"', head)
    vid   = vm.group(1) if vm else None
    blk  = s[m.start():m.start()+1800]
    dur  = re.search(r'tile__dur">([\d:]+)<', blk)
    kind = re.search(r'tile__kind">([^<]*)<', blk)
    stat = re.search(r'tile__stat" href="([^"]*)"', blk)
    name = title.replace('&amp;', '&')
    kindtxt = (kind.group(1) if kind else '').replace('&amp;', '&').replace(' · ', ' — ')
    poster = re.search(r'src="assets/(posters/[^"?]+)', blk)
    v = {
        "@type": "VideoObject",
        "name": name,
        "description": f"{kindtxt} by Ahmed El-Nimeri." if kindtxt else "Film by Ahmed El-Nimeri.",
        "creator": {"@id": "https://alnimeri.com/#person"},
        "director": {"@id": "https://alnimeri.com/#person"},
    }
    if poster: v["thumbnailUrl"] = f"https://alnimeri.com/assets/{poster.group(1)}"
    # Only films with a Vimeo master can be embedded; the rest live on X only.
    if vid: v["embedUrl"] = f"https://player.vimeo.com/video/{vid}"
    if dur:  v["duration"] = iso(dur.group(1))
    if stat: v["sameAs"] = stat.group(1)
    videos.append(v)

person = {
  "@type": "Person", "@id": "https://alnimeri.com/#person",
  "name": "Ahmed El-Nimeri",
  "alternateName": ["Ahmed Al-Nimeri", "Ahmed Nimeri", "Ahmed Alnimeri",
                    "Ahmed Amin El-Nimeri", "أحمد النميري"],
  "url": "https://alnimeri.com",
  "image": "https://alnimeri.com/assets/og.jpg",
  "email": "mailto:ahmed@alnimeri.com",
  "jobTitle": "Storyteller, Director & Video Producer",
  "description": "Storyteller and film director in Dubai. Eleven years of commercial, documentary and institutional film.",
  "address": {"@type": "PostalAddress", "addressLocality": "Dubai", "addressCountry": "AE"},
  "nationality": {"@type": "Country", "name": "Sudan"},
  "worksFor": {"@type": "Organization", "name": "1000media",
               "parentOrganization": {"@type": "Organization", "name": "Nas Company"}},
  "alumniOf": {"@type": "CollegeOrUniversity", "name": "University of Khartoum"},
  "knowsLanguage": [{"@type": "Language", "name": "English"},
                    {"@type": "Language", "name": "Arabic"}],
  "knowsAbout": ["Storytelling", "Film direction", "Documentary filmmaking",
                 "Cinematography", "Video editing", "Colour grading",
                 "Motion graphics", "Animation", "Brand storytelling"],
  "sameAs": ["https://vimeo.com/nimeri", "https://www.instagram.com/by_nimeri",
             "https://www.linkedin.com/in/ahmedalnimeri"],
}

graph = {"@context": "https://schema.org", "@graph": [
  person,
  {"@type": "WebSite", "@id": "https://alnimeri.com/#website",
   "url": "https://alnimeri.com", "name": "Ahmed El-Nimeri",
   "publisher": {"@id": "https://alnimeri.com/#person"}, "inLanguage": "en"},
  {"@type": "ProfilePage", "@id": "https://alnimeri.com/#page",
   "url": "https://alnimeri.com",
   "name": "Ahmed El-Nimeri — Storyteller & Film Director",
   "isPartOf": {"@id": "https://alnimeri.com/#website"},
   "about": {"@id": "https://alnimeri.com/#person"},
   "mainEntity": {"@id": "https://alnimeri.com/#person"}},
] + videos}

block = '<script type="application/ld+json">' + json.dumps(graph, ensure_ascii=False, indent=2) + '</script>'
s = re.sub(r'<script type="application/ld\+json">.*?</script>', block, s, count=1, flags=re.S)
open('index.html', 'w').write(s)
print(f"schema rebuilt: {len(videos)} VideoObject entries, {len(graph['@graph'])} nodes")
