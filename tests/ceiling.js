// The arena's energy border stops fighters, not bullets: on every arena, real shots fired upward (through the normal muzzle
// and update path) from high up must fly out over the top edge and fall back into the arena, like a lob.
//   node tests/ceiling.js
const { load } = require('./env');

(async () => {
  const { api: A } = await load({ seed: 7 });
  const angles = [-Math.PI / 2, -Math.PI / 2 + 0.25, -Math.PI / 2 - 0.25];
  let total = 0, wentOut = 0, cameBack = 0;
  const lost = [];

  for (const map of A.MAPS) {
    for (const ang of angles) {
      let tries = 0;
      do A.newPoint(true); while (A.game.map !== map && tries++ < 300);
      A.game.state = 'play';
      const [p, e] = A.players;
      e.alive = false; p.ctrl = 'test'; p.cards = []; A.recompute(p);
      p.x = A.game.map.sp[0][0]; p.y = 120; p.vx = 0; p.vy = 0;   // high up, so a shot clears the top edge
      p.input.aim = ang; p.input.fire = true; p.input.move = 0;
      A.update(1 / 60); p.input.fire = false;
      const mine = A.bullets.filter((b) => b.owner === p);
      const out = new Set(), back = new Set();
      for (let f = 0; f < 200; f++) {
        A.update(1 / 60);
        for (const b of mine) { if (b.y < -20) out.add(b); if (out.has(b) && b.y > 20) back.add(b) }
      }
      total += mine.length; wentOut += out.size; cameBack += back.size;
      for (const b of out) if (!back.has(b)) lost.push(`${map.name} ${ang.toFixed(2)}`);
    }
  }
  const failures = (!wentOut ? 1 : 0) + lost.length;
  if (!wentOut) console.error('no shot ever flew out over the top edge');
  for (const l of lost) console.error(`${l}: a shot went out over the top and never fell back in`);
  console.log(JSON.stringify({ arenas: A.MAPS.length, shots: total, wentOut, cameBack, failures }));
  process.exit(failures ? 1 : 0);
})();
