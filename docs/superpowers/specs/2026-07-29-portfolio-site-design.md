# alnimeri.com — Portfolio Site Design

**Date:** 2026-07-29
**Owner:** Ahmed El-Nimeri
**Status:** Approved (design), pending implementation plan

## Purpose

A general calling card at `alnimeri.com`: one page that shows who Ahmed is, plays his reel, presents selected work, and gives a way to make contact. It replaces "here's my Vimeo link" in job applications with a single owned URL.

Deliberately **not** audience-segmented. An earlier option to build separate entry paths for hiring managers (commercial/Solana framing) versus Arts Council England (documentary/artist framing) was considered and rejected in favour of one neutral site.

## Success criteria

1. A recruiter landing cold understands what Ahmed does within five seconds, without scrolling.
2. The reel is playable in one click.
3. The site loads fast on a phone over mobile data.
4. `alnimeri.com` pasted into LinkedIn, Slack, or an application form renders a proper preview card.
5. Ahmed can add or reorder a video without a build toolchain or a framework upgrade.

## Non-goals

CMS · blog · contact form · light/dark toggle · page transitions · animation libraries · analytics · cookie banner · per-project case-study pages.

Each is maintenance carried indefinitely for a site with one job. Case studies were explicitly considered and deferred; if Creative Director applications later demand visible thinking rather than craft, that is a separate spec.

## Visual direction

Dark and cinematic. Near-black ground, video as the only source of colour, restrained sans-serif type, generous whitespace, subtle hover motion. The idiom of high-end film and motion portfolios — it should read as *this person shoots* before a word is parsed.

The site's own craft is a credential. For a Creative Director application, execution quality here is part of the portfolio, not packaging around it.

## Architecture

Static single page. Plain HTML, CSS, and vanilla JavaScript. No framework, no build step, no dependencies.

Rationale: the page has no state, no routing, and no data fetching. A framework would add a build pipeline and a payload of JavaScript to render what is fundamentally a styled document, and would rot — a toolchain untouched for two years is a toolchain that no longer installs. Hand-written HTML remains editable indefinitely.

```
alnimeri/
├── index.html          # all markup, inline JSON-LD
├── styles.css          # single stylesheet, CSS custom properties for the palette
├── main.js             # lightbox only; no other behaviour
├── assets/
│   ├── posters/        # optimised WebP poster frames, one per grid item
│   ├── og.jpg          # Open Graph preview image (1200×630)
│   └── favicon.svg
└── docs/superpowers/specs/
```

### Page zones

| Zone | Content |
|---|---|
| Hero | Name, one-line positioning, showreel. Full-bleed, dark, no navigation chrome |
| Selected Work | Grid of 9–12 pieces; poster frame → click plays in lightbox |
| About | Short bio, institutional credits (ICC, EU, Al Jazeera, TED) |
| Contact | `ahmed@alnimeri.com`, Vimeo, Instagram, LinkedIn, CV download |

## Video strategy

Video is **never self-hosted**. All playback is Vimeo (`vimeo.com/nimeri`, 67 public videos), which already handles transcoding, adaptive bitrate, and global delivery.

The grid uses a **facade pattern**: each cell renders a static poster image and a real anchor to the Vimeo page. The Vimeo `<iframe>` is injected only on click. Twelve eagerly-loaded iframes would cost several megabytes and a visibly slow first paint; the facade keeps initial load to markup, CSS, and images.

Poster frames are pulled from Vimeo's oEmbed endpoint **once, by a one-off script run locally**, converted to WebP, and committed to the repo as ordinary assets. This is a content-preparation step, not a build step: the deploy pipeline stays a plain file copy, and the committed posters mean the grid renders even if Vimeo is slow or blocked.

## Progressive enhancement

- **Without JavaScript**, every grid item is a working link to its Vimeo page. Nothing becomes invisible on a locked-down corporate machine — a realistic condition for recruiter traffic.
- **Without images**, alt text carries the title of each piece.
- **Responsive**: one column on mobile, three on desktop. Recruiters open links on phones.

## Discoverability

- Open Graph and Twitter card tags so the URL renders as a card wherever it is pasted.
- `schema.org/Person` JSON-LD linking the site to the name "Ahmed El-Nimeri", plus `sameAs` references to Vimeo, Instagram, and LinkedIn. This serves job applications and, separately, the UK Global Talent case, where being findable under one's own name is itself part of the evidence.
- Semantic headings, one `<h1>`, meaningful `<title>` and meta description.

## Hosting and DNS

- **Registrar:** Porkbun (`alnimeri.com`, ~$11.08/yr, auto-renew on).
- **Web host:** Cloudflare Pages, free tier, deploying from a GitHub repo on push.
- **Rejected:** the existing DigitalOcean droplet. It runs the news-video-bot's ffmpeg encoding jobs; a portfolio sharing CPU with video transcodes is a downgrade, not a saving. Cloudflare's edge network also serves recruiters in North Carolina, London, and Singapore better than a single-region droplet.
- **Also rejected:** every Porkbun hosting upsell (Link In Bio, Articulation, cPanel, Static Hosting) — all cost more than free and deliver less.

### DNS constraint (critical)

**Nameservers stay at Porkbun.** Email for `alnimeri.com` depends on Porkbun-managed MX, SPF, and DKIM records. Moving nameservers to Cloudflare without recreating those records silently breaks inbound mail — a failure mode discovered via a job offer that never arrived.

The site is attached with records only, under Porkbun's existing nameservers:

- `CNAME` on `www` → the Cloudflare Pages project hostname
- `ALIAS` on the apex → the same target (Porkbun supports apex `ALIAS`)

## Email (adjacent, already in progress)

`ahmed@alnimeri.com` on Porkbun hosted email ($3/mo/inbox billed yearly = $36/yr, currently on a 15-day free trial expiring **2026-08-13**).

Gmail discontinued POP3 fetching on the web client in January 2026, so the mailbox cannot be read in Gmail on desktop. Working configuration:

- **Apple Mail** (Mac + iPhone) via IMAP `imap.porkbun.com:993` (SSL/TLS) and SMTP `smtp.porkbun.com:587` (STARTTLS) — full send and receive.
- **Gmail web** via *Send mail as* using the same SMTP credentials — sending only.

Applications already submitted under `ahmedaminalnimeri@gmail.com` (MrBeast, Vox Media, Wormhole, KAST and others) stay on that address; the new one is for new applications and for the site.

**Open decision:** whether to keep the mailbox past 2026-08-13 at $36/yr, or move to Zoho Mail Lite at ~$12/yr. Requires a reminder before that date — a configured mailbox auto-renews by default.

## Content

Source material: `~/Documents/CV/Applications/02_Portfolio_Highlights.md` (top-20 videos by views) and the public Vimeo profile.

Selection for the grid — 9 to 12 pieces — must show **range**, not just reach. Twelve crypto event promos would misrepresent him as a single-format editor. Target mix:

- 3–4 high-reach commercial pieces (Accelerate Event Ad 1.4M, Solana x ALLIn 1.1M, Breakpoint London 926K)
- 2–3 explainers, demonstrating clarity rather than spectacle (Electric Capital Developer's Report, Roam)
- 1–2 human/documentary pieces (Owen Venter — APEX Cape Town)
- 1–2 institutional credits where footage exists (ICC, EU, Al Jazeera, TED)

Final selection is Ahmed's; the spec fixes the shape, not the list.

View counts are **not** displayed per tile. They are Solana-tracker figures, unverifiable by a visitor, and a grid of numbers reads as a media kit rather than a portfolio. Scale is stated once, in prose, in the About section.

## Risks

| Risk | Mitigation |
|---|---|
| Nameserver move breaks email | Documented above; records-only attachment, nameservers stay at Porkbun |
| Vimeo player branding on a free account | Confirm account tier; if branding is intrusive, the facade still controls the grid's appearance and only the lightbox shows it |
| Vimeo blocked on some corporate networks | Poster images are local; grid renders and links remain functional |
| Domain lapses | Auto-renew enabled at Porkbun |
| Name inconsistency (`alnimeri` vs `El-Nimeri`) | Site uses "Ahmed El-Nimeri" as display name; the domain matches the existing LinkedIn handle. Optionally register `elnimeri.com` as a redirect |

## Open questions

1. Final video selection and running order (blocked on the Vimeo library scrape).
2. Whether a dedicated showreel exists on Vimeo, or one must be cut.
3. Exact positioning line for the hero.
4. Whether to register `elnimeri.com` as a defensive redirect.
