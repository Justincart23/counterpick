// Fires real shots upward on every arena (through the normal muzzle and update path) and checks that
// no bullet ever gets above the arena ceiling.
//   node tests/ceiling.js
const { load } = require('./env');

(async () => {
  const { api: A } = await load({ seed: 7 });
  const angles = [-Math.PI / 2, -Math.PI / 2 + 0.25, -Math.PI / 2 - 0.25, -Math.PI / 2 + 0.6, -Math.PI / 2 - 0.6];
  let total = 0, escapes = 0;

  for (const map of A.MAPS) {
    for (const ang of angles) {
      let tries = 0;
      do A.newPoint(true); while (A.game.map !== map && tries++ < 300);
      A.game.state = 'play';
      const [p, e] = A.players;
      e.alive = false; p.ctrl = 'test'; p.cards = [];
      for (let f = 0; f < 5; f++) A.update(1 / 60); // settle on the ground
      const seen = new Set();
      for (let f = 0; f < 240; f++) {
        p.input.aim = ang; p.input.fire = f < 30; p.input.move = 0;
        A.update(1 / 60);
        for (const b of A.bullets) {
          if (!seen.has(b)) { seen.add(b); total++ }
          if (b.y < -2) { escapes++; console.error(`${map.name}: bullet above the ceiling at y=${b.y.toFixed(1)}`) }
        }
      }
    }
  }
  console.log(JSON.stringify({ arenas: A.MAPS.length, shots: total, escapes }));
  process.exit(escapes || !total ? 1 : 0);
})();
