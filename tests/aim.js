// The aim guide shows exactly where a shot flies: for a plain gun, several builds (big, fast, heavy, accelerating, homing's
// lighter drop) and the low-gravity and fast-bullet twists, a real bullet is fired from where the guide starts, along the
// same aim, and stepped by the game; at every step it must sit on the guide's path (within half a pixel).
//   node tests/aim.js
const { load } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 5 });
  const fail = [], rows = [];
  const decks = { plain: [], 'Fat Rounds': ['Fat Rounds'], 'Rail Slug': ['Rail Slug'], 'Lob Shell': ['Lob Shell'], Accelerator: ['Accelerator'], Seeker: ['Seeker'] };
  for (const twist of ['', 'low', 'fast']) for (const [name, cards] of Object.entries(decks)) {
    A.startMatch('cpu'); A.loadMap(A.MAPS.findIndex((m) => m.name === 'Yard')); A.game.state = 'play'; A.game.dropT = 0; A.game.dropOff = 0;
    A.game.mode = twist ? 'survival' : A.game.mode; A.game.twist = twist ? { id: twist } : null;
    const [P, E] = A.players; E.alive = false; E.x = -9999; P.cards = cards.map((n) => A.CARDS.find((c) => c.n === n)); A.recompute(P);
    P.x = 260; P.y = 330; P.aim = -0.35; A.bullets.length = 0;
    const path = A.aimPath(P, .3), c = Math.cos(P.aim), s = Math.sin(P.aim);
    A.spawnBullet(P, P.x + c * (P.r + 30), P.y + s * (P.r + 30), P.aim, {}); const b = A.bullets[A.bullets.length - 1];
    let worst = 0, steps = 0; const x0 = b.x, y0 = b.y;
    for (let k = 0; k < path.length && !b.dead; k++) { A.updateBullets(A.FIXED); steps++; worst = Math.max(worst, Math.hypot(b.x - path[k][0], b.y - path[k][1])) }
    if (steps < path.length * .9 || Math.hypot(b.x - x0, b.y - y0) < 200) fail.push(`${twist || 'normal'} ${name}: the test shot didn't fly its course (${steps} steps, ${Math.round(Math.hypot(b.x - x0, b.y - y0))} px)`);
    rows.push(`${twist || 'normal'}/${name}: ${worst.toFixed(2)}px`);
    if (!(worst <= .5)) fail.push(`${twist || 'normal'} ${name}: the shot strays ${worst.toFixed(1)} px from the aim guide`) }
  console.log(JSON.stringify({ cases: rows.length, worstPx: Math.max(...rows.map((r) => +r.split(': ')[1].slice(0, -2))), failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
