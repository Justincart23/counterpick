// Blocking right before you hit the bottom of the arena (ROUNDS' "sketchy jump") must launch you high enough to get back
// onto a platform: on every arena, from every open gap, a fighter that blocks at the bottom and then steers / double-jumps
// has to be able to land on something.
//   node tests/edge-save.js [file]
const { load } = require('./env');
const path = require('path');

(async () => {
  const { api: A } = await load({ seed: 4, file: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
  const H = 1 / 120, fail = [], rows = [];
  const progs = [[], [.15], [.25], [.35], [.45], [.55], [.7]];   // when to spend the double jump after the launch
  for (let mi = 0; mi < A.MAPS.length; mi++) {
    A.startMatch('cpu'); A.loadMap(mi); A.game.state = 'play'; A.game.dropT = 0;
    const [P, E] = A.players; E.alive = false; E.x = -999; P.cards = []; A.recompute(P);
    // open gaps: columns with nothing solid between mid-height and the bottom edge
    const open = []; for (let x = 40; x <= 1560; x += 40) if (!A.solids.some((r) => !r.bound && x > r.x - P.r && x < r.x + r.w + P.r && r.y + r.h > 520)) open.push(x);
    let saved = 0;
    for (const x0 of open) {
      let ok = false;
      for (const dir of [-1, 1, 0]) { for (const pr of progs) {
        A.loadMap(mi); A.game.state = 'play'; A.resetPlayer(P, [x0, 840]); P.ctrl = 'mouse'; P.vy = 900; P.grounded = false; P.ground = null; P.edgeT = 0;
        A.keys.clear(); A.edges.clear(); A.doBlock(P); let bounced = false, t0 = 0;
        for (let i = 0; i < 420 && !ok; i++) { const t = i * H;
          if (bounced) { if (dir) A.keys.add(dir < 0 ? 'KeyA' : 'KeyD'); const tt = t - t0; if (pr.some((p) => Math.abs(p - tt) < H / 2)) { A.edges.add('KeyW'); A.keys.add('KeyW') } if (pr.some((p) => tt > p + .2 && tt < p + .2 + H)) A.keys.delete('KeyW') }
          A.update(H);
          if (!bounced && P.edgeHit === 'bottom') { bounced = true; t0 = t }
          if (bounced && P.grounded && P.ground && P.ground.kind !== 3 && !P.ground.bound) ok = true;
          if (bounced && t - t0 > .3 && P.y > 880) break }
        A.keys.clear(); if (ok) break } if (ok) break }
      if (ok) saved++ }
    rows.push({ map: A.MAPS[mi].name, gaps: open.length, saved: open.length ? `${saved}/${open.length}` : '-' });
    if (open.length && saved / open.length < .9) fail.push(`${A.MAPS[mi].name}: a block save only gets you back from ${saved} of ${open.length} gap spots`) }
  console.table(rows);
  console.log(JSON.stringify({ arenas: rows.length, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
