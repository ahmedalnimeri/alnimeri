// Tests GET /api/e?…&after=<id> (functions/api/e.js) against node:sqlite.
//
//   node e-after-test.mjs [--before <git rev>]
//
// The table and its index are the function's own: the database starts empty
// and the first POST makes them, through e.js's TABLE and INDEX, as on the
// site. Checks:
//   - with after, only the rows with a larger id come back, oldest first, and
//     paging on the last id of each page returns every row once;
//   - SQLite's plan for that query is a range on the primary key, so D1 reads
//     only the rows after the id (also with &days);
//   - after is JSON only, and anything but a whole number is refused;
//   - without after, every response (JSON and the page, each option) is byte
//     for byte what e.js returned before the option existed (read from git).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const BEFORE = (() => { const i = args.indexOf('--before'); return i < 0 ? '3e5b0ef' : args[i + 1]; })();
const KEY = 'test-key-not-real';

const E = path.join(REPO, 'functions/api/e.js');
const now = await import(pathToFileURL(E).href);
// The version before &after, from git, importing the same films list.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e-before-'));
const beforeSrc = execFileSync('git', ['-C', REPO, 'show', BEFORE + ':functions/api/e.js'], { encoding: 'utf8' })
  .replace("'../_lib/films.js'", JSON.stringify(pathToFileURL(path.join(REPO, 'functions/_lib/films.js')).href));
if (/searchParams\.get\('after'\)/.test(beforeSrc)) throw new Error(BEFORE + ' already has after: pass --before <an older rev>');
fs.writeFileSync(path.join(tmp, 'e.mjs'), beforeSrc);
const before = await import(pathToFileURL(path.join(tmp, 'e.mjs')).href);
fs.rmSync(tmp, { recursive: true });

const db = new DatabaseSync(':memory:');
const issued = [];                                   // every statement e.js sends, with its binds
const DB = { prepare(sql) {
  const st = { b: [], bind(...a) { st.b = a; return st; },
    async run() { issued.push([sql, st.b]); return db.prepare(sql).run(...st.b); },
    async all() { issued.push([sql, st.b]); return { results: db.prepare(sql).all(...st.b) }; },
    async first() { issued.push([sql, st.b]); return db.prepare(sql).get(...st.b); } };
  return st;
} };
const env = { VISITS_TOKEN: KEY, DB };

let failed = 0;
const check = (ok, label, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

// ---- the table comes from e.js itself: POST into an empty database ----------
Math.random = () => 0.5;                               // no purge mid-test
const post = async (body, country = 'AE') => {
  const req = new Request('https://alnimeri.com/api/e', { method: 'POST', headers: { Origin: 'https://alnimeri.com', 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  Object.defineProperty(req, 'cf', { value: { country } });
  const waits = [];
  const res = await now.onRequestPost({ request: req, env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res.status;
};
check(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'events'").get().n === 0, 'the database starts without an events table');
const codes = [];
codes.push(await post({ t: 'play', film: 'al-doroub', path: '/work/al-doroub', via: 'page' }));
const objs = db.prepare("SELECT type, name FROM sqlite_master WHERE tbl_name = 'events' ORDER BY name").all().map((r) => r.type + ' ' + r.name);
check(objs.includes('table events') && objs.includes('index idx_events_ts'), 'the first POST made the table and its index from e.js', objs.join(', '));
const T = ['play', 'brief_open', 'brief_sent', 'proof_click', 'shortlist_share', 'cv_pdf', 'brief_failed'];
for (let i = 0; i < 24; i++) codes.push(await post({ t: T[i % T.length], film: i % 3 ? 'sia-x-solana' : 'al-doroub,el-fasher-city', path: '/', via: ['ig', 'lightbox', 'copy'][i % 3] }, ['AE', 'GB', 'SA'][i % 3]));
check(codes.every((c) => c === 204), '25 events posted', 'statuses ' + [...new Set(codes)].join(','));
// rows of every age: the days filter must have something to drop
const ins = db.prepare('UPDATE events SET ts = ? WHERE id = ?');
for (const r of db.prepare('SELECT id FROM events').all()) ins.run(new Date(Date.now() - (25 - r.id) * 5 * 864e5).toISOString(), r.id);
// a gap in the ids, as the 90-day purge leaves at the old end and a failed insert can in the middle
db.prepare('DELETE FROM events WHERE id IN (3, 4, 11)').run();
const ids = db.prepare('SELECT id FROM events ORDER BY id').all().map((r) => r.id);

const get = async (h, q) => {
  const res = await h.onRequestGet({ request: new Request('https://alnimeri.com/api/e?' + q), env });
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), robots: res.headers.get('x-robots-tag'), body: await res.text() };
};
const json = async (q) => { const r = await get(now, q); return r.status === 200 ? JSON.parse(r.body).events : r; };

// ---- &after -----------------------------------------------------------------
{
  const all = await json(`key=${KEY}&format=json&after=0`);
  check(JSON.stringify(all.map((r) => r.id)) === JSON.stringify(ids), 'after=0: every event, oldest first', all.length + ' rows');
  check(all.every((r) => 'title' in r && 'ts' in r && 't' in r && 'country' in r), 'each row has the same fields as without after');
  const mid = await json(`key=${KEY}&format=json&after=10`);
  check(JSON.stringify(mid.map((r) => r.id)) === JSON.stringify(ids.filter((i) => i > 10)), 'after=10: only ids above 10, oldest first', mid.map((r) => r.id).join(','));
  const top = await json(`key=${KEY}&format=json&after=${ids.at(-1)}`);
  check(Array.isArray(top) && top.length === 0, 'after the newest id: an empty list');
  // paging: three at a time, each page starting after the last id of the one before
  let after = 0, got = [], pages = 0;
  for (;;) { const page = await json(`key=${KEY}&format=json&limit=3&after=${after}`); pages++; got = got.concat(page.map((r) => r.id)); if (page.length < 3) break; after = page.at(-1).id; }
  check(JSON.stringify(got) === JSON.stringify(ids), `paging 3 at a time on the last id: every row once, in ${pages} pages`);
  const recent = await json(`key=${KEY}&format=json&after=5&days=30`);
  const want = db.prepare("SELECT id FROM events WHERE id > 5 AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') ORDER BY id").all().map((r) => r.id);
  check(JSON.stringify(recent.map((r) => r.id)) === JSON.stringify(want) && want.length > 0, 'after=5&days=30: both filters', want.join(','));

  // the plan: what D1 reads
  const plan = (sql, binds) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...binds).map((r) => r.detail);
  for (const q of [`after=10`, `after=10&days=30`, `after=0&limit=3`]) {
    issued.length = 0; await json(`key=${KEY}&format=json&${q}`);
    const [sql, binds] = issued.find(([s]) => /^SELECT/.test(s));
    const p = plan(sql, binds);
    check(/SEARCH events USING INTEGER PRIMARY KEY \(rowid>\?\)/.test(p[0]) && !p.some((d) => /TEMP B-TREE/.test(d)),
      `${q}: SQLite reads a primary-key range in order, no sort`, p.join(' | '));
  }
  // rows SQLite steps through for after=N on a bigger table, measured with a counter in the WHERE clause
  const big = new DatabaseSync(':memory:');
  big.exec(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'events'").get().sql);
  const bi = big.prepare("INSERT INTO events (ts, t) VALUES (?, 'play')");
  for (let i = 0; i < 20000; i++) bi.run(new Date(Date.now() - (20000 - i) * 60e3).toISOString());
  let stepped = 0;
  big.function('touch', () => { stepped++; return 1; });
  issued.length = 0; await json(`key=${KEY}&format=json&after=19950`);
  const [sql] = issued.find(([s]) => /^SELECT/.test(s));
  const rows = big.prepare(sql.replace('WHERE id > ?', 'WHERE id > ? AND touch()')).all(19950, 20000);
  check(rows.length === 50 && stepped === 50, `on 20000 rows, after=19950 steps through ${stepped} rows for ${rows.length} returned`);
}

// ---- refused, and JSON only -------------------------------------------------
for (const bad of ['abc', '-1', '1.5', '', '1e3', '9999999999999999']) {
  const r = await get(now, `key=${KEY}&format=json&after=${encodeURIComponent(bad)}`);
  check(r.status === 400, `after=${JSON.stringify(bad)}: 400`, r.body.slice(0, 60));
}
check((await get(now, `key=wrong&format=json&after=abc`)).status === 404, 'a wrong key is still a 404 before after is looked at');
{
  const a = await get(now, `key=${KEY}&after=10`), b = await get(before, `key=${KEY}`);
  check(a.status === 200 && a.body === b.body, 'the page (no format=json) ignores after: the same page as without it');
}

// ---- without after: byte for byte as before ---------------------------------
for (const q of ['format=json', 'format=json&limit=4', 'format=json&days=30', 'format=json&days=7&limit=2',
                 'format=json&limit=abc', 'format=json&days=500', '', 'days=30', 'limit=3', 'format=csv']) {
  const a = await get(now, `key=${KEY}&${q}`), b = await get(before, `key=${KEY}&${q}`);
  const same = ['status', 'type', 'cache', 'robots', 'body'].every((k) => a[k] === b[k]);
  check(same, `without after, "${q || '(the page)'}" is unchanged from ${BEFORE}`, same ? `${a.status}, ${a.body.length} bytes` : 'DIFFERENT');
}
for (const q of ['format=json', '']) for (const key of ['wrong', '']) {
  const a = await get(now, `key=${key}&${q}`), b = await get(before, `key=${key}&${q}`);
  check(a.status === b.status && a.body === b.body, `key "${key}" ${q || 'page'}: unchanged (${a.status})`);
}
{
  const e2 = { VISITS_TOKEN: '', DB };
  const r1 = await now.onRequestGet({ request: new Request(`https://alnimeri.com/api/e?key=x&format=json&after=1`), env: e2 });
  check(r1.status === 503, 'no VISITS_TOKEN configured: still 503 with after');
}

// ids only grow: the newest row deleted (as a purge or a hand delete can), the
// next event still gets a larger id, so a sheet that holds it is not handed a
// different event under the same number.
{
  const top = ids.at(-1);
  db.prepare('DELETE FROM events WHERE id = ?').run(top);
  await post({ t: 'cv_pdf', path: '/cv' });
  const next = db.prepare('SELECT MAX(id) n FROM events').get().n;
  check(next > top, `after the newest id (${top}) is deleted, the next event is id ${next}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
