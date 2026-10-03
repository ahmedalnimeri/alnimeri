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


// ---- Local time ------------------------------------------------------------
// Cloudflare hands every request the visitor's city and timezone. The line
// under the hero eyebrow names the city and its clock beside Dubai's, and the
// contact line sets the two clocks side by side. Rendered here at the edge so
// nothing waits on JavaScript; main.js only keeps the clocks ticking (it reads
// .screening and its data-tz). No cookie, nothing kept beyond the visit log.
// Crawlers and visitors Cloudflare cannot place get the page exactly as
// authored.
const HTML_PATH = /^\/(about|index\.html)?$/;

function clock(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  } catch { return null; }
}

function screening(cf) {
  if (!cf || !cf.city || !cf.timezone) return null;
  const local = clock(cf.timezone), dubai = clock('Asia/Dubai');
  if (!local || !dubai) return null;
  const cc = (cf.country || '').toUpperCase();
  const home = cf.timezone === 'Asia/Dubai';
  return { city: cf.city, cc, tz: cf.timezone, local, dubai, home };
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function personalise(res, sc) {
  // "{City}, {CC} · {hh:mm} local · Dubai {hh:mm}"; a visitor in Dubai gets
  // "{City}, {CC} · {hh:mm} local".
  const slate =
    `<p class="screening" data-tz="${esc(sc.tz)}" aria-label="Local time in ${esc(sc.city)}">` +
    `<span>${esc(sc.city)}${sc.cc ? ', ' + esc(sc.cc) : ''}</span><span class="screening__sep">·</span>` +
    (sc.home
      ? `<span><b data-clock="Asia/Dubai">${sc.dubai}</b> local</span>`
      : `<span><b data-clock="local">${sc.local}</b> local</span><span class="screening__sep">·</span>` +
        `<span>Dubai <b data-clock="Asia/Dubai">${sc.dubai}</b></span>`) +
    `</p>`;
  // Follows "…I answer my own email." with "It is 01:37 here in Dubai." (a
  // visitor in Dubai) or "It is 01:37 in Dubai, 22:37 in London." (anyone
  // else). The clock only: no promise of when a reply comes.
  const contact =
    (sc.home
      ? ` <span class="contact__clock">It is <b data-clock="Asia/Dubai">${sc.dubai}</b> here in Dubai.</span>`
      : ` <span class="contact__clock">It is <b data-clock="Asia/Dubai">${sc.dubai}</b> in Dubai, ` +
        `<b data-clock="local">${sc.local}</b> in ${esc(sc.city)}.</span>`);

  const out = new HTMLRewriter()
    .on('html', { element(e) { e.setAttribute('data-screening', 'on'); } })
    .on('p.hero__eyebrow', { element(e) { e.after(slate, { html: true }); } })
    .on('p.contact__sub', { element(e) { e.append(contact, { html: true }); } })
    .transform(res);
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
      const sc = screening(request.cf);
      if (sc) return personalise(res, sc);
    }
  } catch (err) {
    console.log('screening-error: ' + err.message);
  }
  return res;
}
