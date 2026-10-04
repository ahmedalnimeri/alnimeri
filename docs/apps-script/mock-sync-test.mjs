// Proves sync v4 (Sync.gs) against the two versions it joins, on simulated
// traffic and site events:
//   v3       the incremental visits sync installed in the sheet on 4 Oct 2026
//            (git b1d1c84): Visitors, All traffic, Summary
//   release  3e5b0ef: the Events tab and the 90-day prune, on the old full pull
//
//   1. While nothing is 90 days old, v4's Visitors, All traffic and Summary
//      are v3's, cell for cell, every day.
//   2. v4's Events tab, funnel line included, is the release's, cell for
//      cell, every day of the run.
//   3. Past 90 days, after every run: the three tabs hold exactly the rows
//      newer than 90 days, each once; no row a run deleted is ever written
//      again; no run throws; the Summary is what the tabs hold. Session
//      numbers stay v3's (which never deletes), row for row.
//   4. D1 rows read per hourly run, visits and events, against new rows.
//   5. Switching from v3: the live sheet's own history (old full pull with the
//      narrow humans filter → v3 → v4), and a v3 sheet already past 90 days.
//   Then the prune boundary up close, hand edits, outages, paging, rebuild(),
//   and v4 against e.js from before &after (the site not yet deployed).
//
//   node mock-sync-test.mjs [Sync.gs] [--v3 <rev>] [--release <rev>] [--days 130]
//
// v3 is read from git b1d1c84, the commit on branch sync/v4 that records the
// installed version; if that history is ever rewritten, pass --v3 <its rev>.
// It takes about nine minutes.
// No fetch is faked by hand: /api/visits and /api/e are the real handlers in
// functions/api, over an in-memory SQLite built from schema.sql, so since /
// after / humans / limit / offset behave as on the site, and each request is
// charged the rows SQLite's own plan says it reads. The Apps Script services
// are in-memory fakes (as in mock-test.mjs) that also do what a sheet does:
// a written "2026-10-04" or "13:45" comes back as a date unless the column is
// plain text, and the rows under the frozen ones can't all be deleted.
//
// UrlFetchApp is synchronous and the handlers are async, so a fetch the fake
// has not served yet stops the run; the harness serves it, puts the sheets and
// Script properties back as they were when the run began, and runs the
// function again, so the run that completes is one uninterrupted run (v4 and
// the release fetch events after writing the visit tabs). The events page a
// run will ask for is served ahead, to save most of those re-runs. Exits 1 if
// any check fails.
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args.splice(i, 2)[1]; };
const V3_REV = opt('--v3', 'b1d1c84');
const REL_REV = opt('--release', '3e5b0ef');
const V2_REV = opt('--v2', '1d73bcb');
const DAYS = Number(opt('--days', '130'));
const git = (rev, p) => execFileSync('git', ['-C', REPO, 'show', rev + ':' + p], { encoding: 'utf8' });
const V4 = fs.readFileSync(args[0] || path.join(HERE, 'Sync.gs'), 'utf8');
const V3 = git(V3_REV, 'docs/apps-script/Sync.gs');
const REL = git(REL_REV, 'docs/apps-script/Sync.gs');
const V2 = git(V2_REV, 'docs/apps-script/Sync.gs');
if (!/OVERLAP_HOURS/.test(V3) || /syncEvents/.test(V3)) throw new Error(V3_REV + ' is not v3');
if (!/function syncEvents/.test(REL) || /OVERLAP_HOURS/.test(REL)) throw new Error(REL_REV + ' is not the release');
if (DAYS < 125) throw new Error('--days must reach past 90 days and the day-120 switch: 125 or more');
const SCHEMA = fs.readFileSync(path.join(REPO, 'schema.sql'), 'utf8');
const { onRequestGet: visitsGet } = await import(pathToFileURL(path.join(REPO, 'functions/api/visits.js')).href);
const { onRequestGet: eventsGet } = await import(pathToFileURL(path.join(REPO, 'functions/api/e.js')).href);
// e.js as it was before &after, as the site serves it until this branch is deployed
const eventsGetBefore = await (async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e-before-'));
  fs.writeFileSync(path.join(dir, 'e.mjs'), git(REL_REV, 'functions/api/e.js')
    .replace("'../_lib/films.js'", JSON.stringify(pathToFileURL(path.join(REPO, 'functions/_lib/films.js')).href)));
  const m = await import(pathToFileURL(path.join(dir, 'e.mjs')).href);
  fs.rmSync(dir, { recursive: true });
  return m.onRequestGet;
})();
const KEY = 'test-key-not-real';
const DAY = 86400e3, HOUR = 3600e3, MIN = 60e3;
const KEEP = 90 * DAY;

const failures = [];
const verdict = (ok, label) => { if (!ok) failures.push(label); return ok ? 'ok' : 'FAIL'; };

let simNow = 0;                                     // the clock every fake reads
class SimDate extends Date { constructor(...a) { if (a.length) super(...a); else super(simNow); } static now() { return simNow; } }

/* ------------------------------------------------------------- fake D1 */

class FakeD1 {
  constructor(name) {
    this.name = name;
    this.db = new DatabaseSync(':memory:');
    this.db.exec(SCHEMA);
    this.ins = this.db.prepare('INSERT INTO visits (ts, ip, country, region, city, asn, path, referrer, ua, is_bot) VALUES (?,?,?,?,?,?,?,?,?,?)');
    this.insE = this.db.prepare('INSERT INTO events (ts, t, film, path, via, country) VALUES (?,?,?,?,?,?)');
    this.read = 0; this.purged = 0; this.ePurged = 0;
  }
  insert(e) { served.clear(); this.ins.run(e.ts, e.ip, e.country, e.region, e.city, e.asn, e.path, e.referrer, e.ua, e.is_bot); }
  insertEvent(e) { served.clear(); return Number(this.insE.run(e.ts, e.t, e.film, e.path, e.via, e.country).lastInsertRowid); }
  // the middleware's purge and e.js's, with the simulated clock standing in for 'now'
  purge(atMs) {
    served.clear();
    const n = Number(this.db.prepare('DELETE FROM visits WHERE ts < ?').run(new Date(atMs - KEEP).toISOString()).changes);
    if (n && !this.firstDelete) this.firstDelete = atMs;
    this.purged += n;
  }
  purgeEvents(atMs) { served.clear(); this.ePurged += Number(this.db.prepare('DELETE FROM events WHERE ts < ?').run(new Date(atMs - KEEP).toISOString()).changes); }
  size() { return this.db.prepare('SELECT COUNT(*) n FROM visits').get().n; }
  // env.DB as the handlers see it; every statement adds the rows it reads
  binding() {
    const self = this;
    return { prepare(sql) {
      const st = { b: [], bind(...a) { st.b = a; return st; },
        async run() { self.read += self.rowsRead(sql, st.b); return self.db.prepare(sql).run(...st.b); },
        async all() { self.read += self.rowsRead(sql, st.b); return { results: self.db.prepare(sql).all(...st.b) }; },
        async first() { self.read += self.rowsRead(sql, st.b); return self.db.prepare(sql).get(...st.b); } };
      return st;
    } };
  }
  // Rows a statement visits, from SQLite's own plan: the index or key range it
  // walks, cut short by LIMIT only when that range already gives the order.
  rowsRead(sql, binds) {
    if (!/^\s*SELECT/i.test(sql)) return 0;                      // e.js's CREATE TABLE IF NOT EXISTS
    const plan = this.db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...binds).map((r) => r.detail);
    const ordered = /ORDER BY/.test(sql) && !plan.some((d) => /TEMP B-TREE/.test(d));
    if (/FROM events/.test(sql)) {
      let n;
      if (/SEARCH events USING INTEGER PRIMARY KEY \(rowid>\?\)/.test(plan[0])) n = this.db.prepare('SELECT COUNT(*) n FROM events WHERE id > ?').get(binds[0]).n;
      else if (/^SCAN events/.test(plan[0])) n = this.db.prepare('SELECT COUNT(*) n FROM events').get().n;
      else throw new Error('rowsRead: unknown plan ' + plan.join(' | '));
      return ordered ? Math.min(n, binds[binds.length - 1]) : n;
    }
    const iso = binds.find((b) => typeof b === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(b));
    let range;
    if (/INDEX idx_visits_ts \(ts>\?\)/.test(plan[0])) range = ['ts > ?', [iso]];
    else if (/INDEX idx_visits_is_bot \(is_bot=\?\)/.test(plan[0])) range = ['is_bot = 0', []];
    else if (/^SCAN visits/.test(plan[0])) range = ['1', []];
    else throw new Error('rowsRead: unknown plan ' + plan.join(' | '));
    if (!ordered) return this.db.prepare(`SELECT COUNT(*) n FROM visits WHERE ${range[0]}`).get(...range[1]).n;
    const clause = /FROM visits\s+(WHERE[\s\S]*?)\s+ORDER BY/.exec(sql);
    const match = new Set(this.db.prepare(`SELECT id FROM visits ${clause ? clause[1] : ''}`).all(...binds.slice(0, -2)).map((r) => r.id));
    const want = binds[binds.length - 2] + binds[binds.length - 1];
    let n = 0, got = 0;
    for (const r of this.db.prepare(`SELECT id FROM visits WHERE ${range[0]} ORDER BY ts DESC, id ASC`).iterate(...range[1])) {
      n++; if (match.has(r.id) && ++got >= want) break;
    }
    return n;
  }
}

// Within one run the log does not change, so two sheets asking the same log
// the same question get the same answer (and are each charged its rows).
const served = new Map();
const serveOnce = (d1, url) => {
  const k = d1.name + ' ' + url;
  if (!served.has(k)) served.set(k, serve(d1, url));
  return served.get(k);
};
async function serve(d1, url) {
  const before = d1.read;
  const h = /\/api\/e\?/.test(url) ? (d1.eHandler || eventsGet) : (d1.handler || visitsGet);
  const res = await h({ request: new Request(url), env: { VISITS_TOKEN: KEY, DB: d1.binding() } });
  return { code: res.status, body: await res.text(), read: d1.read - before };
}

/* ------------------------------------------------- fake Apps Script */

const DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(d, tz, fmt) {                    // SimpleDateFormat, for the letters Sync.gs uses
  if (tz !== 'Asia/Dubai') throw new Error('fake formatDate knows only Asia/Dubai');
  const ms = +d; if (!Number.isFinite(ms)) throw new Error('Invalid argument: date');
  const t = new Date(ms + 4 * HOUR);                 // Dubai is UTC+4 all year
  const p2 = (n) => String(n).padStart(2, '0');
  return fmt.replace(/y+|M+|d+|H+|m+|E+|s+/g, (k) => {
    switch (k) {
      case 'yyyy': return String(t.getUTCFullYear());
      case 'MM': return p2(t.getUTCMonth() + 1);  case 'MMM': return MON[t.getUTCMonth()];
      case 'dd': return p2(t.getUTCDate());       case 'd': return String(t.getUTCDate());
      case 'HH': return p2(t.getUTCHours());      case 'H': return String(t.getUTCHours());
      case 'mm': return p2(t.getUTCMinutes());    case 'EEEE': return DAYNAME[t.getUTCDay()];
      default: throw new Error('fake formatDate: no pattern ' + k);
    }
  });
}
// What Sheets does to a written string in a cell not formatted as text.
function asSheets(v) {
  if (typeof v !== 'string') return v;
  if (/^\d{4}-\d\d-\d\d$/.test(v)) return new Date(v + 'T00:00:00Z');
  const m = /^(\d{1,2}):(\d\d)$/.exec(v); if (m) return new Date(Date.UTC(1899, 11, 30, +m[1], +m[2]));
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

class Range { constructor(sh, r, c, nr, nc) {
    if (!(nr >= 1 && nc >= 1)) throw new Error(`getRange: the number of rows and columns must be at least 1 (${nr} x ${nc})`);
    Object.assign(this, { sh, r, c, nr, nc }); }
  getValue() { return (this.sh.cells[this.r - 1] || [])[this.c - 1] ?? ''; }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const src = this.sh.cells[this.r - 1 + i] || [], row = []; for (let j = 0; j < this.nc; j++) row.push(src[this.c - 1 + j] ?? ''); o.push(row); } return o; }
  setValues(v) {
    touch();
    if (v.length !== this.nr || v.some((row) => row.length !== this.nc)) throw new Error('setValues: data does not match the range');
    if (this.r - 1 + this.nr > this.sh.maxR || this.c - 1 + this.nc > this.sh.maxC) throw new Error('setValues: outside the grid');
    v.forEach((row, i) => { const dst = this.sh.cells[this.r - 1 + i] = this.sh.cells[this.r - 1 + i] || [];
      row.forEach((x, j) => { const col = this.c + j; dst[col - 1] = this.sh.text.has(col) ? x : asSheets(x); }); });
    return this; }
  setValue(v) { return this.setValues([[v]]); }
  sort({ column, ascending }) { touch(); const rows = this.sh.cells.slice(this.r - 1, this.r - 1 + this.nr); rows.sort((a, b) => (ascending ? 1 : -1) * ((a[column - 1] > b[column - 1]) - (a[column - 1] < b[column - 1]))); this.sh.cells.splice(this.r - 1, this.nr, ...rows); return this; }
  setNumberFormat(f) { touch(); if (f === '@') for (let j = 0; j < this.nc; j++) this.sh.text.add(this.c + j); return this; }
  setWrap() { return this; } setFontWeight() { return this; } }
class Sheet { constructor(name) { this.name = name; this.cells = []; this.maxR = 1000; this.maxC = 26; this.text = new Set(); this.frozen = 0; }
  getLastRow() { let n = this.cells.length; while (n && !(this.cells[n - 1] || []).some((x) => x !== '' && x !== undefined)) n--; return n; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getMaxRows() { return this.maxR; } getMaxColumns() { return this.maxC; }
  insertRowsAfter(a, n) { touch(); this.maxR += n; } insertColumnsAfter(a, n) { touch(); this.maxC += n; }
  deleteRows(r, n) {
    touch();
    if (r < 1 || n < 1 || r + n - 1 > this.maxR) throw new Error('deleteRows: those rows are out of bounds');
    if (this.maxR - n <= this.frozen && r > this.frozen) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
    if (this.failNextDelete) { this.failNextDelete = false; throw new Error('Service Spreadsheets timed out (simulated)'); }
    this.cells.splice(r - 1, n); this.maxR -= n; }
  clear() { touch(); this.cells = []; this.text = new Set(); } setFrozenRows(n) { touch(); this.frozen = n; } autoResizeColumns() {} getSheetId() { return 42; } }
const copySheet = (sh, into = new Sheet(sh.name)) => Object.assign(into, { cells: sh.cells.map((r) => r.slice()), maxR: sh.maxR, maxC: sh.maxC, frozen: sh.frozen, text: new Set(sh.text), failNextDelete: sh.failNextDelete });

// The state a run began with, taken at its first write; a re-run starts from it.
let running = null;
function touch() { if (running && !running.snap) running.snap = { sheets: Object.entries(running.sheets).map(([k, sh]) => [k, copySheet(sh)]), props: { ...running.props }, triggers: running.triggers.slice() }; }
function restore(g) {
  const s = g.snap; if (!s) return;
  for (const k of Object.keys(g.sheets)) delete g.sheets[k];
  for (const [k, sh] of s.sheets) g.sheets[k] = copySheet(sh);
  for (const k of Object.keys(g.props)) delete g.props[k];
  Object.assign(g.props, s.props);
  g.triggers.splice(0, g.triggers.length, ...s.triggers);
}

class NeedFetch extends Error { constructor(url) { super('fetch ' + url); this.url = url; } }

// The events pages a run is going to ask for, served before it starts: the
// release asks for the whole table; v4 for the ids above the highest its tab
// (or EVENTS_UP_TO) has had, page after page. A wrong guess costs a re-run.
async function eventsAhead(g) {
  if (/function pullEvents/.test(g.src)) {
    const T = (g.sheets.Events || { cells: [] }).cells, lim = vm.runInContext('LIMIT', g.ctx);
    let after = 0;
    if (T.length >= 2 && (T[1] || [])[0] === 'Date') after = T.slice(2).reduce((m, r) => Math.max(m, Number(r[8]) || 0), Number(g.props.EVENTS_UP_TO) || 0);
    const urls = [];
    for (;;) {
      const url = `https://alnimeri.com/api/e?key=${encodeURIComponent(KEY)}&format=json&limit=${lim}&after=${after}`;
      urls.push(url);
      const page = JSON.parse((await serveOnce(g.d1, url)).body).events || [];
      if (page.length < lim || !(page.at(-1).id > after)) return urls;
      after = page.at(-1).id;
    }
  }
  if (/function syncEvents/.test(g.src)) return [`https://alnimeri.com/api/e?key=${encodeURIComponent(KEY)}&format=json&limit=20000`];
  return [];
}
function makeGas(name, src, d1, { limit, props: given } = {}) {
  const sheets = {}, props = { VISITS_TOKEN: KEY, ...given }, triggers = [];
  const gas = { name, src, d1, sheets, props, triggers, cache: new Map(), runs: [], fetches: [] };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => { touch(); return (sheets[n] = new Sheet(n)); },
               getUrl: () => 'https://docs.google.com/spreadsheets/d/X/edit', toast() {} };
  const ctx = {
    console, JSON, Date: SimDate, Number, String, Object, Array, Math, isFinite,
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { touch(); props[k] = String(v); }, deleteProperty: (k) => { touch(); delete props[k]; } }) },
    UrlFetchApp: { fetch(url) {
      if (url.startsWith('https://alnimeri.com/api/brief')) return { getResponseCode: () => 200, getContentText: () => '{"ok":true,"briefs":[]}' };
      const hit = gas.cache.get(url); if (!hit) throw new NeedFetch(url);
      gas.fetches.push({ url, read: hit.read });
      return { getResponseCode: () => hit.code, getContentText: () => hit.body };
    } },
    SpreadsheetApp: { getActive: () => ss, flush() {} },
    Utilities: { formatDate },
    MailApp: { sendEmail() { throw new Error('no mail expected'); } },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: (t) => { touch(); triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: (h) => { const t = { h, getHandlerFunction: () => h }; const b = { timeBased: () => b, everyHours: (n) => { t.every = n + 'h'; return b; }, everyMinutes: (n) => { t.every = n + 'm'; return b; }, create: () => { touch(); triggers.push(t); return t; } }; return b; } },
  };
  vm.createContext(ctx); vm.runInContext(src, ctx, { filename: name + '.gs' });
  if (limit) vm.runInContext('LIMIT = ' + limit, ctx);
  gas.ctx = ctx;
  // Runs a top-level function to the end, serving each fetch it asks for.
  gas.ms = 0; gas.reruns = 0;
  gas.call = async (fn) => {
    const began = Date.now();
    gas.cache = new Map(); gas.snap = null;
    for (const url of await eventsAhead(gas)) gas.cache.set(url, await serveOnce(gas.d1, url));
    for (;;) {
      gas.fetches = [];
      running = gas;
      try { vm.runInContext(fn + '()', ctx); break; }
      catch (e) {
        if (!(e instanceof NeedFetch)) throw new Error(`${name}: ${fn}() threw at day ${((simNow - START) / DAY).toFixed(2)}: ${e.message}`);
        restore(gas); gas.reruns++;
        gas.cache.set(e.url, await serveOnce(gas.d1, e.url));
      } finally { running = null; }
    }
    const of = (re) => gas.fetches.filter((f) => re.test(f.url)).reduce((s, f) => s + f.read, 0);
    const run = { at: simNow, fetches: gas.fetches, read: gas.fetches.reduce((s, f) => s + f.read, 0), visits: of(/\/api\/visits\?/), events: of(/\/api\/e\?/) };
    gas.runs.push(run);
    gas.ms += Date.now() - began;
    return run;
  };
  return gas;
}
const clone = (g, name, src, d1 = g.d1) => {
  const n = makeGas(name, src, d1, { props: Object.fromEntries(Object.entries(g.props).filter(([k]) => k !== 'VISITS_TOKEN')) });
  for (const [k, sh] of Object.entries(g.sheets)) n.sheets[k] = copySheet(sh);
  return n;
};

/* --------------------------------------------------------- traffic */

let seed = 20261004;
const R = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(R() * a.length)];
const START = Date.parse('2026-05-01T00:00:00.000Z');
const END = START + DAYS * DAY;
const RUN_AT = (k) => START + k * HOUR + 17 * MIN;      // hourly trigger, 17 minutes past

const HOMES = [ // [country, region, city, network] — consumer ISPs, one with no network at all
  ['AE', 'Dubai', 'Dubai', 'Emirates Integrated Telecommunications Company PJSC'],
  ['AE', 'Abu Dhabi', 'Abu Dhabi', 'Emirates Telecommunications Group Company (Etisalat Group) PJSC'],
  ['GB', 'England', 'London', 'British Telecommunications PLC'], ['US', 'California', 'Los Angeles', 'Comcast Cable Communications, LLC'],
  ['DE', 'Berlin', 'Berlin', 'Deutsche Telekom AG'], ['SA', 'Riyadh Region', 'Riyadh', 'Saudi Telecom Company JSC'],
  ['FR', 'Île-de-France', 'Paris', 'Orange S.A.'], ['EG', 'Cairo Governorate', 'Cairo', 'Vodafone Data'], ['SD', 'Khartoum', null, null]];
const CLOUDS = [['US', 'Virginia', 'Ashburn', 'Amazon.com, Inc.'], ['DE', 'Bavaria', 'Nuremberg', 'Hetzner Online GmbH'],
  ['NL', 'North Holland', 'Amsterdam', 'DigitalOcean, LLC'], ['FR', 'Hauts-de-France', 'Roubaix', 'OVH SAS'],
  ['SG', null, 'Singapore', 'Tencent Building, Kejizhongyi Avenue'], ['GB', 'England', 'London', 'M247 Europe SRL']];
const PAGES = ['/', '/', '/about', '/cv', '/work/', '/work/al-doroub', '/work/el-fasher-city', '/work/solana-accelerate', '/reel/k7x2p', '/privacy'];
const PROBES = ['/wp-login.php', '/.env', '/xmlrpc.php', '/wp-admin/', '/.git/config', '/admin', '/phpmyadmin/', '/', '/sitemap', '/selects.edl'];
const BROWSERS = ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'];
const REFS = [null, null, 'https://l.instagram.com/', 'https://www.google.com/', 'https://www.linkedin.com/', 'https://alnimeri.com/', 'https://t.co/x'];
const BOT_UA = () => pick(   // user agents the middleware flags is_bot = 1
  ['python-requests/2.31.0', 'curl/8.4.0', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)']);
const MID_BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|curl|wget|python-requests|monitor|preview/i;

const log = [];                                       // page hits, as the middleware logs them
const hit = (ms, ip, home, path, ua, referrer, lag) => log.push({
  ts: new Date(Math.floor(ms)).toISOString(), ms: Math.floor(ms), ip, country: home[0], region: home[1], city: home[2], asn: home[3],
  path, referrer, ua, is_bot: ua && MID_BOT.test(ua) ? 1 : 0,
  land: Math.floor(ms) + (lag ?? (R() < 0.97 ? 5 + R() * 500 : 1000 + R() * 100 * MIN)) });

// people: a few regulars across the whole period, most come once or twice
const people = Array.from({ length: 70 }, (_, i) => ({ ip: i < 60 ? `${80 + i}.${10 + i % 7}.${i * 3 % 250}.${i + 1}` : `2a02:6b8:${i.toString(16)}::1`,
  home: pick(HOMES), ua: pick(BROWSERS), visits: i < 12 ? 10 + Math.floor(R() * 20) : 1 + Math.floor(R() * 3) }));
for (const p of people) for (let v = 0; v < p.visits; v++) {
  let t = START + R() * (END - START);
  if (p.visits > 10 && v === 0) t = START + R() * 10 * DAY;          // the regulars were here early, past 90 days
  const views = 1 + Math.floor(R() * 4); const ref = pick(REFS);
  for (let k = 0; k < views; k++) { hit(t, p.ip, p.home, pick(PAGES), p.ua, k ? 'https://alnimeri.com/' : ref); t += 10e3 + R() * 8 * MIN; }
  if (R() < 0.15) hit(t + 40 * MIN + R() * 3 * HOUR, p.ip, p.home, pick(PAGES), p.ua, null);   // back later the same day
  if (R() < 0.1) hit(t + R() * HOUR, p.ip, p.home, pick(['/.env', '/wp-login.php']), 'Mozilla/5.0 zgrab/0.x', null); // a scanner on the same address
}
// scanners in clouds: bursts of probes, some sharing a millisecond
const scanners = Array.from({ length: 30 }, (_, i) => ({ ip: `${150 + i}.${i * 7 % 255}.${i * 13 % 255}.${200 - i}`, home: pick(CLOUDS) }));
for (let n = 0; n < DAYS * 2.5; n++) {
  const s = pick(scanners); let t = START + R() * (END - START);
  const ua = R() < 0.5 ? pick(BROWSERS) : R() < 0.6 ? BOT_UA() : '';
  for (let k = 0, m = 3 + Math.floor(R() * 22); k < m; k++) { hit(t, s.ip, s.home, pick(PROBES), ua, null); if (R() > 0.1) t += R() * 3000; }
}
// crawlers on real pages, residential probes, a VPN visitor
for (let n = 0; n < DAYS * 3; n++) hit(START + R() * (END - START), '66.249.66.' + (1 + Math.floor(R() * 9)), CLOUDS[0].slice(0, 3).concat('Google LLC'), pick(PAGES), BOT_UA(), null);
for (let n = 0; n < DAYS; n++) hit(START + R() * (END - START), '91.200.' + Math.floor(R() * 4) + '.9', pick(HOMES), pick(PROBES), pick(BROWSERS), null);
for (let n = 0; n < DAYS / 2; n++) hit(START + R() * (END - START), '185.220.101.4', CLOUDS[5], pick(PAGES), BROWSERS[1], null);
// Out of order across a run: a person's earlier hit lands after the run that
// already wrote their later one — the case the overlap exists for.
for (let n = 0; n < 80; n++) {
  const k = 1 + Math.floor(R() * (DAYS * 24 - 2)), T = RUN_AT(k), p = n % 2 ? pick(people) : { ip: `203.0.${n}.7`, home: pick(HOMES), ua: pick(BROWSERS) };
  const t = T - 60e3 - R() * 120e3;
  hit(t, p.ip, p.home, '/', p.ua, null, (T - t) + MIN + R() * 90 * MIN);     // lands after the run
  hit(t + 30e3, p.ip, p.home, '/about', p.ua, 'https://alnimeri.com/', 50);   // lands before it
}
// Two different visitors stamped in the same millisecond: six pairs that land
// in the same run, six where one lands only after the next run.
for (let n = 0; n < 12; n++) {
  const k = 1 + Math.floor(R() * (DAYS * 24 - 2)), T = RUN_AT(k), t = T - 20 * MIN - R() * 30 * MIN;
  const [a, b] = [pick(people), pick(people.filter((q) => q.ip !== people[0].ip))];
  hit(t, a.ip, a.home, '/', a.ua, null, 30);
  hit(t, b === a ? people[0].ip : b.ip, b.home, '/work/', b.ua, null, n < 6 ? 40 : (T - t) + 5 * MIN);
}
// A session that runs across the cutoff, every day: an uptime check on a
// cloud address, every 29 minutes for the whole period, from day 5. Its
// session never ends, so it is always the one the deletion cuts in two.
for (let t = START + 5 * DAY + 7 * MIN; t < END; t += 29 * MIN) hit(t, '34.120.7.7', CLOUDS[0], '/', 'Mozilla/5.0 (compatible; UptimeCheck/1.0)', null);
log.sort((a, b) => a.land - b.land);
const purgeAt = log.filter(() => R() < 0.02).map((e) => e.land);   // ~1 page view in 50 runs the purge

// What visitors do on the site (/api/e): a few dozen a day. Stamped when the
// request starts and stored a moment later (waitUntil), so ids follow the
// order they land in, which is not always the order of their stamps.
let seed2 = 7;
const R2 = () => { seed2 |= 0; seed2 = seed2 + 0x6D2B79F5 | 0; let t = Math.imul(seed2 ^ seed2 >>> 15, 1 | seed2); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick2 = (a) => a[Math.floor(R2() * a.length)];
const FILM = ['al-doroub', 'el-fasher-city', 'solana-accelerate', 'sia-x-solana', 'token-supercycle'];
const TITLE = { 'al-doroub': 'Al Doroub', 'el-fasher-city': 'El Fasher City', 'solana-accelerate': 'Solana Accelerate', 'sia-x-solana': 'Sia x Solana', 'token-supercycle': 'Token Supercycle' };
const acts = [];
for (let n = 0; n < DAYS * 14; n++) {
  const ms = Math.floor(START + R2() * (END - START)), f = pick2(FILM);
  const t = pick2(['play', 'play', 'play', 'play', 'brief_open', 'brief_open', 'brief_sent', 'proof_click', 'shortlist_share', 'cv_pdf', 'brief_failed']);
  const film = t === 'cv_pdf' ? null : t === 'shortlist_share' ? f + ',' + pick2(FILM.filter((x) => x !== f)) : f;
  acts.push({ ts: new Date(ms).toISOString(), ms, t, film, path: t === 'cv_pdf' ? '/cv' : pick2(['/', '/work/' + f]),
    via: t === 'play' ? pick2(['lightbox', 'page']) : t === 'brief_open' ? pick2(['ig', 'li', null]) : t === 'shortlist_share' ? pick2(['copy', 'share']) : null,
    country: pick2(['AE', 'GB', 'SA', 'US', null]), land: ms + 5 + Math.floor(R2() < 0.9 ? R2() * 900 : R2() * 40e3), purge: R2() < 0.02 });
}
// Play then brief_open a second apart, the play stored after the open: a
// larger id on the earlier stamp.
for (let n = 0; n < 30; n++) {
  const ms = Math.floor(START + R2() * (END - START)), f = pick2(FILM);
  acts.push({ ts: new Date(ms).toISOString(), ms, t: 'play', film: f, path: '/work/' + f, via: 'page', country: 'AE', land: ms + 3000, purge: false });
  acts.push({ ts: new Date(ms + 1000).toISOString(), ms: ms + 1000, t: 'brief_open', film: f, path: '/work/' + f, via: null, country: 'AE', land: ms + 1200, purge: false });
}
acts.sort((a, b) => a.land - b.land);

/* ----------------------------------------------------------- compare */

const norm = (v) => (v instanceof Date ? 'date:' + v.toISOString() : v === undefined ? '' : v);
function diffSheet(a, b, name) {
  const A = (a.sheets[name] || { cells: [] }).cells, B = (b.sheets[name] || { cells: [] }).cells;
  const out = { name, rows: [A.length, B.length], cells: 0, rowsDiffering: 0, first: [] };
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || [], y = B[i] || []; let rowDiff = false;
    for (let j = 0; j < Math.max(x.length, y.length); j++) {
      if (norm(x[j]) !== norm(y[j])) { out.cells++; rowDiff = true; if (out.first.length < 6) out.first.push(`r${i + 1} c${j + 1}: ${JSON.stringify(norm(x[j]))} vs ${JSON.stringify(norm(y[j]))}`); }
    }
    if (rowDiff) out.rowsDiffering++;
  }
  return out;
}
const LOGS = ['Visitors', 'All traffic', 'Summary'];
const diffAll = (a, b, tabs = LOGS) => tabs.map((n) => diffSheet(a, b, n));
const same = (a, b, tabs = LOGS) => diffAll(a, b, tabs).every((d) => d.cells === 0);
const show = (label, a, b, tabs = LOGS) => {
  const ds = diffAll(a, b, tabs);
  console.log(label);
  for (const d of ds) console.log(`   ${d.name.padEnd(12)} rows ${d.rows[0]} vs ${d.rows[1]} · ${d.cells ? d.cells + ' cells differ in ' + d.rowsDiffering + ' rows' : 'identical, cell for cell'}`);
  for (const d of ds) for (const f of d.first) console.log('      ' + d.name + ' ' + f);
  return ds.every((d) => d.cells === 0);
};

const VCOLS = ['Timestamp (UTC)', 'IP', 'Page', 'User agent'];
const tab = (g, name) => (g.sheets[name] || { cells: [] }).cells;
const rowsOf = (g, name) => { const T = tab(g, name); return T.length ? T.slice(name === 'Events' ? 2 : 1) : []; };
const headOf = (g, name) => tab(g, name)[name === 'Events' ? 1 : 0] || [];
const keyOf = (g, name) => {
  if (name === 'Events') { const i = headOf(g, name).indexOf('Event #'); return (r) => String(r[i]); }
  const at = VCOLS.map((n) => headOf(g, name).indexOf(n)); return (r) => at.map((i) => r[i]).join('|');
};
const stampOf = (g, name) => { const i = headOf(g, name).indexOf('Timestamp (UTC)'); return (r) => String(r[i]); };
const bag = (keys) => { const m = new Map(); for (const k of keys) m.set(k, (m.get(k) || 0) + 1); return m; };
const bagDiff = (a, b) => {           // what a has more of than b, and b than a
  const more = [], less = [];
  for (const [k, n] of a) { const d = n - (b.get(k) || 0); for (let i = 0; i < d; i++) more.push(k); }
  for (const [k, n] of b) { const d = n - (a.get(k) || 0); for (let i = 0; i < d; i++) less.push(k); }
  return { more, less };
};
const tabBag = (g, name) => { const k = keyOf(g, name); return bag(rowsOf(g, name).map(k)); };

// What a sheet should hold now: every hit / person / event of D1 newer than the cutoff, once.
async function expected(d1, cutoff) {
  const iso = new Date(cutoff).toISOString(), floor = new Date(cutoff - 1).toISOString();
  const all = bag(d1.db.prepare('SELECT ts, ip, path, ua FROM visits WHERE is_bot = 0 AND ts >= ?').all(iso)
    .map((r) => [r.ts, r.ip || '', r.path || '', r.ua || ''].join('|')));
  const h = JSON.parse((await serve(d1, `https://alnimeri.com/api/visits?key=${KEY}&format=json&limit=20000&humans=1&since=${encodeURIComponent(floor)}`)).body);
  const ppl = bag(h.map((r) => [r.ts, r.ip || '', r.path || '', r.ua || ''].join('|')));
  const ev = bag(d1.db.prepare('SELECT id FROM events WHERE ts >= ?').all(iso).map((r) => String(r.id)));
  return { 'All traffic': all, Visitors: ppl, Events: ev };
}
// The three tabs against D1: exactly the rows newer than the cutoff.
async function window(g, truth) {
  const want = await expected(truth, simNow - KEEP), out = {};
  for (const name of ['All traffic', 'Visitors', 'Events']) {
    const d = bagDiff(tabBag(g, name), want[name]);
    out[name] = { rows: rowsOf(g, name).length, want: [...want[name].values()].reduce((s, n) => s + n, 0), extra: d.more, missing: d.less };
  }
  return out;
}
const windowOk = (w) => Object.values(w).every((x) => !x.extra.length && !x.missing.length);
const windowSay = (w) => Object.entries(w).map(([n, x]) => `${n} ${x.rows}/${x.want}` + (x.extra.length ? ` +${x.extra.length} (${x.extra[0]})` : '') + (x.missing.length ? ` −${x.missing.length} (${x.missing[0]})` : '')).join(' · ');

// The Summary against the tabs: every figure it shows is what Visitors and
// All traffic hold; "New vs returning" counts each address's first kept
// visit as New (the kept rows' own Visitor cells may say Returning, from
// visits since deleted).
function summaryVsTabs(g) {
  const S = tab(g, 'Summary'), V = rowsOf(g, 'Visitors'), T = rowsOf(g, 'All traffic'), H = headOf(g, 'Visitors');
  const c = (n) => H.indexOf(n), bad = [];
  const val = (label) => (S.find((r) => r[0] === label) || [])[1];
  const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  const eq = (label, got, want) => { if (norm(got) !== norm(want)) bad.push(`${label}: Summary ${JSON.stringify(norm(got))}, tabs ${JSON.stringify(norm(want))}`); };
  const uniq = (rows, i) => new Set(rows.map((r) => r[i]).filter(Boolean)).size;
  eq('Real visits', val('Real visits (people)'), V.length);
  eq('Total hits', val('Total hits logged'), T.length);
  eq('Bots', val('Bots and scanners'), T.filter((r) => r[c('Type')] === 'Bot').length);
  eq('Person rows in All traffic = Visitors', T.filter((r) => r[c('Type')] === 'Person').length, V.length);
  eq('Unique people', val('Unique people (by IP)'), uniq(V, c('IP')));
  eq('Countries reached', val('Countries reached'), uniq(V, c('Code')));
  const days = V.map((r) => ymd(r[c('Date')])).sort();
  eq('Covering', val('Covering'), days.length ? days[0] + ' to ' + days.at(-1) : '');
  const blocks = [['Countries', V, 'Country'], ['Cities', V, 'City'], ['Pages', V, 'Page name'], ['Sections', V, 'Section'],
    ['How they arrived', V, 'Source'], ['Device', V, 'Device'], ['Operating system', V, 'OS'], ['Browser', V, 'Browser'],
    ['Network type', V, 'Network type'], ['Busiest days of week', V, 'Day'],
    ['Bot traffic by network', T.filter((r) => r[c('Type')] === 'Bot'), 'Network', 20],
    ['What the bots probed for', T.filter((r) => r[c('Type')] === 'Bot'), 'Page', 20]];
  for (const [title, rows, colName, top = 15] of blocks) {
    const want = bag(rows.map((r) => (r[c(colName)] === '' || r[c(colName)] == null ? '—' : String(r[c(colName)]))));
    const at = S.findIndex((r) => r[0] === title); const listed = [];
    for (let i = at + 1; i < S.length && S[i][0] !== '' && S[i][0] !== undefined; i++) listed.push(S[i]);
    if (listed.length !== Math.min(top, want.size)) bad.push(`${title}: lists ${listed.length}, tabs have ${want.size}`);
    for (const [k, n] of listed) if (want.get(String(k)) !== n) bad.push(`${title} ${k}: ${n} vs ${want.get(String(k))}`);
  }
  // New vs returning, counted over the kept rows
  const firstKept = new Set(V.map((r) => r[c('IP')])).size;
  const nr = S.findIndex((r) => r[0] === 'New vs returning');
  const got = {}; for (let i = nr + 1; S[i] && S[i][0]; i++) got[S[i][0]] = S[i][1];
  eq('New', got.New || 0, firstKept); eq('Returning', got.Returning || 0, V.length - firstKept);
  // by hour and by day
  const hours = bag(V.map((r) => Number(r[c('Hour')])));
  const hr = S.findIndex((r) => r[0] === 'Visits by hour (Dubai)');
  for (let h = 0; h < 24; h++) eq('hour ' + h, S[hr + 1 + h][1], hours.get(h) || 0);
  const perDay = bag(days), pd = S.findIndex((r) => r[0] === 'Visits per day');
  const listedDays = []; for (let i = pd + 1; S[i] && S[i][0] !== ''; i++) listedDays.push([ymd(S[i][0]), S[i][1]]);
  eq('days listed', listedDays.length, perDay.size);
  for (const [d, n] of listedDays) eq('day ' + d, n, perDay.get(d));
  return bad;
}

// Every row of a's All traffic against the same row in b's (same stamp, IP,
// page and user agent): which columns differ, and how often.
function rowByRow(a, b, name = 'All traffic', watch = '34.120.7.7') {
  const mine = new Set(), theirs = new Set();
  const A = rowsOf(a, name), B = rowsOf(b, name), H = headOf(a, name), kA = keyOf(a, name), kB = keyOf(b, name);
  const index = new Map(); for (const r of B) { const k = kB(r); (index.get(k) || index.set(k, []).get(k)).push(r); }
  const diff = {}, examples = {}; let compared = 0, unmatched = 0;
  for (const r of A) {
    const list = index.get(kA(r)); if (!list || !list.length) { unmatched++; continue; }
    const s = list.shift(); compared++;
    H.forEach((h, j) => { if (norm(r[j]) !== norm(s[j])) { diff[h] = (diff[h] || 0) + 1; examples[h] = examples[h] || `${kA(r)}: ${norm(r[j])} vs ${norm(s[j])}`; } });
    if (s[H.indexOf('IP')] === watch) { mine.add(r[H.indexOf('Session')]); theirs.add(s[H.indexOf('Session')]); }
  }
  return { compared, unmatched, diff, examples, labels: [mine.size, theirs.size] };
}
// Labels that more than one address+type carry
const sharedLabels = (g) => {
  const H = headOf(g, 'All traffic'), by = {};
  for (const r of rowsOf(g, 'All traffic')) (by[r[H.indexOf('Session')]] ||= new Set()).add(r[H.indexOf('IP')] + '|' + r[H.indexOf('Type')]);
  return Object.values(by).filter((x) => x.size > 1).length;
};
// Labels a single address+type carries for one unbroken run of hits (gaps of 30 min or less)
const splitSessions = (g, ip) => {
  const H = headOf(g, 'All traffic');
  return new Set(rowsOf(g, 'All traffic').filter((r) => r[H.indexOf('IP')] === ip).map((r) => r[H.indexOf('Session')])).size;
};

// Every run past 90 days: what it added and deleted. Nothing added is older
// than the cutoff, and nothing deleted (by this run or any before) comes back.
class Audit {
  constructor(g) { this.g = g; this.removed = { 'All traffic': new Set(), Visitors: new Set(), Events: new Set() }; this.bad = []; this.runs = 0; this.deleted = 0; this.added = 0; }
  before() { this.snap = Object.fromEntries(Object.keys(this.removed).map((n) => [n, tabBag(this.g, n)])); }
  after(cutoff) {
    this.runs++;
    for (const n of Object.keys(this.removed)) {
      if (!this.g.sheets[n]) continue;
      const now = tabBag(this.g, n), d = bagDiff(now, this.snap[n] || new Map());
      const stamp = n === 'Events' ? null : (k) => k.split('|')[0];
      for (const k of d.more) {
        this.added++;
        if (this.removed[n].has(k)) this.bad.push(`${n}: ${k} written again after it was deleted`);
        if (stamp && Date.parse(stamp(k)) < cutoff) this.bad.push(`${n}: ${k} written though older than the cutoff`);
      }
      for (const k of d.less) { this.removed[n].add(k); this.deleted++; }
    }
    if (n_events(this.g)) for (const r of rowsOf(this.g, 'Events')) {
      if (Date.parse(stampOf(this.g, 'Events')(r)) < cutoff) { this.bad.push('Events: ' + keyOf(this.g, 'Events')(r) + ' older than the cutoff'); break; }
    }
  }
}
const n_events = (g) => !!g.sheets.Events;

/* ------------------------------------------------------- simulation */

const clean = new FakeD1('clean'), purged = new FakeD1('purged');
const v3 = makeGas('v3', V3, clean);
const v4 = makeGas('v4', V4, clean);
const v4p = makeGas('v4 on the purged log', V4, purged);
const rel = makeGas('release', REL, clean);
const relp = makeGas('release on the purged log', REL, purged);
const LATE_DAY = 80;
const v3late = makeGas('v3 joining day ' + LATE_DAY, V3, clean);
const v4late = makeGas('v4 joining day ' + LATE_DAY + ', LIMIT 7', V4, clean, { limit: 7 });
const SWITCH_DAY = 120;
let v4sw = null;                                     // v3's sheet, switched to v4 on day 120
const audits = [new Audit(v4), new Audit(v4p)];
const PRUNE_FROM = START + 90 * DAY;                 // the first run that can delete anything is after this

console.log(`v4 = ${args[0] || 'Sync.gs'} · v3 = ${V3_REV} · release = ${REL_REV}`);
console.log(`traffic: ${log.length} hits over ${DAYS} days from ${new Date(START).toISOString().slice(0, 10)}, ` +
  `${log.filter((e) => e.is_bot).length} flagged is_bot by user agent, ` +
  `${log.filter((e) => e.land - e.ms > 1000).length} landing a second or more late (longest ${Math.round(Math.max(...log.map((e) => e.land - e.ms)) / MIN)} min), ` +
  `${log.length - new Set(log.map((e) => e.ts)).size} sharing a millisecond with another hit, an uptime check every 29 min from day 5; ${purgeAt.length} purges in the purged log`);
console.log(`events: ${acts.length} over the same days, ${acts.filter((a, i) => i && a.ts < acts[i - 1].ts).length} stored out of stamp order; ~1 in 50 runs e.js's purge in the purged log`);

let lv = 0, la = 0, pv = 0;
const daily = { pre: 0, preBad: null, ev: 0, evBad: null, post: 0, postBad: null, sum: 0, sumBad: null, late: 0, lateBad: null, sw: 0, swBad: null };
const stats = [];                                    // per run: new rows landed, rows read
const checkpoints = [];
const sides = {};
const t0 = Date.now();
for (let k = 1; RUN_AT(k) <= END; k++) {
  simNow = RUN_AT(k);
  let newVisits = 0, newEvents = 0;
  while (lv < log.length && log[lv].land <= simNow) {
    const e = log[lv++]; clean.insert(e); purged.insert(e); if (!e.is_bot) newVisits++;
    while (pv < purgeAt.length && purgeAt[pv] <= e.land) purged.purge(purgeAt[pv++]);
  }
  while (la < acts.length && acts[la].land <= simNow) {
    const a = acts[la++]; const id = clean.insertEvent(a); const id2 = purged.insertEvent(a); newEvents++;
    if (id !== id2) throw new Error('event ids differ between the logs');
    if (a.purge) purged.purgeEvents(a.land);
  }
  const pruning = simNow > PRUNE_FROM;
  if (pruning) for (const a of audits) a.before();
  for (const g of [v3, v4, v4p]) await g.call('sync');
  // The release reads the whole events table every run, so its Events tab is
  // the same whether it runs hourly or once a day: it runs at each day's check.
  if (k % 24 === 0) for (const g of [rel, relp]) await g.call('sync');
  if (pruning) for (const a of audits) a.after(simNow - KEEP);
  if (simNow >= START + LATE_DAY * DAY && !pruning) for (const g of [v3late, v4late]) await g.call('sync');
  if (v4sw) await v4sw.call('sync');
  stats.push({ at: simNow, newVisits, newEvents, v4: v4.runs.at(-1), v3: v3.runs.at(-1), rel: rel.runs.at(-1) || { visits: 0, events: 0, read: 0 } });

  // side scenarios that need the main sheets as they are on that day
  if (k === 85 * 24) {
    // Visitors emptied by hand, then rebuild(): v3 and v4 do the same
    const a = clone(v3, 'v3 (day 85 copy)', V3), b = clone(v4, 'v4 (day 85 copy)', V4);
    for (const g of [a, b]) g.sheets.Visitors.clear();
    for (const g of [a, b]) await g.call('sync');
    sides.refill = same(a, b);
    sides.refillShow = () => show('   Visitors emptied by hand on day 85, then one sync each', a, b);
    const c = clone(v3, 'v3 (day 85 rebuild)', V3), d = clone(v4, 'v4 (day 85 rebuild)', V4);
    for (const g of [c, d]) await g.call('rebuild');
    sides.rebuild = same(c, d);
    sides.rebuildShow = () => show('   rebuild() on both on day 85', c, d);
    sides.rebuildFetch = d.runs.at(-1).fetches.map((f) => f.url.replace(KEY, '…').replace(/^https:\/\/alnimeri\.com/, ''));
  }
  if (k === SWITCH_DAY * 24) {
    v4sw = clone(v3, 'v3 → v4 on day ' + SWITCH_DAY, V4);
    sides.swBefore = { traffic: rowsOf(v4sw, 'All traffic').length, events: !!v4sw.sheets.Events };
    sides.swAudit = new Audit(v4sw); sides.swAudit.before();
    const run = await v4sw.call('setUp');
    sides.swAudit.after(simNow - KEEP);
    sides.swRun = run; sides.swWindow = await window(v4sw, clean); sides.swProp = v4sw.props.SESSIONS_PRUNED;
    sides.swTriggers = v4sw.triggers.map((t) => t.h + '/' + t.every).join(', ');
    sides.swSummary = summaryVsTabs(v4sw);
  }
  if (k === 125 * 24) {
    // rebuild() past 90 days: the tabs come back as exactly the last 90 days
    const g = clone(v4, 'v4 (day 125 rebuild)', V4);
    const run = await g.call('rebuild');
    sides.rebuild125 = { window: await window(g, clean), prop: g.props.SESSIONS_PRUNED, fetches: run.fetches.map((f) => f.url.replace(KEY, '…').replace(/^https:\/\/alnimeri\.com/, '')), summary: summaryVsTabs(g) };
    const h = clone(v4, 'v4 (day 125, Visitors emptied)', V4);
    h.sheets.Visitors.clear(); await h.call('sync');
    sides.refill125 = { window: await window(h, clean), equal: bagDiff(tabBag(h, 'Visitors'), tabBag(v4, 'Visitors')), summary: summaryVsTabs(h) };
  }

  if (k % 24 === 0) {
    const d = Math.round((simNow - START) / DAY);
    if (!pruning) {
      daily.pre++;
      if (!daily.preBad) for (const g of [v4, v4p]) if (!same(v3, g)) { daily.preBad = [g.name, d]; break; }
      if (simNow >= START + LATE_DAY * DAY) { daily.late++; if (!daily.lateBad && !same(v3late, v4late)) daily.lateBad = d; }
    } else {
      daily.post++;
      for (const g of [v4, v4p].concat(v4sw ? [v4sw] : [])) {
        const w = await window(g, clean);
        if (!daily.postBad && !windowOk(w)) daily.postBad = [g.name, d, windowSay(w)];
        const s = summaryVsTabs(g); daily.sum++;
        if (!daily.sumBad && s.length) daily.sumBad = [g.name, d, s.slice(0, 3)];
      }
    }
    daily.ev++;
    if (!daily.evBad) for (const [a, b] of [[rel, v4], [relp, v4p]].concat(simNow >= START + LATE_DAY * DAY && !pruning ? [[rel, v4late]] : []).concat(v4sw ? [[rel, v4sw]] : []))
      if (!same(a, b, ['Events'])) { daily.evBad = [b.name, d, diffSheet(a, b, 'Events').first]; break; }
  }
  if (k % (24 * 10) === 0) process.stderr.write(`  … day ${Math.round((simNow - START) / DAY)}, ${((Date.now() - t0) / 1000).toFixed(0)} s (${[v3, v4, v4p, rel, relp, v3late, v4late].map((g) => g.name.split(' ')[0] + ' ' + (g.ms / 1000).toFixed(0)).join(', ')})\n`);
  if (k % (24 * 10) === 0 || RUN_AT(k + 1) > END) checkpoints.push({ day: Math.round((simNow - START) / DAY), log: clean.size(),
    ev: clean.db.prepare('SELECT COUNT(*) n FROM events').get().n, sheet: rowsOf(v4, 'All traffic').length, evSheet: rowsOf(v4, 'Events').length,
    newV: stats.slice(-24).reduce((s, x) => s + x.newVisits, 0) / 24, newE: stats.slice(-24).reduce((s, x) => s + x.newEvents, 0) / 24,
    v3: stats.slice(-24).reduce((s, x) => s + x.v3.visits, 0) / 24, v4v: stats.slice(-24).reduce((s, x) => s + x.v4.visits, 0) / 24,
    v4e: stats.slice(-24).reduce((s, x) => s + x.v4.events, 0) / 24, relV: stats.at(-1).rel.visits, relE: stats.at(-1).rel.events });
}
console.log(`${v4.runs.length} hourly runs per sheet (the release's daily), simulated in ${((Date.now() - t0) / 1000).toFixed(0)} s; re-runs to serve a fetch: v4 ${v4.reruns}, v3 ${v3.reruns}\n`);

/* ------------------------------------------------------------ reports */

console.log('1. Before anything is 90 days old: v4 is v3, cell for cell');
console.log(`   daily check (${daily.pre} days, v4 on the clean log and on the purged log against v3): ` +
  verdict(!daily.preBad, '1 daily') + (daily.preBad ? ` — FIRST DIFFERENCE ${daily.preBad[0]} on day ${daily.preBad[1]}` : ' — identical every day'));
console.log(`   joining on day ${LATE_DAY}, v4 paging 7 rows at a time against v3's 20000 (${daily.late} days): ` + verdict(!daily.lateBad, '1 late join') +
  (daily.lateBad ? ' — FIRST DIFFERENCE on day ' + daily.lateBad : ' — identical every day'));
const lateFirst = v4late.runs[0];
console.log(`   v4's first run there: ${lateFirst.fetches.length} fetches, ${lateFirst.fetches.filter((f) => /\/api\/visits.*since=/.test(f.url)).length} visit pages (all with since), ${lateFirst.fetches.filter((f) => /\/api\/e\?/.test(f.url)).length} event pages`);
sides.refillShow(); console.log('   ' + verdict(sides.refill, '1 refill'));
sides.rebuildShow(); console.log('   ' + verdict(sides.rebuild, '1 rebuild') + `; v4's rebuild fetched ${sides.rebuildFetch.join(', ')}`);
console.log();

console.log('2. The Events tab, funnel line included: v4 is the release, cell for cell');
console.log(`   daily check (${daily.ev} days, on the clean and the purged log, the day-${LATE_DAY} joiner and the day-${SWITCH_DAY} switch included): ` +
  verdict(!daily.evBad, '2 events daily') + (daily.evBad ? ` — FIRST DIFFERENCE ${daily.evBad[0]} on day ${daily.evBad[1]}: ${daily.evBad[2].join('; ')}` : ' — identical every day'));
for (const g of [rel, relp]) await g.call('sync');           // the release once more, at the last hour
console.log(`   at the last hour, once more: ${verdict(same(rel, v4, ['Events']) && same(relp, v4p, ['Events']), '2 events last hour')}; ${rowsOf(v4, 'Events').length} events on the tab (release ${rowsOf(rel, 'Events').length}); D1 holds ${clean.db.prepare('SELECT COUNT(*) n FROM events').get().n} (clean), ${purged.db.prepare('SELECT COUNT(*) n FROM events').get().n} (purged, ${purged.ePurged} deleted by e.js)`);
console.log(`   funnel: ${tab(v4, 'Events')[0][0]}`);
console.log(`   release: ${tab(rel, 'Events')[0][0]}`);
console.log();

console.log('3. Past 90 days: exactly the last 90 days, each row once, nothing deleted ever back');
console.log(`   after each day's run (${daily.post} days × the v4 sheets): ` + verdict(!daily.postBad, '3 window') +
  (daily.postBad ? ` — ${daily.postBad[0]} day ${daily.postBad[1]}: ${daily.postBad[2]}` : ' — All traffic, Visitors and Events hold exactly D1\'s rows newer than the cutoff, each once'));
for (const g of [v4, v4p]) console.log(`      ${g.name.padEnd(22)} day ${DAYS}: ${windowSay(await window(g, clean))}`);
for (const a of audits) console.log(`   every run (${a.runs}) of ${a.g.name}: ${a.added} rows written, ${a.deleted} deleted; ` +
  verdict(!a.bad.length, '3 audit ' + a.g.name) + (a.bad.length ? ' — ' + a.bad.slice(0, 3).join('; ') : ' — none older than the cutoff, none deleted earlier'));
console.log(`   Summary against the tabs (${daily.sum} checks): ` + verdict(!daily.sumBad, '3 summary') + (daily.sumBad ? ` — ${daily.sumBad[0]} day ${daily.sumBad[1]}: ${daily.sumBad[2].join('; ')}` : ' — every figure is what the tabs hold'));
{
  const r = rowByRow(v4, v3);
  const other = Object.keys(r.diff).filter((h) => h !== 'Visit #' && h !== 'Visitor');
  console.log(`   v4's All traffic row by row against v3's (which never deletes): ${r.compared} rows, ${r.unmatched} without a match; ` +
    `differ in ${Object.entries(r.diff).map(([h, n]) => h + ' ' + n).join(', ') || 'nothing'} — ` + verdict(!other.length && !r.unmatched, '3 rows vs v3') +
    (other.length ? ' ' + other.map((h) => r.examples[h]).join('; ') : ': only Visit # and New/Returning, which count the kept visits'));
  if (r.examples['Visit #']) console.log(`      e.g. ${r.examples['Visit #']}`);
  const H = headOf(v4, 'All traffic'), sloppy = rowsOf(v4, 'All traffic').filter((x) => (x[H.indexOf('Visit #')] === 1) !== (x[H.indexOf('Visitor')] === 'New')).length;
  console.log(`   Visit # 1 ⇔ New on every v4 row: ${verdict(!sloppy, '3 new=1')}${sloppy ? ' — ' + sloppy + ' rows disagree' : ''}`);
  console.log(`   Session numbers: identical to v3's on every row (above). The uptime check, one session for 125 days, on the rows v4 keeps: ${r.labels[0]} label(s) in v4, ${r.labels[1]} in v3 ` +
    `(v3 writes a new number while a hit that lands an hour late is still missing, and goes back to the first once it lands) — ${verdict(r.labels[0] === r.labels[1], '3 uptime labels')}`);
  console.log(`   labels shared by more than one address: v4 ${sharedLabels(v4)} (its 90 days), v3 ${sharedLabels(v3)} (all 130; v3 reuses a number after a late hit joins two sessions)`);
  console.log(`   SESSIONS_PRUNED on day ${DAYS}: ${v4.props.SESSIONS_PRUNED} (v4), ${v4p.props.SESSIONS_PRUNED} (v4, purged log); EVENTS_UP_TO ${v4.props.EVENTS_UP_TO}`);
}
console.log();

console.log('4. D1 rows read per hourly run');
console.log('   day  log rows  events │ new/run: visits events │ v3 visits │ v4 visits  v4 events │ release visits  events');
for (const c of checkpoints) console.log(`   ${String(c.day).padStart(3)}  ${String(c.log).padStart(8)}  ${String(c.ev).padStart(6)} │ ${c.newV.toFixed(1).padStart(13)} ${c.newE.toFixed(1).padStart(6)} │ ${c.v3.toFixed(0).padStart(9)} │ ${c.v4v.toFixed(0).padStart(9)} ${c.v4e.toFixed(1).padStart(10)} │ ${String(c.relV).padStart(14)} ${String(c.relE).padStart(7)}`);
{
  const last = stats.filter((s) => s.at > END - 7 * DAY), mean = (f) => last.reduce((s, x) => s + f(x), 0) / last.length;
  const after = stats.slice(1);
  const evExact = after.every((s) => s.v4.events === s.newEvents);
  console.log(`   (new/run and v3/v4 columns: the mean over the 24 runs to that day; release: its run that day, which reads the same every hour)`);
  console.log(`   last 7 days, per run: ${mean((x) => x.newVisits).toFixed(1)} new visit rows → v4 read ${mean((x) => x.v4.visits).toFixed(1)} (v3 ${mean((x) => x.v3.visits).toFixed(1)}, release ${mean((x) => x.rel.visits).toFixed(0)}); ` +
    `${mean((x) => x.newEvents).toFixed(2)} new events → v4 read ${mean((x) => x.v4.events).toFixed(2)} (release ${mean((x) => x.rel.events).toFixed(0)})`);
  console.log(`   events, every run after the first: v4 read exactly the events that landed since the run before — ${verdict(evExact, '4 events exact')}` +
    (evExact ? '' : ' — ' + after.filter((s) => s.v4.events !== s.newEvents).length + ' runs differ'));
  const ratio = after.map((s) => s.v4.visits / Math.max(1, s.newVisits));
  console.log(`   visits: v4 reads the rows logged in the last ${vm.runInContext('OVERLAP_HOURS', v4.ctx)} h of overlap plus the new ones, twice (all, people): max ${Math.max(...after.map((s) => s.v4.visits))} in one run, ` +
    `mean ${(after.reduce((s, x) => s + x.v4.visits, 0) / after.length).toFixed(1)}, flat while the log grows; whole run: v4 ${v4.runs.reduce((s, x) => s + x.read, 0)}, v3 ${v3.runs.reduce((s, x) => s + x.read, 0)}, release (hourly, from its daily runs) ${24 * rel.runs.reduce((s, x) => s + x.read, 0)}`);
  console.log(`   v4's first run: ${v4.runs[0].read} rows (empty log); first run with rows to delete (day 90): ${stats.find((s) => s.at > PRUNE_FROM).v4.read} rows read`);
  const urls = v4.runs.at(-1).fetches.map((f) => f.url.replace(KEY, '…'));
  console.log('   last v4 run fetched:'); urls.forEach((u) => console.log('      ' + u));
}
console.log();

console.log('5. Switching from v3');
{
  const r = sides.swRun;
  console.log(`   a v3 sheet ${SWITCH_DAY} days old (${sides.swBefore.traffic} rows in All traffic, ${sides.swBefore.events ? 'an' : 'no'} Events tab), Sync.gs replaced, setUp() run:`);
  console.log(`   triggers ${sides.swTriggers}; first sync fetched ${r.fetches.map((f) => /\/api\/e\?/.test(f.url) ? 'events after=' + new URL(f.url).searchParams.get('after') : 'visits ' + (/humans=1/.test(f.url) ? 'people' : 'all') + (/since=/.test(f.url) ? ' since' : ' FULL')).join(', ')}, read ${r.read} rows`);
  console.log(`   after it: ${windowSay(sides.swWindow)} — ${verdict(windowOk(sides.swWindow), '5 switch window')}; Summary against the tabs: ${verdict(!sides.swSummary.length, '5 switch summary')}${sides.swSummary.length ? ' ' + sides.swSummary.slice(0, 3).join('; ') : ''}`);
  console.log(`   that run deleted ${sides.swAudit.deleted} rows, wrote ${sides.swAudit.added}; ${verdict(!sides.swAudit.bad.length, '5 switch audit')}; SESSIONS_PRUNED ${sides.swProp}`);
  const a = rowByRow(v4sw, v3), b = rowByRow(v4sw, v4);
  console.log(`   on day ${DAYS}, against v3 kept running: ${a.compared} rows; differ in ${Object.entries(a.diff).map(([h, n]) => h + ' ' + n).join(', ') || 'nothing'} — ` +
    verdict(!Object.keys(a.diff).some((h) => h !== 'Visit #' && h !== 'Visitor') && !a.unmatched, '5 switch vs v3'));
  console.log(`   against v4 run from the start: Summary ${same(v4sw, v4, ['Summary']) ? 'identical' : 'DIFFERENT'}, Events ${same(v4sw, v4, ['Events']) ? 'identical' : 'DIFFERENT'}; rows differ in ${Object.entries(b.diff).map(([h, n]) => h + ' ' + n).join(', ') || 'nothing'} ` +
    `(v3 wrote days 90–${SWITCH_DAY} counting the deleted visits too) — ` + verdict(same(v4sw, v4, ['Summary', 'Events']) && !Object.keys(b.diff).some((h) => h !== 'Visit #' && h !== 'Visitor'), '5 switch vs v4'));
}

// The live sheet's own history: the old full pull until 4 Oct (with the humans
// filter narrower until 30 Sep), v3 from 4 Oct, v4 a day later.
const VISITS_SRC = fs.readFileSync(path.join(REPO, 'functions/api/visits.js'), 'utf8');
const WIDE = " OR ((path LIKE '/work/%' OR path LIKE '/reel/%') AND path NOT LIKE '%.%')";
if (!VISITS_SRC.includes(WIDE) || !/const PAGES = \[[\s\S]*?'\/cv'[\s\S]*?\];/.test(VISITS_SRC)) throw new Error('visits.js changed: update the narrowed filter');
const { onRequestGet: beforeFa191a0 } = await import('data:text/javascript,' + encodeURIComponent(VISITS_SRC
  .replace(/const PAGES = \[[\s\S]*?\];/, "const PAGES = ['/', '/index.html', '/about', '/about.html', '/privacy', '/privacy.html'];")
  .replace(WIDE, '')));
{
  const FILTER_DAY = 38, V3_DAY = 42, V4_DAY = 43, LAST_DAY = 50;   // 30 Sep, 4 Oct, 5 Oct, 12 Oct if the log began 23 Aug
  const d = new FakeD1('live'), v2 = makeGas('old full pull', V2, d), r = makeGas('release (live)', REL, d);
  let e = 0, a = 0, lv3 = null, lv4 = null, first = null, rebuilt = null, rebuilt4 = null;
  for (let k = 1; RUN_AT(k) <= START + LAST_DAY * DAY; k++) {
    simNow = RUN_AT(k);
    while (e < log.length && log[e].land <= simNow) d.insert(log[e++]);
    while (a < acts.length && acts[a].land <= simNow) d.insertEvent(acts[a++]);
    const h = simNow < START + FILTER_DAY * DAY ? beforeFa191a0 : visitsGet;
    if (d.handler !== h) { d.handler = h; served.clear(); }
    if (!lv3 && simNow >= START + V3_DAY * DAY) { lv3 = clone(v2, 'v3 (live)', V3); await lv3.call('setUp'); rebuilt = clone(v2, 'v3 rebuilt (live)', V3); await rebuilt.call('setUp'); await rebuilt.call('rebuild'); continue; }
    if (!lv4 && simNow >= START + V4_DAY * DAY) {
      lv4 = clone(lv3, 'v4 (live)', V4); first = await lv4.call('setUp');
      rebuilt4 = clone(rebuilt, 'v4 over the rebuilt v3 (live)', V4); await rebuilt4.call('setUp');
      await lv3.call('sync'); await rebuilt.call('sync'); await r.call('sync');
      continue;
    }
    for (const g of [v2, r, lv3, lv4, rebuilt, rebuilt4]) if (g) await g.call('sync');
  }
  console.log(`\n   the live sheet's history: the old full pull from day 0 (humans filter narrower until day ${FILTER_DAY}), v3 installed on day ${V3_DAY} as is, v4 on day ${V4_DAY} with setUp(); compared on day ${LAST_DAY}`);
  console.log(`   v4's first run: ${first.fetches.length} fetches (${first.fetches.map((f) => /\/api\/e\?/.test(f.url) ? 'events after=' + new URL(f.url).searchParams.get('after') : 'visits ' + (/since=/.test(f.url) ? 'since' : 'FULL')).join(', ')}), ${first.read} rows read; Events tab made with ${rowsOf(lv4, 'Events').length} events`);
  console.log('   ' + verdict(show('   v3 kept running vs v4', lv3, lv4), '5 live chain'));
  console.log('   ' + verdict(show('   v3 rebuilt on install, kept running, vs v4 over it', rebuilt, rebuilt4), '5 live chain rebuilt'));
  console.log('   ' + verdict(show('   the release from day 0 vs v4: Events', r, lv4, ['Events']), '5 live chain events'));
}
console.log();

/* ------------------------------------------- the prune boundary up close */

console.log('6. The cutoff up close (v3 and v4 side by side, hourly for 150 days on a small log)');
{
  const T0 = START + 400 * DAY, home = HOMES[0];
  const d = new FakeD1('boundary'), o = makeGas('v3/boundary', V3, d), n = makeGas('v4/boundary', V4, d);
  const rows = [];
  const add = (ms, ip, p, ua = BROWSERS[0], lag = 50) => rows.push({ ts: new Date(ms).toISOString(), ip, country: home[0], region: home[1], city: home[2], asn: home[3], path: p, referrer: null, ua, is_bot: 0, land: ms + lag });
  const run = (k) => T0 + k * HOUR + 17 * MIN;
  // a returning visitor: days 0, 50, 100 and 145
  for (const dd of [0, 50, 100, 145]) add(T0 + dd * DAY + 2 * HOUR, '9.9.9.1', '/');
  // a session that crosses the cutoff of the run on day 92 at 10:17: hits 10 min apart from 09:57 to 10:37, 90 days earlier
  const cut = run(92 * 24 + 10) - KEEP;
  for (let m = -20; m <= 20; m += 10) add(cut + m * MIN, '9.9.9.2', '/work/');
  // the same address back 25 min after its last hit, then 2 h later (a new session)
  add(cut + 45 * MIN, '9.9.9.2', '/about'); add(cut + 165 * MIN, '9.9.9.2', '/cv');
  // rows stamped exactly at a run's cutoff and 1 ms before it
  const cut2 = run(95 * 24 + 3) - KEEP;
  add(cut2, '9.9.9.3', '/'); add(cut2 - 1, '9.9.9.4', '/');
  // an uptime check every 29 minutes, all 150 days
  for (let t = T0 + 3 * MIN; t < T0 + 150 * DAY; t += 29 * MIN) add(t, '34.1.1.1', '/', 'Mozilla/5.0 (compatible; UptimeCheck/1.0)');
  // plenty of other visitors, a few a day
  let s = 99; const R3 = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 600; i++) { const t = T0 + R3() * 150 * DAY; for (let v = 0; v < 1 + Math.floor(R3() * 3); v++) add(t + v * 3 * MIN, '10.0.' + (i % 40) + '.1', pick(PAGES)); }
  rows.sort((a, b) => a.land - b.land);
  const au = new Audit(n); let i = 0, threw = null, failDay = 110, recovered = null;
  const atCut = {};
  for (let k = 1; run(k) <= T0 + 150 * DAY; k++) {
    simNow = run(k);
    while (i < rows.length && rows[i].land <= simNow) d.insert(rows[i++]);
    // On day 110 the deletion fails half way (a Sheets timeout) after the session count was stored
    if (k === failDay * 24) n.sheets['All traffic'].failNextDelete = true;
    au.before();
    try { await n.call('sync'); } catch (x) { if (k === failDay * 24) threw = x.message; else throw x; }
    au.after(simNow - KEEP);
    await o.call('sync');
    if (k === failDay * 24 + 1) recovered = await window(n, d);
    if (k === 92 * 24 + 10) atCut.rows = [o, n].map((g) => rowsOf(g, 'All traffic').filter((x) => x[headOf(g, 'All traffic').indexOf('IP')] === '9.9.9.2')
      .map((x) => { const H = headOf(g, 'All traffic'); return `${String(x[H.indexOf('Timestamp (UTC)')]).slice(11, 16)} ${x[H.indexOf('Session')]}`; }).reverse().join(' · '));
    if (k === 95 * 24 + 3 || k === 95 * 24 + 4) {
      const ts = (g) => new Set(rowsOf(g, 'All traffic').map(stampOf(g, 'All traffic')));
      atCut[k] = [ts(n).has(new Date(cut2).toISOString()), ts(n).has(new Date(cut2 - 1).toISOString())];
    }
  }
  const r = rowByRow(n, o);
  const H = headOf(n, 'All traffic'), c = (x) => H.indexOf(x);
  const of = (g, ip) => rowsOf(g, 'All traffic').filter((x) => x[c('IP')] === ip).map((x) => `${String(x[c('Timestamp (UTC)')]).slice(0, 16)} #${x[c('Visit #')]} ${x[c('Visitor')]} ${x[c('Session')]}`);
  console.log(`   ${au.runs} runs, ${au.added} rows written, ${au.deleted} deleted; nothing written older than the cutoff or written again after deletion: ${verdict(!au.bad.length, '6 audit')}${au.bad.length ? ' ' + au.bad.slice(0, 2).join('; ') : ''}`);
  console.log(`   day ${DAYS > 0 ? 150 : 0} window: ${windowSay(await window(n, d))} — ${verdict(windowOk(await window(n, d)), '6 window')}; Summary against the tabs: ${verdict(!summaryVsTabs(n).length, '6 summary')}`);
  console.log(`   a row stamped exactly at the cutoff is kept and the one 1 ms before goes: ${verdict(atCut[95 * 24 + 3] && atCut[95 * 24 + 3][0] && !atCut[95 * 24 + 3][1], '6 cutoff instant')} (an hour later both are gone: ${verdict(atCut[95 * 24 + 4] && !atCut[95 * 24 + 4][0] && !atCut[95 * 24 + 4][1], '6 cutoff later')})`);
  console.log(`   rows compared with v3: ${r.compared}; differ in ${Object.entries(r.diff).map(([h, k]) => h + ' ' + k).join(', ') || 'nothing'} — Session never: ${verdict(!r.diff.Session && !r.unmatched, '6 sessions')}`);
  console.log(`   the uptime check, one unbroken session for 150 days: ${splitSessions(n, '34.1.1.1')} label in v4 (v3 ${splitSessions(o, '34.1.1.1')}) — ${verdict(splitSessions(n, '34.1.1.1') === 1, '6 uptime')}`);
  console.log(`   a session cut in two by the cutoff of the run on day 92 at 10:17 (9.9.9.2, hits from 09:57 to 10:37, back at 11:02 and 13:02), right after that run:`);
  console.log('      v3: ' + atCut.rows[0]); console.log('      v4: ' + atCut.rows[1] + '  (09:57 and 10:07 deleted; the session counted once, not in SESSIONS_PRUNED)');
  console.log(`   a visitor on days 0, 50, 100, 145 (9.9.9.1): v3 ${of(o, '9.9.9.1').map((x) => x.split(' ').slice(1).join(' ')).join(' · ')} | v4 ${of(n, '9.9.9.1').map((x) => x.split(' ').slice(1).join(' ')).join(' · ')}`);
  console.log(`   the deletion failing on day ${failDay} after the count was stored: the run threw "${threw}"; the next run: ${windowSay(recovered)} — ${verdict(threw && windowOk(recovered), '6 failed prune recovers')}, and the session numbers still equal v3's (above)`);
  console.log(`   SESSIONS_PRUNED ${n.props.SESSIONS_PRUNED}`);
}
console.log();

/* ------------------------------------------------- events edge cases */

console.log('7. Events');
{
  // A quiet spell: no events for 100 days, so every row on the tab goes, then
  // one more. The tab has grown to fit its rows exactly (as grow() leaves a
  // tab past 1000 rows), so deleting them all is deleting every row under the
  // frozen ones, which Sheets refuses.
  const d = new FakeD1('quiet'), T0 = START + 600 * DAY;
  const g = makeGas('v4/quiet', V4, d), old = makeGas('release/quiet', REL, d);
  simNow = T0; for (let i = 0; i < 5; i++) d.insertEvent({ ts: new Date(T0 - i * HOUR).toISOString(), t: 'play', film: 'al-doroub', path: '/', via: 'page', country: 'AE' });
  await g.call('sync'); await old.call('sync');
  const before = rowsOf(g, 'Events').length;
  for (const x of [g, old]) x.sheets.Events.maxR = x.sheets.Events.getLastRow();
  simNow = T0 + 100 * DAY;
  const emptied = await g.call('sync'), left = rowsOf(g, 'Events').length;
  let oldErr = ''; try { await old.call('sync'); } catch (x) { oldErr = x.message.replace(/^.*?threw at day [\d.]+: /, ''); }
  simNow += HOUR; const idle = await g.call('sync');
  d.insertEvent({ ts: new Date(simNow).toISOString(), t: 'brief_sent', film: 'al-doroub', path: '/', via: 'ig', country: 'GB' });
  simNow += HOUR; const next = await g.call('sync');
  console.log(`   a quiet spell of 100 days, on a tab with no spare rows: ${before} events → ${left}, deleted without error (the release's prune: ${oldErr ? '"' + oldErr + '"' : 'no error'}); ` +
    `rows read: ${emptied.events} the run that emptied it, ${idle.events} the run after (D1 still holds the 5), ${next.events} when the next event came, now on the tab — ` +
    verdict(before === 5 && left === 0 && idle.events === 0 && next.events === 1 && rowsOf(g, 'Events').length === 1, '7 quiet'));

  // the site before &after is deployed: e.js from the release
  const d2 = new FakeD1('old e.js'); d2.eHandler = eventsGetBefore;
  const a = makeGas('v4 on the old e.js', V4, d2), b = makeGas('release on the old e.js', REL, d2), c = makeGas('v4 on the old e.js, LIMIT 7', V4, d2, { limit: 7 });
  const T1 = START + 700 * DAY;
  for (let k = 0; k < 48; k++) {
    simNow = T1 + k * HOUR;
    for (let i = 0; i < 3; i++) d2.insertEvent({ ts: new Date(simNow - i * MIN).toISOString(), t: pick2(['play', 'brief_open', 'cv_pdf']), film: 'el-fasher-city', path: '/', via: null, country: 'SA' });
    for (const g of [a, b, c]) await g.call('sync');
  }
  console.log(`   against e.js from before &after (the site not yet deployed): v4's Events tab vs the release's: ${same(a, b, ['Events']) ? 'identical' : 'DIFFERENT'}, ` +
    `rows read per run ${a.runs.at(-1).events} (the whole table, as the release: ${b.runs.at(-1).events}) — ${verdict(same(a, b, ['Events']), '7 old e.js')}`);
  const pages = c.runs.at(-1).fetches.filter((f) => /\/api\/e\?/.test(f.url)).length;
  console.log(`   with pages of 7 the old e.js sends its newest 7 whatever after says; v4 stops at the repeat (${pages} fetch${pages === 1 ? '' : 'es'} in the last run), ` +
    `no event twice on the tab, every event there (as the release's tab): ` +
    verdict(new Set(rowsOf(c, 'Events').map(keyOf(c, 'Events'))).size === rowsOf(c, 'Events').length && same(b, c, ['Events']), '7 old e.js paging'));
  // the same sheet once the site is deployed: the next run asks after the highest id
  d2.eHandler = null; served.clear(); simNow += HOUR;
  d2.insertEvent({ ts: new Date(simNow).toISOString(), t: 'play', film: 'al-doroub', path: '/', via: 'page', country: 'AE' });
  const dep = await a.call('sync');
  console.log(`   then the site is deployed: the next run fetched ${dep.fetches.filter((f) => /\/api\/e\?/.test(f.url)).map((f) => 'after=' + new URL(f.url).searchParams.get('after')).join(', ')} and read ${dep.events} row — ${verdict(dep.events === 1, '7 deployed')}`);
}
console.log();

/* ------------------------------------------- carried over from v3's harness */

console.log('8. v3\'s other cases, v4 against v3');
// paging when hits land between pages: nothing lost, nothing twice
for (const arrivals of [1, 3]) {
  const g = makeGas('v4/pages', V4, clean, { limit: 5 });
  let rowsLog = [], id = 0;
  const add = (ts) => rowsLog.push({ id: ++id, ts, ip: '1.1.1.' + id, path: '/', ua: 'x' });
  for (let i = 0; i < 40; i++) add(new Date(START + Math.floor(i / 3) * 1000).toISOString());  // threes share a stamp
  const before = rowsLog.map((r) => r.id);
  let fetched = 0;
  g.ctx.UrlFetchApp.fetch = (url) => {
    const q = new URL(url).searchParams, lim = +q.get('limit'), off = +(q.get('offset') || 0), since = q.get('since') || '';
    const page = rowsLog.filter((r) => r.ts > since).sort((a, b) => (a.ts < b.ts) - (a.ts > b.ts) || a.id - b.id).slice(off, off + lim);
    for (let n = 0; n < arrivals; n++) add(new Date(START + DAY + rowsLog.length * 1000).toISOString());   // hits land while it pages
    fetched++;
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(page) };
  };
  let result;
  try {
    const got = vm.runInContext('pull(false, "")', g.ctx).map((r) => r.id).sort((a, b) => a - b);
    result = JSON.stringify(got) === JSON.stringify(before) ? `exactly the ${before.length} rows that were there, once each` : 'WRONG ' + JSON.stringify(got);
  } catch (e) { result = 'stopped with "' + e.message + '" (as v3: the next run reads it)'; }
  console.log(`   paging, LIMIT 5, 40 rows in threes sharing a stamp, ${arrivals} new hit(s) landing per page: ${fetched} pages, ${result}`);
}
// beyond the overlap: a hit that lands later than OVERLAP_HOURS is missed, by both
{
  const d = new FakeD1('late'), o = makeGas('v3/late', V3, d), n = makeGas('v4/late', V4, d);
  const overlap = vm.runInContext('OVERLAP_HOURS', n.ctx);
  const base = START + 200 * DAY, home = HOMES[0];
  const row = (ms) => ({ ts: new Date(ms).toISOString(), ip: '5.5.5.5', country: home[0], region: home[1], city: home[2], asn: home[3], path: '/', referrer: null, ua: BROWSERS[0], is_bot: 0 });
  d.insert(row(base)); simNow = base + HOUR; await o.call('sync'); await n.call('sync');
  d.insert(row(base + 2 * HOUR)); simNow = base + 3 * HOUR; await o.call('sync'); await n.call('sync');
  for (const [late, label] of [[overlap - 1, 'inside'], [overlap + 1, 'outside']]) {
    d.insert(row(base + 2 * HOUR - late * HOUR));
    simNow += HOUR; await o.call('sync'); await n.call('sync');
    console.log(`   a hit landing ${late} h late (${label} the ${overlap} h overlap): v3 ${rowsOf(o, 'All traffic').length} rows, v4 ${rowsOf(n, 'All traffic').length} — ${verdict(same(o, n), '8 overlap ' + label)}`);
  }
}
// hand edits: a cleared row, a note over a stamp
{
  const T0 = START + 300 * DAY, home = HOMES[0];
  const row = (ms, ip, p) => ({ ts: new Date(ms).toISOString(), ip, country: home[0], region: home[1], city: home[2], asn: home[3], path: p, referrer: null, ua: BROWSERS[0], is_bot: 0 });
  const d = new FakeD1('edits'), n = makeGas('v4/edits', V4, d), o = makeGas('v3/edits', V3, d);
  for (let i = 0; i < 6; i++) d.insert(row(T0 + i * 40 * MIN, '7.7.7.' + i, '/'));
  simNow = T0 + 5 * HOUR; await n.call('sync'); await o.call('sync');
  const tsCol = headOf(n, 'All traffic').indexOf('Timestamp (UTC)');
  for (const g of [n, o]) { const sh = g.sheets['All traffic']; sh.cells[3] = sh.cells[3].map(() => ''); sh.cells[2][tsCol] = 'my phone'; }
  d.insert(row(T0 + 6 * HOUR, '7.7.7.9', '/about'));
  simNow = T0 + 6 * HOUR + MIN; const r = await n.call('sync'); await o.call('sync');
  console.log(`   a cleared row and a note over a stamp in All traffic: next run fetched ${r.fetches.filter((f) => /visits/.test(f.url)).map((f) => (/since=/.test(f.url) ? 'since' : 'FULL')).join(', ')}; vs v3 on the same edits: ${verdict(same(o, n), '8 hand edits')}`);
  // ninety days on, the note over a stamp can't be dated, so it stays; everything datable goes
  simNow = T0 + 100 * DAY; await n.call('sync');
  const left = rowsOf(n, 'All traffic').filter((x) => x.some((v) => v !== '' && v !== undefined)).map(stampOf(n, 'All traffic'));
  console.log(`   100 days on: All traffic holds ${left.length} row(s) with anything in them: ${JSON.stringify(left)} — the note, which can't be dated: ${verdict(left.length === 1 && left[0] === 'my phone', '8 undatable kept')}`);
}
// sync failing for 95 days while D1 purged, the sheet's newest rows among them
{
  const T0 = START + 300 * DAY, home = HOMES[0];
  const row = (ms, ip, p) => ({ ts: new Date(ms).toISOString(), ip, country: home[0], region: home[1], city: home[2], asn: home[3], path: p, referrer: null, ua: BROWSERS[0], is_bot: 0 });
  const d2 = new FakeD1('outage'), n2 = makeGas('v4/outage', V4, d2);
  for (let i = 0; i < 4; i++) d2.insert(row(T0 - 3 * HOUR + i * 50 * MIN, '5.5.5.5', '/'));
  simNow = T0 + MIN; await n2.call('sync');
  for (let k = 1; k <= 95; k += 5) d2.insert(row(T0 + k * DAY, '4.4.4.' + k, '/'));
  d2.purge(T0 + 95 * DAY);
  d2.insert(row(T0 + 95 * DAY, '5.5.5.5', '/about'));
  simNow = T0 + 95 * DAY + MIN; const r = await n2.call('sync');
  const H2 = headOf(n2, 'All traffic'), last = rowsOf(n2, 'All traffic').find((x) => x[H2.indexOf('IP')] === '5.5.5.5');
  const w = await window(n2, d2);
  console.log(`   sync failing for 95 days while D1 purged ${d2.purged} rows: the next run asked since ${new URL(r.fetches[0].url).searchParams.get('since')} (the cutoff), ${windowSay(w)} — ${verdict(windowOk(w), '8 outage')}; ` +
    `5.5.5.5's next hit is Visit # ${last[H2.indexOf('Visit #')]} (${last[H2.indexOf('Visitor')]}), its earlier visits deleted`);
}
// D1 holding years (its purge never ran): the first run reads only the 90 days
{
  const T0 = START + 1000 * DAY, home = HOMES[0];
  const d3 = new FakeD1('long'), n3 = makeGas('v4/long', V4, d3);
  for (let k = 0; k < 1100; k++) d3.insert({ ts: new Date(T0 + k * DAY).toISOString(), ip: '6.6.6.' + (k % 50), country: home[0], region: home[1], city: home[2], asn: home[3], path: '/', referrer: null, ua: BROWSERS[0], is_bot: 0 });
  simNow = T0 + 1100 * DAY; let err = ''; let r;
  try { r = await n3.call('sync'); } catch (x) { err = x.message; }
  console.log(`   D1 still holding 1100 days: ${err ? 'THREW ' + err : `the first run read ${r.read} rows and wrote ${rowsOf(n3, 'All traffic').length}`} — ${verdict(!err && rowsOf(n3, 'All traffic').length === 90 && r.read <= 2 * 90, '8 long log')}`);
}
// setUp() replaces the triggers
{
  simNow = END + HOUR;
  const g = makeGas('v4/setUp', V4, clean);
  vm.runInContext('ScriptApp.newTrigger("sync").timeBased().everyHours(1).create(); ScriptApp.newTrigger("sync").timeBased().everyHours(1).create()', g.ctx);
  const run = await g.call('setUp');
  console.log(`   setUp() on an empty sheet: triggers ${g.triggers.map((t) => t.h + '/' + t.every).join(', ')}; first sync ${run.fetches.length} fetches, ${run.read} rows read, ${windowSay(await window(g, clean))}`);
}
console.log();

console.log('9. rebuild() and a hand-emptied Visitors tab past 90 days');
{
  const x = sides.rebuild125;
  console.log(`   rebuild() on day 125: fetched ${x.fetches.join(', ')}; ${windowSay(x.window)}; SESSIONS_PRUNED ${x.prop === undefined ? 'cleared' : x.prop} — ${verdict(windowOk(x.window) && x.prop === undefined && !x.summary.length, '9 rebuild')}`);
  const y = sides.refill125;
  console.log(`   Visitors emptied on day 125, one sync: ${windowSay(y.window)}; the same rows as before it was emptied: ${verdict(!y.equal.more.length && !y.equal.less.length && windowOk(y.window) && !y.summary.length, '9 refill')}`);
}
console.log();

console.log(failures.length ? `${failures.length} CHECK(S) FAILED: ${failures.join(', ')}` : 'every check passed');
process.exit(failures.length ? 1 : 0);
