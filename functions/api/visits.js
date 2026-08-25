/**
 * Protected visit log.
 *
 *   /api/visits?key=<VISITS_TOKEN>
 *
 * Options:
 *   &humans=1  hide machine traffic (see below)
 *   &limit=200 rows to return, max 1000
 *   &bots=1    include anything the user-agent check flagged
 *   &format=json
 *
 * The key is compared against the VISITS_TOKEN environment variable, which is
 * set in the Pages dashboard — never committed. Without a token configured the
 * endpoint refuses to serve anything, so visitor data can't be exposed by a
 * half-finished setup.
 *
 * On humans=1: the is_bot column is useless on its own — it matches user-agent
 * strings, and in the first two days it caught 0 of 215 rows while 96% of the
 * traffic was machines. Two signals actually work:
 *
 *   1. Path allowlist. The site has three pages. A request for anything else
 *      is a scanner, so this is an allowlist rather than a blocklist of probe
 *      patterns — it needs no upkeep when they invent new ones.
 *   2. Network. Consumer ISPs carry people; hosting providers, clouds and VPN
 *      resellers carry scripts. Matching on the datacenter side is the safer
 *      direction: a missed hosting company shows one extra row, whereas an
 *      ISP allowlist would silently drop real visitors on carriers not listed.
 */

// The real pages. Assets never reach here — the middleware skips them.
const PAGES = ['/', '/index.html', '/about', '/about.html', '/privacy', '/privacy.html'];

// Substrings of the network name that mean "machine". Matched case-insensitively.
const DATACENTER = [
  'tencent', 'collyer quay', 'amazon', 'google llc', 'digitalocean', 'linode',
  'ovh', 'hetzner', 'alibaba', 'microsoft', 'oracle', 'vultr', 'scaleway',
  'contabo', 'leaseweb', 'm247', 'hostinger', 'hostpapa', 'techoff', 'estoxy',
  'dedik', 'aceville', 'freedomtech', 'oculus networks', 'code200', 'wiit',
  'techties', 'cyber security', 'cyber-security', 'internet security',
  'palo alto', 'censys', 'shodan', 'cloudflare', 'opendns', 'gtt', '3xk tech',
  'internetbolaget', 'tres teknoloji', 'rego communications', 'datacamp',
  'packethub', 'ipxo', 'stark industries', 'servers.com', 'cloud', 'hosting',
  'vpn', 'proxy', 'private customer', 'colo', 'llc-', 'ltd-',
];

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

  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000);
  const bots   = url.searchParams.get('bots') === '1';
  const humans = url.searchParams.get('humans') === '1';

  // Filtering happens in SQL, not after the fetch: LIMIT has to apply to the
  // rows you keep. Filtering in JS would let 200 scanner rows crowd out every
  // real visit before you ever saw one.
  const where = [];
  const binds = [];
  if (!bots) where.push('is_bot = 0');
  if (humans) {
    where.push(`path IN (${PAGES.map(() => '?').join(',')})`);
    binds.push(...PAGES);
    // A null network is kept — unknown is not the same as datacenter.
    where.push(`(asn IS NULL OR (${DATACENTER.map(() => 'lower(asn) NOT LIKE ?').join(' AND ')}))`);
    binds.push(...DATACENTER.map((d) => `%${d}%`));
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT ts, ip, country, region, city, asn, path, referrer, ua, is_bot
       FROM visits ${clause}
      ORDER BY ts DESC LIMIT ?`
  ).bind(...binds, limit).all();

  // Shown only so the filtered view says what it is hiding, rather than
  // looking like a site with almost no traffic.
  let total = null;
  if (humans) {
    const t = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM visits ${bots ? '' : 'WHERE is_bot = 0'}`
    ).first();
    total = t && t.n;
  }

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

  const link = (p) => {
    const u = new URLSearchParams(url.searchParams);
    Object.entries(p).forEach(([k, v]) => u.set(k, v));
    return `?${u.toString()}`;
  };

  return new Response(`<!doctype html><meta charset="utf-8">
<title>Visits — alnimeri.com</title>
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{background:#0a0a0c;color:#f4f2ee;font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:2rem}
 h1{font-size:1rem;font-weight:600;margin:0 0 .25rem}
 p{color:#8a8783;margin:0 0 1.5rem;font-size:.85rem}
 a{color:#8a8783}
 a.on{color:#f4f2ee}
 table{border-collapse:collapse;width:100%;font-size:.82rem}
 th{text-align:left;color:#8a8783;font-weight:500;padding:.5rem .75rem;border-bottom:1px solid #26262c;position:sticky;top:0;background:#0a0a0c}
 td{padding:.5rem .75rem;border-bottom:1px solid #17171b;white-space:nowrap}
 .t,.ip{font-variant-numeric:tabular-nums}
 .d{color:#8a8783}
 tr:hover td{background:#131318}
</style>
<h1>Visits</h1>
<p>${results.length} shown${humans && total ? ` of ${total} — ${total - results.length} machine requests hidden` : ''}${bots ? ' · including crawlers' : ''} · newest first<br>
   <a class="${humans ? 'on' : ''}" href="${link({ humans: humans ? 0 : 1 })}">${humans ? '← show everything' : 'people only →'}</a>
   &nbsp;·&nbsp;
   <a href="${link({ bots: bots ? 0 : 1 })}">${bots ? 'hide' : 'show'} flagged crawlers</a>
   &nbsp;·&nbsp;
   <a href="${link({ limit: 1000 })}">last 1000</a></p>
<table>
 <thead><tr><th>Time (UTC)</th><th>IP</th><th>Location</th><th>Network</th><th>Page</th><th>From</th></tr></thead>
 <tbody>${rows || `<tr><td colspan="6" class="d">${humans ? 'No human visits in this window.' : 'No visits recorded yet.'}</td></tr>`}</tbody>
</table>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
