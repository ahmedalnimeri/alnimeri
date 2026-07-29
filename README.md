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
| `main.js` | Lightbox and scroll reveal, nothing else |
| `assets/posters/` | Poster frames, one JPEG per video, committed |
| `assets/work.json` | Record of the curated selection (not loaded at runtime) |

## Adding or changing a video

1. Find the Vimeo ID (the number in `vimeo.com/1234567890`).
2. Save its poster as `assets/posters/<id>.jpg`.
3. Copy an existing `<article class="tile">` block in `index.html` and update
   `data-video`, `data-title`, the `src`, the `alt`, the duration and the title.
4. Renumber the `tile__idx` spans if the order changed.

Set `data-portrait="true"` and add `tile--tall` for vertical pieces.

## Deploying

Cloudflare Pages, free tier:

1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command: **none**. Output directory: **`/`**. It is already static.
4. Add `alnimeri.com` and `www.alnimeri.com` as custom domains.

Then in **Porkbun DNS** — leave the nameservers alone:

- `ALIAS` on `alnimeri.com` → the `*.pages.dev` hostname
- `CNAME` on `www` → the same hostname

> **Do not move the nameservers to Cloudflare.** Email for this domain runs on
> Porkbun-managed MX, SPF and DKIM records. Moving nameservers without
> recreating them silently breaks inbound mail.

## Known gaps

- **No showreel.** The hero is built around a featured film because no cut reel
  exists on the Vimeo profile. When one is made, it slots into the same spot.
- **`assets/og.jpg`** is a crop of a still. A purpose-made 1200×630 card would
  be better.
- Five of the highest-performing pieces (Solana x ALLIn, Breakpoint London,
  Electric Capital Developer's Report, Roam, APEX Mexico) are not on Vimeo and
  therefore cannot be shown here.
