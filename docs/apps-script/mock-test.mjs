// Runs Sync.gs syncBriefs() against an in-memory fake of the Apps Script services.
import fs from 'node:fs'; import vm from 'node:vm';
const code = fs.readFileSync(process.argv[2], 'utf8');
let briefs = [
  { id: 1, ts: '2026-09-29 16:32:48', name: 'Test One', company: 'Acme', about: 'a brand or campaign film', for_what: 'a launch', timing: 'June', email: 'one@example.com', whatsapp: '+971 50 111 1111', film_seen: '', message: 'Hi Ahmed…', country: 'AE' },
  { id: 2, ts: '2026-09-29 16:35:27', name: 'Test Two', company: '', about: 'a documentary', for_what: '', timing: '', email: '', whatsapp: '+971501234567', film_seen: 'Al Doroub', message: '=SUM(1,1) not a formula', country: 'AE' },
];
const props = {}; const mails = [];
class Range { constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValue() { return (this.sh.cells[this.r - 1] || [])[this.c - 1] ?? ''; }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push((this.sh.cells[this.r - 1 + i] || [])[this.c - 1 + j] ?? ''); o.push(row); } return o; }
  setValues(v) { v.forEach((row, i) => { this.sh.cells[this.r - 1 + i] = this.sh.cells[this.r - 1 + i] || []; row.forEach((x, j) => this.sh.cells[this.r - 1 + i][this.c - 1 + j] = x); }); return this; }
  sort({ column, ascending }) { const rows = this.sh.cells.slice(this.r - 1, this.r - 1 + this.nr); rows.sort((a, b) => (ascending ? 1 : -1) * ((a[column - 1] > b[column - 1]) - (a[column - 1] < b[column - 1]))); this.sh.cells.splice(this.r - 1, this.nr, ...rows); return this; }
  setNumberFormat() { return this; } setWrap() { return this; } setFontWeight() { return this; } }
class Sheet { constructor(name) { this.name = name; this.cells = []; this.maxR = 1000; this.maxC = 26; }
  getLastRow() { return this.cells.filter(r => r && r.some(x => x !== '' && x !== undefined)).length; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getMaxRows() { return this.maxR; } getMaxColumns() { return this.maxC; }
  insertRowsAfter(a, n) { this.maxR += n; } insertColumnsAfter(a, n) { this.maxC += n; }
  clear() { this.cells = []; } setFrozenRows() {} getSheetId() { return 42; } }
const sheets = {};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getUrl: () => 'https://docs.google.com/spreadsheets/d/X/edit', toast() {} };
const ctx = {
  console, JSON, Date, Number, String, Object, Array, Math,
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
  UrlFetchApp: { fetch: url => ({ getResponseCode: () => (url.includes('key=good') ? 200 : 404), getContentText: () => JSON.stringify({ ok: true, briefs: briefs.slice().reverse() }) }) },
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
