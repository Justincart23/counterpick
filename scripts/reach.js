// Map reachability: drives a fighter with real key presses on every arena and checks that every platform, wall top,
// hanging block and moving platform can be reached from BOTH spawns, using runs, jumps, the double jump, wall jumps,
// bounce pads and rides on moving parts. Anything unreachable is dead space.
//   node scripts/reach.js [file=src/counterpick.html] [mapName]      (exit 1 if any arena has an unreachable surface)
const { load } = require('../tests/env');
const path = require('path');
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : undefined, ONLY = process.argv[3] || '';

(async () => {
  const { api: A } = await load({ seed: 3, file: FILE });
  const H = 1 / 120;
  const out = []; let bad = 0;
  for (let mi = 0; mi < A.MAPS.length; mi++) {
    const M = A.MAPS[mi]; if (ONLY && M.name !== ONLY) continue;
    A.startMatch('cpu'); flush(); A.loadMap(mi); A.game.state = 'play'; A.game.dropT = 0; A.game.dropOff = 0;
    const [P, E] = A.players; E.alive = false; E.x = -999; P.cards = []; A.recompute(P); P.s.jumpPower = .88;   // a margin: nothing should need a pixel-perfect max-height jump (12% short of the real max)
    // a surface is a solid you can stand on: rects by position, hanging blocks / movers by their index (they move)
    const key = (r) => !r ? null : r.swing ? 'swing' + A.solids.filter((q) => q.swing).indexOf(r) : `${r.x},${r.y},${r.w},${r.h}`;
    const standable = (r) => !r.bound && r.kind !== 3 && (r.swing || r.y > 2 * P.r + 14);   // pads launch you; a block flush with the ceiling has no top
    const surf = A.solids.filter(standable).map((r) => ({ k: key(r), name: r.swing ? (r.mover ? 'moving platform' : 'hanging block') + ' ' + key(r).slice(5) : `[${r.x},${r.y},${r.w},${r.h}]` }));
    const spots = (r) => { const xs = []; for (let x = r.x + P.r + 2; x <= r.x + r.w - P.r - 2; x += 40) xs.push(x); if (!xs.length) xs.push(r.x + r.w / 2); return xs };
    const progs = [[], [0], [0, .2], [0, .3], [0, .4], [0, .7], [0, .9], [0, 1.1], [0, .25, .5, .75, 1.0, 1.25], [0, .3, .55, .8, 1.05, 1.3]];
    const waits = [0, .5, 1, 1.5, 2, 2.5];   // moving parts: try leaving at different moments
    const tryFrom = (k, xi, wait, dir, presses, holdFor = 99) => {
      A.loadMap(mi); A.game.state = 'play'; A.game.pointT = 0; A.keys.clear(); A.edges.clear(); A.mouse.down = false;
      const r = A.solids.find((q) => key(q) === k), xs = spots(r); if (xi >= xs.length) return null;
      A.resetPlayer(P, [xs[xi], r.y - P.r - 1]); P.ctrl = 'mouse';
      for (let i = 0; i < 30 + wait * 120; i++) A.update(H);
      if (!P.grounded || key(P.ground) !== k) return null;
      const dk = dir < 0 ? 'KeyA' : dir > 0 ? 'KeyD' : null; let left = false;
      for (let i = 0; i < 480; i++) { const t = i * H;
        if (dk && t < holdFor) A.keys.add(dk); else if (dk) A.keys.delete(dk);   // let go of the direction to land on what you climbed
        if (presses.some((pt) => Math.abs(pt - t) < H / 2)) { A.edges.add('KeyW'); A.keys.add('KeyW') }
        if (presses.some((pt) => t > pt + .22 && t < pt + .22 + H)) A.keys.delete('KeyW');
        A.update(H);
        if (!P.grounded) left = true; else if (left && P.ground && P.ground.kind !== 3 && key(P.ground) !== k && standable(P.ground)) { const g = key(P.ground); A.keys.clear(); return g }
        if (!P.alive || P.y > 880) break }
      A.keys.clear(); return null };
    const edges = new Map();
    for (const s of surf) { const to = new Set(), r0 = A.solids.find((q) => key(q) === s.k), moving = !!r0.swing, n = spots(r0).length;
      for (let xi = 0; xi < n; xi++) for (const w of moving ? waits : [0]) for (const dir of [-1, 0, 1]) for (const pr of progs) for (const hold of dir ? [99, .7] : [99]) {
        if (!pr.length && !dir) continue; const g = tryFrom(s.k, xi, w, dir, pr, hold); if (g) to.add(g) }
      edges.set(s.k, to) }
    const spawnSurf = M.sp.map(([x, y]) => { A.loadMap(mi); A.resetPlayer(P, [x, y]); for (let i = 0; i < 60; i++) A.update(H); return key(P.ground) });
    const reach = (from) => { const seen = new Set([from]), q = [from]; while (q.length) { const k = q.shift(); for (const n of edges.get(k) || []) if (!seen.has(n)) { seen.add(n); q.push(n) } } return seen };
    const r0 = reach(spawnSurf[0]), r1 = reach(spawnSurf[1]);
    const dead = surf.filter((s) => !r0.has(s.k) || !r1.has(s.k)).map((s) => s.name + (!r0.has(s.k) && !r1.has(s.k) ? '' : !r0.has(s.k) ? ' (not from left spawn)' : ' (not from right spawn)'));
    if (dead.length) bad++;
    out.push({ map: M.name, surfaces: surf.length, unreachable: dead.join('; ') || '-' });
    process.stderr.write('.') }
  console.log(); console.table(out);
  console.log(bad ? `${bad} arena(s) have unreachable surfaces` : 'every surface is reachable from both spawns');
  process.exit(bad ? 1 : 0);
  function flush() {}
})();
