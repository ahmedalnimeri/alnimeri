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

Visit rows (Visitors, All traffic) and events older than ninety days are
deleted on every run, and never added, as alnimeri.com/privacy promises. IP
addresses stay whole while a row is kept: the sheet tells new visitors from
returning ones by IP. Briefs are not pruned here.

The site key is not in the code. It lives in the project's Script properties as
`VISITS_TOKEN` — the same value as the Cloudflare Pages secret of that name.
If the key is rotated in Cloudflare, update the Script property too.

To install a new version: open the project, replace Code.gs with this file,
save, then run `setUp` once (it re-creates both triggers and runs a first sync,
which creates the Events tab and deletes the visit rows older than ninety days).

`node mock-test.mjs Sync.gs` runs syncBriefs() and sync() against an in-memory
fake sheet.
