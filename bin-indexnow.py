#!/usr/bin/env python3
"""Tell search engines which pages changed, right after a deploy (IndexNow).

Run it from the repo once the deploy is live, never before:

  python3 bin-indexnow.py             the sitemap URLs that are new or changed
                                      since this machine last sent them
  python3 bin-indexnow.py --dry-run   print what would be sent; send nothing
  python3 bin-indexnow.py --all       every URL in the sitemap
  python3 bin-indexnow.py URL ...     just these (alnimeri.com URLs only)

"Changed" is the sitemap's own word for it: a URL whose <lastmod> in
sitemap.xml differs from the one recorded when it was last sent. The record is
.indexnow-sent.json beside this script, on this machine only (.gitignore keeps
it out of the repo, so it is never deployed); without it, everything is new.

IndexNow is one POST to api.indexnow.org, which passes it on to Bing, Yandex,
Seznam, Naver and the other engines that take part. Google does not; it reads
sitemap.xml. The engines check that the site owns the key by fetching
https://alnimeri.com/<key>.txt, the file at the root whose name and content
are the key, so this script checks the same thing first, and that the live
sitemap is the one in this checkout (otherwise the deploy is not live yet and
the engines would crawl the old pages). Nothing is recorded unless the POST is
accepted (200 or 202).
"""
import json, pathlib, re, sys, urllib.error, urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent
SITE = 'https://alnimeri.com'
STATE = ROOT / '.indexnow-sent.json'
ENDPOINT = 'https://api.indexnow.org/indexnow'
NS = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
UA = {'User-Agent': 'alnimeri-indexnow/1 (+https://alnimeri.com)'}


def key():
    keys = [p for p in ROOT.glob('*.txt')
            if re.fullmatch(r'[0-9a-f]{32}', p.stem) and p.read_text().strip() == p.stem]
    if len(keys) != 1:
        sys.exit(f'bin-indexnow: expected one key file (<32 hex>.txt holding its own name) at the root, found {len(keys)}')
    return keys[0].stem


def get(url):
    req = urllib.request.Request(url, headers=dict(UA, **{'Cache-Control': 'no-cache'}))
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode('utf-8')


def sitemap(text):
    return {u.findtext('s:loc', namespaces=NS): u.findtext('s:lastmod', default='', namespaces=NS)
            for u in ET.fromstring(text).findall('s:url', NS)}


def main(argv):
    dry = '--dry-run' in argv
    every = '--all' in argv
    named = [a for a in argv if not a.startswith('--')]
    k = key()

    local_text = (ROOT / 'sitemap.xml').read_text()
    local = sitemap(local_text)
    try:
        state = json.loads(STATE.read_text()) if STATE.exists() else {}
    except ValueError:
        state = {}

    if named:
        bad = [u for u in named if not u.startswith(SITE + '/')]
        if bad:
            sys.exit(f'bin-indexnow: not an alnimeri.com URL: {bad[0]}')
        urls = named
    elif every:
        urls = list(local)
    else:
        urls = [u for u, mod in local.items() if state.get(u) != mod]

    if not urls:
        print('bin-indexnow: nothing new or changed since the last send')
        return 0
    print(f'bin-indexnow: {len(urls)} URL(s)' + (' (dry run, nothing sent)' if dry else ''))
    for u in urls:
        print('  ' + u)
    if dry:
        return 0

    # the engines will fetch these two; check them first
    try:
        live_key = get(f'{SITE}/{k}.txt').strip()
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f'bin-indexnow: {SITE}/{k}.txt is not reachable ({e}); deploy the key file first')
    if live_key != k:
        sys.exit(f'bin-indexnow: {SITE}/{k}.txt does not hold the key; deploy it first')
    try:
        live = sitemap(get(f'{SITE}/sitemap.xml'))
    except (urllib.error.URLError, OSError, ET.ParseError) as e:
        sys.exit(f'bin-indexnow: cannot read the live sitemap ({e})')
    if live != local:
        sys.exit('bin-indexnow: the live sitemap is not the one in this checkout; '
                 'run this after the deploy is live (or from the deployed commit)')

    body = json.dumps({'host': 'alnimeri.com', 'key': k, 'keyLocation': f'{SITE}/{k}.txt',
                       'urlList': urls}).encode('utf-8')
    req = urllib.request.Request(ENDPOINT, data=body, method='POST',
                                 headers=dict(UA, **{'Content-Type': 'application/json; charset=utf-8'}))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f'bin-indexnow: could not reach {ENDPOINT} ({e}); nothing recorded')
    meaning = {200: 'accepted', 202: 'accepted; the key is still being checked',
               400: 'bad request', 403: 'the key was not valid for this host',
               422: 'a URL does not belong to the host', 429: 'too many requests; try later'}
    print(f'bin-indexnow: {status} {meaning.get(status, "")}'.rstrip())
    if status not in (200, 202):
        return 1
    for u in urls:
        if u in local:
            state[u] = local[u]
    STATE.write_text(json.dumps(state, indent=1, sort_keys=True) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
