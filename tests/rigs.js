// Rigs: dark pieces held up by hollow supports. On every rig arena: each support breaks to shots and what it held reacts as it
// should (a beam swings, then falls; a bridge slams down, then drops away; the ball swings, then drops; lifts trade height under
// a fighter, then fall; a keystone shot out brings the stack down), nothing ever ends up inside a fixed block, and a guest that
// only gets the host's snapshots (90 ms late, every third step) ends up showing every piece where the host has it.
//   node tests/rigs.js
const { load, flushTimers } = require('./env');
(async () => {
  const H = (await load({ seed: 3 })).api, G = (await load({ seed: 4 })).api, fail = [], check = (ok, m) => { if (!ok) fail.push(m) };
  const h = 1 / 120, mi = (A, n) => A.MAPS.findIndex((m) => m.name === n);
  const start = (A, n, guest) => { A.startMatch('cpu'); flushTimers(); A.loadMap(mi(A, n)); A.game.state = 'play'; A.game.dropT = 0; A.game.dropOff = 0;
    for (const p of A.players) { p.ctrl = 'idle'; p.x = -9999; p.alive = false } if (guest) A.game.mode = 'online-guest' };
  // a guest fed the host's snapshots: 90 ms late, one every third step
  let q = [];
  const run = (secs, both) => { for (let i = 0; i < secs / h; i++) { H.update(h); flushTimers();
      if (both) { if (i % 3 === 0) q.push([i + Math.round(0.09 / h), JSON.parse(JSON.stringify({ rg: H.rigSnap(), lf: H.lifts.map((L) => [L.s, L.v]) }))]);
        while (q.length && q[0][0] <= i) G.rigApply(q.shift()[1]); G.guestRigs(h) } } q = [] };
  const embedded = (A) => A.rigs.filter((c) => c.mode === 'rest' || c.mode === 'hold').some((c) => A.solids.some((o) => o !== c && !o.ride && !o.swing && !o.bound && !o.oneway && c.x < o.x + o.w - 1 && c.x + c.w > o.x + 1 && c.y < o.y + o.h - 1 && c.y + c.h > o.y + 1));
  const near = (n) => H.rigs.every((c, i) => { const g = G.rigs[i]; return g.mode === c.mode && (c.mode === 'gone' || Math.hypot(g.x - c.x, g.y - c.y) < n) });
  const both = (n) => { start(H, n); start(G, n, true) };
  const brk = (c, k) => { const n = c.nodes[k]; while (n.alive) H.hitNode(c, n, null) };
  // Chandelier
  both('Chandelier'); { const c = H.rigs[0]; check(c.mode === 'hold' && c.nodes.length === 2, 'Chandelier: a beam on two ropes');
    run(0.5, true); brk(c, 0); run(0.3, true); check(c.mode === 'swing', 'Chandelier: one rope gone, the beam swings');
    run(2, true); check(near(30), `Chandelier: the guest's beam follows the host's swing (${Math.round(Math.hypot(G.rigs[0].x - c.x, G.rigs[0].y - c.y))} px)`);
    brk(c, 1); run(3, true); check(c.mode === 'rest' && c.y + c.h <= 801 && c.y + c.h > 790, `Chandelier: both gone, it falls and lands on the floor (${c.mode} at ${Math.round(c.y + c.h)})`);
    check(near(12), 'Chandelier: the guest\'s beam lands where the host\'s did'); check(!embedded(H), 'Chandelier: nothing inside a block') }
  // a beam falls on a fighter: it hurts
  both('Chandelier'); { const c = H.rigs[0], p = H.players[0]; p.alive = true; p.x = c.x + c.w / 2; p.y = 782; p.vx = p.vy = 0; p.hp = p.s.maxHp; const hp = p.hp;
    brk(c, 0); brk(c, 1); for (let i = 0; i < 240; i++) { H.update(h); flushTimers() } check(p.hp < hp, 'Chandelier: a falling beam hurts whoever is under it') }
  // Drawbridge
  both('Drawbridge'); { const [L, R] = H.rigs; check(L.bridge && R.bridge && !L.down && L.h > L.w, 'Drawbridge: two bridges stand raised');
    run(0.3, true); brk(L, 0); brk(R, 0); run(2, true);
    check(L.down && R.down && L.mode === 'hold' && R.mode === 'hold' && Math.abs(L.y - 700) < 1 && L.w > L.h && Math.abs(L.x + L.w - R.x) < 2, 'Drawbridge: ropes shot, both bridges come down and meet');
    check(near(3) && G.rigs.every((c) => c.down), 'Drawbridge: the guest\'s bridges come down too');
    const p = H.players[0]; p.alive = true; p.ctrl = 'idle'; H.resetPlayer(p, [600, 660]); p.input.move = 1; let crossed = false;
    for (let i = 0; i < 360; i++) { p.input.move = 1; H.update(h); flushTimers(); if (p.x > 1060 && p.y < 700) { crossed = true; break } } check(crossed, 'Drawbridge: a fighter walks across the lowered bridges');
    p.alive = false; p.x = -9999; brk(L, 1); run(3, true); check(L.mode === 'gone', `Drawbridge: hinge shot, the bridge drops away (${L.mode})`); check(near(3), 'Drawbridge: and on the guest') }
  // Wrecking Yard
  both('Wrecking Yard'); { const c = H.rigs[0], xs = []; for (let i = 0; i < 300; i++) { H.update(h); xs.push(c.x) } check(Math.max(...xs) - Math.min(...xs) > 200, 'Wrecking Yard: the ball swings');
    run(1.5, true); check(near(25), `Wrecking Yard: the guest's ball swings with the host's (${Math.round(Math.hypot(G.rigs[0].x - c.x, G.rigs[0].y - c.y))} px)`);
    brk(c, 0); run(3, true); check(c.mode === 'rest' && c.y + c.h <= 801, `Wrecking Yard: chain shot, the ball drops and stays (${c.mode})`); check(!embedded(H), 'Wrecking Yard: nothing inside a block') }
  // Pulley
  both('Pulley'); { const [a, b] = H.rigs, p = H.players[0], y0 = a.y; p.alive = true; H.resetPlayer(p, [a.x + a.w / 2, a.y - 30]);
    for (let i = 0; i < 240; i++) { p.input.move = 0; H.update(h); flushTimers() } check(a.y > y0 + 100 && b.y < y0 - 100 && p.ground === a, `Pulley: a fighter's weight sinks one lift and raises the other (${Math.round(a.y - y0)})`);
    p.alive = false; p.x = -9999; for (let i = 0; i < 600; i++) H.update(h); check(Math.abs(a.y - y0) < 40, 'Pulley: empty, they drift back level');
    run(1, true); check(near(10), 'Pulley: the guest\'s lifts match the host\'s'); brk(a, 0); run(3, true);
    check(a.mode === 'rest' && b.mode === 'rest', `Pulley: a rope shot, both lifts fall (${a.mode}/${b.mode})`); check(near(12), 'Pulley: and land in the same spots on the guest') }
  // Topple
  both('Topple'); { const key = H.rigs.find((c) => c.prop), top = H.rigs.filter((c) => c.stack === key.stack && c.lvl > key.lvl), y0 = top.map((c) => c.y);
    run(1, true); check(H.rigs.every((c) => c.mode === 'rest') && !embedded(H), 'Topple: the towers stand still');
    H.hitNode(key, key.nodes[0], null); check(key.mode === 'rest', 'Topple: a keystone takes two hits'); H.hitNode(key, key.nodes[0], null); run(3, true);
    check(key.mode === 'gone' && top.every((c, i) => c.y > y0[i] + 30 && c.mode === 'rest'), 'Topple: keystone shot out, the blocks above come down and settle');
    check(top.some((c, i) => Math.abs(c.x - (key.x + key.w / 2 - c.w / 2)) > 20), 'Topple: and they topple sideways'); check(!embedded(H), 'Topple: nothing inside a block');
    check(near(12), 'Topple: the guest shows the same pile') }
  // every rig arena: a minute of CPU play never leaves a piece inside a fixed block, and nothing throws
  for (const n of ['Chandelier', 'Drawbridge', 'Wrecking Yard', 'Pulley', 'Topple', 'Foundry']) { H.startMatch('cpu'); flushTimers(); H.loadMap(mi(H, n)); H.game.state = 'play';
    for (const p of H.players) { p.ctrl = 'cpu'; p.hp = 1e6 } let bad = 0; for (let i = 0; i < 60 / h; i++) { H.update(h); flushTimers(); if (i % 60 === 0 && embedded(H)) bad++ } check(!bad, `${n}: a piece ended up inside a block during CPU play`) }
  if (fail.length) { console.log('FAIL\n  - ' + fail.join('\n  - ')); process.exit(1) }
  console.log(JSON.stringify({ arenas: 6, failures: 0 })) })();
