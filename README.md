# Counterpick

A one-on-one arena shooter that runs in the browser. Shoot, block and wall-jump to win points. The loser of each round drafts one card from a hand of five, so every loss lets you build a counter to your rival.

It's a fan tribute to the mechanics of [ROUNDS](https://store.steampowered.com/app/1557740/ROUNDS/) by Landfall. All the characters, cards, arenas, art, sounds and code here are original. No Landfall assets are used.

## Play

Open `index.html` in a browser. There's no build step, server or dependencies to install. Once GitHub Pages is enabled for this repo, it's also playable at the Pages URL.

| | Move | Jump | Drop through a plank | Aim | Shoot | Block |
|---|---|---|---|---|---|---|
| **Orange** | `A` `D` | `W` / `Space` | `S` | mouse | click | right-click / `Shift` |
| **Blue** (local versus) | `←` `→` | `↑` | `↓` | assisted | `.` | `/` |

A gamepad works for Blue: left stick, A, RT, LB, and the right stick to aim. Press `Esc` to pause and `M` to mute. In the menus, use `↑` `↓` to choose, `Enter` to select, `←` `→` to change a setting and `Esc` to go back.

## How a match works

1. Both players draft one card before the first shot.
2. A point ends when one fighter dies. Two points win a round.
3. The round's loser drafts one card from a hand of five. Cards stack.
4. The first player to win the set number of rounds (3, 5 or 7) takes the match.

If a point drags past 45 seconds, overtime starts. Bullets begin to seek their target, and damage climbs every 10 seconds until someone falls.

## What's in it

- **Combat:** 100 health, 55 damage per shot (two hits kill), a 3-round magazine, lobbed bullets with gravity, and a 4-second block.
- **34 cards** across gun, bullet, block and body upgrades, each with its own animated art. Examples: Ricochet, Seeker, Blast Cap, Mirror Guard, Ghost Rounds and Second Wind.
- **12 arenas** with one-way planks, solid walls, pits and hanging blocks that swing when you shoot or land on them.
- **CPU opponent** at three skill levels. It reacts to where you *were* a moment ago, swings its aim at a human speed, crosses gaps, climbs walls and blocks.
- **Synthesized sound effects** built with the Web Audio API, with a volume setting. No audio files.
- Reduced-motion support: screen shake and flashes are toned down when the OS asks for less motion.

## Project layout

```
src/counterpick.html   the game: one self-contained file (HTML, CSS, JS)
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
- **`card-art.js`** renders all 34 card animations for 12 seconds each.
- **`audio.js`** plays every sound effect into a mock Web Audio graph and checks its parameters.

GitHub Actions runs the same suite on every push (`.github/workflows/test.yml`). The tests need Node 20 or newer.

## Credits

Game design inspired by ROUNDS (Landfall, 2021). ROUNDS is a trademark of Landfall. This project isn't affiliated with or endorsed by Landfall.

## License

Counterpick is free software under the [GNU General Public License v3.0](LICENSE). You can use, study, share and modify it. Anything you distribute that's based on it must also be released under GPL-3.0, with its source code.
