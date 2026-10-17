// Gameplay audit: plays CPU vs CPU (the menu's background match) headlessly and checks physics invariants.
//   node tests/audit.js [seconds=300] [seed=1]
// Fails if a bullet spawns on the far side of a wall, tunnels through one, a body ends a frame inside a wall,
// a point lasts over 90 game-seconds, or the game throws.
const { load } = require('./env');

const SECS = +(process.argv[2] || 300);
const SEED = +(process.argv[3] || 1);
const DT = 1 / 60;

(async () => {
  const { api: A, flushTimers } = await load({ seed: SEED });
  const inside = (x, y, r, m = 1) => x > r.x + m && x < r.x + r.w - m && y > r.y + m && y < r.y + r.h - m;
  // true if the straight segment passes through the interior of a static wall
  const crossesWall = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
    for (let i = 1; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      for (const r of A.solids) if (!r.bound && !r.swing && inside(x, y, r)) return true;
    }
    return false;
  };

  const stats = { seconds: SECS, seed: SEED, points: 0, rounds: 0, shots: 0, spawnThroughWall: 0, tunnels: 0, embedded: 0, stalls: 0, errors: 0 };
  const seen = new WeakSet();
  let t = 0, lastPointAt = 0, lastScore = '', lastState = '';

  while (t < SECS) {
    const prevBullet = new Map(A.bullets.map((b) => [b, [b.x, b.y]]));
    const prevOwner = new Map(A.players.map((p) => [p, [p.x, p.y]]));
    try { A.update(DT) } catch (e) { if (stats.errors++ < 3) console.error(e) }
    flushTimers();
    t += DT;

    for (const b of A.bullets) {
      if (b.phase || b.reflected) continue; // Ghost Rounds phase by design; reflected bullets change owner mid-frame
      if (b.shard && !prevBullet.has(b)) { seen.add(b); continue } // Splinter shards are born at the wall they hit, by design
      if (!seen.has(b)) {
        seen.add(b);
        if (prevBullet.has(b)) continue;
        stats.shots++;
        const o = b.owner, op = prevOwner.get(o) || [o.x, o.y];
        if (crossesWall(o.x, o.y, b.x, b.y) && crossesWall(op[0], op[1], b.x, b.y)) stats.spawnThroughWall++;
      } else if (prevBullet.has(b)) {
        const [px, py] = prevBullet.get(b);
        if (crossesWall(px, py, b.x, b.y)) stats.tunnels++;
      }
    }
    for (const p of A.players) {
      if (!p.alive) continue;
      if (A.solids.some((r) => !r.bound && !r.oneway && inside(p.x, p.y, r, 2))) stats.embedded++;
    }

    const g = A.game, score = `${g.wins}|${g.points}`;
    if (score !== lastScore) { if (lastScore && g.wins.join() !== lastScore.split('|')[0]) stats.rounds++; stats.points++; lastScore = score; lastPointAt = t }
    // time each point from its own start (a trade starts a new point without changing the score)
    if (g.state === 'ready' && lastState !== 'ready') lastPointAt = t;
    lastState = g.state;
    // overtime starts at 45 s and escalates damage, so a long camping duel ends by ~70 s; 90 s means something is stuck
    if (g.state === 'play' && t - lastPointAt > 90) { stats.stalls++; console.error(`stall on ${g.map.name}`); lastPointAt = t }
  }

  const bad = stats.spawnThroughWall + stats.tunnels + stats.embedded + stats.stalls + stats.errors;
  console.log(JSON.stringify(stats));
  process.exit(bad ? 1 : 0);
})();
