// Crates and rope drops: walking into a crate pushes it at a slower walk; a crate shoved off a ledge lands hard on whoever
// is below; one that falls out of the arena comes back; shooting a rope's red target drops its platform, which hurts the
// fighter it lands on and stays where it lands; and every crate and rope is back in place at the next point.
//   node tests/rides.js
const { load } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 3 });
  const H = 1 / 120, fail = [], check = (ok, m) => { if (!ok) fail.push(m) }, out = {};
  const setup = (name) => { A.startMatch('cpu'); A.loadMap(A.MAPS.findIndex((m) => m.name === name)); A.game.state = 'play'; A.game.dropT = 0; A.game.dropOff = 0;
    const [P, E] = A.players; P.cards = []; E.cards = []; A.recompute(P); A.recompute(E); P.ctrl = 'mouse'; E.ctrl = 'idle'; A.keys.clear(); A.edges.clear(); return [P, E] };
  const run = (s, each) => { for (let i = 0; i < s / H; i++) { if (each) each(); A.update(H) } };
  // push: stand left of the middle ground crate on Quarry and walk right for 1.5 s
  { const [P, E] = setup('Quarry'); E.alive = false; E.x = -999; const c = A.rides.find((r) => r.crate && r.y > 700 && r.x > 700 && r.x < 900);
    A.resetPlayer(P, [c.x - 60, 760]); run(.3); const x0 = c.x; let top = 0; A.keys.add('KeyD');
    run(1.5, () => { if (Math.abs(c.x - c.px) > 0) top = Math.max(top, Math.abs(P.vx)) }); A.keys.clear();
    out.pushedPx = Math.round(c.x - x0); out.pushSpeed = Math.round(top);
    check(c.x - x0 > 150, `walking into a crate should push it (moved ${Math.round(c.x - x0)} px)`);
    check(top <= A.CRATE_PUSH + 1, `pushing should be a slower walk (${Math.round(top)} px/s)`);
    check(Math.abs(P.x + P.r - c.x) < 3, 'the pusher should stay against the crate') }
  // crush: the crate on Quarry's middle ledge, shoved off onto a fighter standing below
  { const [P, E] = setup('Quarry'); const c = A.rides.find((r) => r.crate && r.y < 500);
    A.resetPlayer(E, [1015, 760]); A.resetPlayer(P, [-999, -999]); P.alive = false; const hp = E.hp;
    c.x = 985; c.vx = 0; run(1.2); out.crateHit = Math.round(hp - E.hp);
    check(E.hp < hp, 'a crate falling on a fighter should hurt them'); check(c.y + c.h > 770, 'the crate should end up on the ground') }
  // a crate that falls out of the arena comes back where it started
  { const [P, E] = setup('Quarry'); P.alive = E.alive = false; P.x = E.x = -999; const c = A.rides.find((r) => r.crate); c.y = 1000; c.vy = 900; run(.2);
    check(c.gone > 0, 'a crate below the arena should be gone for a moment'); run(3.5); check(!(c.gone > 0) && c.x === c.x0 && c.y >= c.y0 - 1, 'it should come back where it started') }
  // rope drop: shoot the red target over a fighter on the floor of Cutline
  { const [P, E] = setup('Cutline'); const c = A.rides.find((r) => r.hang); A.resetPlayer(E, [c.x + c.w / 2, 800]); A.resetPlayer(P, [150, 640]); const hp = E.hp;
    A.spawnBullet(P, c.tx - 40, c.ty, 0, { plain: true, dmg: 10, r: 6, speed: 1800 }); run(.1);
    check(c.st === 1, 'shooting the red target should drop the platform'); run(1.5); out.ropeHit = Math.round(hp - E.hp);
    check(E.hp < hp, 'the dropped platform should hurt the fighter it lands on'); check(!A.solids.some((r) => !r.bound && !r.oneway && E.x > r.x + 2 && E.x < r.x + r.w - 2 && E.y > r.y + 2 && E.y < r.y + r.h - 2), 'the fighter it landed on should not end up inside the floor or the platform'); check(c.st === 2 && Math.abs(c.y + c.h - 820) < 2, `it should rest on the floor (st ${c.st}, bottom ${Math.round(c.y + c.h)})`);
    // the next point puts everything back
    A.loadMap(A.game.mapIdx); const d = A.rides.find((r) => r.hang); check(d.st === 0 && d.y === A.game.map.hangs[0].y && A.solids.includes(d) && !A.solids.includes(c), 'the rope drop should be back up at the next point') }
  console.log(JSON.stringify({ ...out, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
