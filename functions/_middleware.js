/**
 * Logs one line per page view, including the visitor's IP.
 *
 * Runs on every request, so it deliberately skips static assets — logging each
 * poster, font and stylesheet would bury the page views and add work to
 * requests that tell you nothing.
 *
 * Output goes to the Pages Function log stream, readable live via the
 * dashboard or `wrangler pages deployment tail`. Nothing is stored.
 */
export async function onRequest(context) {
  const { request, next } = context;

  try {
    const url = new URL(request.url);
    const isAsset = /\.(css|js|mjs|jpg|jpeg|png|svg|ico|webp|woff2?|pdf|xml|txt|map)$/i
      .test(url.pathname);

    if (!isAsset) {
      const cf = request.cf || {};
      console.log(JSON.stringify({
        t:       new Date().toISOString(),
        ip:      request.headers.get('CF-Connecting-IP'),
        country: cf.country,
        region:  cf.region,
        city:    cf.city,
        asn:     cf.asOrganization,
        path:    url.pathname,
        ref:     request.headers.get('Referer') || null,
        ua:      request.headers.get('User-Agent'),
      }));
    }
  } catch (err) {
    // Logging must never take the site down.
    console.log('log-error: ' + err.message);
  }

  return next();
}
