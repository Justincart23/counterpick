# CUUED

**Queue up. Duel a friend.** A one-on-one arena shooter that runs in the browser at **[cuued.com](https://cuued.com)**. Shoot, block and wall-jump to win points. The loser of each round drafts one card from a hand of five, so every loss lets you build a counter to your rival.

The name is said like *queued*: pick a name, share a 4-letter code, and you're in a duel. No download, no account.


## Play

Go to [cuued.com](https://cuued.com), or open `index.html` in a browser. There's no build step, server or dependencies to install. A copy also runs on [GitHub Pages](https://justincart23.github.io/counterpick/).

The first time you open it, you pick a name. It's remembered in your browser, and you can change it from the title screen or Settings.

### Online play

1. One player picks **Play online → Host a game** and gets a 4-letter room code and an invite link.
2. The other player opens the link, or picks **Play online → Join with a code** and types the code.
3. The match starts as soon as they connect. Both players draft at the start, and each round's loser drafts on their own screen.

Online play is peer-to-peer. The host's browser runs the match, and the guest sends its inputs and draws the host's snapshots. The guest's own fighter is **predicted locally**, so it responds instantly, and it's corrected against the host's acknowledged state without visible jumps. The free public [PeerJS](https://peerjs.com) broker only introduces the two browsers, so there is no game server to run.

When two networks can't link directly (strict routers, campus or office Wi-Fi, some phone carriers), the game **falls back to a relay automatically**. Messages go through free public MQTT brokers ([EMQX](https://www.emqx.com/en/mqtt/public-mqtt5-broker), then [Mosquitto](https://test.mosquitto.org)) over secure WebSockets, with no account needed. The host listens on every broker, and the guest uses the first one that answers. A relayed match adds about 40–80 ms each way, shows `ONLINE (RELAY)` at the top of the screen, and sends snapshots at 20 Hz instead of 30. These are free test brokers with no uptime guarantee, which suits a game played with friends. `node scripts/relay-smoke.js` checks them live.

**Optional upgrade: Cloudflare TURN.** `api/turn.js` is a Vercel function that can hand out short-lived [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/) credentials (free for the first 1 TB a month). That keeps even blocked networks on a fast WebRTC path, so the MQTT fallback is rarely needed. To enable it, set two environment variables on the Vercel project and redeploy:

| Variable | Where to find it |
|---|---|
| `CF_TURN_KEY_ID` | Cloudflare dashboard > Realtime > TURN Server > your key's **Turn Token ID** |
| `CF_TURN_KEY_TOKEN` | The **API Token** shown once when you create that key |

Without them, `/api/turn` returns STUN only and the MQTT relay covers blocked networks. `node scripts/turn-check.js` confirms the credentials work by allocating (and releasing) a real relay slot.

| | Move | Jump | Drop through a plank | Aim | Shoot | Block |
|---|---|---|---|---|---|---|
| **You** | `A` `D` or `←` `→` | `W` / `Space` / `↑` | `S` / `↓` | mouse | click | right-click / `Shift` |

Press `Esc` to pause and `M` to mute. In the menus, use `↑` `↓` to choose, `Enter` to select, `←` `→` to change a setting and `Esc` to go back.

## How a match works

1. Both players draft one card before the first shot.
2. A point ends when one fighter dies. Two points win a round.
3. The round's loser drafts one card from a hand of five. Cards stack.
4. The first player to win the set number of rounds (3, 5 or 7) takes the match.

If a point drags past 45 seconds, overtime starts. Bullets begin to seek their target, and damage climbs every 10 seconds until someone falls.

## What's in it

- **Combat:** 130 health, 55 damage per shot (three plain hits kill), a 3-round magazine, and a 4-second block. Movement and bullets are tuned from frame-by-frame measurements of ROUNDS gameplay: low, snappy jumps (about four body-heights, plus a small double jump and wall jumps), and slower bullets that drop hard, so long shots are lobbed. Bullets fly as glowing tracers and throw sparks where they hit. An optional aim guide (Settings) shows the first stretch of your shot's arc. Your own explosions hurt you a little, so don't fire explosive rounds point-blank.
- **48 cards** across gun, bullet, block and body upgrades, each with its own custom icon and animated art. Each card in a hand rolls 55% common, 32% uncommon, 13% rare, so about half of hands show a rare (and three drafts without one guarantee one). Cards stack, so combos multiply. Many change how you move or fight, not just your numbers: Limpet Mines stick to walls and blow half a second later (careful, they hurt you too), Bulwark raises a bullet-stopping wall when you block, Cluster Guard tosses bombs when you block, Frost Guard freezes a nearby rival, Gravity Well bullets drag your rival, Aegis soaks a hit.
- **21 arenas** (ROUNDS-style: chunky platforms, cover blocks, symmetric layouts, every climb within one jump plus an easy double jump) with one-way planks, solid walls, pits, hanging blocks that swing when you shoot or land on them, moving platforms that carry you, and bounce pads. The arena edge is a glowing energy border, not a wall: touching the sides or ceiling hurts and knocks you back (you can wall-jump up the arena's blocks, never up its edges), and falling to the bottom pops you up with damage instead of killing you outright.
- **ROUNDS-style tricks** (from studying a ROUNDS tips guide):
  - **Duck** by holding `S` on the ground: your hitbox squashes flat and head-height shots sail over. In the air, `S` cuts a jump short or drops you fast.
  - **Grip walls** by holding toward them: you barely slide, and your air jump comes back. Jump while holding into the wall to climb it; jump without holding to kick off it.
  - **Perfect parry:** a block that meets a bullet in its first 0.12 s sends it back at the shooter (PARRY).
  - **Edge launches:** block as you hit the arena border to bounce off it unhurt: off the bottom you launch about halfway up the screen with your air jump back (enough to get onto a platform from any gap; `edge-save.js` checks every arena), off a side you rocket back in, off the top you spike down.
  - **Hanging blocks hurt:** shoot one so it swings hard into your rival to smash them; block to knock it back.
  - New cards: **Echo Guard** (every block fires a second free block a beat later) and **Shield Charge** (blocking dashes you along your aim and rams your rival). Long Haul bullets now grow as they fly, like ROUNDS' Grow.
- **Plays on phones:** on a touch screen (held sideways) a stick appears under your left thumb (run, flick up to jump, pull down to duck or drop) and an aim stick under your right, Brawl Stars style (tap to auto-aim and fire, or drag to aim and let go to fire; drag back to the middle to cancel; a tap while the gun is still cycling waits a moment for it instead of being lost, and the aim arc shows only while you drag), with Jump and Block buttons in the side margin. They drive the same inputs as a keyboard and mouse, so online play, Sandbox and every trick work the same. A Full screen button (Android) or an Add to Home Screen hint (iPhone, which opens CUUED full screen through the web app manifest) shows on phones only, and holding the phone upright mid-match asks you to turn it.
- **CUUED coins & Shop:** win a full match to earn coins (2 for an online win or a Hard CPU, 1 for a Normal or Easy CPU; streaks tracked) and spend them in the Shop on hats, body patterns and bullet-trail colours. Cosmetic only, so nobody can buy an edge; your opponent sees what you wear online. Coins are kept in your browser.
- **Sandbox:** hand yourself or the CPU any cards you like, as many copies as you want, and try them out with no drafting. Press Tab mid-fight to change cards; the CPU can fight back, dodge without shooting, or stand still as a target, and you can lock the arena.
- **Instant shots for the joining player:** their bullet leaves the gun the moment they click (a predicted bullet with the same speed, drop, walls and bounces), and the host fires the real one on the exact same physics step; when it arrives it takes over the predicted bullet's place and trail. Every bullet on the joining player's screen is placed on the host's clock and glides between updates.
- **Smooth online play:** the joining player's game runs hanging blocks and moving platforms itself and steers toward the host's, and draws the other fighter a few milliseconds in the past along its true path, so nothing shakes between network updates. `net.js` checks both.
- **Online 1v1** by room code or invite link, peer-to-peer, with no accounts.
- **CPU opponent** at three skill levels. It reacts to where you *were* a moment ago, swings its aim at a human speed, crosses gaps, climbs walls and blocks.
- **Original music and sound**, generated live with the Web Audio API: a looping minor-key groove that ducks during card picks, and effects with a room reverb so impacts boom. Music and volume settings; no audio files.
- **The sky tells the score:** each match starts at night and moves toward dawn as the leader nears the winning score. The last round is announced as FINAL ROUND.
- Reduced-motion support: screen shake and flashes are toned down when the OS asks for less motion.

## Project layout

```
src/counterpick.html   the game: one self-contained file (HTML, CSS, JS)
vercel.json            serves the repo as a static site on Vercel (cuued.com)
api/turn.js            Vercel function: optional Cloudflare TURN credentials for online play
scripts/relay-smoke.js live check of the public MQTT relays (not in CI)
scripts/turn-check.js  live check of the Cloudflare TURN relay: real authenticated allocation (not in CI)
scripts/balance.js     CPU-vs-CPU win rate of every card on its own (not in CI)
scripts/pacing.js      full CPU matches: point length, close matches, comebacks, overtime (not in CI)
scripts/browser-online.js  a real online match between two headless Chrome windows over PeerJS: bots play with every block and
                       movement card; checks errors, fps, snapshot rate and host/visitor agreement on both screens (not in CI)
scripts/browser-mobile.js  emulates a phone held sideways with real touch events: sticks, buttons, layout, rotate prompt (not in CI)
scripts/reach.js       drives a fighter over every arena (with a 12% jump-height margin) and fails if any platform, wall top,
                       hanging block or moving platform can't be reached from both spawns (not in CI: ~80 s)
scripts/stress.js      long CPU matches with big random card stacks: crashes, NaN, runaway bullets, stalls (not in CI)
scripts/browser-perf.js headless Chrome frame times at 1x and 2x pixel density, up to hundreds of bullets (not in CI)
scripts/browser-flow.js headless Chrome walkthrough: name, menu, draft, pause, settings, and a real online match on the live site (not in CI)
index.html             generated from src/ by scripts/build.js; adds the standalone page shell
scripts/build.js       node scripts/build.js [--check]
tests/                 headless test suite (plain Node, no dependencies)
```

Edit `src/counterpick.html`, then run `node scripts/build.js` to regenerate `index.html`. CI fails if you forget.

## Tests

```
node tests/run-all.js
```

The tests load the game headlessly with a stubbed DOM and canvas, then check:

- **`audit.js`** plays CPU vs CPU and fails if a bullet spawns past a wall, a bullet tunnels through one, a body ends a frame inside a wall, a point stalls, or the game throws.
- **`ceiling.js`** fires shots upward on every arena and fails if any bullet gets above the ceiling.
- **`net.js`** loads two copies of the game, connects them through a mock PeerJS with 40 ms latency, and has bots play a full online match. It runs at 40 ms and on a laggy, jittery link (90 ms ± 45 ms, like a cross-country connection), each also in a `features` mode where both fighters carry every block/movement card and the bots duck, parry, dash and launch off edges while both screens draw, and fails if the guest's own fighter ever ends up inside or passes through a wall. It checks joining by code, drafting on both screens, input relay, view sync, rematch, a full room, a wrong code and disconnects. It also plays a relayed match through a mock MQTT broker (which parses the real packets) with the direct link blocked and the first broker down.
- **`movement.js`** runs the same input timeline at 30, 60, 120, 144 and 240 fps and checks that run speed, jump height, tap-jump height and long-jump distance match. Physics advances in fixed 1/120 s steps on every device.
- **`points.js`** checks scoring (the first death decides the point; only near-simultaneous deaths are trades) and the arena edges (damage and knock-back, a small pop off the bottom, no clinging to edges).
- **`stacking.js`** fires every card stacked 1, 3, 6 and 9 times, plus 300 random mixed decks, and fails if a deck shoots nothing, its bullets don't fly, or anything goes NaN.
- **`cpu-reach.js`** checks that the CPU can get to you and land a hit on every arena, from either spawn.
- **`combos.js`** checks that you and the CPU can wall-jump up the arena's blocks but never climb its edges, that your own explosions hurt you a little, that Sandbox loadouts apply with no drafting, that stacked cards keep both effects (Limpet Mines with Splinter Rounds, double Ricochet), that the block cards work (Cluster Guard bombs, Frost Guard freeze, Double Guard's second charge), and that blocking into the bottom edge saves you and launches you high.
- **`card-art.js`** renders all 44 card animations and icons for 12 seconds each.
- **`turn.js`** checks the relay function: STUN fallback, Cloudflare credentials, port-53 filtering, CORS.
- **`audio.js`** plays every sound effect into a mock Web Audio graph and checks its parameters.

GitHub Actions runs the same suite on every push (`.github/workflows/test.yml`). The tests need Node 20 or newer.

## Credits

Game design inspired by ROUNDS (Landfall, 2021). ROUNDS is a trademark of Landfall. This project isn't affiliated with or endorsed by Landfall.

## License

CUUED is free software under the [GNU General Public License v3.0](LICENSE). You can use, study, share and modify it. Anything you distribute that's based on it must also be released under GPL-3.0, with its source code.
