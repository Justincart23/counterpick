// Bounce pads must never throw a fighter into the top edge of the arena: on every arena, a fighter dropped onto each pad
// (normal gravity and the low-gravity twist, holding jump the whole way) rises high but takes no edge damage.
//   node tests/pads.js
const { load } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 7 });
  const H = 1 / 120, fail = [], rows = [];
  for (let mi = 0; mi < A.MAPS.length; mi++) {
    const pads = A.MAPS[mi].rects.filter((r) => r[4] === 3); if (!pads.length) continue;
    for (const low of [false, true]) for (const [x, y, w] of pads) {
      A.startMatch('cpu'); A.loadMap(mi); A.game.state = 'play'; A.game.dropT = 0; A.game.dropOff = 0;
      const [P, E] = A.players; E.alive = false; E.x = -999; P.cards = []; A.recompute(P);
      A.resetPlayer(P, [x + w / 2, y - 60]); P.ctrl = 'mouse'; P.edgeT = 0; P.edgeHit = null;
      A.game.twist = low ? { id: 'low' } : null; A.game.surv = low ? A.game.surv || {} : A.game.surv;
      A.keys.clear(); A.edges.clear(); A.keys.add('KeyW');
      let top = 1e9, hp = P.hp, launched = false;
      for (let i = 0; i < 240; i++) { A.update(H); if (P.vy < -1000) launched = true; top = Math.min(top, P.y - P.r); if (P.edgeHit === 'top') break }
      A.keys.clear();
      rows.push(`${A.MAPS[mi].name}${low ? ' (low gravity)' : ''} pad at ${x}: top of fighter reached y=${Math.round(top)}`);
      if (!launched) fail.push(`${A.MAPS[mi].name} pad at ${x}: should launch`);
      if (P.hp < hp || top <= 10) fail.push(`${A.MAPS[mi].name}${low ? ' (low gravity)' : ''} pad at ${x}: thrown into the top edge (y=${Math.round(top)})`);
    }
  }
  console.log(JSON.stringify({ pads: rows.length, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
