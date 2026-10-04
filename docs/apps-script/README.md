# Website Visitors sheet — Apps Script

`Sync.gs` is the script inside the "Website Visitors" Google Sheet
(project "alnimeri visitor sync",
https://script.google.com/home/projects/1eRmxk_6QhEJ1Dx4mHq3KYu46T4epvAdg3jCVOn44Dhq5ftc-zUf8j2CC/edit).
It keeps five tabs current: Visitors, All traffic, Summary and Events (hourly)
and Briefs (every ten minutes; each new brief is also emailed to the sheet's
owner).

Events is what visitors did on the site (`/api/e`): played a film, opened or
sent the brief, followed a view count to its post, shared a shortlist,
downloaded the CV. Its first row is the funnel for the last 30 days
(visits → plays → brief opens → briefs sent); the events follow, newest first.

The site key is not in the code. It lives in the project's Script properties as
`VISITS_TOKEN` — the same value as the Cloudflare Pages secret of that name.
If the key is rotated in Cloudflare, update the Script property too.

## Installing v4 over v3 (the version in the sheet since 4 Oct 2026)

1. Open the project, replace the contents of Code.gs with `Sync.gs`, save.
2. Run `setUp` once.

That is all: no `rebuild`. v4 reads the sheet v3 filled as it is, and its
first run carries on where v3 stopped: it reads only the visits since the
sheet's newest row, as v3 did, makes the Events tab with every event the site
holds (one read of the events table, a few thousand rows at most), and deletes
nothing until the first visit rows turn ninety days old. `mock-sync-test.mjs`
replays exactly this switch (check 5) and finds the visit tabs and Summary
identical, cell for cell, to v3 kept running.

`setUp` re-creates this account's two triggers. A trigger made from another
Google account is not visible to it: if the Triggers page still shows a second
`sync` trigger, delete it (two runs an hour read D1 twice).

The site and the script can be updated in either order. v4 asks `/api/e` for
`&after=<the highest event id the tab has had>`, which the site answers from
the next deploy of `functions/api/e.js` by reading only the new rows. Until
that deploy the site ignores `&after` and sends the whole events table, as it
did for the release version of this script; v4 skips what the tab already has,
so nothing is doubled (check 7).

v3's install note asked for one `rebuild` before 21 Nov 2026, to rewrite the
Type of film-page, CV and reel views logged before 30 Sep 2026. It is no longer
needed: `sync` already counts those rows as people, and from 21 Nov they are
deleted with everything else past ninety days, the last by 29 Dec 2026.

## Ninety days

alnimeri.com/privacy says visit rows and events are kept ninety days. The sheet
is a copy of that log, IP addresses included, so every hourly run deletes the
rows of Visitors, All traffic and Events whose `Timestamp (UTC)` is more than
ninety days old, and never writes one. The log began on 23 Aug 2026, so the
first rows go on 21 Nov 2026. Briefs are not deleted here (the site keeps them
a year).

From then on, everything is counted over the ninety days the sheet keeps:

- **Visit #** and **New/Returning** count only the visits still kept. An
  address whose earlier visits were deleted starts again at 1, New. Rows
  already written keep the numbers they were given, so an address's older row
  can show a higher Visit # than its newer one.
- **Session** numbers carry on across the deletions: a new row gets the number
  it would have had if nothing had been deleted. Each run starts its count from
  the number of sessions already deleted, which is kept in the Script property
  `SESSIONS_PRUNED` (a count and a date, no address). A session still running
  when its first rows go keeps its number and is counted once.
- **Summary** counts the kept rows: "Covering" starts at most ninety days back,
  and "New vs returning" counts each address's first kept visit as New.

Each run asks D1 only for what is new. Visits: since the sheet's newest row,
less six hours of overlap, and never from before the ninety days, so a row once
deleted is never asked for again, even while D1 (which deletes its old rows
only now and then) still holds it. Events: the ids above the highest the tab
has had, kept in the Script property `EVENTS_UP_TO` as well, so a quiet spell
that empties the tab does not send the next run back for the whole table.

## The sheet is the record

- A row deleted from All traffic stays deleted and is no longer counted.
  Later visit and session numbers are counted without it, so one may repeat a
  number already shown. To hide rows, use a filter view, not "Delete row".
- A row deleted only from Visitors comes back on the next run, because
  Visitors is refilled from All traffic.
- A row with anything other than a stamp in Timestamp (UTC) is skipped. It
  can't be dated, so it is not deleted at ninety days either: delete it by hand.
- An event deleted from the Events tab stays deleted. To refill the tab from
  what the site holds, delete the whole tab; the next run makes it again.
- Each row keeps the Type it was written with. If the humans filter in
  `functions/api/visits.js` changes again, run `rebuild`: it rewrites both
  visit tabs from the ninety days D1 holds (the same ninety days the sheet
  keeps, so nothing is lost) and starts the visit and session numbers afresh.

## Tests

- `node mock-test.mjs Sync.gs` runs syncBriefs() and sync() against an
  in-memory fake sheet.
- `node e-after-test.mjs` tests `/api/e`'s `&after` against node:sqlite, with
  the table made by e.js's own CREATE TABLE, and checks every response without
  `&after` is byte for byte what it was before.
- `node mock-sync-test.mjs` (about nine minutes) replays 130 days of simulated
  traffic and site events, hourly, through v4, v3 (git b1d1c84, the commit on
  this branch that records the installed version) and the release version
  (git 3e5b0ef). Every fetch is served by the real `functions/api/visits.js`
  and `functions/api/e.js` over an in-memory SQLite, and charged the rows
  SQLite's own plan reads. It checks:
  1. until anything is ninety days old, v4's Visitors, All traffic and Summary
     equal v3's cell for cell, every day (also joining late, paging 7 rows at
     a time, after Visitors is emptied by hand, and after `rebuild`);
  2. v4's Events tab, funnel line included, equals the release's cell for cell,
     every day, on a log D1 never purges and on one it does;
  3. past ninety days, after every run, the three tabs hold exactly D1's rows
     newer than ninety days, each once; no row a run deleted is ever written
     again; the Summary is what the tabs hold; and every Session number is the
     one v3 (which never deletes) gives the same row;
  4. the rows D1 reads per run: v4 reads the new visits plus the six-hour
     overlap (about 60 rows a run in the simulation, the same as v3, flat while
     the log grows; the release read about 20,000) and exactly the new events
     (the release read the whole table, about 1,800);
  5. the switch from v3: the live sheet's own history (old full pull with the
     narrow humans filter, v3, then v4 with `setUp`) and a v3 sheet already 120
     days old, which v4's first run cuts to ninety;

  then the cutoff up close (a session cut in two by it, rows on it to the
  millisecond, a deletion that fails half way), a quiet spell that empties the
  Events tab, the site before and after `&after` is deployed, and v3's old
  cases (overlap, hand edits, a 95-day outage, paging). It exits 1 if any
  check fails. If b1d1c84 is ever lost from history (a squash merge), pass
  `--v3 <rev>` with a commit that holds v3's Sync.gs.
