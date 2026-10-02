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

`node mock-test.mjs Sync.gs` runs syncBriefs() against an in-memory fake sheet.
