#!/usr/bin/env python3
"""Rebuild index.html's JSON-LD graph from whatever tiles are currently present.

The VideoObject list must be derived from the DOM, not maintained by hand —
swapping two tiles once left the schema advertising films that were no longer
on the page.
"""
import re, json

s = open('index.html').read()
METADATA = json.load(open('assets/video-metadata.json'))

def iso(d):
    p = [int(x) for x in d.split(':')]
    m, sec = (p[0], p[1]) if len(p) == 2 else (p[0]*60 + p[1], p[2])
    return f"PT{m}M{sec}S"

videos = []
for blk in re.findall(r'<article class="tile[\s\S]+?</article>', s):
    title = re.search(r'data-title="([^"]*)"', blk).group(1)
    vm = re.search(r'data-video="(\d+)"', blk)
    vid = vm.group(1) if vm else None
    dur  = re.search(r'tile__dur">([\d:]+)<', blk)
    kind = re.search(r'tile__kind">([^<]*)<', blk)
    stat = re.search(r'tile__stat" href="([^"]*)"', blk)
    # The verified engagement figure, machine-readable. "1.4M views on X" ->
    # 1400000 WatchActions; "4.3K reactions" -> LikeActions. The number is
    # the same one the visible pill shows and links to.
    fig  = re.search(r'tile__stat"[^>]*>\s*([\d.]+)([KM]?)\s+(views|reactions)', blk)
    name = title.replace('&amp;', '&')
    kindtxt = (kind.group(1) if kind else '').replace('&amp;', '&').replace(' · ', ' — ')
    poster = re.search(r'src="assets/(posters/[^"?]+)', blk)
    v = {
        "@type": "VideoObject" if vid else "Movie",
        "name": name,
        "description": f"{kindtxt} by Ahmed El-Nimeri." if kindtxt else "Film by Ahmed El-Nimeri.",
        "creator": {"@id": "https://alnimeri.com/#person"},
        "director": {"@id": "https://alnimeri.com/#person"},
    }
    if vid:
        v["uploadDate"] = METADATA[vid]["uploadDate"]
    if poster: v["thumbnailUrl"] = f"https://alnimeri.com/assets/{poster.group(1)}"
    # Only films with a Vimeo master can be embedded; the rest live on X only.
    if vid: v["embedUrl"] = f"https://player.vimeo.com/video/{vid}"
    if dur:  v["duration"] = iso(dur.group(1))
    if fig:
        n = float(fig.group(1)) * {"K": 1e3, "M": 1e6, "": 1}[fig.group(2)]
        action = "WatchAction" if fig.group(3) == "views" else "LikeAction"
        v["interactionStatistic"] = {
            "@type": "InteractionCounter",
            "interactionType": {"@type": action},
            "userInteractionCount": int(n),
        }
    if stat: v["sameAs"] = stat.group(1)
    videos.append(v)

person = {
  "@type": "Person", "@id": "https://alnimeri.com/#person",
  "name": "Ahmed El-Nimeri",
  "alternateName": ["Ahmed Al-Nimeri", "Ahmed Nimeri", "Ahmed Alnimeri",
                    "Ahmed Amin El-Nimeri", "أحمد النميري"],
  "url": "https://alnimeri.com",
  "image": "https://alnimeri.com/assets/portrait/studio-1280.jpg",
  "email": "mailto:ahmed@alnimeri.com",
  "jobTitle": "Film Director & Editor",
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
             "https://sudannextgen.com/members/ahmed-el-nimeri/",
             "https://www.wikidata.org/wiki/Q141417588",
             "https://www.linkedin.com/in/ahmedalnimeri"],
}

graph = {"@context": "https://schema.org", "@graph": [
  person,
  {"@type": "WebSite", "@id": "https://alnimeri.com/#website",
   "url": "https://alnimeri.com", "name": "Ahmed El-Nimeri",
   "publisher": {"@id": "https://alnimeri.com/#person"}, "inLanguage": "en"},
  {"@type": "ProfilePage", "@id": "https://alnimeri.com/#page",
   "url": "https://alnimeri.com",
   "name": "Ahmed El-Nimeri | Film Director & Editor in Dubai",
   "isPartOf": {"@id": "https://alnimeri.com/#website"},
   "about": {"@id": "https://alnimeri.com/#person"},
   "mainEntity": {"@id": "https://alnimeri.com/#person"}},
] + [{"@type": "Service", "@id": "https://alnimeri.com/#service-" + key,
      "name": name, "serviceType": name, "description": description,
      "provider": {"@id": "https://alnimeri.com/#person"},
      "url": "https://alnimeri.com/#services", "areaServed": "Dubai, UAE"}
     for key, name, description in [
       ("campaign", "Brand and campaign films", "Film direction, cinematography and editing for brands and agencies."),
       ("documentary", "Documentary and institutional films", "Documentary filmmaking in English and Arabic, with experience across Sudan and the Gulf."),
       ("post", "Creative direction and post-production", "Creative direction, editing, motion graphics, colour and sound. Fees quoted per project.")
     ]] + videos}

block = '<script type="application/ld+json">' + json.dumps(graph, ensure_ascii=False, indent=2) + '</script>'
s = re.sub(r'<script type="application/ld\+json">.*?</script>', block, s, count=1, flags=re.S)
open('index.html', 'w').write(s)
print(f"schema rebuilt: {len(videos)} VideoObject entries, {len(graph['@graph'])} nodes")
