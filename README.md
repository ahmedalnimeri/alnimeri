# alnimeri.com

Portfolio site for Ahmed El-Nimeri. Static HTML, CSS and JavaScript — no framework, no build step, no dependencies.

Design spec: [`docs/superpowers/specs/2026-07-29-portfolio-site-design.md`](docs/superpowers/specs/2026-07-29-portfolio-site-design.md)

## Run locally

```sh
python3 -m http.server 4321
# → http://localhost:4321
```

## Files

| Path | Purpose |
|---|---|
| `index.html` | Everything — markup, meta tags, JSON-LD |
| `styles.css` | Single stylesheet; palette lives in `:root` |
| `main.js` | Lightbox and the reel, hard-cut navigation, scroll reveal, "Make a reel" (the tray, its link and the sheet's "Get in touch", which opens the brief with the selected films) and the brief dialog |
| `design-*.css` / `design-*.js` | One design layer per area: `hover` (home films and /reel/), `filmpages` (/work/ and the film pages), `about`, `compositions` (the home services), `ending` (the end credits of the home page and of /work/) and `loops` (the films beside the opening line, moving). Stamped with their own md5 and served immutable |
| `design-transition.js` | Changing pages: the page cuts through black (the two pages are never on screen together), and the still you clicked grows into the film page's player, without its words (`.vt-bare`) (cross-document view transitions; the CSS is the "page-to-page" block in `styles.css`, the room light's cue `.vt-film` in `design-filmpages.css`). Never linked: `pagereveal` fires before any deferred script runs, so `bin-stamp-assets.py` inlines it into the head of `/` and `/about` (between its two markers) and `bin-build-work-pages.py` copies that block onto `/work/` and every film page. Edit the file, never an inlined copy. Browsers without cross-document view transitions, and reduced motion, just navigate |
| `assets/posters/` | Poster frames per video: `<id>.jpg` (master) plus `-480`/`-768` JPEG and `-480`/`-768`/`-1280` WebP sizes (vertical films: `-768w` in place of `-768`). A vertical film may also have `<poster>-card.jpg` (+ `-480`/`-768`, 16:9, cut from the same frame), which the `/work/` wall shows in place of a 9:16 poster cut down to its 16:9 cards (DP World at SailGP, Sugar vs Jaggery). A changed poster takes a new name, `<id>-b` (the old files stay on disk, linked from nowhere). `1083313331-1600.*` and `-2560.*` are offered only by the front page's full-row scope tile (1600 for its 1400px box on a 1x screen, 2560 for 2x); the builders never pass anything wider than 1280w to the film pages, the About board or the reel |
| `assets/loops/` | A few seconds of each of the hero's six films: one shot, about three seconds, silent, cut so that its end runs back into its start, 1280x720, about 400 KB, as `<data-video>-<md5[:8]>.webm` (VP9) and `.mp4` (H.264, faststart; Safari and every Apple browser take it). `bin-build-home-art.py` writes them onto the hero's films (`data-loop-webm`/`data-loop-mp4`); `design-loops.js` plays the one on show over its still, once the page has loaded and gone idle and the picture is on screen, fetches the next one about two seconds in, never more, stops off screen and in a hidden tab, and plays none at all under reduced motion, Save-Data or 2g/3g. A re-cut loop is a new file under its new hash; delete the one it replaces (only the hero links a loop; the builder refuses two). `bin-check.py` fails on a loop whose name is not its bytes' md5[:8]. No loops in the films grid yet (hover loops are for later) |
| `assets/published/` | His photographs as others published them, hand-placed (About's one print: the ICC's Khartoum meeting, Aug 2022). Master plus `-480`/`-768` JPEG and `-480`/`-768`/full-width WebP; a changed picture gets a new name. Only officials or places: never survivors, witnesses or children |
| `functions/brief/[[kind]].js` | `/brief` and `/brief/<kind>`: a link that opens the brief. 302s to `/?brief=<kind>&film=<slug>&via=<where>`, each value checked against a fixed list (kind: brand, events, documentary, post; film: `functions/_lib/films.js`; via: ig, li, wa, x, sig, ai, qr) and dropped if it is not on it. main.js opens the dialog on arrival (also for `#brief`) and puts the address back without them; `via` travels in the brief's "came from" value (`film_seen`), so the database and the Briefs sheet are unchanged |
| `functions/api/e.js` | What visitors do, not who they are: `main.js` sends one `navigator.sendBeacon` per Play pressed, brief opened/sent/failed, view count followed to its post, reel link copied or shared (event `shortlist_share`), and CV downloaded (`{t, film, path, via}`). Stored in D1 `events` (`schema.sql`) with the country and nothing else (no IP, no user agent); the site's own pages only (Origin), 1 KB cap, kept 90 days. `/api/e?key=<VISITS_TOKEN>` reads it (`&format=json` for the sheet's Events tab, `docs/apps-script/Sync.gs`) |
| Cloudflare Web Analytics | One beacon, one token, on every page: hand-placed on `/`, `/about`, `/cv`, `/privacy` and the 404; copied from `index.html` by the builders onto the film pages, `/work/`, `/work/solana` and the `/reel/<code>` template. `bin-check.py` fails on a page with none or two |
| `assets/reel-keys.json` | Every `/reel/<code>` character ever given, and the film it names (written by `bin-build-reel.py`) |

## Adding or changing a video

1. Find the Vimeo ID (the number in `vimeo.com/1234567890`), or, for a film that lives on
   YouTube, its 11-character id (`youtube.com/watch?v=mseoOqBdc7A`) with
   `data-provider="youtube"` beside `data-video`. Either one plays the same way: the still is
   a facade that becomes the player on Play (Vimeo's, or YouTube's privacy-enhanced
   `youtube-nocookie.com` player with `autoplay=1&rel=0&modestbranding=1`), on the film pages,
   in the front page's lightbox and in the reel. A film that lives only on X has neither
   attribute: its tile links to the post and its page says "Watch on X" (Solana x All In).
   Add the film's date to `assets/video-metadata.json` (Vimeo's upload date for the schema; a
   YouTube video's published date, which its watch page shows, so its year is printed too).
2. Save its poster as `assets/posters/<id>.jpg`, and make the `-480`/`-768` JPEG and
   `-480`/`-768`/`-1280` WebP sizes next to it (new file names if a poster ever changes).
3. Copy an existing `<article class="tile">` block in `index.html` and update
   `data-video`, `data-title`, BOTH srcsets (the WebP `<source>` and the `<img>`), the `src`,
   the `alt`, the duration and the title.

Set `data-portrait="true"` and add `tile--tall` for vertical pieces.

A film for `/work/` only (its own page and its place on the `/work/` wall, but not
the front page's grid) is the same tile, placed inside `<template id="more-films">`
after the grid. A `<template>` is never rendered, so the front page, its reel and
its bin never see it; the builders read it like any other tile. Move the block
between the two to promote or retire a film from the front page.

Attributes on the `<article>` the builders read:

- `data-credit="contributor"` / `data-credit="none"` — what the films' data may claim of
  Ahmed. No attribute: one of his own films (schema `creator`); `contributor`: he worked
  on it (schema `contributor`); `none`: nothing is stated anywhere, so no relation at all.
  No role is written on any film, in the page or in its data: roles appear only on `/cv`
  (his decision, 3 Oct 2026). `bin-check-claims.py` fails the build if one comes back.
- `data-cat="motion"` — the `/work/` category, where the kind alone would file it
  elsewhere (Stim is a TV commercial shown for its post-production). The kinds are
  brand, events, documentary, music (any kind naming a "Music video") and motion.
- `data-provider="youtube"` — on the `.tile__link`, beside `data-video`: the film plays from
  YouTube. Without it, `data-video` is a Vimeo id.
- `style="--focus: 50% 10%"` — on a full-row `tile--scope` tile whose picture was not shot in
  scope (Al Eid Shofa): where the row's 2.37:1 band sits in its 16:9 still, so no head is cut.
  On a vertical `tile--tall` tile (Sugar vs Jaggery: `50% 44%`, the jar's mouth and the hand on
  it whole): where a landscape frame, the front page's 16:10 or a reel's 16:9 on a phone, sits in
  its 9:16 still (`design-hover.css`; `bin-build-reel.py` carries it to the reel).
- `data-part-of="<slug>"` — not an entry of its own but one more film on that entry's
  page (Badr Airlines). The part with the entry's own Vimeo id gives the page its still;
  the others hang under the main film with their own play and running time.
- `data-key` — written by `bin-build-reel.py`; never edit by hand.

A year is printed only when the linked post proves it (X, Instagram and TikTok ids
carry their timestamp); a Facebook link does not, so those films show no year.

## Generated files

After touching the tiles in `index.html`, regenerate everything that derives from them, in this order:

```sh
python3 bin-build-cv-pdf.py && python3 bin-build-home-art.py && python3 bin-stamp-assets.py && python3 bin-build-work-pages.py \
  && python3 bin-build-solana.py && python3 bin-build-about-strip.py \
  && python3 bin-build-onset.py && python3 bin-build-about-said.py \
  && python3 bin-build-schema.py && python3 bin-build-sitemap.py && python3 bin-build-llms.py \
  && python3 bin-build-reel.py && python3 bin-stamp-assets.py && python3 bin-check.py
```

When a share card's words, picture or count change, re-render the cards apart from the chain:

```sh
python3 bin-build-og.py   # writes _og/<card>.html (git-ignored, never deployed)
# serve the repo root locally; screenshot each _og/<card>.html at 1200x630 to assets/<card>.jpg
rm -r _og
```

`bin-check.py` runs last, before every deploy, and changes nothing. It exits non-zero, listing
every problem, on: JSON-LD that does not parse, an alnimeri.com `@id` no page describes, or a
film page without its `VideoObject` (`/work/<slug>#film`); a `work/*.html` missing from
`sitemap.xml` or `llms.txt`; a film count in words or digits ("One of thirty-four films") that
is not the number of films, of the front page's or of the rest (two counts pass only in their own
sentence: the 66 published for Solana, a fact from the CV, and the films past half a million
views, which it counts from the data: every film page's figures and `assets/solana-edits.json`'s
rows, one film per post, so the home band's number moves with them; "N films past half a million"
and "N films published for Solana" are each checked on their own as well, so a wrong figure fails
even when it equals one of the page counts); a broken internal `href`/`src`/
`srcset` or `#fragment` (or one a script fetches later: the hero's lazy `data-src`/`data-srcset`
stills and its `data-loop-webm`/`data-loop-mp4` loops); a loop in `assets/loops/` not named by
its bytes' md5[:8]; an `og:image` that is not a file here; `styles.css` and `main.js` on
more than one `?v=`; a page without exactly one Cloudflare Web Analytics beacon; `/`, `/about`,
`/work/` or a film page without exactly one inlined `design-transition.js` as the file now stands,
or `styles.css` no longer turning page transitions off under reduced motion; or a stylesheet rule
that dims a fixed or sticky bar whole (the masthead, the timeline, the tray, `/work/`'s tabs, a
sticky year: an opacity between 0 and 1 on the bar itself clears its glass too, and a title
scrolled under it reads through as double text; dim its children instead, as
`.fp-lights-down .masthead > *` does). It also runs `bin-check-claims.py`, which fails if "directed by", a
JSON-LD `"director"`, a title he does not hold ("film director", "Storyteller"), a "Director:"
credit line, any other "director" that is not "creative director" (his title is "Associate
Creative Director", the descriptor "creative director and editor"; he is not a film director,
3 Oct 2026; a /cv credit's "Assistant Director" passes, and a third party's own title goes in its
`THIRD_PARTY` list), the old "Directed, shot and edited" line, an `fp-credit` line, a
`data-role` attribute, or a completeness claim the tracker cannot back ("every Solana video":
it is not all of his Solana work) appears in anything served: every `.html`, `llms.txt`, `sitemap.xml`,
`robots.txt`, `assets/*.json`, the stylesheets' visible strings, the scripts, `functions/`, the
share-card text in `bin-build-og.py` and the text and metadata of every PDF in `assets/`; if any
other role ("edited by", "Editor", "Cinematographer", ...) sits next to a film (the film pages,
`/work/`, `/work/solana`, the front page's tiles, the reel, `sitemap.xml`, `llms.txt`,
`assets/*.json`; his descriptor, "creative director and editor", is not a film's credit); and if a retired file in its `RETIRED` list (the old share cards whose pixels say
"Film director", the first two CV PDFs) or its `REPLACED` list (share cards with an old count or
wording) comes back to `assets/`, loses its 301 in `_redirects`, or 301s to a file that is not
here. Every page is
read as it is served, and one `/reel/<code>` page is rendered through the real Function in Node.

`bin-build-cv-pdf.py` prints the downloadable CV, `assets/Ahmed_ElNimeri_CV-2026-10.pdf` (every
"Download CV (PDF)" link), from `/cv` as it stands: its sections in the page's own words and
headings, the title from its JSON-LD, the opening line from the home page's "Behind the work",
the contact lines from its Contact section. A4, two to three pages, Poppins embedded, every link
live. Headless Chrome prints it over the DevTools pipe (`$CHROME_BIN`, else Playwright's
`chrome-headless-shell`, else Google Chrome); it refuses to print if a line runs past the margin
or a font fails. The file is rewritten only when what Chrome prints changes, so a second run
leaves it and its `?h=` stamp alone. Run it first: `bin-stamp-assets.py` stamps the new bytes
into the links. A bare link to the file carries no `?h=` and `/assets/*` is cached for a year, so
when the words change the file takes a new name (the month it was printed: `-2026-09` went live
as the hand-made PDF, `-2026-10` is the one printed from `/cv`), the links follow, and
`_redirects` sends the old name to it. A list item on `/cv` that is only a link to a page here
("Solana videos I edited") is printed with its address, which paper cannot otherwise show.
Change the CV on `/cv`, never in the PDF.

`bin-build-llms.py` writes `llms.txt`: the record, the contact notes and the profiles are
its own prose (edit them there, not in `llms.txt`), and the films, one line each, by kind, in
/work/'s order, come from the film pages' own `VideoObject`s (title, kind, year where the post
proves it, figure, running time, the page and the post).

`bin-build-sitemap.py` also gives each film page a video entry (still, title, description,
player, seconds, date) read from the same `VideoObject`s; a film with no player here (X only)
has none.

`bin-build-solana.py` writes `/work/solana`, the Solana videos in the team's tracker, from
`assets/solana-edits.json` (the team tracker's rows, exported): grouped by year, one line per
video with its date, kind and views, each linked to its X post, and a video with a film page
here linked to that page. Every count and total on it, in the `/work/` lede and on its share
card (`og-solana-videos-<count>.jpg`, from `bin-build-og.py`) is read from that file. No role word
and no "every" on it: the tracker is not all of his Solana work, and roles live on `/cv`. Totals are
rounded down (25,974,000 views is 25.9M), like the credits' figures; a video with a film page here
is that page's own node in the list's JSON-LD (`/work/<slug>#film`), the rest `CreativeWork`s.

`bin-build-home-art.py` builds the home page's four compositions (under "Commissions") from the tiles, gives each of the hero's films the still its tile shows, and gives it its loop from `assets/loops/` (by the tile's `data-video`), so a loop follows its film, not the slot; a film with none keeps its still.

`bin-build-onset.py` renders About's On Set from `assets/onset.json`: the prints grouped by year, each laid
out by its `shape`. `grade SRC NAME [GRAVITY]` makes the 1200 and 700 frames.

`bin-build-work-pages.py` also writes `functions/_lib/films.js` (every film page's slug, the
films a `/brief?film=` link may name), ends `/work/` on the home page's ending (the
`<section class="contact ending">`, lifted from `index.html`, so the two never drift;
`design-ending.js` builds its roll from the wall's landscape cards), and on a film page with
more than six audience comments (Al Doroub) shows six and keeps the rest in a native
`<details>` ("Read 18 more"), never "all": the post's own total is printed above it.

`bin-build-reel.py` compiles the film list and `reel.tpl.html` into `functions/_lib/reel.js`,
which the `/reel/<code>` function renders at the edge. It also reads the `?v=` numbers, so run it
after bumping `styles.css`/`main.js` versions too. Each film keeps its reel character for good
(`assets/reel-keys.json`): a new film takes the next character never given, a film that leaves
retires its own, and the grid can be re-ordered without changing what a sent link means.

`bin-build-og.py` writes the share cards' HTML to `_og/` for rendering at 1200x630 (`_og/` is
git-ignored and `bin-check.py` skips it; remove it once the JPGs are rendered); the `/work/` card
prints the film count, so a new count is rendered to a new file name (`og-work-3.jpg`), and a
card whose words change takes a new name too (`og-about-2.jpg`); the old name gets a 301 in
`_redirects` and goes on `bin-check-claims.py`'s `REPLACED` list.

## Deploying

Cloudflare Pages, free tier:

1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command: **none**. Output directory: **`/`**. It is already static.
4. Add `alnimeri.com` and `www.alnimeri.com` as custom domains.

After a deploy is live, tell the search engines what changed:

```sh
python3 bin-indexnow.py            # new or changed sitemap URLs since this machine last sent them
python3 bin-indexnow.py --dry-run  # what it would send
```

It POSTs them to IndexNow (Bing, Yandex and the others; Google reads `sitemap.xml`), after
checking that the live sitemap is this checkout's and that the key file
`f458b69ba17e628ce148d1d692c132a3.txt` (at the root, holding its own name) is live. What it has
sent is kept in `.indexnow-sent.json`, which is git-ignored.

`www.alnimeri.com` answers with a 301 to the same path on `alnimeri.com`: the first lines of
`functions/_middleware.js` (a `_redirects` rule cannot match a host). `_headers` sends HSTS
(a year, subdomains, no preload), `frame-ancestors 'none'` and a Permissions-Policy that
turns off camera, microphone and location; the middleware adds the same three to what a
Function renders.

DNS: the domain is registered at Porkbun, but its nameservers are Cloudflare's,
so every record lives in the Cloudflare dashboard. Mail to ahmed@alnimeri.com
arrives through Cloudflare Email Routing; its MX and SPF records are managed
there too, so check Email Routing after any DNS change.

## Known gaps

- ~~**No showreel.**~~ Closed 11 Sep 2026: the deck assembles one at runtime.
  "Run the reel" plays every Vimeo-hosted clip back to back behind a 1-bit
  countdown leader, advancing on the player's own `ended` event, with a single
  timeline across the whole sequence. A cut reel on the Vimeo profile would
  still be worth having as a file; the site no longer waits for it.
- Some of the highest-performing pieces live only on X (Solana x All In, Breakpoint London,
  Electric Capital Developer Report, Roam and more): they have pages and stills here, but
  play on X, not on the site. APEX Mexico has no page yet; it is on `/work/solana`.
