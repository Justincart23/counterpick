// No moving platform may pass through a wall, slab or plank of its own arena (a mover's whole sweep is checked on every duel arena)
//   node tests/movers.js
const { load } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 3 }), fail = []; let n = 0;
  for (const m of A.MAPS) { if (!m.duel || !m.movers) continue;
    for (const d of m.movers) { n++; for (let f = 0; f <= 1.001; f += .02) { const nx = d.x + d.mx * f, ny = d.y + d.my * f;
      for (const r of m.rects) if (nx < r[0] + r[2] && nx + d.w > r[0] && ny < r[1] + r[3] && ny + d.h > r[1]) { fail.push(`${m.name}: a mover passes through ${r.join(',')}`); f = 2; break } } } }
  console.log(JSON.stringify({ movers: n, failures: fail.length })); fail.forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
