// Climb arenas: ordinary arenas with lava that rises from the bottom once the point starts. The lava engulfs (health drains every
// second, the fighter is set alight and the burn outlasts the lava), a fighter who stays low dies, the lava never starts before its delay,
// CPUs climb ahead of it, and a point always ends
//   node tests/climb.js
const { load, flushTimers } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 9 });
  const fail = [], out = {};
  const idx = A.MAPS.map((m, i) => m.climb ? i : -1).filter((i) => i >= 0);
  if (idx.length < 5) fail.push('expected 5 climb arenas, found ' + idx.length);
  const run = (secs, stop) => { for (let i = 0; i < secs * 60 && !(stop && stop()); i++) { A.update(1 / 60); flushTimers() } };
  for (const mi of idx) {
    const m = A.MAPS[mi], G = A.game;
    if (m.w !== 2208 || m.h < 3000 || m.h > 4000) fail.push(`${m.name}: unexpected size ${m.w}x${m.h}`);
    // every plank has another within one air jump below it (192 up, a hop sideways), so there is always a way up
    const pl = m.rects.filter((r) => !r[4] && r[3] === 32).sort((a, b) => b[1] - a[1]); let stuck = 0;
    for (const r of pl) { if (r[1] > m.h - 200) continue; const below = m.rects.filter((q) => q[1] > r[1] && q[1] - r[1] <= 230 && q[0] < r[0] + r[2] + 330 && q[0] + q[2] > r[0] - 330); if (!below.length) stuck++ }
    if (stuck) fail.push(`${m.name}: ${stuck} planks have nothing within a jump below them`);
    for (const d of m.movers || []) for (let f = 0; f <= 1.001; f += .02) for (const r of m.rects) if (d.x < r[0] + r[2] && d.x + d.w > r[0] && d.y + d.my * f < r[1] + r[3] && d.y + d.my * f + d.h > r[1]) { fail.push(`${m.name}: a lift passes through ${r.join(',')}`); f = 2; break }
    // idle fighters standing on the floor: lava is quiet for its delay, then rises, burns and sets them alight
    A.startMatch('cpu'); A.loadMap(mi); G.state = 'play'; G.dropT = 0; G.dropOff = 0; G.pointT = 0; G.otRise = 0;
    A.players.forEach((p, k) => { A.resetPlayer(p, m.sp[k]); p.ctrl = 'idle'; p.input = { move: 0, aim: 0 }; p.hp = 5000; p.s.maxHp = 5000 });
    run(3); const early = G.otRise; let lit = false, hpIn = null, dotsMax = 0;
    for (let i = 0; i < 60 * 40; i++) { A.update(1 / 60); flushTimers(); const p = A.players[0]; if (p.lava && hpIn == null) hpIn = p.hp; if (p.dots.some((d) => d.f)) lit = true; if (G.state !== 'play') break }
    out[m.name] = Math.round(G.otRise);
    if (early !== 0) fail.push(`${m.name}: the lava rose before its delay (${early})`);
    if (!(G.otRise > 1300)) fail.push(`${m.name}: the lava barely rose (${G.otRise} after 43 s; the tall maps need a long rise)`);
    if (!lit) fail.push(`${m.name}: a fighter in lava was never set alight`);
    const lost = A.players.map((p) => 5000 - p.hp); if (!(lost.every((l) => l > 100))) fail.push(`${m.name}: lava did not drain health (lost ${lost.map(Math.round)})`);
    if (G.overtime) fail.push(`${m.name}: overtime started in a climb arena`);
    // health drains by the second, not in lumps: one second under the surface costs about LAVA_DPS
    A.startMatch('cpu'); A.loadMap(mi); G.state = 'play'; G.dropT = 0; G.dropOff = 0; G.pointT = 20; G.otRise = G.h || 600;
    const q = A.players[0]; A.resetPlayer(q, m.sp[0]); q.hp = 5000; q.s.maxHp = 5000; q.y = G.map.h - 100; q.vy = 0; q.dots = [];
    run(1); const dm = 5000 - q.hp; if (!(dm > 15 && dm < 70)) fail.push(`${m.name}: one second in lava cost ${Math.round(dm)} health (want ~25-50)`);
    // a CPU duel on the arena ends and the CPUs get off the floor
    A.startMatch('cpu'); A.loadMap(mi); G.state = 'play'; G.dropT = 0; G.dropOff = 0; G.pointT = 0; G.otRise = 0;
    A.players.forEach((p, k) => { A.resetPlayer(p, m.sp[k]); p.ctrl = 'cpu'; p.skill = 'hard' });
    let top = 99999; run(80, () => { for (const p of A.players) if (p.alive) top = Math.min(top, p.y); return G.state === 'pointEnd' });
    out[m.name + 'Top'] = Math.round(top); if (G.state !== 'pointEnd') fail.push(`${m.name}: a CPU duel did not end within 80 s`);
  }
  console.log(JSON.stringify({ ...out, failures: fail.length })); fail.forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
