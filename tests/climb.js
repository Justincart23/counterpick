// Climb arenas: a tall shaft with lava rising from below. Every plank is one jump above the last (a fighter that just keeps
// jumping and walking up the tracks reaches the summit), the lava starts after a few seconds and speeds up, it kills anyone who
// stays low, CPUs climb ahead of it, and a point always ends
//   node tests/climb.js
const { load, flushTimers } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 9 });
  const fail = [], out = {};
  const idx = A.MAPS.map((m, i) => m.climb ? i : -1).filter((i) => i >= 0);
  if (idx.length < 3) fail.push('expected 3 climb arenas, found ' + idx.length);
  const run = (secs, stop) => { for (let i = 0; i < secs * 60 && !(stop && stop()); i++) { A.update(1 / 60); flushTimers() } };
  for (const mi of idx) {
    const m = A.MAPS[mi];
    // geometry: from every plank the next one up is within a single jump (150 px) and a short sideways step
    const planks = m.rects.filter((r) => !r[4] && r[3] === 32 && r[1] > 120 && r[0] !== 670).sort((a, b) => b[1] - a[1]);
    let bad = 0; for (const r of planks) { const above = m.rects.filter((q) => !q[4] && q[3] <= 56 && q[1] < r[1] && r[1] - q[1] <= 150 && q[0] < r[0] + r[2] + 260 && q[0] + q[2] > r[0] - 260); if (!above.length) bad++ }
    if (bad) fail.push(`${m.name}: ${bad} planks have nothing within a jump above them`);
    // an idle fighter is burnt out of the shaft; a CPU pair climbs and the point ends
    A.startMatch('cpu'); A.loadMap(mi); const G = A.game; G.state = 'play'; G.dropT = 0; G.dropOff = 0; G.pointT = 0; G.otRise = 0;
    A.players.forEach((p, k) => { A.resetPlayer(p, m.sp[k]); p.ctrl = 'idle'; p.input = { move: 0, aim: 0 }; p.hp = 5000 })
    run(4); const early = G.otRise; run(30); out[m.name + 'Rise'] = Math.round(G.otRise);
    if (early !== 0) fail.push(m.name + ': the lava rose before its delay (' + early + ')');
    if (!(G.otRise > 700)) fail.push(m.name + ': the lava barely rose (' + G.otRise + ' after 34 s)');
    if (!(A.players.every((p) => p.hp < 5000 || !p.alive))) fail.push(m.name + ': idle fighters on the floor were not burnt');
    if (G.overtime) fail.push(m.name + ': overtime started in a climb arena');
    A.startMatch('cpu'); A.loadMap(mi); G.state = 'play'; G.dropT = 0; G.dropOff = 0; G.pointT = 0; G.otRise = 0; A.players.forEach((p, k) => { A.resetPlayer(p, m.sp[k]); p.hp = 120; p.ctrl = 'cpu'; p.skill = 'hard' })
    let top = 99999; run(70, () => { for (const p of A.players) if (p.alive) top = Math.min(top, p.y); return G.state === 'pointEnd' });
    out[m.name + 'Top'] = Math.round(m.h - top); if (G.state !== 'pointEnd') fail.push(m.name + ': a CPU duel did not end within 70 s');
    if (!(m.h - top > 500)) fail.push(m.name + ': CPUs never climbed (best height ' + (m.h - top) + ')');
  }
  console.log(JSON.stringify({ ...out, failures: fail.length })); fail.forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
