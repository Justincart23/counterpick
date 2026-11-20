// Dropping through wood never leaves you stuck inside the plank: on every arena, a fighter stands on each stretch of every wooden
// plank, holds down for a second, and must end up either back on top of it or clear below it (never embedded in it)
//   node tests/dropthru.js
const { load, flushTimers } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 5 }), fail = []; let n = 0;
  for (let mi = 0; mi < A.MAPS.length; mi++) { const m = A.MAPS[mi]; if (!m.duel && !m.party) continue;
    A.startMatch('cpu'); flushTimers(); A.loadMap(mi); A.game.state = 'play'; A.game.dropT = 0;
    const [P, E] = A.players; P.ctrl = 'idle'; E.ctrl = 'idle'; E.x = -9999;
    const planks = A.solids.filter((r) => r.oneway && !r.bound && !r.ride && !r.swing && !r.mover);
    for (const w of planks) for (let x = w.x + 26; x < w.x + w.w - 26; x += 24) {
      A.resetPlayer(P, [x, w.y - 1]); P.y = w.y - P.r; P.vy = 0; P.vx = 0;
      for (let f = 0; f < 10; f++) { A.update(1 / 60); flushTimers() }
      if (P.ground !== w) continue; n++;
      for (let f = 0; f < 60; f++) { P.input.down = true; P.input.move = 0; A.update(1 / 60); flushTimers() }
      P.input.down = false;
      const bot = P.y + P.r;
      if (P.alive && bot > w.y + 3 && P.y - P.r < w.y + w.h - 2 && P.grounded) { fail.push(`${m.name}: stuck in the plank at ${Math.round(w.x)},${Math.round(w.y)} (x ${Math.round(x)})`); break }
    }
  }
  console.log(JSON.stringify({ spots: n, failures: fail.length })); fail.slice(0, 20).forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
