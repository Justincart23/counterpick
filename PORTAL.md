# CUUED on a game website

CUUED is one HTML5 folder that runs inside a website's `<iframe>`. This page is everything a game site (Flick, or any portal) needs.

## The package

`node scripts/build.js --portal` writes:

```
dist/portal/cuued/
  index.html        the whole game (code, styles, music and sound are all inside it)
  cards/            card art (loaded by relative path)
  logo.webp  favicon.svg  favicon.ico  icon-192.png  icon-512.png  manifest.webmanifest
  thumb.jpg         4:3 tile picture (480 x 360)
  thumb-wide.jpg    1200 x 630 banner
  game.json         title, description, tags, orientation, iframe settings, events (machine-readable)
dist/portal/cuued.zip   the same folder zipped, for upload forms
```

Copy `cuued/` into the site, e.g. `/games/cuued/`. Every path inside is relative, so any folder works.

## Embedding

```html
<iframe id="game" src="/games/cuued/index.html?share=https%3A%2F%2Fflick.com%2Fplay%2Fcuued"
  allow="fullscreen; autoplay; clipboard-write; web-share; screen-wake-lock"
  sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock"
  style="border:0;width:100%;height:100%"></iframe>
```

- Give the frame the whole play area. CUUED fits any size and asks phones to turn sideways for a match.
- The `allow` list is needed for full screen, sound before the first tap, sharing invite links and keeping a phone awake as a Big Screen controller.

### Options (in the iframe's address)

| Option | What it does |
|---|---|
| `share=<url>` | The site's own page for CUUED. Invite links and Big Screen QR codes become `<url>?join=ABCD`, so friends come back to the site. Without it they point at the game file itself. |
| `join=ABCD` | Join that room on load. The play page should pass on its own `?join=` (see below). |
| `mute=1` | Start muted. |

When a friend opens `https://flick.com/play/cuued?join=ABCD`, the play page must hand the code to the game:

```js
const join = new URLSearchParams(location.search).get('join');
const src = new URL('/games/cuued/index.html', location.href);
src.searchParams.set('share', location.origin + location.pathname);
if (join) src.searchParams.set('join', join);
document.getElementById('game').src = src;
```

## Messages

CUUED posts to the parent page: `{ flick: <type>, game: 'cuued', ...data }`.

| Type | When | Data |
|---|---|---|
| `ready` | loaded, menu showing | `title`, `orientation`, `multiplayer` |
| `gameplayStart` | a match or run begins | `mode` |
| `gameplayStop` | it ends, or the player goes back to the menu | |
| `gameOver` | the end screen shows | `mode`, `won` (true/false/null), `rounds`, or `score` (Survival: rounds survived) |

The site can send to the frame (`frame.contentWindow.postMessage({ flick: 'pause' }, '*')`):

| Type | Effect |
|---|---|
| `pause` / `resume` | Pauses a single-player match (online matches can't pause; use it for ads between games only) |
| `mute` / `unmute` | Sound off / on |
| `config` | `{ flick: 'config', share, join, site }`: same as the options above, after loading |

A good place for an ad is on `gameplayStop`, before the player starts again.

## Online play and the site's domain

- Matches connect players directly, peer to peer, so they work on any domain.
- For players on strict networks, CUUED fetches relay credentials from `https://www.cuued.com/api/turn`. That endpoint only answers sites it trusts: add the site's address to the Vercel environment variable `PORTAL_ORIGINS`, comma-separated, e.g. `https://flick.com,https://www.flick.com`. Without it, those few players fall back to the free public relays.
- Saves (name, coins, looks, best runs) live in the browser storage of whatever domain serves the game. Copying the folder onto the site gives one save shared by everyone who plays there. Embedding `https://www.cuued.com` directly instead keeps a separate save from cuued.com's own page.

## Inside a frame, CUUED

- never scrolls the page around it (arrow keys and Space are kept inside the game);
- hides its own "Add to Home Screen" prompt (that's the site's job);
- reloads only its own frame when a new version is deployed;
- keeps everything else: online play, Big Screen with phones as controllers, Survival, Customize.
