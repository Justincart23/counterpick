# CUUED (cuued.com)

A free browser arena shooter (ROUNDS-style: lose a round, draft a card). Live at https://www.cuued.com.
README.md describes every feature in detail; read it before changing a system.

## Layout
- `src/counterpick.html`: the whole game (HTML, CSS and JS in one file). Edit this, never `index.html`.
- `node scripts/build.js` builds `index.html` from it. Always rebuild after editing.
- `const BUILD='…'` in the source: bump it for every deploy (online players on different builds can't play together; the page reloads itself onto a new build).
- `tests/`: Node tests that load the game headless (`tests/env.js`; add anything a test needs to its EXPOSE list). `node tests/run-all.js` runs them all.
- `scripts/`: real-browser checks in headless Chrome (`browser-flow`, `browser-mobile`, `browser-online`, `browser-party`, `browser-bigscreen`, `browser-bigsurv`), plus probes (`survival`/`balance`/`pacing`/`stress`, `relay-smoke`, `turn-check`). They SIGKILL Chrome and remove their temp profiles; keep it that way (leftover profiles once filled the disk).
- `api/turn`: Vercel function that serves Cloudflare TURN credentials.
- Deploy: push to `main` and Vercel publishes. Confirm with `curl -s https://www.cuued.com/ | grep "const BUILD"`.

## Main systems (search these names)
- Multiplayer: Versus (`openVersus`, lobby `roomLobbyChanged`, online party engine `partyList`/`partyBegin`, `game.room`, `game.ffa`) or Co-op; each offers Own screens or One big screen.
- Modes: `startMatch` (cpu, party, survival, sandbox, online-host/guest, demo). Big Screen: `game.screen`, `openBigScreen`, `bsStart`, the phone controller `ctl`/`pad*`. Big Screen Co-op Survival: `game.bsSurv`, `bsHeroes`, `bsBoard`.
- Online: host-authoritative, PeerJS plus an MQTT relay fallback. Guest prediction and corrections: `reconcile`, `net.offX/offY`.
- Survival: `survRound`, `survKind` (wave/swarm/waves/twist/elite/boss wheel), `TRAITS`, `survResolve` (pay, boss loot), shop `SHOP_PRICE`/`cardPrice`, revives `downTick`/`DOWN_T`.
- Phone card picks: `fitCards` / `#pick.flat` / `.pcard`. Customize: `renderLocker`. Hats stack one per slot (`HAT_SLOT`, `hatList`).
- Invite links: `?join=CODE` (`linkCode`, `inviteUrl`).
- Game websites: portal mode when inside an iframe (`portal`, `portalSay`, `?share=`); package with `node scripts/build.js --portal`; guide in `PORTAL.md`; check with `scripts/browser-portal.js`.

## Rules
- Run `node tests/run-all.js` (and the relevant browser scripts for UI changes) before every push. Look at screenshots for layout work: desktop 1440x900, phone upright 390x844, phone sideways 844x390.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Secrets live only in Vercel env vars. Never read or share `.env.local`. Leave the old Supabase env vars alone. Keep the Google TXT record at Namecheap.
- Never use ROUNDS' copyrighted art or audio. Music and most sound are generated in code; the big moments use CC0 samples from Kenney (kenney.nl), embedded as `SAMP_SRC`. Only add CC0 sounds.
- The Big Screen phone controller (`#pad`, `padSticks`, `padSend`) is the reference for **Flick Controllers**, the standard controller in all Flick games (the `flick-controllers` skill, `~/.claude/skills/flick-controllers`). Keep the two in step: a change to the controller's look, layout or feel goes into the skill's kit too, and the reverse.
- Phone controls show on touch devices only. Menus are laid out for an upright phone; matches ask to turn sideways.
- Test browsers run muted and are closed afterwards.
- Higgsfield credits cost real money: ask before generating anything.
- Don't delete anything important or anything that would need reinstalling.
- Code style: match the dense one-line style of the file; comments explain why, and no `//` comment mid-line before code.
