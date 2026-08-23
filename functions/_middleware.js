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

const ASSET = /\.(css|js|mjs|jpg|jpeg|png|svg|ico|webp|woff2?|pdf|xml|txt|map)$/i;
const BOT   = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|curl|wget|python-requests|monitor|preview/i;

export async function onRequest(context) {
  const { request, env, next, waitUntil } = context;

  try {
    const url = new URL(request.url);
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
    }
  } catch (err) {
    console.log('log-error: ' + err.message);
  }

  return next();
}
