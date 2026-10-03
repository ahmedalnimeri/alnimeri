// Runs Sync.gs against an in-memory fake of the Apps Script services: syncBriefs(),
// then sync() (visits, the 90-day prune, the Events tab and its funnel line).
import fs from 'node:fs'; import vm from 'node:vm';
const code = fs.readFileSync(process.argv[2], 'utf8');
let briefs = [
  { id: 1, ts: '2026-09-29 16:32:48', name: 'Test One', company: 'Acme', about: 'a brand or campaign film', for_what: 'a launch', timing: 'June', email: 'one@example.com', whatsapp: '+971 50 111 1111', film_seen: '', message: 'Hi Ahmed…', country: 'AE' },
  { id: 2, ts: '2026-09-29 16:35:27', name: 'Test Two', company: '', about: 'a documentary', for_what: '', timing: '', email: '', whatsapp: '+971501234567', film_seen: 'Al Doroub', message: '=SUM(1,1) not a formula', country: 'AE' },
];
const props = {}; const mails = [];
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
let visits = [
  { ts: ago(1), ip: '1.1.1.1', country: 'AE', city: 'Dubai', region: '', asn: 'Etisalat', path: '/', referrer: '', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', is_bot: 0 },
  { ts: ago(40), ip: '1.1.1.1', country: 'AE', city: 'Dubai', region: '', asn: 'Etisalat', path: '/work/al-doroub', referrer: '', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', is_bot: 0 },
  { ts: ago(95), ip: '2.2.2.2', country: 'GB', city: 'London', region: '', asn: 'BT', path: '/', referrer: '', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120', is_bot: 0 },
  { ts: ago(2), ip: '3.3.3.3', country: 'US', city: '', region: '', asn: 'Amazon', path: '/wp-admin', referrer: '', ua: 'evilbot', is_bot: 1 },
];
let events = [
  { id: 1, ts: ago(100), t: 'play', film: 'al-doroub', title: 'Al Doroub', path: '/work/al-doroub', via: 'page', country: 'AE' },
  { id: 2, ts: ago(3), t: 'play', film: 'al-doroub', title: 'Al Doroub', path: '/work/al-doroub', via: 'page', country: 'AE' },
  { id: 3, ts: ago(3), t: 'brief_open', film: 'al-doroub', title: 'Al Doroub', path: '/work/al-doroub', via: '', country: 'AE' },
  { id: 4, ts: ago(3), t: 'brief_sent', film: 'al-doroub', title: 'Al Doroub', path: '/work/al-doroub', via: 'ig', country: 'AE' },
  { id: 5, ts: ago(45), t: 'play', film: 'sia-x-solana', title: 'Sia x Solana', path: '/', via: 'lightbox', country: 'SA' },
];
class Range { constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValue() { return (this.sh.cells[this.r - 1] || [])[this.c - 1] ?? ''; }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push((this.sh.cells[this.r - 1 + i] || [])[this.c - 1 + j] ?? ''); o.push(row); } return o; }
  setValues(v) { v.forEach((row, i) => { this.sh.cells[this.r - 1 + i] = this.sh.cells[this.r - 1 + i] || []; row.forEach((x, j) => this.sh.cells[this.r - 1 + i][this.c - 1 + j] = x); }); return this; }
  sort({ column, ascending }) { const rows = this.sh.cells.slice(this.r - 1, this.r - 1 + this.nr); rows.sort((a, b) => (ascending ? 1 : -1) * ((a[column - 1] > b[column - 1]) - (a[column - 1] < b[column - 1]))); this.sh.cells.splice(this.r - 1, this.nr, ...rows); return this; }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; } setWrap() { return this; } setFontWeight() { return this; } }
class Sheet { constructor(name) { this.name = name; this.cells = []; this.maxR = 1000; this.maxC = 26; }
  getLastRow() { return this.cells.filter(r => r && r.some(x => x !== '' && x !== undefined)).length; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getMaxRows() { return this.maxR; } getMaxColumns() { return this.maxC; }
  insertRowsAfter(a, n) { this.maxR += n; } insertColumnsAfter(a, n) { this.maxC += n; }
  clear() { this.cells = []; } setFrozenRows() {} getSheetId() { return 42; } autoResizeColumns() {}
  deleteRows(r, n) { this.cells.splice(r - 1, n); } }
const sheets = {};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getUrl: () => 'https://docs.google.com/spreadsheets/d/X/edit', toast() {} };
const ctx = {
  console, JSON, Date, Number, String, Object, Array, Math,
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
  UrlFetchApp: { fetch: url => ({ getResponseCode: () => (url.includes('key=good') ? 200 : 404),
    getContentText: () => JSON.stringify(url.includes('/api/visits') ? visits.filter(v => !url.includes('humans=1') || !/bot/i.test(v.ua))
      : url.includes('/api/e') ? { ok: true, events: events.slice().reverse() } : { ok: true, briefs: briefs.slice().reverse() }) }) },
  SpreadsheetApp: { getActive: () => ss },
  Utilities: { formatDate: (d, tz, f) => new Date(d.getTime() + 4 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') },
  MailApp: { sendEmail: (to, subj, body, opts) => mails.push({ to, subj, body, opts }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
};
vm.createContext(ctx); vm.runInContext(code, ctx);
const run = () => vm.runInContext('syncBriefs()', ctx);
try { run(); console.log('no key   → ERROR expected but ran'); } catch (e) { console.log('no key   →', e.message.slice(0, 70)); }
props.VISITS_TOKEN = 'bad'; try { run(); } catch (e) { console.log('bad key  →', e.message.slice(0, 60)); }
props.VISITS_TOKEN = 'good';
console.log('first    → added', run(), '| emailed', mails.length, '| marker', props.BRIEFS_EMAILED_UP_TO);
console.log('again    → added', run(), '| emailed', mails.length);
briefs.push({ id: 3, ts: '2026-10-03 05:10:00', name: 'Real Client', company: 'Bank X', about: 'an event or conference film', for_what: 'our summit', timing: 'November', email: 'client@bankx.example', whatsapp: '', film_seen: 'Solana Accelerate', message: 'Hi Ahmed, I’m Real Client from Bank X…', country: 'SA' });
console.log('new one  → added', run(), '| emailed', mails.length, '| marker', props.BRIEFS_EMAILED_UP_TO);
const sh = sheets.Briefs; console.log('rows (newest first):'); sh.cells.forEach(r => console.log('  ', r.join(' | ').slice(0, 150)));
console.log('mail:', JSON.stringify(mails[0], null, 1));

// ---- sync(): the visit tabs keep ninety days, and the Events tab --------------
// a row the sheet already holds from before the prune existed, 120 days old
const VH = vm.runInContext('HEAD', ctx);
const oldRow = VH.map(() => ''); oldRow[0] = 'old'; oldRow[VH.indexOf('IP')] = '9.9.9.9'; oldRow[VH.indexOf('Page')] = '/';
oldRow[VH.indexOf('Timestamp (UTC)')] = ago(120);
const vs = ss.insertSheet('Visitors'); vs.cells = [VH.slice(), oldRow];
const sync = () => vm.runInContext('sync()', ctx);
sync();
const tsAt = VH.indexOf('Timestamp (UTC)');
const ages = (n) => sheets[n].cells.slice(1).map(r => Math.round((Date.now() - new Date(r[tsAt])) / 864e5));
console.log('visitors → ages (days):', ages('Visitors').join(', '), '| ips:', sheets.Visitors.cells.slice(1).map(r => r[VH.indexOf('IP')]).join(', '));
console.log('all hits → ages (days):', ages('All traffic').join(', '));
const ev = sheets.Events;
console.log('events   → funnel:', ev.cells[0][0]);
console.log('           header:', ev.cells[1].join(' | '));
ev.cells.slice(2).forEach(r => console.log('          ', r.join(' | ')));
events.push({ id: 6, ts: ago(0), t: 'cv_pdf', film: null, title: '', path: '/cv', via: '', country: 'DE' });
sync();
console.log('again    → events rows', ev.cells.length - 2, '(ids', ev.cells.slice(2).map(r => r[8]).join(','), ') | visitors rows', sheets.Visitors.cells.length - 1);

