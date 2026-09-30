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
| `main.js` | Lightbox and the reel, hard-cut navigation, scroll reveal, the pull-a-reel bin and the brief dialog |
| `design-*.css` / `design-*.js` | One design layer per area: `hover` (home films and /reel/), `filmpages` (/work/ and the film pages), `about`, `compositions` (the home services) and `ending` (the home page's end credits). Stamped with their own md5 and served immutable |
| `assets/posters/` | Poster frames per video: `<id>.jpg` (master) plus `-480`/`-768` JPEG and `-480`/`-768`/`-1280` WebP sizes |

## Adding or changing a video

1. Find the Vimeo ID (the number in `vimeo.com/1234567890`).
2. Save its poster as `assets/posters/<id>.jpg`, and make the `-480`/`-768` JPEG and
   `-480`/`-768`/`-1280` WebP sizes next to it (new file names if a poster ever changes).
3. Copy an existing `<article class="tile">` block in `index.html` and update
   `data-video`, `data-title`, BOTH srcsets (the WebP `<source>` and the `<img>`), the `src`,
   the `alt`, the duration and the title.

Set `data-portrait="true"` and add `tile--tall` for vertical pieces.

## Generated files

After touching the tiles in `index.html`, regenerate everything that derives from them, in this order:

```sh
python3 bin-build-home-art.py && python3 bin-stamp-assets.py && python3 bin-build-work-pages.py \
  && python3 bin-build-about-strip.py \
  && python3 bin-build-onset.py && python3 bin-build-about-said.py \
  && python3 bin-build-schema.py && python3 bin-build-sitemap.py && python3 bin-build-reel.py \
  && python3 bin-stamp-assets.py
```

`bin-build-home-art.py` builds the home page's four compositions ("What are we making?") from the tiles.

`bin-build-onset.py` renders About's On Set from `assets/onset.json`: the prints grouped by year, each laid
out by its `shape`. `grade SRC NAME [GRAVITY]` makes the 1200 and 700 frames.

`bin-build-reel.py` compiles the film list and `reel.tpl.html` into `functions/_lib/reel.js`,
which the `/reel/<code>` function renders at the edge. It also reads the `?v=` numbers, so run it
after bumping `styles.css`/`main.js` versions too.

## Deploying

Cloudflare Pages, free tier:

1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command: **none**. Output directory: **`/`**. It is already static.
4. Add `alnimeri.com` and `www.alnimeri.com` as custom domains.

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
- **`assets/og.jpg`** is a crop of a still. A purpose-made 1200×630 card would
  be better.
- Five of the highest-performing pieces (Solana x ALLIn, Breakpoint London,
  Electric Capital Developer's Report, Roam, APEX Mexico) are not on Vimeo and
  therefore cannot be shown here.
