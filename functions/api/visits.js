/**
 * Protected visit log.
 *
 *   /api/visits?key=<VISITS_TOKEN>
 *
 * Options: &limit=200  &bots=1 (include crawlers)  &format=json
 *
 * The key is compared against the VISITS_TOKEN environment variable, which is
 * set in the Pages dashboard — never committed. Without a token configured the
 * endpoint refuses to serve anything, so visitor data can't be exposed by a
 * half-finished setup.
 */

const esc = (s) =>
  String(s ?? '—').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  if (!env.VISITS_TOKEN) {
    return new Response('VISITS_TOKEN is not configured.', { status: 503 });
  }
  if (url.searchParams.get('key') !== env.VISITS_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  if (!env.DB) {
    return new Response('D1 binding "DB" is missing.', { status: 503 });
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000);
  const bots  = url.searchParams.get('bots') === '1';

  const { results } = await env.DB.prepare(
    `SELECT ts, ip, country, region, city, asn, path, referrer, ua, is_bot
       FROM visits ${bots ? '' : 'WHERE is_bot = 0'}
      ORDER BY ts DESC LIMIT ?`
  ).bind(limit).all();

  if (url.searchParams.get('format') === 'json') {
    return new Response(JSON.stringify(results, null, 2), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  const rows = results.map((r) => `<tr>
    <td class="t">${esc(r.ts).replace('T', ' ').slice(0, 19)}</td>
    <td class="ip">${esc(r.ip)}</td>
    <td>${esc([r.city, r.country].filter(Boolean).join(', '))}</td>
    <td class="d">${esc(r.asn)}</td>
    <td>${esc(r.path)}</td>
    <td class="d">${r.referrer ? esc(new URL(r.referrer).hostname) : '—'}</td>
  </tr>`).join('');

  return new Response(`<!doctype html><meta charset="utf-8">
<title>Visits — alnimeri.com</title>
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{background:#0a0a0c;color:#f4f2ee;font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:2rem}
 h1{font-size:1rem;font-weight:600;margin:0 0 .25rem}
 p{color:#8a8783;margin:0 0 1.5rem;font-size:.85rem}
 table{border-collapse:collapse;width:100%;font-size:.82rem}
 th{text-align:left;color:#8a8783;font-weight:500;padding:.5rem .75rem;border-bottom:1px solid #26262c;position:sticky;top:0;background:#0a0a0c}
 td{padding:.5rem .75rem;border-bottom:1px solid #17171b;white-space:nowrap}
 .t,.ip{font-variant-numeric:tabular-nums}
 .d{color:#8a8783}
 tr:hover td{background:#131318}
</style>
<h1>Visits</h1>
<p>${results.length} shown${bots ? ' (including crawlers)' : ', crawlers hidden'} · newest first ·
   <a style="color:#8a8783" href="?key=${esc(url.searchParams.get('key'))}&bots=${bots ? 0 : 1}">${bots ? 'hide' : 'show'} crawlers</a></p>
<table>
 <thead><tr><th>Time (UTC)</th><th>IP</th><th>Location</th><th>Network</th><th>Page</th><th>From</th></tr></thead>
 <tbody>${rows || '<tr><td colspan="6" class="d">No visits recorded yet.</td></tr>'}</tbody>
</table>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
