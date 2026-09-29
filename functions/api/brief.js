/**
 * The brief form's own inbox.
 *
 *   POST /api/brief            a visitor's brief, from the "Get in touch" dialog
 *   GET  /api/brief?key=…      Ahmed's list of briefs (same key as /api/visits)
 *   GET  /api/brief?check=1    health check: database reachable, table present
 *
 * Every brief is written to the site's own D1 database before anything else,
 * so nothing a visitor writes depends on a third party staying up. (The first
 * relay, FormSubmit, was answering HTTP 500 to everyone on 2026-09-30 — the
 * reason this endpoint exists.) Email notification is a separate, second step
 * done by the page; if it fails, the brief is still here.
 *
 * Guards: same-origin only, a honeypot field, field-length caps, a name plus a
 * valid email or WhatsApp number, and at most five briefs per sender per hour.
 * Kept for a year, as the privacy page says.
 */

const ORIGINS = /^https:\/\/(www\.)?alnimeri\.com$|^https:\/\/[a-z0-9-]+\.alnimeri\.pages\.dev$|^http:\/\/localhost(:\d+)?$/;
const MAX_BODY = 8000;
const CAP = { name: 120, company: 160, about: 80, for: 300, timing: 120, email: 200, whatsapp: 40, film_seen: 160, message: 2000 };

const TABLE = `CREATE TABLE IF NOT EXISTS briefs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  name      TEXT NOT NULL,
  company   TEXT,
  about     TEXT,
  for_what  TEXT,
  timing    TEXT,
  email     TEXT,
  whatsapp  TEXT,
  film_seen TEXT,
  message   TEXT,
  ip        TEXT,
  country   TEXT,
  ua        TEXT
)`;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

export async function onRequestPost({ request, env, waitUntil }) {
  const origin = request.headers.get('Origin') || '';
  if (origin && !ORIGINS.test(origin)) return json({ ok: false, error: 'origin' }, 403);
  if (!env.DB) return json({ ok: false, error: 'storage unavailable' }, 503);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: 'too long' }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ ok: false, error: 'bad request' }, 400); }

  // A bot fills every field it finds; a person never sees this one. Answer as
  // if it worked, so the bot learns nothing.
  if (b._honey) return json({ ok: true });

  const f = {};
  for (const k of Object.keys(CAP)) f[k] = clean(b[k], CAP[k]);
  if (!f.name) return json({ ok: false, error: 'name' }, 422);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email);
  const waOk = f.whatsapp.replace(/\D/g, '').length >= 7;
  if (!emailOk && !waOk) return json({ ok: false, error: 'contact' }, 422);
  if (f.email && !emailOk) f.email = '';

  const ip = request.headers.get('CF-Connecting-IP') || null;
  const cf = request.cf || {};
  try {
    await env.DB.prepare(TABLE).run();
    if (ip) {
      const recent = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM briefs WHERE ip = ? AND ts > datetime('now', '-1 hour')`
      ).bind(ip).first();
      if (recent && recent.n >= 5) return json({ ok: false, error: 'rate' }, 429);
    }
    const res = await env.DB.prepare(
      `INSERT INTO briefs (ts, name, company, about, for_what, timing, email, whatsapp, film_seen, message, ip, country, ua)
       VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(f.name, f.company, f.about, f.for, f.timing, f.email, f.whatsapp, f.film_seen, f.message,
           ip, cf.country || null, clean(request.headers.get('User-Agent'), 300)).run();

    // a year, as promised; checked on roughly one brief in twenty
    if (Math.random() < 0.05) {
      waitUntil(env.DB.prepare(`DELETE FROM briefs WHERE ts < datetime('now', '-365 days')`).run().catch(() => {}));
    }
    return json({ ok: true, id: res.meta && res.meta.last_row_id });
  } catch (e) {
    console.log('brief-store-failed: ' + e.message);
    return json({ ok: false, error: 'storage' }, 500);
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('check') === '1') {
    if (!env.DB) return json({ ok: false, db: false }, 503);
    try {
      await env.DB.prepare(TABLE).run();
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM briefs').first();
      return json({ ok: true, db: true, table: true, stored: n ? n.n : 0 });
    } catch (e) {
      return json({ ok: false, db: true, error: e.message }, 500);
    }
  }
  if (!env.VISITS_TOKEN || url.searchParams.get('key') !== env.VISITS_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  if (!env.DB) return new Response('D1 binding "DB" is missing.', { status: 503 });
  await env.DB.prepare(TABLE).run();
  const { results } = await env.DB.prepare('SELECT * FROM briefs ORDER BY id DESC LIMIT 500').all();
  if (url.searchParams.get('format') === 'json') return json({ ok: true, briefs: results });

  const rows = results.map((r) => `
    <article>
      <p class="when">${esc(r.ts)} UTC · ${esc(r.country || '')}</p>
      <p class="msg">${esc(r.message)}</p>
      <p class="who">${esc(r.name)}${r.company ? ' · ' + esc(r.company) : ''} ·
        ${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}
        ${r.whatsapp ? ` · <a href="https://wa.me/${esc(r.whatsapp.replace(/\D/g, ''))}">WhatsApp ${esc(r.whatsapp)}</a>` : ''}</p>
    </article>`).join('');
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Briefs — alnimeri.com</title>
<style>body{margin:0;padding:40px 24px;background:#08090a;color:#f7f8f8;font:16px/1.6 -apple-system,system-ui,sans-serif}
main{max-width:760px;margin:0 auto}h1{font-weight:500;letter-spacing:-.02em}article{border-top:1px solid #222;padding:20px 0}
.when{color:#858a94;font-size:13px;margin:0 0 6px}.msg{margin:0 0 8px;font-size:18px}.who{margin:0;color:#9aa0a9;font-size:14px}a{color:#f7f8f8}</style>
<main><h1>Briefs <span style="color:#858a94">${results.length}</span></h1>${rows || '<p>None yet.</p>'}</main>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
