/**
 * What visitors do on the site, not who they are: which films get played, and
 * which lead to a brief.
 *
 *   POST /api/e     a page's navigator.sendBeacon('/api/e', JSON.stringify({ t, film, path, via }))
 *   GET  /api/e?key=<VISITS_TOKEN>&format=json   the log, newest first
 *   GET  /api/e?key=<VISITS_TOKEN>               the same as a page, with the funnel on top
 *        &days=30  only the last N days      &limit=5000  rows (JSON up to 20000)
 *        &after=<id>  JSON only: the events with a larger id, OLDEST first. The
 *                 sheet's Events tab asks for what came after the last id it
 *                 holds, and pages on by passing the last id of each page, so
 *                 D1 reads the new rows on the primary key, not the whole table.
 *
 * t, one of:
 *   play             Play pressed on a film (via: lightbox, page; post = opened
 *                    the post of a film that plays only there)
 *   brief_open       the brief dialog opened (via: where a /brief link was shared)
 *   brief_sent       the brief reached the site's own list
 *   brief_failed     it did not, after the retry
 *   proof_click      a view count followed to the post it came from
 *   shortlist_share  a shortlist's link copied or shared (via: copy, share)
 *   cv_pdf           the CV downloaded
 * film: a film page's slug (functions/_lib/films.js), or several joined by
 *       commas for a shortlist; anything that is not a film page is dropped.
 * path: the page it happened on.
 *
 * Kept: ts, t, film, path, via and the two-letter country Cloudflare attaches
 * to the request. Not kept: the IP address, the user agent, any cookie or id,
 * so an event cannot be tied to a person, or back to a row of the visit log.
 * Guards: the site's own pages only (Origin), a 1 KB body, a fixed vocabulary
 * for t and via. Kept ninety days, as /privacy says, by the same purge as the
 * visit log: a delete of older rows rides on about one write in fifty.
 */
import { SLUGS, TITLES } from '../_lib/films.js';

const ORIGINS = /^https:\/\/(www\.)?alnimeri\.com$|^https:\/\/[a-z0-9-]+\.alnimeri\.pages\.dev$|^http:\/\/localhost(:\d+)?$/;
const MAX_BODY = 1024;
const TYPES = new Set(['play', 'brief_open', 'brief_sent', 'brief_failed', 'proof_click', 'shortlist_share', 'cv_pdf']);
const VIA = new Set(['ig', 'li', 'wa', 'x', 'sig', 'ai', 'qr', 'copy', 'share', 'lightbox', 'page', 'post']);
const FILMS = new Set(SLUGS);

const TABLE = `CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  t       TEXT NOT NULL,
  film    TEXT,
  path    TEXT,
  via     TEXT,
  country TEXT
)`;
const INDEX = 'CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC)';
// ts is an ISO string ('…T…Z'), as in visits, so compare against one
const PURGE = `DELETE FROM events WHERE ts < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')`;

const empty = (status) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

function films(v) {
  const out = [];
  for (const s of String(v || '').split(',')) {
    const slug = s.trim();
    if (FILMS.has(slug) && !out.includes(slug) && (out.join(',').length + slug.length) < 600) out.push(slug);
  }
  return out.length ? out.join(',') : null;
}

function pathOf(v) {
  const p = String(v || '');
  return /^\/[A-Za-z0-9\/._-]{0,199}$/.test(p) ? p : null;
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!ORIGINS.test(request.headers.get('Origin') || '')) return empty(403);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return empty(413);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return empty(413);
  let b;
  try { b = JSON.parse(raw); } catch { return empty(400); }
  if (!b || typeof b !== 'object' || !TYPES.has(b.t)) return empty(400);
  if (!env.DB) return empty(503);

  const row = [new Date().toISOString(), b.t, films(b.film), pathOf(b.path),
               VIA.has(b.via) ? b.via : null, ((request.cf || {}).country || '').slice(0, 2) || null];
  const insert = () => env.DB.prepare(
    'INSERT INTO events (ts, t, film, path, via, country) VALUES (?, ?, ?, ?, ?, ?)').bind(...row).run();
  // The beacon has already gone; nothing waits on the database.
  waitUntil((async () => {
    try { await insert(); }
    catch (e) {
      if (!/no such table/i.test(e.message)) throw e;
      await env.DB.prepare(TABLE).run();
      await env.DB.prepare(INDEX).run();
      await insert();
    }
    if (Math.random() < 0.02) await env.DB.prepare(PURGE).run();
  })().catch((e) => console.log('event-store-failed: ' + e.message)));
  return empty(204);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const titleOf = (film) => (film ? film.split(',').map((s) => TITLES[s] || s).join(' · ') : '');

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.VISITS_TOKEN) return new Response('VISITS_TOKEN is not configured.', { status: 503 });
  if (url.searchParams.get('key') !== env.VISITS_TOKEN) return new Response('Not found', { status: 404 });
  if (!env.DB) return new Response('D1 binding "DB" is missing.', { status: 503 });

  const asJson = url.searchParams.get('format') === 'json';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '5000', 10) || 5000, asJson ? 20000 : 5000);
  const days = Math.max(0, Math.min(90, parseInt(url.searchParams.get('days') || '0', 10) || 0));
  // ids only grow (AUTOINCREMENT never reuses one), so "after the last id I
  // have" is exactly "what I have not got". Anything but a whole number is
  // refused rather than read as 0, which would return the whole table.
  const afterRaw = asJson ? url.searchParams.get('after') : null;
  if (afterRaw !== null && !/^\d{1,15}$/.test(afterRaw)) {
    return new Response('after must be an event id, a whole number such as 1234', { status: 400 });
  }

  await env.DB.prepare(TABLE).run();
  let results;
  if (afterRaw === null) {
    const where = days ? `WHERE ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${days} days')` : '';
    ({ results } = await env.DB.prepare(
      `SELECT id, ts, t, film, path, via, country FROM events ${where} ORDER BY id DESC LIMIT ?`).bind(limit).all());
  } else {
    // A range on the primary key, read in its own order and cut off by LIMIT:
    // D1 reads only the rows after the id. With &days, the unary + keeps
    // SQLite from walking idx_events_ts over the whole window instead.
    const recent = days ? ` AND +ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${days} days')` : '';
    ({ results } = await env.DB.prepare(
      `SELECT id, ts, t, film, path, via, country FROM events WHERE id > ?${recent} ORDER BY id ASC LIMIT ?`)
      .bind(Number(afterRaw), limit).all());
  }
  const rows = results.map((r) => ({ ...r, title: titleOf(r.film) }));
  if (asJson) {
    return new Response(JSON.stringify({ ok: true, events: rows }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  }

  const count = (t) => rows.filter((r) => r.t === t).length;
  const byFilm = {};
  for (const r of rows) {
    if (!r.film || !['play', 'brief_open', 'brief_sent'].includes(r.t)) continue;
    for (const s of r.film.split(',')) {
      const f = (byFilm[s] = byFilm[s] || { play: 0, brief_open: 0, brief_sent: 0 });
      f[r.t] += 1;
    }
  }
  const ranked = Object.entries(byFilm).sort((a, b) => b[1].brief_sent - a[1].brief_sent ||
    b[1].brief_open - a[1].brief_open || b[1].play - a[1].play);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Events — alnimeri.com</title>
<style>body{margin:0;padding:2rem;background:#0a0a0c;color:#f4f2ee;font:14px/1.5 -apple-system,system-ui,sans-serif}
h1,h2{font-size:1rem;font-weight:600;margin:0 0 .5rem}p{color:#8a8783;margin:0 0 1.5rem}
table{border-collapse:collapse;width:100%;font-size:.82rem;margin:0 0 2rem}th{text-align:left;color:#8a8783;font-weight:500;padding:.4rem .7rem;border-bottom:1px solid #26262c}
td{padding:.4rem .7rem;border-bottom:1px solid #17171b;white-space:nowrap}td.n{font-variant-numeric:tabular-nums;text-align:right}</style>
<h1>Events</h1>
<p>${rows.length} events${days ? `, last ${days} days` : ''}, newest first: ${count('play')} plays &rarr; ${count('brief_open')} brief opens &rarr;
${count('brief_sent')} briefs sent (${count('brief_failed')} failed) · ${count('proof_click')} view counts followed ·
${count('shortlist_share')} shortlists shared · ${count('cv_pdf')} CV downloads</p>
<h2>By film</h2>
<table><thead><tr><th>Film</th><th>Plays</th><th>Brief opens</th><th>Briefs sent</th></tr></thead><tbody>${
  ranked.map(([s, f]) => `<tr><td>${esc(TITLES[s] || s)}</td><td class="n">${f.play}</td><td class="n">${f.brief_open}</td><td class="n">${f.brief_sent}</td></tr>`).join('') ||
  '<tr><td colspan="4">None yet.</td></tr>'}</tbody></table>
<h2>Log</h2>
<table><thead><tr><th>Time (UTC)</th><th>Event</th><th>Film</th><th>Page</th><th>Via</th><th>Country</th></tr></thead><tbody>${
  rows.slice(0, 1000).map((r) => `<tr><td>${esc(r.ts.replace('T', ' ').slice(0, 19))}</td><td>${esc(r.t)}</td><td>${esc(r.title)}</td><td>${esc(r.path)}</td><td>${esc(r.via)}</td><td>${esc(r.country)}</td></tr>`).join('') ||
  '<tr><td colspan="6">None yet.</td></tr>'}</tbody></table>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
