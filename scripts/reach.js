// Map reachability (not part of CI): drives a fighter with real key presses on every arena and reports which platforms
// can be reached from the spawns using runs, jumps, the double jump and wall jumps. Run it after changing jump physics or
// map layouts: every platform should be reachable, or it's dead space.
//   node scripts/reach.js [file=src/counterpick.html] [mapName]
const { load } = require('../tests/env');
const path = require('path');
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : undefined, ONLY = process.argv[3] || '';

(async () => {
  const { api: A } = await load({ seed: 3, file: FILE });
  const H = 1 / 120;
  const press = (set) => { for (const k of set) { if (!A.keys.has(k)) A.edges.add(k); A.keys.add(k) } };
  const release = (k) => A.keys.delete(k);
  const out = [];
  for (let mi = 0; mi < A.MAPS.length; mi++) {
    const M = A.MAPS[mi]; if (ONLY && M.name !== ONLY) continue;
    A.startMatch('cpu'); A.loadMap(mi); A.game.state = 'play'; A.game.dropT = 0; A.game.dropOff = 0; A.game.overtime = false;
    const [P, E] = A.players; E.alive = false; E.x = -999; P.cards = []; A.recompute(P);
    const rects = A.solids.filter((r) => !r.bound && !r.swing && r.kind !== 3);   // bounce pads launch you, you never stand on them
    const key = (r) => r && `${r.x},${r.y},${r.w},${r.h}`, keys = rects.map(key), id = (r) => keys.indexOf(key(r));   // the map reloads each try, so match by position
    // standing spots along each platform top (needs headroom)
    const spots = (r) => { const xs = []; for (let x = r.x + P.r + 2; x <= r.x + r.w - P.r - 2; x += 40) xs.push(x); if (!xs.length) xs.push(r.x + r.w / 2); return xs };
    const tryFrom = (x, y, dir, presses) => {
      A.loadMap(mi); A.game.state = 'play'; A.game.pointT = 0; A.resetPlayer(P, [x, y]); P.ctrl = 'mouse'; A.keys.clear(); A.edges.clear(); A.mouse.down = false;
      for (let i = 0; i < 30; i++) A.update(H);   // settle
      if (!P.grounded) return null; const start = P.ground;
      const dk = dir < 0 ? 'KeyA' : dir > 0 ? 'KeyD' : null; let t = 0, left = false;
      for (let i = 0; i < 420; i++) {
        t = i * H; if (dk) A.keys.add(dk);
        const pi = presses.findIndex((pt) => Math.abs(pt - t) < H / 2); if (pi >= 0) press(['KeyW']);
        if (presses.some((pt) => t > pt + .22 && t < pt + .22 + H)) release('KeyW');
        A.update(H);
        if (!P.grounded) left = true; else if (left && P.ground && P.ground.kind !== 3 && key(P.ground) !== key(start)) { A.keys.clear(); return P.ground }
        if (!P.alive || P.y > 880) break }
      A.keys.clear(); return null };
    const progs = [[], [0], [0, .2], [0, .3], [0, .4], [0, .7], [0, .9], [0, 1.1], [0, .25, .5, .75, 1.0, 1.25], [0, .3, .55, .8, 1.05, 1.3]];
    const edges = new Map();
    for (const r of rects) { const from = id(r), to = new Set();
      for (const x of spots(r)) for (const dir of [-1, 0, 1]) for (const pr of progs) { if (!pr.length && !dir) continue; const g = tryFrom(x, r.y - P.r - 1, dir, pr); if (g && id(g) >= 0) to.add(id(g)) }
      edges.set(from, to) }
    // BFS from the spawns' platforms
    const spawnPl = M.sp.map(([x, y]) => { A.loadMap(mi); A.resetPlayer(P, [x, y]); for (let i = 0; i < 60; i++) A.update(H); return id(P.ground) });
    const seen = new Set(spawnPl.filter((k) => k >= 0)), q = [...seen];
    while (q.length) { const k = q.shift(); for (const n of edges.get(k) || []) if (!seen.has(n)) { seen.add(n); q.push(n) } }
    const dead = rects.map((r, k) => k).filter((k) => !seen.has(k)).map((k) => { const r = rects[k]; return `[${r.x},${r.y},${r.w},${r.h}]` });
    const cross = spawnPl[1] >= 0 && (() => { const s = new Set([spawnPl[0]]), qq = [spawnPl[0]]; while (qq.length) { const k = qq.shift(); for (const n of edges.get(k) || []) if (!s.has(n)) { s.add(n); qq.push(n) } } return s.has(spawnPl[1]) })();
    out.push({ map: M.name, platforms: rects.length, reachable: seen.size, unreachable: dead.join(' '), spawnToSpawn: cross });
    process.stderr.write('.') }
  console.log(); console.table(out);
})();
