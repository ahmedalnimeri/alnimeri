// Proves that the incremental sync() in Sync.gs fills the sheets exactly as
// the old full-pull sync() did, and counts how many D1 rows each one reads.
// The one difference allowed: a second hit with the same stamp, IP and page
// that lands after the run which wrote the first. The old write() dropped it
// from the sheet (while still counting it); the new one writes it.
// Checks 10-13 replay installing over a sheet the old code wrote before the
// humans filter widened (fa191a0), and a few hand edits and outages.
//
//   node mock-sync-test.mjs [Sync.gs] [--old <git rev>] [--days 130] [--overlap <hours>]
//
// The old version is read from git (default 1d73bcb, the last commit before
// the incremental pull). /api/visits is not faked by hand: every fetch is
// served by the real functions/api/visits.js handler, over an in-memory
// SQLite built from schema.sql, so since / humans / limit / offset behave as
// they do on the site. The Apps Script services are the same in-memory
// fakes as mock-test.mjs (stable sort, getLastRow counting filled rows),
// plus what a sheet does to text: a written "2026-10-04" or "13:45" comes
// back as a date value unless the column is formatted as plain text.
//
// UrlFetchApp is synchronous and the handler is async, so a fetch the fake
// has not served yet stops the run; the harness serves it and runs the
// function again. sync() changes nothing before its fetches, so a re-run is
// the same run.
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args.splice(i, 2)[1]; };
const OLD_REV = opt('--old', '1d73bcb');
const DAYS = Number(opt('--days', '130'));
const OVERLAP = opt('--overlap', null);           // hours; default is whatever Sync.gs says
const NEW_SRC = fs.readFileSync(args[0] || path.join(HERE, 'Sync.gs'), 'utf8');
const OLD_SRC = execFileSync('git', ['-C', REPO, 'show', OLD_REV + ':docs/apps-script/Sync.gs'], { encoding: 'utf8' });
const SCHEMA = fs.readFileSync(path.join(REPO, 'schema.sql'), 'utf8');
const { onRequestGet } = await import(pathToFileURL(path.join(REPO, 'functions/api/visits.js')).href);
const KEY = 'test-key-not-real';
const DAY = 86400e3, HOUR = 3600e3, MIN = 60e3;

let simNow = 0;                                     // the clock every fake reads
class SimDate extends Date { constructor(...a) { if (a.length) super(...a); else super(simNow); } static now() { return simNow; } }

/* ------------------------------------------------------------- fake D1 */

class FakeD1 {
  constructor(name) {
    this.name = name;
    this.db = new DatabaseSync(':memory:');
    this.db.exec(SCHEMA);
    this.ins = this.db.prepare('INSERT INTO visits (ts, ip, country, region, city, asn, path, referrer, ua, is_bot) VALUES (?,?,?,?,?,?,?,?,?,?)');
    this.read = 0; this.purged = 0;
  }
  insert(e) { served.clear(); this.ins.run(e.ts, e.ip, e.country, e.region, e.city, e.asn, e.path, e.referrer, e.ua, e.is_bot); }
  // the middleware's purge, with the simulated clock standing in for 'now'
  purge(atMs) {
    served.clear();
    const n = Number(this.db.prepare('DELETE FROM visits WHERE ts < ?').run(new Date(atMs - 90 * DAY).toISOString()).changes);
    if (n && !this.firstDelete) this.firstDelete = atMs;
    this.purged += n;
  }
  size() { return this.db.prepare('SELECT COUNT(*) n FROM visits').get().n; }
  // env.DB as visits.js sees it; every statement adds the rows it reads
  binding() {
    const self = this;
    return { prepare(sql) {
      const st = { b: [], bind(...a) { st.b = a; return st; },
        async all() { self.read += self.rowsRead(sql, st.b); return { results: self.db.prepare(sql).all(...st.b) }; },
        async first() { self.read += self.rowsRead(sql, st.b); return self.db.prepare(sql).get(...st.b); } };
      return st;
    } };
  }
  // Rows a statement visits, from SQLite's own plan: the index range it
  // walks, cut short by LIMIT only when the index already gives the order.
  rowsRead(sql, binds) {
    const plan = this.db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...binds).map((r) => r.detail);
    const iso = binds.find((b) => typeof b === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(b));
    let range;
    if (/INDEX idx_visits_ts \(ts>\?\)/.test(plan[0])) range = ['ts > ?', [iso]];
    else if (/INDEX idx_visits_is_bot \(is_bot=\?\)/.test(plan[0])) range = ['is_bot = 0', []];
    else if (/^SCAN visits/.test(plan[0])) range = ['1', []];
    else throw new Error('rowsRead: unknown plan ' + plan.join(' | '));
    const ordered = /ORDER BY/.test(sql) && !plan.some((d) => /TEMP B-TREE/.test(d));
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
  const res = await (d1.handler || onRequestGet)({ request: new Request(url), env: { VISITS_TOKEN: KEY, DB: d1.binding() } });
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

class Range { constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValue() { return (this.sh.cells[this.r - 1] || [])[this.c - 1] ?? ''; }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const src = this.sh.cells[this.r - 1 + i] || [], row = []; for (let j = 0; j < this.nc; j++) row.push(src[this.c - 1 + j] ?? ''); o.push(row); } return o; }
  setValues(v) {
    if (v.length !== this.nr || v.some((row) => row.length !== this.nc)) throw new Error('setValues: data does not match the range');
    v.forEach((row, i) => { const dst = this.sh.cells[this.r - 1 + i] = this.sh.cells[this.r - 1 + i] || [];
      row.forEach((x, j) => { const col = this.c + j; dst[col - 1] = this.sh.text.has(col) ? x : asSheets(x); }); });
    if (this.r - 1 + this.nr > this.sh.maxR || this.c - 1 + this.nc > this.sh.maxC) throw new Error('setValues: outside the grid');
    return this; }
  sort({ column, ascending }) { const rows = this.sh.cells.slice(this.r - 1, this.r - 1 + this.nr); rows.sort((a, b) => (ascending ? 1 : -1) * ((a[column - 1] > b[column - 1]) - (a[column - 1] < b[column - 1]))); this.sh.cells.splice(this.r - 1, this.nr, ...rows); return this; }
  setNumberFormat(f) { if (f === '@') for (let j = 0; j < this.nc; j++) this.sh.text.add(this.c + j); return this; }
  setWrap() { return this; } setFontWeight() { return this; } }
class Sheet { constructor(name) { this.name = name; this.cells = []; this.maxR = 1000; this.maxC = 26; this.text = new Set(); }
  getLastRow() { let n = this.cells.length; while (n && !(this.cells[n - 1] || []).some((x) => x !== '' && x !== undefined)) n--; return n; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getMaxRows() { return this.maxR; } getMaxColumns() { return this.maxC; }
  insertRowsAfter(a, n) { this.maxR += n; } insertColumnsAfter(a, n) { this.maxC += n; }
  clear() { this.cells = []; this.text = new Set(); } setFrozenRows() {} autoResizeColumns() {} getSheetId() { return 42; } }

class NeedFetch extends Error { constructor(url) { super('fetch ' + url); this.url = url; } }

function makeGas(name, src, d1, { limit } = {}) {
  const sheets = {}, props = { VISITS_TOKEN: KEY }, triggers = [];
  const gas = { name, d1, sheets, triggers, cache: new Map(), runs: [], fetches: [] };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = new Sheet(n)),
               getUrl: () => 'https://docs.google.com/spreadsheets/d/X/edit', toast() {} };
  const ctx = {
    console, JSON, Date: SimDate, Number, String, Object, Array, Math,
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
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
    ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (h) => { const t = { h, getHandlerFunction: () => h }; const b = { timeBased: () => b, everyHours: (n) => { t.every = n + 'h'; return b; }, everyMinutes: (n) => { t.every = n + 'm'; return b; }, create: () => { triggers.push(t); return t; } }; return b; } },
  };
  vm.createContext(ctx); vm.runInContext(src, ctx, { filename: name + '.gs' });
  if (limit) vm.runInContext('LIMIT = ' + limit, ctx);
  if (OVERLAP && src === NEW_SRC) vm.runInContext('OVERLAP_HOURS = ' + Number(OVERLAP), ctx);
  gas.ctx = ctx;
  // Runs a top-level function to the end, serving each fetch it asks for.
  gas.call = async (fn) => {
    gas.cache = new Map();
    for (;;) {
      gas.fetches = [];
      try { vm.runInContext(fn + '()', ctx); break; }
      catch (e) { if (!(e instanceof NeedFetch)) throw e; gas.cache.set(e.url, await serveOnce(d1, e.url)); }
    }
    const run = { at: simNow, fetches: gas.fetches, read: gas.fetches.reduce((s, f) => s + f.read, 0) };
    gas.runs.push(run);
    return run;
  };
  return gas;
}

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

const events = [];
const hit = (ms, ip, home, path, ua, referrer, lag) => events.push({
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
events.sort((a, b) => a.land - b.land);
const purgeAt = events.filter(() => R() < 0.02).map((e) => e.land);   // ~1 page view in 50 runs the purge

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
// Hits D1 holds that a sheet does not. The old write() keys rows on stamp +
// IP + page, so a second hit with the same key that lands after the run which
// wrote the first is dropped from its sheet, though the old code still counts
// it (it recounts from the API every run). The new write() adds that hit.
function dropped(g, d1) {
  const T = g.sheets['All traffic'].cells, H = T[0], have = {};
  const at = ['Timestamp (UTC)', 'IP', 'Page', 'User agent'].map((n) => H.indexOf(n));
  T.slice(1).forEach((r) => { const k = at.map((i) => r[i]).join('|'); have[k] = (have[k] || 0) + 1; });
  return d1.db.prepare('SELECT ts, ip, path, ua FROM visits WHERE is_bot = 0').all()
    .filter((r) => { const k = [r.ts, r.ip || '', r.path || '', r.ua || ''].join('|'); if (have[k]) { have[k]--; return false; } return true; });
}
// One log of the new sheet against the target's, row by row: a row the new
// one has in excess must be one of the hits the target dropped (each used
// once); any other difference counts as a fault.
function walk(a, b, name, lost) {
  const A = (a.sheets[name] || { cells: [] }).cells, B = (b.sheets[name] || { cells: [] }).cells;
  const H = A[0] || B[0] || [], at = ['Timestamp (UTC)', 'IP', 'Page', 'User agent'].map((n) => H.indexOf(n));
  const left = new Map();
  for (const d of lost) { const k = [d.ts, d.ip || '', d.path || '', d.ua || ''].join('|'); left.set(k, (left.get(k) || 0) + 1); }
  const eq = (x, y) => { for (let j = 0; j < Math.max(x.length, y.length); j++) if (norm(x[j]) !== norm(y[j])) return false; return true; };
  const out = { name, rows: [A.length, B.length], extra: [], bad: 0, first: [] };
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && eq(A[i], B[j])) { i++; j++; continue; }
    const k = j < B.length ? at.map((c) => B[j][c]).join('|') : null;
    if (k && left.get(k)) { left.set(k, left.get(k) - 1); out.extra.push(k); j++; continue; }
    out.bad++;
    if (out.first.length < 6) {
      const x = A[i] || [], y = B[j] || [];
      let c = 0; while (c < Math.max(x.length, y.length) && norm(x[c]) === norm(y[c])) c++;
      out.first.push(`target r${i + 1} / new r${j + 1}, ${H[c] || 'c' + (c + 1)}: ${JSON.stringify(norm(x[c]))} vs ${JSON.stringify(norm(y[c]))}`);
    }
    i++; j++;
  }
  return out;
}
// The new sheet must be the target plus exactly the hits it dropped, with
// the Summary identical cell for cell.
function plusDropped(a, b, lost) {
  const logs = ['Visitors', 'All traffic'].map((n) => walk(a, b, n, lost));
  const sum = diffSheet(a, b, 'Summary');
  return { logs, sum, faults: logs.reduce((s, w) => s + w.bad, 0) + sum.cells };
}
function report(label, a, b, lost) {
  console.log(label);
  const r = plusDropped(a, b, lost);
  for (const w of r.logs) {
    const said = w.bad ? `${w.bad} rows differ` : w.extra.length ? `the target plus ${w.extra.length} row${w.extra.length > 1 ? 's' : ''} it dropped, nothing else differs` : 'identical, cell for cell';
    console.log(`   ${w.name.padEnd(12)} rows ${w.rows[0]} vs ${w.rows[1]} · ${said}`);
    for (const f of w.first) console.log('      ' + f);
  }
  console.log(`   ${'Summary'.padEnd(12)} rows ${r.sum.rows[0]} vs ${r.sum.rows[1]} · ${r.sum.cells ? r.sum.cells + ' cells differ' : 'identical, cell for cell'}`);
  for (const f of r.sum.first) console.log('      Summary ' + f);
  return r;
}
const LOGS = ['Visitors', 'All traffic', 'Summary'];
const diffAll = (a, b) => LOGS.map((n) => diffSheet(a, b, n));
const same = (a, b) => diffAll(a, b).every((d) => d.cells === 0);
const show = (label, a, b) => {
  console.log(label);
  for (const d of diffAll(a, b)) console.log(`   ${d.name.padEnd(12)} rows ${d.rows[0]} vs ${d.rows[1]} · ${d.cells ? d.cells + ' cells differ in ' + d.rowsDiffering + ' rows' : 'identical, cell for cell'}`);
  for (const d of diffAll(a, b)) for (const f of d.first) console.log('      ' + d.name + ' ' + f);
};

/* ------------------------------------------------------- simulation */

const clean = new FakeD1('no purge'), purged = new FakeD1('purge');
const target = makeGas('old/no-purge', OLD_SRC, clean);   // the numbers the old code gave with the full history
const fresh = makeGas('new/no-purge', NEW_SRC, clean);
const oldP = makeGas('old/purge', OLD_SRC, purged);
const newP = makeGas('new/purge', NEW_SRC, purged);
const LATE_DAY = Math.min(75, DAYS - 10);
const lateOld = makeGas('old/joins day ' + LATE_DAY, OLD_SRC, clean);
const latePaged = makeGas('new/joins day ' + LATE_DAY + ', LIMIT 7', NEW_SRC, clean, { limit: 7 });

console.log(`traffic: ${events.length} hits over ${DAYS} days from ${new Date(START).toISOString().slice(0, 10)}, ` +
  `${events.filter((e) => e.is_bot).length} flagged is_bot by user agent, ` +
  `${events.filter((e) => e.land - e.ms > 1000).length} landing a second or more late (longest ${Math.round(Math.max(...events.map((e) => e.land - e.ms)) / MIN)} min), ` +
  `${events.length - new Set(events.map((e) => e.ts)).size} sharing a millisecond with another hit; ${purgeAt.length} purges in the purged log`);

let ev = 0, pv = 0, firstBad = null;
const t0 = Date.now();
const checkpoints = [];
for (let k = 1; RUN_AT(k) <= END; k++) {
  simNow = RUN_AT(k);
  while (ev < events.length && events[ev].land <= simNow) {
    const e = events[ev++];
    clean.insert(e); purged.insert(e);
    while (pv < purgeAt.length && purgeAt[pv] <= e.land) purged.purge(purgeAt[pv++]);
  }
  for (const g of [target, fresh, oldP, newP]) await g.call('sync');
  if (simNow >= START + LATE_DAY * DAY) for (const g of [lateOld, latePaged]) await g.call('sync');
  if (k % 24 === 0 && !firstBad) {
    const lost = dropped(target, clean);
    if (plusDropped(target, fresh, lost).faults) firstBad = ['new/no-purge', k];
    else if (plusDropped(target, newP, lost).faults) firstBad = ['new/purge', k];
  }
  if (k % (24 * 10) === 0 || RUN_AT(k + 1) > END) checkpoints.push({ day: Math.round((simNow - START) / DAY), log: clean.size(), logP: purged.size(),
    old: target.runs.at(-1).read, neu: fresh.runs.at(-1).read, oldP: oldP.runs.at(-1).read, neuP: newP.runs.at(-1).read,
    sheet: (fresh.sheets['All traffic'].getLastRow() - 1) });
}
console.log(`${target.runs.length} hourly runs per sheet, simulated in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('daily check:', firstBad ? `FIRST UNEXPLAINED DIFFERENCE ${firstBad[0]} at run ${firstBad[1]}` : 'every 24 runs, both new sheets matched the target cell for cell, apart from holding the hits the target dropped (below)');
console.log();

{
  const lost = dropped(target, clean);
  console.log(`hits the old dedupe key dropped from the target sheet, which it still counted: ${lost.length}` + lost.map((d) => `\n      ${d.ts} ${d.ip} ${d.path} ua=${JSON.stringify(d.ua)}`).join(''));
  report('1. NEW vs OLD, same log, never purged — must be identical, apart from holding those hits', target, fresh, lost);
  console.log(`   hits D1 holds that the new sheet lacks: ${dropped(fresh, clean).length}`);
  report('2. NEW on the purged log vs OLD on the full log (the target) — the same', target, newP, lost);
}
show('3. OLD on the purged log vs the target — the old code forgets what D1 purged', target, oldP);
show(`4. joining late (day ${LATE_DAY}): NEW paging 7 rows at a time vs OLD — first run is a full pull`, lateOld, latePaged);
const firstLate = latePaged.runs[0];
console.log(`   NEW's first run: ${firstLate.fetches.length} fetches, ${firstLate.fetches.filter((f) => !/since=/.test(f.url)).length} without since (a full pull)`);
console.log();

// what changed in the old code once rows were purged
{
  const T = target.sheets['All traffic'].cells, O = oldP.sheets['All traffic'].cells, H = T[0];
  const col = (n) => H.indexOf(n); let num = 0, ses = 0, vis = 0, firstRow = null;
  for (let i = 1; i < T.length; i++) {
    if (T[i][col('Visit #')] !== O[i][col('Visit #')]) num++;
    if (T[i][col('Session')] !== O[i][col('Session')]) { ses++; firstRow = O[i][col('Timestamp (UTC)')]; }
    if (T[i][col('Visitor')] !== O[i][col('Visitor')]) vis++;
  }
  const oldest = (g) => g.sheets['Summary'].cells.find((r) => r[0] === 'Covering')[1];
  console.log(`   in 3, All traffic rows with a different Visit #: ${num}, Session: ${ses}, New/Returning: ${vis} (D1 first deleted rows on day ${purged.firstDelete ? ((purged.firstDelete - START) / DAY).toFixed(1) : '—'} and ${purged.purged} rows in all; earliest row numbered differently ${firstRow || '—'})`);
  console.log(`   Summary "Covering": target ${oldest(target)} · new/purge ${oldest(newP)} · old/purge ${oldest(oldP)}`);
  const sessions = (g) => { const s = g.sheets['All traffic'].cells.slice(1).map((r) => r[col('Session')]); return [new Set(s).size, s.length]; };
  const [a, b] = sessions(oldP), [c, d] = sessions(newP);
  const reused = (g) => { const by = {}; g.sheets['All traffic'].cells.slice(1).forEach((r) => { const s = r[col('Session')]; (by[s] ||= new Set()).add(r[col('IP')] + '|' + r[col('Type')]); }); return Object.values(by).filter((x) => x.size > 1).length; };
  console.log(`   session labels used by more than one visitor: old/purge ${reused(oldP)}, new/purge ${reused(newP)}, target ${reused(target)}`);
}
console.log();

// rows read
const per = (g, from) => { const r = g.runs.filter((x) => x.at >= from); return r.reduce((s, x) => s + x.read, 0) / r.length; };
console.log('rows read per run (both pulls together):');
console.log('   day   log rows   sheet rows │ old full pull   new incremental │ purged log: rows   old    new');
for (const c of checkpoints) console.log(`   ${String(c.day).padStart(3)}   ${String(c.log).padStart(8)}   ${String(c.sheet).padStart(10)} │ ${String(c.old).padStart(13)}   ${String(c.neu).padStart(15)} │ ${String(c.logP).padStart(16)} ${String(c.oldP).padStart(6)} ${String(c.neuP).padStart(6)}`);
const lastWeek = END - 7 * DAY;
console.log(`   last 7 days, mean per run: old ${per(target, lastWeek).toFixed(0)}, new ${per(fresh, lastWeek).toFixed(1)}; whole run: old ${target.runs.reduce((s, x) => s + x.read, 0)}, new ${fresh.runs.reduce((s, x) => s + x.read, 0)}`);
const newMax = Math.max(...fresh.runs.slice(1).map((x) => x.read));
console.log(`   new, after its first run: max ${newMax} rows in one run; first run ${fresh.runs[0].read} (a full pull of an almost empty log)`);
const urls = fresh.runs.at(-1).fetches.map((f) => f.url.replace(KEY, '…'));
console.log('   last new run fetched:'); urls.forEach((u) => console.log('      ' + u));
console.log();

/* ------------------------------------------------- further checks */

// Visitors cleared by hand: both refill it, the new one from All traffic
for (const g of [target, fresh]) g.sheets['Visitors'].clear();
for (const g of [target, fresh]) await g.call('sync');
report('5. Visitors tab emptied by hand, then one sync each — NEW refills it as OLD does', target, fresh, dropped(target, clean));
{ // Rows that differ there: the old code orders hits stamped in the same
  // millisecond by D1's row id, which neither the API nor the sheet carries.
  const A = target.sheets.Visitors.cells, B = fresh.sheets.Visitors.cells, ipCol = A[0].indexOf('IP');
  const groups = {}; events.forEach((e) => (groups[e.ts] ||= []).push(e));
  const runOf = (e) => Math.ceil((e.land - RUN_AT(0)) / HOUR);
  const tied = new Set(Object.values(groups).filter((g) => new Set(g.map((e) => e.ip)).size > 1 && new Set(g.map(runOf)).size > 1).flat().map((e) => e.ip));
  let differ = 0, explained = 0;
  for (let i = 1; i < A.length; i++) if (A[i].some((x, j) => norm(x) !== norm(B[i][j]))) { differ++; if (tied.has(A[i][ipCol]) || tied.has(B[i][ipCol])) explained++; }
  console.log(`   ${differ} refilled rows differ, ${explained} of them from visitors with a hit stamped in the same millisecond as another visitor's that landed in a different run`);
}
newP.sheets['Visitors'].clear(); await newP.call('sync');
const apiPeople = JSON.parse((await serve(purged, `https://alnimeri.com/api/visits?key=${KEY}&format=json&limit=20000&humans=1`)).body).length;
console.log(`   on the purged log, NEW refills ${newP.sheets['Visitors'].getLastRow() - 1} visits (its whole history); the API still holds ${apiPeople}`);

// rebuild(): wipes both logs and takes the whole log again
for (const g of [target, fresh]) await g.call('rebuild');
show('6. rebuild() on both, same log — identical', target, fresh);
console.log(`   NEW rebuild fetched: ${fresh.runs.at(-1).fetches.map((f) => (/since=/.test(f.url) ? 'since' : 'full') + ' ' + (/humans=1/.test(f.url) ? 'humans' : 'all')).join(', ')}`);

// setUp(): replaces the triggers, then a first sync of an empty sheet
{
  simNow += HOUR;
  const g = makeGas('new/setUp', NEW_SRC, clean);
  vm.runInContext('ScriptApp.newTrigger("sync").timeBased().everyHours(1).create(); ScriptApp.newTrigger("sync").timeBased().everyHours(1).create()', g.ctx);
  const run = await g.call('setUp');
  console.log(`7. setUp(): triggers now ${g.triggers.map((t) => t.h + '/' + t.every).join(', ')}; first sync took ${run.fetches.length} fetches (${run.fetches.map((f) => (/since=/.test(f.url) ? 'since' : 'full')).join(', ')}), wrote ${g.sheets['All traffic'].getLastRow() - 1} hits`);
  await g.call('sync');
  console.log(`   next sync: ${g.runs.at(-1).fetches.map((f) => (/since=/.test(f.url) ? 'since' : 'full')).join(', ')}, ${g.runs.at(-1).read} rows read`);
}

// paging when hits land between pages: nothing lost, nothing twice
for (const arrivals of [1, 3]) {
  const g = makeGas('new/pages', NEW_SRC, clean, { limit: 5 });
  let log = [], id = 0;
  const add = (ts) => log.push({ id: ++id, ts, ip: '1.1.1.' + id, path: '/', ua: 'x' });
  for (let i = 0; i < 40; i++) add(new Date(START + Math.floor(i / 3) * 1000).toISOString());  // threes share a stamp
  const before = log.map((r) => r.id);
  let fetched = 0;
  g.ctx.UrlFetchApp.fetch = (url) => {
    const q = new URL(url).searchParams, lim = +q.get('limit'), off = +(q.get('offset') || 0), since = q.get('since') || '';
    const page = log.filter((r) => r.ts > since).sort((a, b) => (a.ts < b.ts) - (a.ts > b.ts) || a.id - b.id).slice(off, off + lim);
    for (let n = 0; n < arrivals; n++) add(new Date(START + DAY + log.length * 1000).toISOString());   // hits land while it pages
    fetched++;
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(page) };
  };
  let result;
  try {
    const got = vm.runInContext('pull(false, "")', g.ctx).map((r) => r.id).sort((a, b) => a - b);
    result = JSON.stringify(got) === JSON.stringify(before) ? `exactly the ${before.length} rows that were there, once each` : 'WRONG ' + JSON.stringify(got);
  } catch (e) { result = 'stopped with "' + e.message + '"'; }
  console.log(`8. paging, LIMIT 5, 40 rows in threes sharing a stamp, ${arrivals} new hit(s) landing per page: ${fetched} pages, ${result}`);
}

// beyond the overlap: a hit that lands later than OVERLAP_HOURS is missed
{
  const d = new FakeD1('late'), o = makeGas('old/late', OLD_SRC, d), n = makeGas('new/late', NEW_SRC, d);
  const overlap = vm.runInContext('OVERLAP_HOURS', n.ctx);
  const base = START + 200 * DAY, home = HOMES[0];
  const row = (ms) => ({ ts: new Date(ms).toISOString(), ip: '5.5.5.5', country: home[0], region: home[1], city: home[2], asn: home[3], path: '/', referrer: null, ua: BROWSERS[0], is_bot: 0 });
  d.insert(row(base)); simNow = base + HOUR; await o.call('sync'); await n.call('sync');
  d.insert(row(base + 2 * HOUR)); simNow = base + 3 * HOUR; await o.call('sync'); await n.call('sync');
  for (const [late, label] of [[overlap - 1, 'inside'], [overlap + 1, 'outside']]) {
    d.insert(row(base + 2 * HOUR - late * HOUR));      // stamped `late` hours before the newest row, landing only now
    simNow += HOUR; await o.call('sync'); await n.call('sync');
    console.log(`9. a hit landing ${late} h late (${label} the ${overlap} h overlap): old sheet ${o.sheets['All traffic'].getLastRow() - 1} rows, new ${n.sheets['All traffic'].getLastRow() - 1}` +
      (same(o, n) ? ' — identical' : ' — the new sync never sees it'));
  }
}

/* ------------------------------------------- the switchover, and hand edits */

// The humans filter as it was before fa191a0 (30 Sep 2026): home, About and
// Privacy were the only pages. The live sheet holds rows the old code wrote
// then, typed Bot in All traffic though the old code, re-asking every hour,
// had since counted them as people and copied them into Visitors.
const VISITS_SRC = fs.readFileSync(path.join(REPO, 'functions/api/visits.js'), 'utf8');
const WIDE = " OR ((path LIKE '/work/%' OR path LIKE '/reel/%') AND path NOT LIKE '%.%')";
if (!VISITS_SRC.includes(WIDE) || !/const PAGES = \[[\s\S]*?'\/cv'[\s\S]*?\];/.test(VISITS_SRC)) throw new Error('visits.js changed: update the narrowed filter');
const { onRequestGet: beforeFa191a0 } = await import('data:text/javascript,' + encodeURIComponent(VISITS_SRC
  .replace(/const PAGES = \[[\s\S]*?\];/, "const PAGES = ['/', '/index.html', '/about', '/about.html', '/privacy', '/privacy.html'];")
  .replace(WIDE, '')));
const clone = (g, name, src) => {
  const n = makeGas(name, src, g.d1);
  for (const [k, sh] of Object.entries(g.sheets)) { const c = n.sheets[k] = new Sheet(k); c.cells = sh.cells.map((r) => r.slice()); c.maxR = sh.maxR; c.maxC = sh.maxC; c.text = new Set(sh.text); }
  return n;
};
{
  const FILTER_DAY = 24, INSTALL_DAY = 28, LAST_DAY = 36;
  const d = new FakeD1('switchover'), o = makeGas('old/switchover', OLD_SRC, d);
  let e = 0, asIs = null, installed = null, oldRebuilt = null, stale = 0;
  for (let k = 1; RUN_AT(k) <= START + LAST_DAY * DAY; k++) {
    simNow = RUN_AT(k);
    while (e < events.length && events[e].land <= simNow) d.insert(events[e++]);
    const h = simNow < START + FILTER_DAY * DAY ? beforeFa191a0 : onRequestGet;
    if (d.handler !== h) { d.handler = h; served.clear(); }
    if (!asIs && simNow >= START + INSTALL_DAY * DAY) {
      const T = o.sheets['All traffic'].cells.slice(1), H = o.sheets['All traffic'].cells[0], c = (n) => H.indexOf(n);
      const inV = new Set(o.sheets.Visitors.cells.slice(1).map((r) => [r[c('Timestamp (UTC)')], r[c('IP')], r[c('Page')]].join('|')));
      stale = T.filter((r) => r[c('Type')] === 'Bot' && inV.has([r[c('Timestamp (UTC)')], r[c('IP')], r[c('Page')]].join('|'))).length;
      asIs = clone(o, 'new/as-is', NEW_SRC); installed = clone(o, 'new/setUp+rebuild', NEW_SRC); oldRebuilt = clone(o, 'old/rebuilt', OLD_SRC);
      await installed.call('setUp'); await installed.call('rebuild'); await oldRebuilt.call('rebuild');
      continue;
    }
    for (const g of [o, asIs, installed, oldRebuilt]) if (g) await g.call('sync');
  }
  console.log(`\n10. the switchover: the old code ran with the narrower humans filter until day ${FILTER_DAY}, with today's after; the new one took over its sheet on day ${INSTALL_DAY}, when ${stale} All traffic rows typed Bot were people in Visitors; compared on day ${LAST_DAY}`);
  const lost = dropped(o, d);
  report('   old kept running vs new installed as-is (no rebuild)', o, asIs, lost);
  const total = (g) => g.sheets.Summary.cells.find((x) => x[0] === 'Total hits logged')[1];
  console.log(`   the old sheet lacks ${lost.length} hit${lost.length === 1 ? "" : "s"} its dedupe dropped (${lost.map((x) => x.ts + " " + x.path).join(", ")}); the old code still` +
    ` counts ${lost.length === 1 ? 'it' : 'them'} from D1, the new one counts the sheet: Summary Total ${total(o)} vs ${total(asIs)} until rebuild() writes ${lost.length === 1 ? 'it' : 'them'}`);
  report('   old rebuilt that day and kept running vs new installed with setUp() then rebuild()', oldRebuilt, installed, dropped(oldRebuilt, d));
}

// Hand edits: a cleared row, a note over a stamp, a run of failed syncs long
// enough for D1 to purge the sheet's newest rows, and a Summary longer than
// the tab's first 1000 rows.
{
  const T0 = START + 300 * DAY, home = HOMES[0];
  const row = (ms, ip, p) => ({ ts: new Date(ms).toISOString(), ip, country: home[0], region: home[1], city: home[2], asn: home[3], path: p, referrer: null, ua: BROWSERS[0], is_bot: 0 });
  const d = new FakeD1('edits'), n = makeGas('new/edits', NEW_SRC, d), o = makeGas('old/edits', OLD_SRC, d);
  for (let i = 0; i < 6; i++) d.insert(row(T0 + i * 40 * MIN, '7.7.7.' + i, '/'));
  simNow = T0 + 5 * HOUR; await n.call('sync'); await o.call('sync');
  const tsCol = n.sheets['All traffic'].cells[0].indexOf('Timestamp (UTC)');
  for (const g of [n, o]) {
    const sh = g.sheets['All traffic'];
    sh.cells[3] = sh.cells[3].map(() => '');                     // a row's contents cleared
    sh.cells[2][tsCol] = 'my phone';                              // a note over a stamp
  }
  d.insert(row(T0 + 6 * HOUR, '7.7.7.9', '/about'));
  simNow = T0 + 6 * HOUR + MIN; const r = await n.call('sync'); await o.call('sync');
  console.log(`11. a cleared row and a note over a stamp in All traffic: next run fetched ${r.fetches.map((f) => (/since=/.test(f.url) ? 'since' : 'FULL')).join(', ')}; the new hit ${n.sheets['All traffic'].cells.some((x) => x[tsCol] === new Date(T0 + 6 * HOUR).toISOString()) ? 'written' : 'NOT written'}; vs the old code on the same edits: ${same(o, n) ? 'identical, cell for cell' : 'DIFFERENT'}`);

  const d2 = new FakeD1('outage'), n2 = makeGas('new/outage', NEW_SRC, d2);
  for (let i = 0; i < 4; i++) d2.insert(row(T0 - 3 * HOUR + i * 50 * MIN, '5.5.5.5', '/'));
  simNow = T0 + MIN; await n2.call('sync');
  for (let k = 1; k <= 95; k += 5) d2.insert(row(T0 + k * DAY, '4.4.4.' + k, '/'));
  d2.purge(T0 + 95 * DAY);
  d2.insert(row(T0 + 95 * DAY, '5.5.5.5', '/about'));
  simNow = T0 + 95 * DAY + MIN; await n2.call('sync');
  const T2 = n2.sheets['All traffic'].cells, H2 = T2[0];
  const last = T2.find((x) => x[H2.indexOf('IP')] === '5.5.5.5');
  console.log(`12. sync failing for 95 days while D1 purged ${d2.purged} rows, the sheet's newest among them: All traffic ${T2.length - 1} rows, Summary Total ${n2.sheets.Summary.cells.find((x) => x[0] === 'Total hits logged')[1]}; 5.5.5.5's next hit is Visit # ${last[H2.indexOf('Visit #')]} (${last[H2.indexOf('Visitor')]})`);

  const d3 = new FakeD1('long'), n3 = makeGas('new/long', NEW_SRC, d3);
  for (let k = 0; k < 1100; k++) d3.insert(row(T0 + k * DAY, '6.6.6.' + (k % 50), '/'));
  simNow = T0 + 1100 * DAY; let err = '';
  try { await n3.call('sync'); } catch (x) { err = x.message; }
  console.log(`13. 1100 days of history: ${err ? 'summary() THREW ' + err : 'Summary written, ' + n3.sheets.Summary.getLastRow() + ' rows on a tab first made with 1000'}`);
}
