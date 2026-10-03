/**
 * /brief            → /?brief
 * /brief/<kind>     → /?brief=<kind>
 *   ?film=<slug>    → &film=<slug>
 *   ?via=<where>    → &via=<where>
 *
 * A link that opens the brief, for a bio, a signature, a QR code or an
 * assistant's answer: the front page opens its brief dialog on arrival
 * (main.js), with the kind of film chosen and the film named, and puts its
 * address back without the parameters. Every value is checked against a
 * fixed list here; anything else is dropped rather than passed on, so the
 * link still opens the brief but nothing unknown reaches the page. `via` is
 * where the link was shared; it travels in the brief's "came from" value,
 * so neither the database nor the Briefs sheet changes.
 */
import { SLUGS } from '../_lib/films.js';

const KINDS = new Set(['brand', 'events', 'documentary', 'post']);
const VIA = new Set(['ig', 'li', 'wa', 'x', 'sig', 'ai', 'qr']);
const FILMS = new Set(SLUGS);

const pick = (v, allowed) => {
  const s = String(v ?? '').trim().toLowerCase();
  return allowed.has(s) ? s : '';
};

export function onRequest({ request, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const url = new URL(request.url);
  const seg = [].concat(params.kind || []).filter(Boolean);
  // /brief/<kind> and nothing deeper
  if (seg.length > 1) return new Response('Not found', { status: 404 });
  const kind = pick(seg[0] ?? url.searchParams.get('kind'), KINDS);
  const film = pick(url.searchParams.get('film'), FILMS);
  const via = pick(url.searchParams.get('via'), VIA);

  const to = '/?brief' + (kind ? '=' + kind : '') + (film ? '&film=' + film : '') + (via ? '&via=' + via : '');
  return new Response(null, {
    status: 302,
    headers: { Location: new URL(to, url.origin).toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
