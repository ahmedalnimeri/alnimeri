# Website Visitors sheet — Apps Script

`Sync.gs` is the script inside the "Website Visitors" Google Sheet
(project "alnimeri visitor sync",
https://script.google.com/home/projects/1eRmxk_6QhEJ1Dx4mHq3KYu46T4epvAdg3jCVOn44Dhq5ftc-zUf8j2CC/edit).
It keeps five tabs current: Visitors, All traffic, Summary and Events (hourly)
and Briefs (every ten minutes; each new brief is also emailed to the account
that ran `setUp`, which is the sheet's owner when it is installed as below).

Events is what visitors did on the site (`/api/e`): played a film, opened or
sent the brief, followed a view count to its post, shared a shortlist,
downloaded the CV. Its first row is the funnel for the last 30 days
(visits → plays → brief opens → briefs sent); the events follow, newest first.

The site key is not in the code. It lives in the project's Script properties as
`VISITS_TOKEN` — the same value as the Cloudflare Pages secret of that name.
If the key is rotated in Cloudflare, update the Script property too.

## Installing v4 over v3 (the version in the sheet since 4 Oct 2026)

0. Sign in as **ahmedalnimeri@gmail.com**, the sheet's owner, whose triggers
   run v3 today. Use the account switcher, or put `/u/<n>/` in the URL: the
   link above opens in the browser's first account (`/u/0`), which is
   ahmedaminalnimeri@gmail.com, and that is the wrong one.
1. Open the project and replace the contents of Code.gs with `Sync.gs`, then
   save. Copy it from a UTF-8 source. With pbcopy that means
   `LANG=en_US.UTF-8 pbcopy < Sync.gs`. Without it, characters such as →, —,
   “ ” and ü are garbled, and then the funnel line, the Country and Page name
   of new rows, and the Summary's title read wrong.
2. Run `setUp` once, as that account.
3. When it has run, check the Events tab's first row. It should read
   `Last 30 days: … visits → … plays → …`, arrows included.
4. Open the project's Triggers page as ahmedaminalnimeri@gmail.com as well, and
   check that it lists no `sync` or `syncBriefs` trigger. Delete any you find.

`setUp` deletes and re-creates the `sync` and `syncBriefs` triggers of the
account that runs it, and no others. A trigger belongs to the account that
made it and shows only on that account's Triggers page, which is why steps 0
and 4 matter. A second account's `sync` trigger means two runs an hour, which
doubles the D1 reads (part of the 79% day on 4 Oct). Its `syncBriefs` can
email a new brief to that account instead of the owner, because whichever
trigger runs first sends it.

That is all: no `rebuild`. v4 reads the sheet v3 filled as it is, and its
first run carries on where v3 stopped. It reads only the visits since the
sheet's newest row, as v3 did. It makes the Events tab with every event the
site holds (one read of the events table, a few thousand rows at most). It
deletes nothing until the first visit rows turn ninety days old.
`mock-sync-test.mjs` replays exactly this switch (check 5) and finds the visit
tabs and Summary identical, cell for cell, to v3 kept running.

The site and the script can be updated in either order. v4 asks `/api/e` for
`&after=<EVENTS_UP_TO>`, the highest event id it has fetched. The site answers
that from the next deploy of `functions/api/e.js`, reading only the new rows.
Until that deploy the site ignores `&after` and sends the whole events table,
as it did for the release version of this script. v4 skips what the tab
already has, so nothing is doubled (check 7).

v3's install note asked for one `rebuild` before 21 Nov 2026, to rewrite the
Type of film-page, CV and reel views logged before 30 Sep 2026. It is no longer
needed: `sync` already counts those rows as people, and from 21 Nov they are
deleted with everything else past ninety days, the last by 29 Dec 2026.

**Never go back to v3 once v4 has deleted anything (from 21 Nov 2026).** v3
numbers sessions from 1 over the ninety days the sheet still holds, so its new
rows would repeat Session numbers already in the tabs, and it deletes nothing.
If you have to go back, run `rebuild` straight after.

## Ninety days

alnimeri.com/privacy says visit rows and events are kept ninety days. The sheet
is a copy of that log, IP addresses included. So every hourly run deletes the
rows of Visitors, All traffic and Events whose `Timestamp (UTC)` is more than
ninety days old, and never writes one. The deleting needs only the sheet and
the clock. A run that can't reach the site still deletes, then stops with the
error, so the trigger reports it: a key rotated in Cloudflare but not in the
Script property, or the site or D1 being down. The same goes for a tab whose
columns were changed by hand (see below). The log began on 23 Aug 2026, so the
first rows go on 21 Nov 2026.

Two things the script can't do:

- **Version history keeps deleted rows.** File → Version history still shows
  every row as it was, IP addresses included, to anyone with edit access.
  Neither a script nor the Drive API can delete a Google Sheet's revisions. To
  clear them, start the sheet again from a copy, which has no history. Do this
  every month or two, or whenever deleted rows must really be gone:
  1. File → Make a copy. The copy has the script too.
  2. In the copy's script, open Project Settings → Script properties. Make
     sure it holds `VISITS_TOKEN`, `SESSIONS_PRUNED`, `EVENTS_UP_TO` and
     `BRIEFS_EMAILED_UP_TO` with the original's values. Add any that are
     missing.
  3. In the original's script, delete its two triggers on the Triggers page.
  4. In the copy's script, as ahmedalnimeri@gmail.com, run `setUp`.
  5. Share the copy with whoever had the original. Then trash the original and
     empty the trash: its history goes with it.

  The other way is to keep less in the sheet, such as a shortened or hashed IP
  address in place of the whole one. That would change what Visit # and
  Session are counted on, so it is not done here.
- **Briefs are not deleted.** /privacy says a brief is kept for a year. The
  Briefs tab keeps every brief it has had: names, emails, WhatsApp numbers,
  messages. v4 leaves briefs as they were. Until it is decided otherwise,
  delete Briefs rows older than a year by hand ("Received (Dubai)" column).

A request under "Your rights" on /privacy has to be honoured here too. Delete
that address's rows from All traffic and Visitors, then make the copy as
above, or its rows stay in the history.

From then on, everything is counted over the ninety days the sheet keeps:

- **Visit #** and **New/Returning** count only the visits still kept. An
  address whose earlier visits were deleted starts again at 1, New. Rows
  already written keep the numbers they were given, so an address's older row
  can show a higher Visit # than its newer one.
- **Session** numbers carry on across the deletions: a new row gets the number
  it would have had if nothing had been deleted. Each run counts on from the
  number of sessions already deleted, which is kept in the Script property
  `SESSIONS_PRUNED` (a count and a date, no address). A session still running
  when its first rows go keeps its number, is counted once, and is counted
  before any session that began after the cutoff. Two exceptions, both at the
  cutoff itself. Rows the sheet never had because the sync was stopped for
  ninety days or more are not counted, so sessions there can be numbered in a
  different order from v3. And a run started by hand less than thirty minutes
  after the one before can repeat a number while a session spans the cutoff,
  but only on a row it writes dated within thirty minutes after the cutoff,
  which happens only after a ninety-day outage or when Visitors was emptied by
  hand. Hourly runs never do.
- **Summary** counts the kept rows: "Covering" starts at most ninety days back,
  and "New vs returning" counts each address's first kept visit as New.

Each run asks D1 only for what is new. Visits are read from the sheet's newest
row, less six hours of overlap, and never from before the ninety days. So a row
once deleted is never asked for again, even while D1 (which deletes its old
rows only now and then) still holds it. Events are read from the ids above
`EVENTS_UP_TO`, the Script property that holds the highest id fetched. A quiet
spell that empties the tab therefore does not send the next run back for the
whole table, and nothing typed into the tab moves it.

## The sheet is the record

- A row deleted from All traffic stays deleted and is no longer counted.
  Later visit and session numbers are counted without it, so one may repeat a
  number already shown. To hide rows, use a filter view, not "Delete row".
- A row deleted only from Visitors comes back on the next run, because
  Visitors is refilled from All traffic.
- A row with anything other than a stamp in Timestamp (UTC) is skipped. It
  can't be dated, so it is not deleted at ninety days either: delete it by hand.
- **Don't insert, move or rename columns** from A to the last column the script
  writes (AB in the visit tabs, I in Events). New rows are written in that
  order, so a run that finds the columns changed adds nothing to that tab (and,
  for a visit tab, asks D1 for no new visits). It stops with an error naming
  the column until the column is put back, or, for the visit tabs, until
  `rebuild` is run; the first run after that catches up. Until then it still
  reads the tab by its headers, counts it, and deletes what is past ninety
  days. Put notes to the right of the last column, where they move with their
  row and go with it at ninety days, or on another tab.
- An event deleted from the Events tab stays deleted. Typing into the Event #
  column changes nothing. **If events stop arriving**, delete the Events tab
  and the next run makes it again from every event the site holds, resetting
  `EVENTS_UP_TO`. That can happen if the events table in D1 was dropped and
  made again, or restored to an earlier point, so that its ids started again
  lower.
- Each row keeps the Type it was written with. If the humans filter in
  `functions/api/visits.js` changes again, run `rebuild`. It rewrites both
  visit tabs from the ninety days D1 holds (the same ninety days the sheet
  keeps, so nothing is lost) and starts the visit and session numbers afresh.

## Tests

- `node mock-test.mjs Sync.gs` runs syncBriefs() and sync() against an
  in-memory fake sheet.
- `node e-after-test.mjs` tests `/api/e`'s `&after` against node:sqlite, with
  the table made by e.js's own CREATE TABLE. It checks that every response
  without `&after` is byte for byte what it was before.
- `node mock-sync-test.mjs` (about a quarter of an hour) replays 130 days of
  simulated traffic and site events, hourly, through v4, v3 (git b1d1c84, the
  commit on this branch that records the installed version) and the release
  version (git 3e5b0ef). Every fetch is served by the real
  `functions/api/visits.js` and `functions/api/e.js` over an in-memory SQLite,
  and charged the rows SQLite's own plan reads. It checks:
  1. until anything is ninety days old, v4's Visitors, All traffic and Summary
     equal v3's cell for cell, every day (also joining late, paging 7 rows at
     a time, after Visitors is emptied by hand, and after `rebuild`);
  2. v4's Events tab, funnel line included, equals the release's cell for cell,
     every day, on a log D1 never purges and on one it does;
  3. past ninety days, after every run: the three tabs hold exactly D1's rows
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
  cases (overlap, hand edits, a 95-day outage, paging). Section 10 covers the
  cases from the review of 5 Oct 2026, against v3 where it applies:
  - the key rotated for four days, and `/api/e` failing for two. Every run still
    deletes and reports the error, and the Session numbers afterwards are v3's.
  - a column inserted in both visit tabs for 55 days. Nothing is appended and
    old rows are still deleted. Once the column is out, the tabs and Session
    numbers are right.
  - notes to the right of the last column stay on their rows.
  - Event # typed over, `EVENTS_UP_TO` typed over, a recreated events table, and
    a tab with no `EVENTS_UP_TO`.
  - a session that spans the cutoff, after a 90-day stop and with runs ten
    minutes apart.

  It exits 1 if any check fails. If b1d1c84 is ever lost from history (a
  squash merge), pass `--v3 <rev>` with a commit that holds v3's Sync.gs.
