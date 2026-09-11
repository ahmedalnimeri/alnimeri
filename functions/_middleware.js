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
// here. wrangler.jsonc was answering 200 with the D1 database id in it.
const BLOCKED = /^\/(wrangler\.(jsonc|toml|json)|package(-lock)?\.json|README\.md|bin-[^/]*\.py)$/i;

const ASSET = /\.(css|js|mjs|jpg|jpeg|png|svg|ico|webp|woff2?|pdf|xml|txt|map)$/i;
const BOT   = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|curl|wget|python-requests|monitor|preview/i;


// ---- The Screening Slate -----------------------------------------------
// The site is an edit sequence, so a visit is a screening. Cloudflare hands
// every request the visitor's city and timezone; the slate stamps them into
// the hero like a burn-in, and the contact block sets their clock against
// Dubai's. Rendered here at the edge so nothing waits on JavaScript; the
// script only keeps the clocks ticking. Crawlers and visitors Cloudflare
// cannot place get the page exactly as authored.
const ARABIC = new Set(['AE','SA','EG','SD','OM','QA','KW','BH','JO','LB','MA','TN','DZ','LY','IQ','SY','YE','PS','MR']);
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
  const h = Number(dubai.slice(0, 2));
  const reply = h >= 9 && h < 20 ? 'I answer my own email, usually the same day.'
              : h >= 20 || h < 1 ? 'Late here — I answer my own email, first thing tomorrow.'
              : 'It is the middle of the night in Dubai. I answer my own email, in the morning.';
  return {
    city: cf.city, cc: (cf.country || '').toUpperCase(), tz: cf.timezone,
    local, dubai, reply, ar: ARABIC.has((cf.country || '').toUpperCase()),
  };
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function personalise(res, sc) {
  const slate =
    `<p class="screening" data-tz="${esc(sc.tz)}" aria-label="Screening in ${esc(sc.city)}">` +
    `<span>Screening</span><span class="screening__sep">·</span>` +
    `<span>${esc(sc.city)}${sc.cc ? ', ' + esc(sc.cc) : ''}</span><span class="screening__sep">·</span>` +
    `<span><b data-clock="local">${sc.local}</b> local</span><span class="screening__sep">·</span>` +
    `<span>Dubai <b data-clock="Asia/Dubai">${sc.dubai}</b></span>` +
    (sc.ar ? `<span class="screening__sep">·</span><span lang="ar" dir="rtl" class="screening__ar">أهلاً — العربية متاحة</span>` : '') +
    `</p>`;
  const contact =
    ` <span class="contact__clock">It is <b data-clock="Asia/Dubai">${sc.dubai}</b> in Dubai, ` +
    `<b data-clock="local">${sc.local}</b> in ${esc(sc.city)}. ${sc.reply}</span>`;

  const out = new HTMLRewriter()
    .on('html', { element(e) { e.setAttribute('data-screening', sc.ar ? 'ar' : 'on'); } })
    .on('p.hero__eyebrow', { element(e) { e.after(slate, { html: true }); } })
    .on('p.contact__sub', { element(e) { e.append(contact, { html: true }); } })
    .transform(res);
  // Personalised HTML must not be served to the next visitor from the edge.
  out.headers.set('Cache-Control', 'private, no-store');
  out.headers.set('Vary', 'CF-IPCountry');
  return out;
}

export async function onRequest(context) {
  const { request, env, next, waitUntil } = context;

  try {
    const url = new URL(request.url);
    if (BLOCKED.test(url.pathname)) {
      return new Response('Not found', { status: 404 });
    }
    if (!ASSET.test(url.pathname)) {
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
            `DELETE FROM visits WHERE ts < datetime('now', '-90 days')`
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
