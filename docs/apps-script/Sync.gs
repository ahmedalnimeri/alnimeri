/**
 * alnimeri.com — visitor log sync (v4)
 *
 * Pulls the Cloudflare D1 visit and event logs and keeps five sheets current:
 *   Visitors    — people only, one row per visit, enriched
 *   All traffic — every hit including bots and scanners
 *   Summary     — recomputed totals and breakdowns
 *   Events      — what visitors did (/api/e): played a film, opened or sent
 *                 the brief, followed a view count, shared a shortlist,
 *                 downloaded the CV; newest first, under a funnel line
 *                 (visits → plays → brief opens → briefs sent, last 30 days)
 *   Briefs      — every brief sent through the site's "Get in touch" form,
 *                 newest first; each new one is also emailed to the account
 *                 that ran setUp() (the account its triggers belong to)
 *
 * The site key is NOT in this file: add it once as a Script property named
 * VISITS_TOKEN (Project Settings → Script properties). The same key opens
 * /api/visits, /api/e and /api/brief.
 *
 * Ninety days. Visit rows (Visitors, All traffic) and events older than
 * KEEP_DAYS are deleted on every run, and never added, as alnimeri.com/privacy
 * promises for the site's log, of which the sheet is a copy, IP addresses
 * included. The deleting needs only the sheet and the clock: a run that can't
 * reach the site (a rotated key, the site or D1 down) still deletes, then
 * reports the error. IP addresses stay whole while a row is kept. Two things
 * this script can't do (see README.md, "Ninety days"): a deleted row stays in
 * the sheet's version history (File > Version history), which no script or
 * API can clear; and Briefs are not deleted here, though /privacy says briefs
 * are kept a year.
 *
 * Rows already in the sheet are never re-written or duplicated: each run
 * appends only what it has not seen. Each run asks the API only for what is
 * new, not for the whole log, since every row read counts against D1's daily
 * allowance: visits logged since the sheet's newest row (less a few hours of
 * overlap, and never from before the ninety days), events with an id above
 * EVENTS_UP_TO, the Script property that holds the highest id fetched.
 *
 * Visit numbers, sessions and the Summary are counted over the rows the sheet
 * holds, which is the last ninety days:
 *   - Visit # and New/Returning count only the visits still kept. An address
 *     whose earlier visits were deleted starts again at 1, New. Rows already
 *     written keep the numbers they were given then, so an address's older
 *     row can show a higher Visit # than its newer one.
 *   - Session numbers carry on across the deletions: a new row gets the
 *     number it would have had if nothing had been deleted. Each run starts
 *     from the number of sessions already deleted, kept as one count in the
 *     Script property SESSIONS_PRUNED (a number and a date, no address). A
 *     session still running when its first rows are deleted keeps its number
 *     and is counted once, before any session that began after the cutoff.
 *     Rows the sheet never had because the sync was stopped for ninety days or
 *     more are not counted, so sessions near the cutoff can then be numbered
 *     in a different order. (README.md, "Ninety days", has one more exception,
 *     for a run started by hand.)
 *   - The Summary counts the kept rows: "Covering" starts at most ninety days
 *     back, and "New vs returning" counts an address's first kept visit as New.
 *
 * So All traffic is the record of those ninety days. A row deleted from it by
 * hand stays deleted and drops out of the counts, and later visit and session
 * numbers are counted without it; to hide rows, use a filter view. A row
 * deleted from Visitors alone comes back, since Visitors is refilled from All
 * traffic. A row whose Timestamp (UTC) was typed over can't be dated, so it is
 * neither counted nor deleted: delete it by hand. Each row keeps the Type it
 * was written with: after a change to what the API counts as a person (the
 * humans filter in functions/api/visits.js), run rebuild().
 *
 * Columns. Each tab's columns are the ones in HEAD (EVENT_HEAD for Events),
 * from column A, in that order. A column inserted, moved or renamed among them
 * stops new rows going into that tab (and, for a visit tab, new visits being
 * asked for), with an error naming it, until it is put back (or, for the visit
 * tabs, rebuild() is run); the run still reads the tab by its headers and
 * deletes what is past ninety days. A column of notes to the right of the last
 * one is fine: it moves with its row and goes with it.
 *
 * Run setUp() once, signed in as the sheet's owner (README.md, "Installing").
 * It replaces that account's triggers (visits and events hourly, briefs every
 * ten minutes) and does a first sync. Triggers another account made are not
 * its to see or delete. Existing briefs are written to the sheet but not
 * emailed; only briefs that arrive afterwards are. Once rows have been deleted
 * at ninety days, don't go back to v3 without running rebuild() after.
 */

var API   = 'https://alnimeri.com/api/visits';
var EVENTS_API = 'https://alnimeri.com/api/e';
var TZ    = 'Asia/Dubai';
var LIMIT = 20000;
// What alnimeri.com/privacy promises for visit rows and events.
var KEEP_DAYS = 90;
// Two hits from one address further apart than this are two sessions.
var SESSION_MINUTES = 30;
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

/**
 * The events with an id above `after`, oldest first, LIMIT at a time: each
 * page starts after the last id of the one before. Ids only grow, so this is
 * exactly what the Events tab has not had.
 */
function pullEvents(after) {
  var out = [];
  for (;;) {
    var res = UrlFetchApp.fetch(EVENTS_API + '?key=' + encodeURIComponent(siteKey()) +
                                '&format=json&limit=' + LIMIT + '&after=' + after, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200)
      throw new Error('Event log returned ' + res.getResponseCode() + ' — is the key still valid?');
    var page = JSON.parse(res.getContentText()).events || [];
    out = out.concat(page);
    if (page.length < LIMIT) return out;
    // A site that does not know &after yet sends its newest rows, the same
    // page again: stop rather than ask forever (the repeats are skipped).
    var last = Number(page[page.length - 1].id);
    if (!(last > after)) return out;
    after = last;
  }
}

/* ------------------------------------------------------------------- sync */

function sync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;            // a run is already in flight
  try {
    // Nothing logged before this moment is kept, written or counted.
    var cutoff = Date.now() - KEEP_DAYS * 864e5;
    // The sheet is the history: All traffic holds every hit of the last
    // ninety days, people and bots. So the API is asked only for what came
    // after the sheet's newest row, less the overlap, and everything up to
    // that point is replayed from the sheet. An empty sheet (the first run,
    // or after rebuild) takes the ninety days the API holds.
    var traffic = stored('All traffic'), visitors = stored('Visitors');
    // A visit tab whose columns were changed by hand (see misfit()) is still
    // read by its headers, counted and pruned, but nothing new is asked for or
    // added until it is put right: rows read count against D1's allowance.
    var wrong = { 'All traffic': misfit('All traffic', 1, HEAD), Visitors: misfit('Visitors', 1, HEAD) };
    var col = function (name) { return HEAD.indexOf(name); };
    var TS = col('Timestamp (UTC)'), IP = col('IP'), TYPE = col('Type'), PAGE = col('Page'),
        UA = col('User agent'), CODE = col('Code'), CITY = col('City'), REGION = col('Region'),
        NET = col('Network'), REF = col('Referrer'), SESSION = col('Session');
    var key = function (x) { return String(x[TS]) + '|' + x[IP] + '|' + x[PAGE]; };
    var at = function (x) { return Date.parse(String(x[TS])); };
    // A stamp typed by hand with a wrong year would become the newest row and
    // push since into the future, and nothing new would ever arrive: only
    // stamps between the start of the log and tomorrow count.
    var latest = Date.now() + 86400000;
    var dated = traffic.filter(function (x) {
      var t = at(x);
      return STAMP.test(String(x[TS])) && isFinite(t) && t >= LOG_START && t <= latest;
    });
    // Rows past the ninety days are deleted at the end of this run. Until
    // then they only settle how many sessions went with them.
    var gone = dated.filter(function (x) { return at(x) < cutoff; });
    var kept = dated.filter(function (x) { return at(x) >= cutoff; });
    var newest = '';
    dated.forEach(function (x) { if (String(x[TS]) > newest) newest = String(x[TS]); });
    // since means "logged after", so the cutoff less a millisecond asks for
    // everything from the cutoff on and nothing before it, even when the
    // sheet's newest row is older than that (a long outage) or there is none.
    var floor = new Date(cutoff - 1).toISOString();
    var since = newest ?
      new Date(Date.parse(newest) - OVERLAP_HOURS * 3600000).toISOString() : '';
    if (since < floor) since = floor;

    // The site deletes its old rows now and then, not on the dot: a row older
    // than the cutoff is never added, whatever the API still holds.
    var inTime = function (r) { return Date.parse(r.ts) >= cutoff; };
    // A run that can't reach the site (a key rotated in Cloudflare but not
    // here, the site or D1 down) carries on from the sheet alone: the rows
    // past ninety days are deleted and the Summary redone all the same, and
    // the error is thrown at the end, so the trigger still reports it.
    var all = [], humans = [], failed = null;
    if (!wrong['All traffic'] && !wrong.Visitors) try {
      all = pull(false, since).filter(inTime);
      humans = pull(true, since).filter(inTime);
    } catch (e) {
      all = []; humans = []; failed = e;
    }

    var isHuman = {};
    humans.forEach(function (r) {
      var k = r.ts + '|' + r.ip + '|' + r.path + '|' + r.ua;
      isHuman[k] = (isHuman[k] || 0) + 1;
    });

    // oldest first, so "visit #" and sessions count forward in time
    all.sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });

    // The sheet's rows up to since are counted from the sheet. Rows after it
    // are counted from the API's copy, which may hold one that landed late;
    // but a row the API no longer has is counted from the sheet.
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
    gone.forEach(function (x) { if (x[TYPE] === 'Person' && listed[vkey(x)]) listed[vkey(x)]--; });
    var person = function (x) {
      if (x[TYPE] === 'Person') return true;
      if (listed[vkey(x)]) { listed[vkey(x)]--; return true; }
      return false;
    };

    // Every hit, oldest first, as [hit, person?, its Session cell if the sheet
    // has it]. The sheet's are worked out again from what was logged, as the
    // API's are, so the Summary follows the current page names and sources.
    // Rows that share a stamp and were written in one run are listed
    // newest-logged first; reversed, they replay in the order they were logged.
    var hits = past.reverse().map(function (x) {
      return [{
        ts: String(x[TS]), ip: x[IP], country: String(x[CODE]), city: x[CITY],
        region: x[REGION], asn: x[NET], path: String(x[PAGE]),
        referrer: String(x[REF]), ua: String(x[UA])
      }, person(x), String(x[SESSION])];
    });
    var used = {};
    all.forEach(function (r) {
      var k = r.ts + '|' + r.ip + '|' + r.path + '|' + r.ua;
      used[k] = (used[k] || 0) + 1;
      hits.push([r, used[k] <= (isHuman[k] || 0)]);
    });
    hits.sort(function (a, b) { return a[0].ts < b[0].ts ? -1 : a[0].ts > b[0].ts ? 1 : 0; });

    // Sessions are numbered across everything the sheet was ever given, so
    // the count starts from the sessions already deleted with older rows, and
    // the ones still running at the cutoff (see settle).
    var prior = sessionsPruned(), carry = settle(gone.map(function (x) {
      return { t: at(x), who: (x[IP] || '') + '|' + (person(x) ? 'p' : 'b'), label: x[SESSION] };
    }), hits, prior, cutoff);
    if (carry.counted)
      PropertiesService.getScriptProperties().setProperty('SESSIONS_PRUNED',
        JSON.stringify({ n: carry.base, upTo: new Date(cutoff).toISOString() }));

    var seenIp = {}, lastSeen = {}, sessionOf = {}, sessions = carry.base + carry.ahead, minutes = {};

    // Visitor, Visit # and Session for one hit. Counted per IP *and* per
    // type: a person's visit number should not be inflated by the thousands
    // of scanner hits sharing their address.
    var count = function (t, ip, human) {
      var who = ip + '|' + (human ? 'p' : 'b');
      seenIp[who] = (seenIp[who] || 0) + 1;
      var gap = lastSeen[who] ? (t - lastSeen[who]) / 60000 : Infinity;
      if (gap > SESSION_MINUTES) {
        // A session that was running at the cutoff keeps the number it has
        // (see settle), and is counted here unless it was counted ahead;
        // every other one takes the next.
        var kept = !lastSeen[who] && carry.number[who];
        if (!(kept && carry.held[who])) sessions += 1;
        sessionOf[who] = kept || sessions;
      }
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

    if (!wrong.Visitors) write('Visitors', people, visitors);
    if (!wrong['All traffic']) write('All traffic', rows, traffic);
    prune('Visitors', 1, HEAD, cutoff);
    prune('All traffic', 1, HEAD, cutoff);
    summary(rows, people);
    var events = 0;
    try { events = syncEvents(people, cutoff); } catch (e) { failed = failed || e; }

    var notes = [wrong['All traffic'], wrong.Visitors].filter(String);
    if (notes.length) throw new Error(notes.join(' ') + ' ' + NOT_ADDED +
      ' Or run rebuild(), which writes both visit tabs afresh.' + (failed ? ' Also: ' + failed.message : ''));
    if (failed) throw failed;

    SpreadsheetApp.getActive().toast(
      people.length + ' visits, ' + rows.length + ' hits, ' + events + ' events', 'Visitor log synced', 5);
  } finally {
    // Commit the writes before the next run can take the lock, so it never
    // reads the sheet as it was before this one and appends the same rows.
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

/** The sessions deleted so far with rows past the ninety days, and the
 *  cutoff they were counted up to (ms): {n, upTo}. */
function sessionsPruned() {
  try {
    var p = JSON.parse(PropertiesService.getScriptProperties().getProperty('SESSIONS_PRUNED') || 'null');
    var upTo = p ? Date.parse(String(p.upTo)) : NaN;
    if (p && isFinite(p.n) && p.n >= 0 && isFinite(upTo)) return { n: Number(p.n), upTo: upTo };
  } catch (e) { /* typed over by hand: count afresh */ }
  return { n: 0, upTo: -Infinity };
}

/** 'S12' → 12; anything else → 0, so a cell typed over by hand is ignored. */
function sessionNumber(cell) {
  var m = /^S(\d+)$/.exec(String(cell));
  return m ? Number(m[1]) : 0;
}

/**
 * Settles the sessions at the cutoff. gone: the rows about to be deleted, as
 * {t, who, label}; hits: the run's kept hits, oldest first, as [hit, person?,
 * Session cell]; prior: what sessionsPruned() returned.
 *
 * A session that ends among the gone rows is counted now, once, into
 * SESSIONS_PRUNED. One still running at the cutoff (an address's first kept
 * hit within SESSION_MINUTES of its last gone one) is not: it is counted again
 * every run until it ends, so its count needs no number on its rows. Rows
 * older than prior.upTo are left over from a run whose deletion did not
 * finish; they were counted then.
 *
 * A session running at the cutoff keeps its number. The rows that hold it are
 * its gone ones and its first kept ones, or, when its gone rows went in an
 * earlier run, its first kept ones alone (which then start within
 * SESSION_MINUTES of the cutoff). Its number is the smallest on those rows: a
 * row written while a late hit was still missing carries a later, larger
 * number, and once that hit lands the session is whole again under its first.
 *
 * A running session whose gone rows are in this run began before every kept
 * session, so the count of the kept rows starts past it (ahead): a session
 * that another address begins between the cutoff and its first kept hit takes
 * the next number, not the one it keeps. One whose rows hold no number (typed
 * over by hand) takes the next number at its first kept hit instead.
 *
 * Returns {base, ahead, held, counted, number}: the sessions before the kept
 * rows, for SESSIONS_PRUNED; how many running sessions to count before the
 * kept rows; those sessions' addresses (held: they keep their number without
 * being counted again); whether new gone rows were counted; and the number to
 * carry for an address whose first kept session was running at the cutoff.
 */
function settle(gone, hits, prior, cutoff) {
  var gap = function (a, b) { return (b - a) / 60000 > SESSION_MINUTES; };
  var least = function (a, b) { return a && b ? Math.min(a, b) : a || b; };
  gone.sort(function (a, b) { return a.t - b.t; });
  // the gone rows: sessions started among those not counted before, and each
  // address's last session (its end, and the smallest number on it)
  var last = {}, seen = {}, starts = 0, counted = false;
  gone.forEach(function (g) {
    if (g.t >= prior.upTo) {
      if (!seen[g.who] || gap(seen[g.who], g.t)) starts++;
      seen[g.who] = g.t;
      counted = true;
    }
    var l = last[g.who];
    if (!l || gap(l.t, g.t)) l = last[g.who] = { t: g.t, n: 0 };
    l.t = g.t; l.n = least(l.n, sessionNumber(g.label));
  });
  // the kept hits: each address's first session (its start, and the smallest
  // number on its rows that the sheet holds)
  var first = {};
  hits.forEach(function (h) {
    var who = (h[0].ip || '') + '|' + (h[1] ? 'p' : 'b'), t = Date.parse(h[0].ts), f = first[who];
    if (!f) f = first[who] = { start: t, t: t, n: 0, open: true };
    else if (f.open && gap(f.t, t)) f.open = false;
    if (f.open) { f.t = t; f.n = least(f.n, sessionNumber(h[2])); }
  });
  var number = {};
  Object.keys(first).forEach(function (who) {
    var f = first[who], l = last[who];
    if (l && !gap(l.t, f.start)) number[who] = least(l.n, f.n);
    else if (f.start < cutoff + SESSION_MINUTES * 60000 && f.n) number[who] = f.n;
  });
  var running = 0, ahead = 0, held = {};
  Object.keys(seen).forEach(function (who) {
    if (!first[who] || gap(seen[who], first[who].start)) return;
    running++;
    if (number[who]) { held[who] = true; ahead++; }
  });
  return { base: prior.n + starts - running, ahead: ahead, held: held, counted: counted, number: number };
}

/* ----------------------------------------------------------------- events */

var EVENT_HEAD = ['Date', 'Time', 'Event', 'Film', 'Page', 'Via', 'Country',
                  'Timestamp (UTC)', 'Event #'];
var EVENT_NAME = {
  play: 'Played a film', brief_open: 'Opened the brief', brief_sent: 'Sent a brief',
  brief_failed: 'Brief did not send', proof_click: 'Followed a view count to its post',
  shortlist_share: 'Shared a shortlist', cv_pdf: 'Downloaded the CV'
};
var VIA_NAME = {
  lightbox: 'Front page player', page: 'Film page', post: 'On its post',
  copy: 'Copied the link', share: 'Shared the link',
  ig: 'Instagram', li: 'LinkedIn', wa: 'WhatsApp', x: 'X', sig: 'Email signature',
  ai: 'AI assistant', qr: 'QR code'
};

/**
 * Copies new events from the site (/api/e) into the Events sheet, newest
 * first under its funnel line, after deleting those older than the cutoff
 * (first, so they go even when the site can't be reached). Only ids above
 * EVENTS_UP_TO, the Script property that holds the highest id fetched, are
 * asked for; nothing typed into the tab moves it. A tab made afresh (deleted,
 * or emptied with its header) takes every event the site still holds and sets
 * EVENTS_UP_TO again from what comes back. people: this run's Visitors rows,
 * for the funnel's first number. Returns how many events the sheet now holds.
 */
function syncEvents(people, cutoff) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Events') || ss.insertSheet('Events', 1);
  var n = EVENT_HEAD.length, idCol = n, tsCol = EVENT_HEAD.indexOf('Timestamp (UTC)') + 1;
  var props = PropertiesService.getScriptProperties();
  grow(sh, 3, n);
  prune('Events', 2, EVENT_HEAD, cutoff);
  var wrong = misfit('Events', 2, EVENT_HEAD);
  if (wrong) throw new Error(wrong + ' ' + NOT_ADDED + ' Or delete the Events tab: the next run makes it again.');
  var fresh = sh.getLastRow() < 3 && unlike(sh, 2, EVENT_HEAD) > 0;
  if (fresh) {
    sh.clear();
    sh.getRange(1, tsCol, sh.getMaxRows(), 1).setNumberFormat('@');   // the stamp stays the API's string
    sh.getRange(1, 1).setValue('Last 30 days: …');                       // the funnel line, filled below
    sh.getRange(2, 1, 1, n).setValues([EVENT_HEAD]);
  }
  var held = sh.getLastRow() > 2 ? sh.getRange(3, 1, sh.getLastRow() - 2, n).getValues() : [];
  var have = {};
  held.forEach(function (r) { have[String(r[idCol - 1])] = 1; });

  // Where to start: EVENTS_UP_TO alone, once it holds an id. The tab's own
  // highest Event # counts only when the property is missing (a tab made by
  // an earlier version of this script), and then only a whole number.
  var upTo = props.getProperty('EVENTS_UP_TO');
  var after = 0;
  if (!fresh && /^\d{1,15}$/.test(String(upTo))) after = Number(upTo);
  else if (!fresh) held.forEach(function (r) {
    var id = r[idCol - 1];
    if (typeof id === 'number' && id % 1 === 0 && id > after) after = id;
  });
  var high = after, seen = {};
  var fetched = pullEvents(after).filter(function (e) {
    var id = String(e.id);
    if (Number(e.id) > high) high = Number(e.id);
    // never one the tab has, twice, or one the privacy page says is gone
    if (have[id] || seen[id] || !(Date.parse(e.ts) >= cutoff)) return false;
    seen[id] = 1;
    return true;
  });
  var rows = fetched.map(function (e) {
    var t = new Date(e.ts);
    var cc = String(e.country || '').toUpperCase();
    return [Utilities.formatDate(t, TZ, 'yyyy-MM-dd'), Utilities.formatDate(t, TZ, 'HH:mm'),
            EVENT_NAME[e.t] || e.t, e.title || e.film || '', e.path || '',
            VIA_NAME[e.via] || e.via || '', (COUNTRY[cc] || [cc])[0], e.ts, e.id];
  });
  if (rows.length) {
    grow(sh, sh.getLastRow() + rows.length, n);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, n).setValues(rows);
    // every column, so a note to the right of the last stays with its row
    sh.getRange(3, 1, sh.getLastRow() - 2, sh.getMaxColumns()).sort({ column: idCol, ascending: false });
  }
  if (String(high) !== upTo) props.setProperty('EVENTS_UP_TO', String(high));

  // The funnel, last 30 days: page visits by people, then what they did.
  var since = new Date(Date.now() - 30 * 864e5).toISOString();
  var tsAt = HEAD.indexOf('Timestamp (UTC)');
  var visits = people.filter(function (r) { return String(r[tsAt]) >= since; }).length;
  var did = {};
  held.concat(rows).forEach(function (r) {
    if (String(r[tsCol - 1]) >= since) did[r[2]] = (did[r[2]] || 0) + 1;
  });
  var count = function (t) { return did[EVENT_NAME[t]] || 0; };
  sh.getRange(1, 1).setValue('Last 30 days: ' + visits + ' visits → ' + count('play') + ' plays → ' +
    count('brief_open') + ' brief opens → ' + count('brief_sent') + ' briefs sent' +
    '   (updated ' + Utilities.formatDate(new Date(), TZ, 'd MMM HH:mm') + ', Dubai)');
  sh.getRange(1, 1).setFontWeight('bold');
  sh.setFrozenRows(2);
  sh.getRange(2, 1, 1, n).setFontWeight('bold');
  return Math.max(0, sh.getLastRow() - 2);
}

/**
 * Deletes the rows of a sheet whose UTC stamp is older than the cutoff (ms).
 * at: the header row; the rows under it, in any order. The stamp column is
 * found by its header, "Timestamp (UTC)", so the deleting goes on whatever was
 * done to the other columns; where that header is gone, it is the column head
 * puts it in. A cell that is not a stamp can't be dated and is left. Runs of
 * rows are deleted from the bottom up, so the row numbers still to come do not
 * move.
 */
function prune(name, at, head, cutoff) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() <= at) return 0;
  var top = sh.getRange(at, 1, 1, sh.getMaxColumns()).getValues()[0].map(String);
  var tsCol = top.indexOf('Timestamp (UTC)') + 1 || head.indexOf('Timestamp (UTC)') + 1;
  if (tsCol > sh.getMaxColumns()) return 0;
  var firstRow = at + 1;
  var stamps = sh.getRange(firstRow, tsCol, sh.getLastRow() - at, 1).getValues();
  var old = function (i) {
    var s = String(stamps[i][0]);
    return STAMP.test(s) && Date.parse(s) < cutoff;
  };
  var gone = 0;
  for (var i = stamps.length - 1; i >= 0; i--) {
    if (!old(i)) continue;
    var end = i;
    while (i > 0 && old(i - 1)) i--;
    // A sheet must keep one row below its frozen ones: when every row would
    // go, add an empty one first.
    if (sh.getMaxRows() - (end - i + 1) < firstRow) sh.insertRowsAfter(sh.getMaxRows(), 1);
    sh.deleteRows(firstRow + i, end - i + 1);
    gone += end - i + 1;
  }
  return gone;
}

/* ---------------------------------------------------------------- columns */

// What a run that finds a tab's columns changed says after naming the column.
var NOT_ADDED = 'Nothing new goes into a tab like that until its columns are back as the ' +
  'script wrote them (notes go to the right of the last column, or on another tab); its rows ' +
  'past ninety days are still deleted.';

/** The first column (from 1) of row `at` that is not head's, or 0 if none. */
function unlike(sh, at, head) {
  var got = sh.getRange(at, 1, 1, Math.min(head.length, sh.getMaxColumns())).getValues()[0];
  for (var i = 0; i < head.length; i++) if (i >= got.length || String(got[i]) !== head[i]) return i + 1;
  return 0;
}

/**
 * Why rows can't be added to a tab as it is, or '' when they can: its header
 * row (at) is not head, column for column from A, and there are rows under it.
 * New rows are written in head's order and the tab is sorted on one of those
 * columns, so a column inserted, moved or renamed among them would put every
 * new row out of line with the old ones. A tab with nothing under its header
 * is simply written afresh.
 */
function misfit(name, at, head) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() <= at) return '';
  var c = unlike(sh, at, head);
  if (!c) return '';
  var cell = c <= sh.getMaxColumns() ? String(sh.getRange(at, c).getValue()) : '';
  return name + ': column ' + letter(c) + ' is headed "' + cell + '" where the script keeps "' +
         head[c - 1] + '".';
}

/** Column 1 is A, 27 is AA. */
function letter(c) {
  var s = '';
  for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s;
  return s;
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

/** One plain email per brief, to the account the trigger runs as: the one
 *  that ran setUp(), not necessarily the sheet's owner. */
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

/** What a log sheet already holds below its header, as rows in HEAD's order.
 *  Each column is found by its header, so a column inserted or moved by hand
 *  shifts nothing (see misfit()); one whose header is gone is read where HEAD
 *  puts it. */
function stored(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  grow(sh, 2, HEAD.length);
  var top = sh.getRange(1, 1, 1, sh.getMaxColumns()).getValues()[0].map(String);
  var from = HEAD.map(function (h, i) { var j = top.indexOf(h); return j < 0 ? i : j; });
  var asIs = from.every(function (j, i) { return j === i; });
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, asIs ? HEAD.length : Math.max.apply(null, from) + 1).getValues();
  return asIs ? vals : vals.map(function (r) { return from.map(function (j) { return r[j]; }); });
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
  // Nothing under a header that is not HEAD's (sync() writes no tab with rows
  // under one): start the tab afresh.
  if (sh.getLastRow() < 2 && unlike(sh, 1, HEAD)) {
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
    // newest first, by the raw UTC stamp — never by the display date; every
    // column, so a note to the right of the last stays with its row
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).sort({ column: tsCol + 1, ascending: false });
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

/** Wipe both visit logs and re-derive every row from the ninety days the
 *  API holds, the same ninety days the sheet keeps. Use after changing the
 *  columns or what counts as a person — a normal sync only appends, so it
 *  would leave old rows as they were. Visit and session numbers start again
 *  from the oldest row, as on a first run. Events are left as they are; to
 *  refill that tab, delete it and run sync(). */
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
    PropertiesService.getScriptProperties().deleteProperty('SESSIONS_PRUNED');
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
