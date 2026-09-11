/**
 * /reel/<code>       — a viewer's own cut of the selects, rendered at the edge
 * /reel/<code>.edl   — the same cut as a CMX3600 cut list
 *
 * The code is the cut: one character per film, in the order the viewer put
 * them (keys in _lib/reel.js, generated from the tiles). Nothing is stored —
 * the link carries the whole selection, so it works forever, needs no
 * database, and says nothing about who made it. Stamps, TRT and the EDL are
 * derived from the chosen films by the same running sum as the home page.
 */
import { FILMS, ALPHABET, TEMPLATE } from '../_lib/reel.js';

const byKey = new Map(FILMS.map((f) => [f.key, f]));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => (n < 10 ? '0' : '') + n;
const mmss = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;
const tc = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}:00`;
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty'];

// A code is valid when every character names a film and none repeats.
export function decode(code) {
  if (!/^[a-z1-9]{1,32}$/.test(code)) return null;
  const seen = new Set(), films = [];
  for (const ch of code) {
    const f = byKey.get(ch);
    if (!f || seen.has(ch)) return null;
    seen.add(ch); films.push(f);
  }
  return films;
}

function tile(f, n, at) {
  const play = f.vid
    ? `data-video="${f.vid}" data-title="${esc(f.title)}" data-portrait="${f.portrait}"`
    : `target="_blank" rel="noopener" data-title="${esc(f.title)}"`;
  const label = f.vid ? `Play ${esc(f.title)}, ${mmss(f.secs)}` : `Watch ${esc(f.title)}, ${mmss(f.secs)}`;
  // Poster URLs are copied already stamped; this page lives one level down,
  // so they are made root-relative.
  const srcset = f.srcset.replace(/(^|, )assets\//g, '$1/assets/');
  return `        <article class="tile reveal${f.portrait ? ' tile--tall' : ''}" id="sc-${pad(n)}">
          <a class="tile__link" href="${esc(f.href)}" ${play} aria-label="${label}">
            <img srcset="${esc(srcset)}" sizes="(max-width: 560px) 100vw, (max-width: 900px) 50vw, 33vw" class="tile__img" src="/${esc(f.poster)}" alt="${esc(f.alt)}" loading="${n === 1 ? 'eager' : 'lazy'}" decoding="async" width="${f.w}" height="${f.h}">
            ${f.vid ? '<span class="tile__preview"></span>' : ''}
            <span class="tile__veil"></span>
            <span class="tile__play"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 0l14 8-14 8z"/></svg></span>
            <span class="tile__dur">${mmss(f.secs)}</span>
          </a>
          <div class="tile__meta">
            <span class="tile__idx">SC ${pad(n)} &middot; IN ${mmss(at)}</span>
            <div>
              <h3 class="tile__name">${esc(f.title)}</h3>
              <p class="tile__kind">${esc(f.kind)}</p>
              ${f.stat ? `<a class="tile__stat" href="${esc(f.statref || f.href)}" target="_blank" rel="noopener">${esc(f.stat)} <span aria-hidden="true">↗</span></a>` : ''}
            </div>
          </div>
        </article>`;
}

export function page(code, films) {
  let at = 0; const tiles = [];
  films.forEach((f, i) => { tiles.push(tile(f, i + 1, at)); at += f.secs; });
  const n = films.length, names = films.map((f) => f.title);
  const trt = mmss(at);
  const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  const title = `${n} film${n > 1 ? 's' : ''} from Ahmed El-Nimeri's reel — ${list}`;
  const desc = `A ${trt} cut of Ahmed El-Nimeri's work, pulled by a viewer: ${names.join(' · ')}. Director and video producer, Dubai.`;
  const headline = n === 1 ? `One film. ${trt}.` : `${WORDS[n] ? WORDS[n][0].toUpperCase() + WORDS[n].slice(1) : n} films. ${trt}.`;
  const first = films[0].poster.split('?')[0];
  const fill = {
    TOTAL_WORD: (WORDS[FILMS.length] || String(FILMS.length)).replace(/^./, (c) => c.toUpperCase()),
    CODE: code, CODE_UP: code.toUpperCase(), COUNT: String(n), COUNT_PAD: pad(n),
    COUNT_WORD: WORDS[n] || String(n), TRT: trt, TRT_TC: tc(at).slice(0, 8),
    TITLE: esc(title), DESC: esc(desc), HEADLINE: esc(headline),
    NAMES: names.map((t, i) => `<span>${pad(i + 1)} ${esc(t)}</span>`).join('<span class="screening__sep">·</span>'),
    OG_IMAGE: `https://alnimeri.com/${first}`,
    TILES: tiles.join('\n'),
  };
  return TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
}

export function edl(code, films) {
  const lines = [`TITLE: ALNIMERI_REEL_${code.toUpperCase()}`, 'FCM: NON-DROP FRAME', ''];
  let tot = 0;
  films.forEach((f, i) => {
    const d = f.secs;
    lines.push(`${pad(i + 1).padStart(3, '0')}  ${(f.vid || 'AX').padEnd(10)}  V  C  ${tc(0)} ${tc(d)} ${tc(tot)} ${tc(tot + d)}`);
    lines.push(`* FROM CLIP NAME: ${f.title.toUpperCase()}`);
    const host = f.href.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].toUpperCase();
    lines.push(`* SOURCE: ${host}${f.stat ? ' — ' + f.stat.toUpperCase() : ''}`);
    lines.push('');
    tot += d;
  });
  lines.push(`* TRT ${tc(tot)} · ${films.length} EVENTS · 24 FPS`,
    `* PULLED FROM THE ${FILMS.length}-CLIP SEQUENCE AT ALNIMERI.COM/REEL/${code.toUpperCase()}`,
    '* SEND THE BRIEF: AHMED@ALNIMERI.COM', '');
  return lines.join('\n');
}

export async function onRequestGet({ params, env, request }) {
  let code = String(params.code || '').toLowerCase();
  const wantEdl = code.endsWith('.edl');
  if (wantEdl) code = code.slice(0, -4);
  const films = decode(code);
  if (!films) {
    // Same 404 as the rest of the site, so a mistyped link still reads as the deck.
    const nf = env.ASSETS ? await env.ASSETS.fetch(new URL('/404.html', request.url)) : null;
    return new Response(nf ? await nf.text() : 'No such reel.', {
      status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (wantEdl) {
    return new Response(edl(code, films), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }
  return new Response(page(code, films), {
    headers: { 'content-type': 'text/html; charset=utf-8',
               // The cut is the URL; cache it, but the ?v= assets it names must
               // be able to move, hence must-revalidate like every other page.
               'cache-control': 'public, max-age=0, must-revalidate' } });
}
