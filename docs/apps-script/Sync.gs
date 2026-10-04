/**
 * alnimeri.com — visitor log sync
 *
 * Pulls the Cloudflare D1 visit log and keeps four sheets current:
 *   Visitors    — people only, one row per visit, enriched
 *   All traffic — every hit including bots and scanners
 *   Summary     — recomputed totals and breakdowns
 *   Briefs      — every brief sent through the site's "Get in touch" form,
 *                 newest first; each new one is also emailed to the owner
 *
 * The site key is NOT in this file: add it once as a Script property named
 * VISITS_TOKEN (Project Settings → Script properties). The same key opens
 * /api/visits and /api/brief.
 *
 * Rows already in the sheet are never re-written or duplicated: each run
 * appends only what it has not seen, so the history outlives whatever the
 * API is still holding.
 *
 * Each run asks the API only for what was logged since the sheet's newest
 * row (less a few hours of overlap), not for the whole log: every row read
 * counts against D1's daily allowance. Visit numbers, sessions and the
 * Summary are counted over the sheet's own history, which reaches back past
 * the 90 days the API keeps.
 *
 * So All traffic is the record. A row deleted from it by hand stays deleted
 * and drops out of the counts, and later visit and session numbers are
 * counted without it; to hide rows, use a filter view. A row deleted from
 * Visitors alone comes back, since Visitors is refilled from All traffic.
 * Each row keeps the Type it was written with: after a change to what the
 * API counts as a person (the humans filter in functions/api/visits.js), run
 * rebuild() while the API still holds the rows that matter.
 *
 * Run setUp() once. It installs the triggers (visits hourly, briefs every
 * ten minutes) and does a first sync. Existing briefs are written to the
 * sheet but not emailed; only briefs that arrive afterwards are.
 */

var API   = 'https://alnimeri.com/api/visits';
var TZ    = 'Asia/Dubai';
var LIMIT = 20000;
// A hit is stamped when the request starts and lands in the log a moment
// later, so one stamped earlier can arrive after one stamped later. Each run
// reads this far back past the sheet's newest row; rows it has already got
// are recognised and skipped, never added or counted twice.
var OVERLAP_HOURS = 6;
// A stamp as the log writes it. Anything else in that column, a cleared cell
// or a note typed over it, is left out of the counts rather than trusted.
var STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
var LOG_START = Date.parse('2026-01-01T00:00:00Z');   // the site's log began in Aug 2026
var BRIEFS_API = 'https://alnimeri.com/api/brief';

/** The site key, kept in Script properties rather than in the code. */
function siteKey() {
  var k = PropertiesService.getScriptProperties().getProperty('VISITS_TOKEN');
  if (!k) throw new Error('Add the site key as a Script property named VISITS_TOKEN ' +
                          '(Project Settings → Script properties).');
  return k.trim();
}

var HEAD = ['Date', 'Time', 'Day', 'Hour', 'Type', 'Visitor', 'Visit #', 'Session', 'IP',
            'Country', 'Code', 'Flag', 'Continent', 'City', 'Region',
            'Page', 'Page name', 'Section', 'Source', 'Came from', 'Referrer',
            'Device', 'OS', 'Browser', 'Network', 'Network type',
            'Timestamp (UTC)', 'User agent'];

/* ---------------------------------------------------------------- lookups */

var COUNTRY = {
  AE:['United Arab Emirates','Asia'], AO:['Angola','Africa'], AT:['Austria','Europe'],
  AU:['Australia','Oceania'], AZ:['Azerbaijan','Asia'], BD:['Bangladesh','Asia'],
  BE:['Belgium','Europe'], BR:['Brazil','South America'], CA:['Canada','North America'],
  CH:['Switzerland','Europe'], CN:['China','Asia'], CZ:['Czechia','Europe'],
  DE:['Germany','Europe'], DK:['Denmark','Europe'], EG:['Egypt','Africa'],
  ES:['Spain','Europe'], ET:['Ethiopia','Africa'], FI:['Finland','Europe'],
  FR:['France','Europe'], GB:['United Kingdom','Europe'], GR:['Greece','Europe'],
  HK:['Hong Kong','Asia'], ID:['Indonesia','Asia'], IE:['Ireland','Europe'],
  IL:['Israel','Asia'], IN:['India','Asia'], IQ:['Iraq','Asia'], IT:['Italy','Europe'],
  JO:['Jordan','Asia'], JP:['Japan','Asia'], KE:['Kenya','Africa'], KH:['Cambodia','Asia'],
  KR:['South Korea','Asia'], KW:['Kuwait','Asia'], LB:['Lebanon','Asia'],
  LT:['Lithuania','Europe'], LU:['Luxembourg','Europe'], MA:['Morocco','Africa'],
  MX:['Mexico','North America'], MY:['Malaysia','Asia'], NG:['Nigeria','Africa'],
  NL:['Netherlands','Europe'], NO:['Norway','Europe'], NZ:['New Zealand','Oceania'],
  OM:['Oman','Asia'], PH:['Philippines','Asia'], PK:['Pakistan','Asia'],
  PL:['Poland','Europe'], PT:['Portugal','Europe'], QA:['Qatar','Asia'],
  RO:['Romania','Europe'], RS:['Serbia','Europe'], RU:['Russia','Europe'],
  SA:['Saudi Arabia','Asia'], SD:['Sudan','Africa'], SE:['Sweden','Europe'],
  SG:['Singapore','Asia'], SI:['Slovenia','Europe'], TH:['Thailand','Asia'],
  TN:['Tunisia','Africa'], TR:['Türkiye','Asia'], TW:['Taiwan','Asia'],
  UA:['Ukraine','Europe'], UG:['Uganda','Africa'], US:['United States','North America'],
  UY:['Uruguay','South America'], VN:['Vietnam','Asia'], ZA:['South Africa','Africa']
};

var FILMS = {
  '/work/60-secs-of-new-york':'60 Secs of New York', '/work/al-doroub':'Al Doroub',
  '/work/assets-api':'Assets API', '/work/crypto-in-the-uae':'Crypto in the UAE',
  '/work/el-fasher-city':'El Fasher City', '/work/press-generate':'Press “Generate”',
  '/work/sgb-solana-accelerate-hk':'SGB — Solana Accelerate HK',
  '/work/sia-x-solana':'Sia x Solana', '/work/solana-accelerate':'Solana Accelerate',
  '/work/solana-developer-platform':'Solana Developer Platform',
  '/work/solana-skyline':'Solana Skyline', '/work/solana-solstice':'Solana Solstice',
  '/work/solana-x-all-in':'Solana x All In', '/work/sugar-vs-jaggery':'Sugar vs Jaggery',
  '/work/the-greatest-sudanese-sit-in':'The Greatest Sudanese Sit-In',
  '/work/token-supercycle':'Token Supercycle',
  '/work/why-is-his-pinky-purple':'Why Is His Pinky Purple?'
};

/* ------------------------------------------------------------- enrichment */

/** Date, time, weekday and hour in Dubai, from one formatDate call. */
function local(t) {
  var p = Utilities.formatDate(t, TZ, 'yyyy-MM-dd|HH:mm|EEEE|H').split('|');
  return [p[0], p[1], p[2], Number(p[3])];
}

function flag(cc) {
  if (!cc || cc.length !== 2) return '';
  return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65,
                              0x1F1E6 + cc.charCodeAt(1) - 65);
}

function pageName(p) {
  if (!p) return '';
  if (FILMS[p]) return FILMS[p];
  if (p === '/') return 'Home';
  if (p === '/about') return 'About & CV';
  if (p === '/privacy') return 'Privacy';
  if (p === '/work/' || p === '/work') return 'All films';
  if (p === '/selects.edl') return 'EDL export';
  return '';
}

function section(p) {
  if (!p) return '';
  if (p === '/') return 'Home';
  if (p.indexOf('/about') === 0) return 'About';
  if (FILMS[p]) return 'Film page';
  if (p.indexOf('/work') === 0) return 'Work';
  if (p.indexOf('/privacy') === 0) return 'Privacy';
  if (p.indexOf('/api/') === 0) return 'API';
  if (p.indexOf('/assets/') === 0) return 'Asset';
  // wp-admin, .env, .git and friends: nothing here has ever existed
  if (/wp-|xmlrpc|wordpress|\.env|\.git|phpmyadmin|\.php|admin|shell|config/i.test(p))
    return 'Probe (nothing here)';
  return 'Other';
}

function host(u) {
  if (!u) return '';
  var m = String(u).match(/^https?:\/\/([^\/:?#]+)/i);
  return m ? m[1].replace(/^www\./, '') : '';
}

function source(ref) {
  var h = host(ref);
  if (!h) return 'Direct / typed in';
  if (/alnimeri\.com$/i.test(h)) return 'Within the site';
  if (/instagram|l\.instagram/i.test(h)) return 'Instagram';
  if (/^(t\.co|x\.com|twitter\.com)$/i.test(h)) return 'X / Twitter';
  if (/linkedin|lnkd\.in/i.test(h)) return 'LinkedIn';
  if (/google\./i.test(h)) return 'Google';
  if (/bing\./i.test(h)) return 'Bing';
  if (/duckduckgo/i.test(h)) return 'DuckDuckGo';
  if (/baidu/i.test(h)) return 'Baidu';
  if (/chatgpt|openai/i.test(h)) return 'ChatGPT';
  if (/claude\.ai|anthropic/i.test(h)) return 'Claude';
  if (/perplexity/i.test(h)) return 'Perplexity';
  if (/vimeo/i.test(h)) return 'Vimeo';
  if (/facebook|fb\./i.test(h)) return 'Facebook';
  if (/youtube|youtu\.be/i.test(h)) return 'YouTube';
  if (/whatsapp/i.test(h)) return 'WhatsApp';
  if (/t\.me|telegram/i.test(h)) return 'Telegram';
  if (/mail\.|outlook|gmail/i.test(h)) return 'Email';
  return 'Other site';
}

function ua(s) {
  s = s || '';
  var os = '', br = '', dev = '';
  var m;
  if (/iPhone/.test(s))        { os = 'iOS';     dev = 'Phone'; }
  else if (/iPad/.test(s))     { os = 'iPadOS';  dev = 'Tablet'; }
  else if (/Android/.test(s))  { os = 'Android'; dev = /Mobile/.test(s) ? 'Phone' : 'Tablet'; }
  else if (/Mac OS X|Macintosh/.test(s)) { os = 'macOS';   dev = 'Desktop'; }
  else if (/Windows/.test(s))  { os = 'Windows'; dev = 'Desktop'; }
  else if (/CrOS/.test(s))     { os = 'ChromeOS';dev = 'Desktop'; }
  else if (/Linux/.test(s))    { os = 'Linux';   dev = 'Desktop'; }

  if ((m = s.match(/OS (\d+[_\.]\d+)/)) && /iPhone|iPad/.test(s)) os += ' ' + m[1].replace('_', '.');
  else if ((m = s.match(/Mac OS X (\d+[_\.]\d+)/))) os += ' ' + m[1].replace('_', '.');
  else if ((m = s.match(/Android (\d+)/))) os += ' ' + m[1];

  if (/Edg\//.test(s))                        br = 'Edge';
  else if (/OPR\/|Opera/.test(s))             br = 'Opera';
  else if (/Chrome\//.test(s))                br = 'Chrome';
  else if (/Firefox\//.test(s))               br = 'Firefox';
  else if (/Safari\//.test(s))                br = 'Safari';
  if (br && (m = s.match(new RegExp(
      (br === 'Edge' ? 'Edg' : br === 'Opera' ? 'OPR' : br) + '\\/(\\d+)')))) br += ' ' + m[1];
  if (!br && (m = s.match(/Version\/(\d+)/)) && /Safari/.test(s)) br = 'Safari ' + m[1];

  if (!dev) {
    if (/bot|crawl|spider|slurp|scan/i.test(s)) dev = 'Crawler';
    else if (/curl|wget|python|go-http|okhttp|java|libwww|httpx/i.test(s)) dev = 'Script';
    else if (/Headless/i.test(s)) dev = 'Headless browser';
    else dev = s ? 'Unknown' : 'No user agent';
  }
  if (!br && /bot|crawl|spider/i.test(s)) {
    m = s.match(/([A-Za-z][A-Za-z0-9\-]*bot)/i); if (m) br = m[1];
  }
  return { device: dev, os: os, browser: br };
}

function networkType(asn) {
  var a = asn || '';
  if (!a) return '';
  if (/amazon|aws|google (llc|cloud)|microsoft|azure|digitalocean|linode|hetzner|ovh|contabo|vultr|oracle|alibaba|tencent|cloudflare|datacenter|data center|hosting|host|server|vps|colo|cloud/i.test(a))
    return 'Datacenter / cloud';
  if (/mobile|cellular|wireless|gsm|lte|telecom.*mobile|vodafone|etisalat|du |zain|orange|mtn|airtel|jio|t-mobile/i.test(a))
    return 'Mobile network';
  if (/university|college|school|institute|gov|ministry/i.test(a))
    return 'Institution';
  if (/telecom|communications|broadband|isp|cable|fiber|fibre|internet|net\b/i.test(a))
    return 'Home / office ISP';
  return 'Other';
}

/** The columns from IP on, worked out from one logged hit. */
function describe(r) {
  var cc = (r.country || '').toUpperCase();
  var c  = COUNTRY[cc] || [cc, ''];
  var u  = ua(r.ua);
  return [
    r.ip || '',
    c[0], cc, flag(cc), c[1],
    r.city || '', r.region || '',
    r.path || '', pageName(r.path), section(r.path),
    source(r.referrer), host(r.referrer), r.referrer || '',
    u.device, u.os, u.browser,
    r.asn || '', networkType(r.asn),
    r.ts, r.ua || ''
  ];
}

/* ------------------------------------------------------------------ fetch */

/**
 * The visit log, newest first: all of it, or with `since` only the rows
 * logged after that stamp. More than LIMIT rows come in pages.
 */
function pull(humansOnly, since) {
  var url = API + '?key=' + encodeURIComponent(siteKey()) + '&format=json&limit=' + LIMIT +
            (humansOnly ? '&humans=1' : '') + (since ? '&since=' + encodeURIComponent(since) : '');
  var out = [], offset = 0, edge = null;
  for (;;) {
    var res = UrlFetchApp.fetch(url + (offset ? '&offset=' + offset : ''), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200)
      throw new Error('Visit log returned ' + res.getResponseCode() + ' — is the key still valid?');
    var page = JSON.parse(res.getContentText());
    // Everything newer than the edge came in the page before. A hit logged
    // in between pushes those rows down into this page; they are dropped.
    var rows = edge === null ? page : page.filter(function (r) { return r.ts <= edge; });
    if (page.length < LIMIT) return out.concat(rows);
    // A full page: keep what is newer than its oldest stamp, and start the
    // next page at that stamp, so rows sharing it are never split in two.
    var low = page[page.length - 1].ts, newer = 0;
    while (page[newer].ts > low) newer++;
    var taken = rows.filter(function (r) { return r.ts > low; });
    if (!taken.length) throw new Error('The visit log could not be paged past ' + low + '; run it again');
    out = out.concat(taken);
    offset += newer;
    edge = low;
  }
}

/* ------------------------------------------------------------------- sync */

function sync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;            // a run is already in flight
  try {
    // The sheet is the history: All traffic holds every hit it was ever
    // given, people and bots, while the API keeps 90 days. So the API is
    // asked only for what came after the sheet's newest row, less the
    // overlap, and everything up to that cutoff is replayed from the sheet.
    // An empty sheet (the first run, or after rebuild) takes the whole log.
    var traffic = stored('All traffic'), visitors = stored('Visitors');
    var col = function (name) { return HEAD.indexOf(name); };
    var TS = col('Timestamp (UTC)'), IP = col('IP'), TYPE = col('Type'), PAGE = col('Page'),
        UA = col('User agent'), CODE = col('Code'), CITY = col('City'), REGION = col('Region'),
        NET = col('Network'), REF = col('Referrer');
    var key = function (x) { return String(x[TS]) + '|' + x[IP] + '|' + x[PAGE]; };
    // A stamp typed by hand with a wrong year would become the newest row and
    // push since into the future, and nothing new would ever arrive: only
    // stamps between the start of the log and tomorrow count.
    var latest = Date.now() + 86400000;
    var kept = traffic.filter(function (x) {
      var t = Date.parse(String(x[TS]));
      return STAMP.test(String(x[TS])) && isFinite(t) && t >= LOG_START && t <= latest;
    });
    var newest = '';
    kept.forEach(function (x) { if (String(x[TS]) > newest) newest = String(x[TS]); });
    var since = newest ?
      new Date(Date.parse(newest) - OVERLAP_HOURS * 3600000).toISOString() : '';

    var all = pull(false, since), humans = pull(true, since);

    var isHuman = {};
    humans.forEach(function (r) {
      var k = r.ts + '|' + r.ip + '|' + r.path + '|' + r.ua;
      isHuman[k] = (isHuman[k] || 0) + 1;
    });

    // oldest first, so "visit #" and sessions count forward in time
    all.sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });

    // The sheet's rows up to the cutoff are counted from the sheet. Rows
    // after it are counted from the API's copy, which may hold one that
    // landed late; but a row the API no longer has is counted from the sheet
    // (the API drops rows at 90 days, so after an outage that long the
    // sheet's newest rows are gone from it).
    var fromApi = {};
    all.forEach(function (r) {
      var k = r.ts + '|' + (r.ip || '') + '|' + (r.path || '');
      fromApi[k] = (fromApi[k] || 0) + 1;
    });
    var past = kept.filter(function (x) {
      var k = key(x);
      if (String(x[TS]) <= since || !fromApi[k]) return true;
      fromApi[k]--;
      return false;
    });

    // A row keeps the Type the API gave it when it was written. Views of the
    // film pages, the CV and reels only began to count as people on 30 Sep
    // 2026, so earlier ones sit in All traffic as Bot, while the old full
    // pull, asking again every hour, had copied them into Visitors. A row
    // stored as Bot that Visitors holds counts as a person. rebuild() writes
    // the column afresh.
    var vkey = function (x) { return key(x) + '|' + x[UA]; };
    var listed = {};
    visitors.forEach(function (x) { listed[vkey(x)] = (listed[vkey(x)] || 0) + 1; });
    past.forEach(function (x) { if (x[TYPE] === 'Person' && listed[vkey(x)]) listed[vkey(x)]--; });

    // Every hit, oldest first, as [hit, person?]. The sheet's are worked out
    // again from what was logged, as the API's are, so the Summary follows
    // the current page names and sources across the whole history. Rows that
    // share a stamp and were written in one run are listed newest-logged
    // first; reversed, they replay in the order they were logged.
    var hits = past.reverse().map(function (x) {
      var person = x[TYPE] === 'Person';
      if (!person && listed[vkey(x)]) { listed[vkey(x)]--; person = true; }
      return [{
        ts: String(x[TS]), ip: x[IP], country: String(x[CODE]), city: x[CITY],
        region: x[REGION], asn: x[NET], path: String(x[PAGE]),
        referrer: String(x[REF]), ua: String(x[UA])
      }, person];
    });
    var used = {};
    all.forEach(function (r) {
      var k = r.ts + '|' + r.ip + '|' + r.path + '|' + r.ua;
      used[k] = (used[k] || 0) + 1;
      hits.push([r, used[k] <= (isHuman[k] || 0)]);
    });
    hits.sort(function (a, b) { return a[0].ts < b[0].ts ? -1 : a[0].ts > b[0].ts ? 1 : 0; });

    var seenIp = {}, lastSeen = {}, sessionOf = {}, sessions = 0, minutes = {};

    // Visitor, Visit # and Session for one hit. Counted per IP *and* per
    // type: a person's visit number should not be inflated by the thousands
    // of scanner hits sharing their address.
    var count = function (t, ip, human) {
      var who = ip + '|' + (human ? 'p' : 'b');
      seenIp[who] = (seenIp[who] || 0) + 1;
      var gap = lastSeen[who] ? (t - lastSeen[who]) / 60000 : Infinity;
      if (gap > 30) { sessions += 1; sessionOf[who] = sessions; }
      lastSeen[who] = t;
      return [seenIp[who] === 1 ? 'New' : 'Returning', seenIp[who], 'S' + sessionOf[who]];
    };

    var rows = hits.map(function (h) {
      var r = h[0], t = new Date(r.ts), m = r.ts.slice(0, 16);
      // Dubai date, time, day and hour: worked out once a minute, not per hit
      var when = minutes[m] || (minutes[m] = local(t));
      return when.concat(h[1] ? 'Person' : 'Bot', count(t, r.ip || '', h[1]), describe(r));
    });

    rows.reverse();                            // newest first for reading
    var people = rows.filter(function (x) { return x[4] === 'Person'; });

    write('Visitors', people, visitors);
    write('All traffic', rows, traffic);
    summary(rows, people);

    SpreadsheetApp.getActive().toast(
      people.length + ' visits, ' + rows.length + ' hits', 'Visitor log synced', 5);
  } finally {
    // Commit the writes before the next run can take the lock, so it never
    // reads the sheet as it was before this one and appends the same rows.
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

/* ----------------------------------------------------------------- briefs */

var BRIEF_HEAD = ['Received (Dubai)', 'Name', 'Company', 'About', 'For', 'Timing',
                  'Email', 'WhatsApp', 'Came from', 'Message', 'Country', 'Brief #'];

/**
 * Copies new briefs from the site's inbox into the Briefs sheet (newest
 * first) and emails each one that arrived since the last email, with
 * Reply-To set to the sender so a reply goes straight back to them.
 */
function syncBriefs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 0;
  try {
    var res = UrlFetchApp.fetch(BRIEFS_API + '?key=' + encodeURIComponent(siteKey()) + '&format=json',
                                { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200)
      throw new Error('Brief inbox returned ' + res.getResponseCode() + ' — is the key still valid?');
    var briefs = (JSON.parse(res.getContentText()).briefs || [])
      .sort(function (a, b) { return a.id - b.id; });

    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName('Briefs') || ss.insertSheet('Briefs', 1);
    var n = BRIEF_HEAD.length, idCol = n;
    grow(sh, 2, n);
    if (sh.getLastRow() === 0 || sh.getRange(1, 1).getValue() !== BRIEF_HEAD[0]) {
      sh.clear();
      sh.getRange(1, 1, sh.getMaxRows(), n - 1).setNumberFormat('@');   // phone numbers and "=" stay text
      sh.getRange(1, 1, 1, n).setValues([BRIEF_HEAD]);
    }
    var have = {};
    if (sh.getLastRow() > 1)
      sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getValues()
        .forEach(function (r) { have[String(r[0])] = 1; });

    var fresh = briefs.filter(function (b) { return !have[String(b.id)]; });
    if (fresh.length) {
      var rows = fresh.map(function (b) {
        var t = new Date(String(b.ts).replace(' ', 'T') + 'Z');     // D1 stores UTC
        var cc = String(b.country || '').toUpperCase();
        return [Utilities.formatDate(t, TZ, 'yyyy-MM-dd HH:mm'), b.name || '', b.company || '',
                b.about || '', b.for_what || '', b.timing || '', b.email || '', b.whatsapp || '',
                b.film_seen || '', b.message || '', (COUNTRY[cc] || [cc])[0], b.id];
      });
      grow(sh, sh.getLastRow() + rows.length, n);
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, n - 1).setNumberFormat('@');
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, n).setValues(rows);
      sh.getRange(2, 1, sh.getLastRow() - 1, n).sort({ column: idCol, ascending: false });
      sh.getRange(2, 10, sh.getLastRow() - 1, 1).setWrap(true);
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, n).setFontWeight('bold');

    // Email only what is new since the last email. The first run marks the
    // backlog as already seen, so turning this on does not flood the inbox.
    var props = PropertiesService.getScriptProperties();
    var last = props.getProperty('BRIEFS_EMAILED_UP_TO');
    var top = briefs.length ? briefs[briefs.length - 1].id : 0;
    if (last === null) { props.setProperty('BRIEFS_EMAILED_UP_TO', String(top)); return fresh.length; }
    briefs.filter(function (b) { return b.id > Number(last); })
      .forEach(function (b) { mailBrief(b, ss); });
    if (top > Number(last)) props.setProperty('BRIEFS_EMAILED_UP_TO', String(top));
    return fresh.length;
  } finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

/** One plain email per brief, to the account that owns this sheet. */
function mailBrief(b, ss) {
  var who = b.name + (b.company ? ', ' + b.company : '');
  var reach = [b.email, b.whatsapp ? 'WhatsApp ' + b.whatsapp : ''].filter(String).join(' · ');
  var lines = [
    b.message || '',
    '',
    'From: ' + who,
    'Reach them: ' + reach,
    b.about ? 'About: ' + b.about : '',
    b.for_what ? 'For: ' + b.for_what : '',
    b.timing ? 'Timing: ' + b.timing : '',
    b.film_seen ? 'Came from: ' + b.film_seen : '',
    '',
    'All briefs: ' + ss.getUrl() + '#gid=' + ss.getSheetByName('Briefs').getSheetId()
  ].filter(function (l, i, a) { return l !== '' || (i > 0 && a[i - 1] !== ''); });
  var opts = { name: 'alnimeri.com' };
  if (b.email) opts.replyTo = b.email;
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
                    'New brief: ' + (b.about || 'a project') + ' — ' + who, lines.join('\n'), opts);
}

/** Make sure the grid is big enough before writing into it. */
function grow(sh, rows, cols) {
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  if (sh.getMaxRows()    < rows) sh.insertRowsAfter(sh.getMaxRows(),       rows - sh.getMaxRows());
}

/** What a log sheet already holds below its header: nothing if the sheet is
 *  new or its header has changed, since write() then starts it afresh. */
function stored(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2 || sh.getRange(1, 1).getValue() !== HEAD[0]) return [];
  grow(sh, 2, HEAD.length);
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).getValues();
}

/** Append only rows the sheet has not got, keyed on timestamp + IP + page.
 *  `had` is what stored() read from the sheet earlier in the same run. */
function write(name, rows, had) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var tsCol = HEAD.indexOf('Timestamp (UTC)'), ipCol = HEAD.indexOf('IP'),
      pgCol = HEAD.indexOf('Page'), uaCol = HEAD.indexOf('User agent');
  var fresh = false;

  grow(sh, 2, HEAD.length);
  if (sh.getLastRow() === 0 || sh.getRange(1, 1).getValue() !== HEAD[0]) {
    sh.clear();
    // The UTC stamp is the dedupe key, so it has to come back out of the sheet
    // as the same string that went in — as a date it would be reformatted and
    // every row would look new on the next run.
    sh.getRange(1, tsCol + 1, sh.getMaxRows()).setNumberFormat('@');
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    fresh = true;
  }

  // Rows under each key, in the sheet and in this batch. Two hits can share a
  // key (a request sent twice in one millisecond); when the second lands
  // after the run that wrote the first, the batch holds the key once more
  // than the sheet does, and the extra one is added, since visit numbers and
  // the Summary count it.
  var key = function (r) { return String(r[tsCol]) + '|' + r[ipCol] + '|' + r[pgCol]; };
  var have = {}, haveUa = {}, left = {}, there = [];
  if (!fresh) (had || stored(name)).forEach(function (r) {
    var k = key(r);
    have[k] = (have[k] || 0) + 1;
    haveUa[k + '|' + r[uaCol]] = (haveUa[k + '|' + r[uaCol]] || 0) + 1;
  });
  rows.forEach(function (r) { var k = key(r); left[k] = (left[k] || 0) + 1; });
  Object.keys(left).forEach(function (k) { left[k] -= have[k] || 0; });
  // Under a key with more rows than the sheet, the ones it already has are
  // those with a user agent it holds there, oldest-logged first (the batch
  // lists those last); the rest are the new ones.
  for (var i = rows.length - 1; i >= 0; i--) {
    var k = key(rows[i]), u = k + '|' + rows[i][uaCol];
    if (left[k] > 0 && haveUa[u]) { haveUa[u]--; there[i] = true; }
  }

  var add = rows.filter(function (r, i) {
    var k = key(r);
    if (there[i] || !(left[k] > 0)) return false;
    left[k]--;
    return true;
  });
  if (add.length) {
    grow(sh, sh.getLastRow() + add.length, HEAD.length);
    sh.getRange(sh.getLastRow() + 1, 1, add.length, HEAD.length).setValues(add);
    // newest first, by the raw UTC stamp — never by the display date
    sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).sort({ column: tsCol + 1, ascending: false });
  }

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold');
  if (fresh) sh.autoResizeColumns(1, HEAD.length);
}

function summary(all, people) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Summary') || ss.insertSheet('Summary', 0);
  sh.clear();
  grow(sh, 200, 3);

  var col = function (rows, i) { return rows.map(function (r) { return r[i]; }); };
  var tally = function (vals, n) {
    var c = {};
    vals.forEach(function (v) { v = (v === '' || v == null) ? '—' : v; c[v] = (c[v] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })
             .slice(0, n || 15).map(function (k) { return [k, c[k]]; });
  };
  var uniq = function (vals) {
    var s = {}; vals.forEach(function (v) { if (v) s[v] = 1; }); return Object.keys(s).length;
  };
  var I = function (name) { return HEAD.indexOf(name); };

  var out = [
    ['alnimeri.com — visitor log'],
    ['Updated', Utilities.formatDate(new Date(), TZ, 'd MMM yyyy HH:mm') + ' (Dubai)'],
    ['Covering', people.length ? people[people.length - 1][0] + ' to ' + people[0][0] : ''],
    [],
    ['Real visits (people)', people.length],
    ['Unique people (by IP)', uniq(col(people, I('IP')))],
    ['Countries reached', uniq(col(people, I('Code')))],
    ['Bots and scanners', all.length - people.length],
    ['Total hits logged', all.length],
    []
  ];

  [['Countries', I('Country')], ['Cities', I('City')], ['Pages', I('Page name')],
   ['Sections', I('Section')], ['How they arrived', I('Source')],
   ['Device', I('Device')], ['Operating system', I('OS')], ['Browser', I('Browser')],
   ['Network type', I('Network type')], ['New vs returning', I('Visitor')],
   ['Busiest days of week', I('Day')]
  ].forEach(function (p) {
    out.push([p[0], 'Visits']);
    tally(col(people, p[1])).forEach(function (r) { out.push(r); });
    out.push([]);
  });

  out.push(['Visits by hour (Dubai)', 'Visits']);
  var byHour = {};
  col(people, I('Hour')).forEach(function (h) { byHour[h] = (byHour[h] || 0) + 1; });
  for (var h = 0; h < 24; h++)
    out.push([(h < 10 ? '0' + h : h) + ':00', byHour[h] || 0]);
  out.push([]);

  out.push(['Visits per day', 'People']);
  var byDay = {};
  col(people, I('Date')).forEach(function (d) { byDay[d] = (byDay[d] || 0) + 1; });
  Object.keys(byDay).sort().forEach(function (d) { out.push([d, byDay[d]]); });
  out.push([]);

  var bots = all.filter(function (r) { return r[I('Type')] === 'Bot'; });
  out.push(['Bot traffic by network', 'Hits']);
  tally(col(bots, I('Network')), 20).forEach(function (r) { out.push(r); });
  out.push([]);
  out.push(['What the bots probed for', 'Hits']);
  tally(col(bots, I('Page')), 20).forEach(function (r) { out.push(r); });

  var width = out.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  out = out.map(function (r) {
    while (r.length < width) r.push('');
    return r;
  });
  // "Visits per day" gains a row each day for as long as the sheet keeps
  // history, so the tab grows to fit rather than stopping at its first size.
  grow(sh, out.length, width);
  sh.getRange(1, 1, out.length, width).setValues(out);
  sh.getRange(1, 1).setFontWeight('bold');
  sh.autoResizeColumns(1, width);
}

/* ------------------------------------------------------------------ setup */

/** Wipe both logs and re-derive every row. Use after changing the columns or
 *  what counts as a person — a normal sync only appends, so it would leave
 *  old rows as they were. Run it once when this version replaces the full
 *  pull (see README). The rows come back from the API, which keeps only the
 *  last 90 days: anything older lives only in the sheet, and a rebuild
 *  loses it. */
function rebuild() {
  var ss = SpreadsheetApp.getActive();
  // Under the lock, so an hourly sync already running can't write back what
  // it read before the clear.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) throw new Error('A sync is running; try rebuild() again in a minute.');
  try {
    ['Visitors', 'All traffic'].forEach(function (n) {
      var sh = ss.getSheetByName(n);
      if (sh) sh.clear();
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  sync();
}

function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'sync' || h === 'syncBriefs') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sync').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('syncBriefs').timeBased().everyMinutes(10).create();
  syncBriefs();
  sync();
}
