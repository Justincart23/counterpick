// Movement accuracy: the same inputs must produce the same motion on any screen refresh rate (30 to 240 fps),
// and the core numbers must stay where the game is tuned. Inputs follow a real-time timeline, not a frame count.
//   node tests/movement.js
const { load } = require('./env');

const EXPECT = { run1s: [462, 482], jumpApex: [145, 165], tapApex: [95, 120], longJump: [295, 345], airtime: [0.55, 0.65] };   // ROUNDS-like: low, snappy jumps
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg) };

(async () => {
  const { api: A } = await load({ seed: 1 });
  const rows = [];
  for (const fps of [30, 60, 120, 144, 240]) {
    const dt = 1 / fps;
    // advance real time t seconds, holding keys per a timeline: keysAt(time) -> Set of codes
    const play = (seconds, keysAt, onFrame) => {
      let t = 0; const held = new Set();
      while (t < seconds - 1e-9) {
        const want = keysAt(t);
        for (const k of want) if (!held.has(k)) { held.add(k); A.keys.add(k); A.edges.add(k) }
        for (const k of [...held]) if (!want.has(k)) { held.delete(k); A.keys.delete(k) }
        A.update(dt); t += dt; if (onFrame && onFrame(t) === false) break;
      }
      A.keys.clear(); A.edges.clear();
    };
    const setup = () => {
      A.startMatch('cpu'); A.loadMap(0); A.game.state = 'play'; A.game.dropT = 0; A.game.dropOff = 0;
      const [p, e] = A.players; e.ctrl = 'idle'; e.alive = false; p.cards = []; A.recompute(p); A.resetPlayer(p, [700, (A.game.map.h || 900) - 180]);   // on the floor, with clear running room to the right
      A.keys.clear(); A.edges.clear(); A.mouse.down = false; play(1, () => new Set()); return p;
    };
    const none = () => new Set();
    let p = setup(); const x0 = p.x; play(1, () => new Set(['KeyD'])); const run1s = p.x - x0;
    p = setup(); const y0 = p.y; let minY = y0, air = 0, left = false;
    play(1.5, (t) => new Set(t < 0.6 ? ['KeyW'] : []), (t) => { if (p.y < minY) minY = p.y; if (!p.grounded) { left = true; air = t } else if (left) return false });
    p = setup(); const y1 = p.y; let minT = y1;
    // a tap of 2/30 s: a whole number of frames at 30, 60, 120 and 240 fps, so those rates see the identical input
    play(1.2, (t) => new Set(t < 2 / 30 - 1e-9 ? ['KeyW'] : []), () => { if (p.y < minT) minT = p.y });
    p = setup(); play(0.5, () => new Set(['KeyD'])); const xs = p.x; let wasAir = false, landX = null;
    play(1.5, () => new Set(['KeyD', 'KeyW']), () => { if (!p.grounded) wasAir = true; else if (wasAir && landX == null) { landX = p.x; return false } });
    rows.push({ fps, run1s: +run1s.toFixed(1), jumpApex: +(y0 - minY).toFixed(1), tapApex: +(y1 - minT).toFixed(1), longJump: +((landX ?? p.x) - xs).toFixed(1), airtime: +air.toFixed(3) });
  }
  console.table(rows);
  for (const k of ['run1s', 'jumpApex', 'tapApex', 'longJump']) {
    // at 144 fps a key release can only land on a 1/144 s frame boundary, so its tap is a slightly different input
    const v = rows.filter((r) => k !== 'tapApex' || r.fps !== 144).map((r) => r[k]), mean = v.reduce((a, b) => a + b) / v.length, spread = (Math.max(...v) - Math.min(...v)) / mean;
    // landing is sampled on frame boundaries, so allow one frame of travel at 30 fps for the long jump
    check(spread < (k === 'longJump' ? 0.045 : 0.02), `${k} should match across frame rates (spread ${(spread * 100).toFixed(1)}%)`);
    check(rows.map((r) => r[k]).every((x) => x >= EXPECT[k][0] && x <= EXPECT[k][1]), `${k} should stay within its tuned range ${EXPECT[k]} (got ${v})`);
  }
  console.log(JSON.stringify({ frameRates: rows.length, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
