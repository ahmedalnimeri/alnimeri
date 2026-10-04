/**
 * Records one row per page view in D1.
 *
 * Static assets are skipped: logging every poster and font would bury the page
 * views and add a database write to requests that tell you nothing.
 *
 * The insert runs inside waitUntil(), so the response is never held up waiting
 * on the database, and the whole thing is wrapped — a logging failure must
 * never take the site down.
 */

// Pages serves the repository root, so build config is reachable as site
// content. _redirects cannot cover it: a static file that exists is served
// before redirects are consulted. Middleware runs first, so the block goes
// here. wrangler.jsonc was answering 200 with the D1 database id in it; the
// planning docs, the editor config and the database schema were public too.
// Tested against the decoded path with repeated slashes collapsed, so neither
// /%77rangler.jsonc nor //wrangler.jsonc can slip by; /reel.tpl is the
// template's pretty URL (Pages strips .html).
// (None of these may ever be listed in _routes.json's exclude.)
const BLOCKED = /^\/(reel\.tpl(\.html)?\/?|wrangler\.(jsonc|toml|json)|package(-lock)?\.json|README\.md|bin-[^/]*\.py|schema\.sql|\.gitignore)$|^\/(docs|\.claude|\.git)(\/|$)/i;

// Not page views: files, including video (a Range request per chunk) and data.
const ASSET = /\.(css|js|mjs|jpg|jpeg|png|svg|ico|webp|avif|gif|woff2?|pdf|xml|txt|map|mp4|webm|m4v|json|webmanifest|md|sql)$/i;
const BOT   = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|curl|wget|python-requests|monitor|preview/i;


// ---- The Screening Slate -----------------------------------------------
// The site is an edit sequence, so a visit is a screening. Cloudflare hands
// every request the visitor's city and timezone; the slate stamps them into
// the hero like a burn-in, and the contact block sets their clock against
// Dubai's. Rendered here at the edge so nothing waits on JavaScript; the
// script only keeps the clocks ticking. Crawlers and visitors Cloudflare
// cannot place get the page exactly as authored.
const HTML_PATH = /^\/(about|index\.html)?$/;

function clock(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  } catch { return null; }
}

const GREET = { nl:'Welkom', fr:'Bienvenue', de:'Willkommen', es:'Bienvenido', pt:'Bem-vindo',
  it:'Benvenuto', tr:'Hoş geldin', sv:'Välkommen', da:'Velkommen', no:'Velkommen', fi:'Tervetuloa',
  pl:'Witaj', ru:'Добро пожаловать', hi:'स्वागत है', ur:'خوش آمدید', bn:'স্বাগতম', id:'Selamat datang',
  ms:'Selamat datang', zh:'欢迎', ja:'ようこそ', ko:'환영합니다', fa:'خوش آمدید', sw:'Karibu', am:'እንኳን ደህና መጡ' };

// Where the visitor came in from, and which film to hand them first. Instagram
// arrivals are used to the vertical screen; X arrivals are here for Solana;
// anyone from a search box or an assistant is asking "who is this" — About.
const SOURCES = [
  [/instagram/i,                 'Instagram', '/work/el-fasher-city',  'El Fasher City — shot for the vertical screen'],
  [/^(t\.co|x\.com|twitter\.com)$/i, 'X',    '/work/solana-accelerate', 'Solana Accelerate — 1.4M views on X'],
  [/linkedin|lnkd\.in/i,         'LinkedIn',  '/cv',                   'the CV and the credits'],
  [/google\.|bing\.|duckduckgo|yandex|baidu/i, 'search', '/about',   'who is behind the work'],
  [/chatgpt|openai|claude\.ai|anthropic|perplexity|gemini\.google|copilot/i, 'an AI assistant', '/about', 'the record it was reading'],
  [/vimeo/i,                     'Vimeo',     '/work/',                'the full sequence with its view counts'],
  [/facebook|fb\./i,             'Facebook',  '/work/al-doroub',       'Al Doroub — the documentary'],
];

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
            Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function screening(cf, request) {
  if (!cf || !cf.city || !cf.timezone) return null;
  const local = clock(cf.timezone), dubai = clock('Asia/Dubai');
  if (!local || !dubai) return null;
  const h = Number(dubai.slice(0, 2));
  const cc = (cf.country || '').toUpperCase();
  const home = cf.timezone === 'Asia/Dubai';
  // Follows "…I answer my own email. It is 01:37 here in Dubai." (a visitor in
  // Dubai) or "It is 01:37 in Dubai, 22:37 in London." (anyone else) — so it
  // never names the email or the city again, and says "here" only when the
  // sentence before it has not.
  const here = home ? '' : ' here';
  const reply = h >= 9 && h < 20 ? 'I usually reply the same day.'
              : h >= 20 || h < 1 ? `Late${here} — I’ll reply first thing tomorrow.`
              : h >= 6           ? `Early${here} — I’ll reply this morning.`
              : `The middle of the night${here} — I’ll reply in the morning.`;

  // Distance the reel travelled. Dubai, where it was cut.
  const lat = Number(cf.latitude), lon = Number(cf.longitude);
  const km = (!home && Number.isFinite(lat) && Number.isFinite(lon))
    ? Math.round(haversine(25.2048, 55.2708, lat, lon)) : 0;

  // Referrer → source name and a first film to hand them.
  let source = null, start = null;
  const refHost = (() => { try { return new URL(request.headers.get('Referer') || '').hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const refPath = (() => { try { return new URL(request.headers.get('Referer') || '').pathname; } catch { return ''; } })();
  const internal = /(^|\.)alnimeri\.(com|pages\.dev)$/i.test(refHost) && /^\/(about(\.html)?|index\.html)?$/.test(refPath);
  if (refHost && !/alnimeri\.com$/i.test(refHost)) {
    for (const [re, name, href, label] of SOURCES) {
      if (re.test(refHost)) { source = name; start = { href, label }; break; }
    }
  }

  // Browser language → one word of greeting.
  const lang = (request.headers.get('Accept-Language') || '').split(',')[0].trim().toLowerCase().split('-')[0];
  const greet = (lang !== 'en' && GREET[lang]) ? GREET[lang] : null;

  // Screening number: one anonymous first-party cookie, a counter and nothing
  // else. A visit is a screening, not a page view: moving between pages of
  // this site (the Referer is the site itself) keeps the number it has.
  const m = /(?:^|;\s*)scr=(\d{1,3})(?:;|$)/.exec(request.headers.get('Cookie') || '');
  const bumped = !internal || !m;
  const seen = bumped ? Math.min(999, (m ? Number(m[1]) : 0) + 1) : Number(m[1]);

  return { city: cf.city, cc, tz: cf.timezone, local, dubai, reply, home,
           km, source, start, greet, lang, seen, bumped };
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function personalise(res, sc) {
  const slate =
    `<p class="screening" data-tz="${esc(sc.tz)}" aria-label="Screening in ${esc(sc.city)}">` +
    `<span>Screening${sc.seen > 1 ? ' ' + sc.seen : ''}</span><span class="screening__sep">·</span>` +
    `<span>${esc(sc.city)}${sc.cc ? ', ' + esc(sc.cc) : ''}</span><span class="screening__sep">·</span>` +
    (sc.home
      ? `<span><b data-clock="Asia/Dubai">${sc.dubai}</b> local</span>`
      : `<span><b data-clock="local">${sc.local}</b> local</span><span class="screening__sep">·</span>` +
        `<span>Dubai <b data-clock="Asia/Dubai">${sc.dubai}</b></span>`) +
    (sc.km ? `<span class="screening__sep">·</span><span><b>${sc.km.toLocaleString('en-GB')}</b> km from Dubai</span>` : '') +
    (sc.source ? `<span class="screening__sep">·</span><span>via ${esc(sc.source)}</span>` : '') +
    (sc.seen > 1 ? `<span class="screening__sep">·</span><span>Welcome back</span>` : '') +
    (sc.greet ? `<span class="screening__sep">·</span><span class="screening__ar" lang="${esc(sc.lang)}">${esc(sc.greet)}</span>` : '') +
    `</p>`;
  const start = sc.start
    ? `<p class="hero__start">Came in from ${esc(sc.source)}? <a href="${esc(sc.start.href)}">Start with ${esc(sc.start.label)} &rarr;</a></p>`
    : '';
  const contact =
    (sc.home
      ? ` <span class="contact__clock">It is <b data-clock="Asia/Dubai">${sc.dubai}</b> here in Dubai. ${sc.reply}</span>`
      : ` <span class="contact__clock">It is <b data-clock="Asia/Dubai">${sc.dubai}</b> in Dubai, ` +
        `<b data-clock="local">${sc.local}</b> in ${esc(sc.city)}. ${sc.reply}</span>`);

  const out = new HTMLRewriter()
    .on('html', { element(e) { e.setAttribute('data-screening', 'on'); } })
    .on('p.hero__eyebrow', { element(e) { e.after(slate, { html: true }); } })
    .on('p.contact__sub', { element(e) { e.append(contact, { html: true }); } })
    .on('div.hero__cta', { element(e) { if (start) e.after(start, { html: true }); } })
    .transform(res);
  // The counter behind "Screening 3": a number, one year, first-party, nothing
  // else — and only written when it changed.
  if (sc.bumped) out.headers.append('Set-Cookie', `scr=${sc.seen}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`);
  // Personalised HTML must not be served to the next visitor from the edge:
  // private keeps it out of every shared cache. no-cache rather than no-store,
  // because no-store also shuts the page out of the back/forward cache, and
  // Back from a film page would then reload home and restart the slideshow.
  // (Vary on CF-IPCountry meant nothing to a browser cache, the only one left.)
  out.headers.set('Cache-Control', 'private, no-cache');
  return out;
}

// One address. www.alnimeri.com answered 200 with the whole site, a second copy
// for search engines to weigh against the first. _redirects cannot match a
// host, so the move to the apex happens here, before anything else: a 301 for
// a page (308 for anything that is not a GET or HEAD, so a method is never
// changed on the way). Static files on www never reach this (they are excluded
// in _routes.json), which is harmless: every page names the apex as canonical.
const APEX = 'https://alnimeri.com';

// The three security headers _headers sets on every static response. _headers
// is not applied to what a Function renders (/reel/<code>, /brief, /api/*, the
// www redirect), so they are added here wherever a response lacks them.
const SECURITY = [
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['Content-Security-Policy', "frame-ancestors 'none'"],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

function secured(res) {
  if (SECURITY.every(([k]) => res.headers.has(k))) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of SECURITY) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

export async function onRequest(context) {
  const u = new URL(context.request.url);
  if (u.hostname === 'www.alnimeri.com') {
    const keep = context.request.method === 'GET' || context.request.method === 'HEAD';
    return secured(new Response(null, { status: keep ? 301 : 308, headers: {
      Location: APEX + u.pathname + u.search,
      'Cache-Control': 'public, max-age=86400',
    } }));
  }

  return secured(await serve(context));
}

async function serve(context) {
  const { request, env, next, waitUntil } = context;

  try {
    const url = new URL(request.url);
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch {}
    path = path.replace(/\/{2,}/g, '/');
    if (BLOCKED.test(path)) {
      return new Response('Not found', { status: 404 });
    }
    // Page views only: not files, and not the site's own API calls.
    if (!ASSET.test(url.pathname) && !url.pathname.startsWith('/api/')) {
      const cf = request.cf || {};
      const ua = request.headers.get('User-Agent') || '';
      const row = [
        new Date().toISOString(),
        request.headers.get('CF-Connecting-IP'),
        cf.country || null,
        cf.region || null,
        cf.city || null,
        cf.asOrganization || null,
        url.pathname,
        request.headers.get('Referer') || null,
        ua,
        BOT.test(ua) ? 1 : 0,
      ];

      if (env.DB) {
        waitUntil(
          env.DB.prepare(
            `INSERT INTO visits (ts, ip, country, region, city, asn, path, referrer, ua, is_bot)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(...row).run().catch((e) => console.log('d1-insert-failed: ' + e.message))
        );
      } else {
        // No binding yet — still visible in the live log stream.
        console.log(JSON.stringify(row));
      }

      // Enforce the 90-day retention promised in the privacy note, rather than
      // only stating it. Runs on roughly 1 in 200 page views so the cost is
      // negligible and no scheduled job is needed.
      if (env.DB && Math.random() < 0.005) {
        waitUntil(
          env.DB.prepare(
            // ts is stored as an ISO string ('…T…Z'), so compare against one
            `DELETE FROM visits WHERE ts < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')`
          ).run().catch((e) => console.log('d1-purge-failed: ' + e.message))
        );
      }
    }
  } catch (err) {
    console.log('log-error: ' + err.message);
  }

  const res = await next();
  try {
    const url = new URL(request.url);
    const ua = request.headers.get('User-Agent') || '';
    if (HTML_PATH.test(url.pathname) && !BOT.test(ua) &&
        (res.headers.get('Content-Type') || '').includes('text/html')) {
      const sc = screening(request.cf, request);
      if (sc) return personalise(res, sc);
    }
  } catch (err) {
    console.log('screening-error: ' + err.message);
  }
  return res;
}
