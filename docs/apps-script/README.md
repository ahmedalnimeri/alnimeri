# Website Visitors sheet — Apps Script

`Sync.gs` is the script inside the "Website Visitors" Google Sheet
(project "alnimeri visitor sync",
https://script.google.com/home/projects/1eRmxk_6QhEJ1Dx4mHq3KYu46T4epvAdg3jCVOn44Dhq5ftc-zUf8j2CC/edit).
It keeps four tabs current: Visitors, All traffic, Summary (hourly) and Briefs
(every ten minutes; each new brief is also emailed to the sheet's owner).

The site key is not in the code. It lives in the project's Script properties as
`VISITS_TOKEN` — the same value as the Cloudflare Pages secret of that name.
If the key is rotated in Cloudflare, update the Script property too.

To install a new version: open the project, replace Code.gs with this file,
save, then run `setUp` once (it re-creates both triggers).

## Installing the incremental sync (first time only)

This version reads only what is new since the sheet's newest row, and counts
visit numbers, sessions and the Summary from the sheet's own rows. The old
version re-read the whole log every hour, so it never relied on what the sheet
held. Do this once, in order:

1. Delete the second `sync` trigger, the one on the other Google account
   (open the project's Triggers page while signed in as that account).
   `setUp` only sees its own account's triggers. Two triggers double the D1
   reads, and two runs can append the same rows twice.
2. Make a copy of the spreadsheet (File → Make a copy) as a backup, and
   note Summary → "Covering" and "Total hits logged" (the old version's
   figures, counted over the whole log).
3. Replace Code.gs with `Sync.gs`, save, and run `setUp`.
4. Run `rebuild` once. **Do this before 21 Nov 2026.** The log began on
   23 Aug 2026 and D1 keeps 90 days, so until then a rebuild loses nothing.
   It rewrites the Type column: views of the film pages, CV and reels written
   before 30 Sep 2026 (when fa191a0 made them count as people) still say
   "Bot" in All traffic. It also writes the occasional second hit the old
   dedupe dropped, and drops rows that two overlapping runs appended twice.
   `sync` copes without a rebuild (a row stored as Bot that Visitors lists
   counts as a person), but after it every stored row is right as stored.
5. Check Summary: "Covering" should start on the same day as before, and
   "Total hits logged" should be the same or a little higher (hits that
   arrived in between).

A full read for the rebuild costs about two passes over the log (2 × ~14k
rows as of October 2026). After that, an hourly run reads only the last few hours.

## The sheet is now the record

- A row deleted from All traffic stays deleted and is no longer counted.
  Later visit and session numbers are counted without it, so one may repeat a
  number already shown. To hide rows, use a filter view, not "Delete row".
- A row deleted only from Visitors comes back on the next run, because
  Visitors is refilled from All traffic.
- A row with anything other than a stamp in Timestamp (UTC) is skipped.
- Each row keeps the Type it was written with. If the humans filter in
  `functions/api/visits.js` changes again, run `rebuild` while D1 still holds
  the rows that matter. Anything older than 90 days is only in the sheet, and
  a rebuild drops it.

## Tests

`node mock-test.mjs Sync.gs` runs syncBriefs() against an in-memory fake sheet.
`node mock-sync-test.mjs` replays 130 days of simulated traffic through the
previous sync() (from git) and this one, against the real functions/api/visits.js
on an in-memory SQLite, and diffs the sheets cell by cell; it also prints the D1
rows each version reads per run. The new sheets must equal the old one apart from
holding the rare second hit (same stamp, IP and page, landing in a later run)
that the old dedupe dropped.
