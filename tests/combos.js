// Card stacking and block cards: stacked cards keep both effects, block cards do what they say, and blocking into
// the bottom edge is a clean save that launches you high.
//   node tests/combos.js
const { load, flushTimers } = require('./env');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg) };
const card = (A, n) => A.CARDS.find((c) => c.n === n);

(async () => {
  const { api: A } = await load({ seed: 7 });
  const step = (n = 1) => { for (let i = 0; i < n; i++) { A.update(1 / 60); flushTimers() } };   // 1/60 s per call
  const setup = (cards0 = [], cards1 = [], map = 0) => {
    A.startMatch('cpu'); flushTimers();
    A.loadMap(map); A.game.state = 'play'; A.game.dropT = 0; A.game.points = [0, 0]; A.game.wins = [0, 0];
    A.players[0].cards = cards0.map((n) => card(A, n)); A.players[1].cards = cards1.map((n) => card(A, n));
    for (const p of A.players) { p.ctrl = 'idle'; A.recompute(p); A.resetPlayer(p, A.game.map.sp[p.id]) }
    step(40); A.bullets.length = 0;
    return A.players;
  };
  const block = (p) => { A.doBlock(p); step() };

  // blocking into the bottom edge: no damage and a much higher launch than a plain edge bounce
  const fall = (withBlock) => {
    const [P] = setup([], [], 1); P.x = 800; P.y = 900 - P.r - 60; P.vy = 900;   // over the Pit's open gap P.blockCd = 0; P.edgeT = 0; P.ground = null; P.grounded = false;
    const hp = P.hp; let minVy = 0;
    for (let i = 0; i < 30; i++) { if (withBlock && i === 0) A.doBlock(P); step(); minVy = Math.min(minVy, P.vy) }
    return { lost: hp - P.hp, minVy };
  };
  const plain = fall(false), saved = fall(true);
  check(plain.lost > 0, 'hitting the bottom edge without blocking should hurt');
  check(saved.lost === 0, `blocking into the bottom edge should take no damage (lost ${saved.lost})`);
  check(saved.minVy < plain.minVy - 300, `a blocked edge bounce should launch higher (${saved.minVy.toFixed(0)} vs ${plain.minVy.toFixed(0)})`);

  // Limpet Mines + Splinter Rounds: shards fly when the mine sticks, and the mine still arms
  {
    const [P] = setup(['Limpet Mines', 'Splinter Rounds']);
    A.spawnBullet(P, P.x, P.y, Math.PI / 2); const seen = new Set();
    for (let i = 0; i < 20; i++) { step(); for (const b of A.bullets) if (b.shard) seen.add(b) }
    const stuck = A.bullets.filter((b) => b.stuck).length, shards = seen.size;
    check(stuck === 1, `the bullet should stick as a mine (${stuck})`);
    check(shards >= 4, `stacking Splinter on Limpet should still throw shards (${shards})`);
  }

  // Limpet Mines: a mine sticks with no trail, then always blows about half a second later, rival near or not
  {
    const [P, E] = setup(['Limpet Mines']); E.x = 1500;
    A.spawnBullet(P, P.x, P.y, Math.PI / 2); let stuckAt = -1, boomAt = -1, trailOnWall = 0;
    for (let i = 0; i < 120 && boomAt < 0; i++) {
      step(); const m = A.bullets.find((b) => b.mines);
      if (m && m.stuck) { if (stuckAt < 0) stuckAt = i; if (m.trail.length) trailOnWall++; A.render() }   // the mine's fuse ring draws without errors
      if (stuckAt >= 0 && !m) boomAt = i;
    }
    const fuse = (boomAt - stuckAt) / 60;
    check(stuckAt >= 0 && boomAt > 0 && fuse > 0.4 && fuse < 0.62, `a mine should blow ~0.5 s after sticking (took ${fuse.toFixed(2)} s)`);
    check(trailOnWall === 0, `a stuck mine should not keep its bullet trail (${trailOnWall} frames)`);
  }

  // Cluster Guard: three bombs that blow up on impact and hurt a rival close by
  {
    const [P, E] = setup(['Cluster Guard']); E.x = P.x + 70; E.y = P.y; const hp = E.hp;
    block(P); const bombs = A.bullets.filter((b) => b.bomb).length;
    check(bombs === 3, `Cluster Guard should toss three bombs (${bombs})`);
    step(180);
    check(!A.bullets.some((b) => b.bomb), 'every bomb should have gone off');
    check(E.hp < hp, 'a bomb blast should hurt a nearby rival');
    check(P.hp === P.s.maxHp, 'your own bombs should not hurt you');
  }

  // Frost Guard freezes a nearby rival; Double Guard blocks twice in a row
  {
    const [P, E] = setup(['Frost Guard']); E.x = P.x + 160; E.y = P.y;
    block(P); check(E.frozenT > 0, 'Frost Guard should freeze a rival in range');
    const [Q] = setup(['Double Guard']);
    block(Q); step(25); block(Q);
    check(Q.blockT > 0, 'Double Guard should allow a second block right away');
    step(25); block(Q);
    check(!(Q.blockT > 0), 'a third block should wait for the cooldown');
  }

  // Ground Pound: hold down in the air to dive; the landing blasts a rival standing nearby
  {
    const [P, E] = setup(['Ground Pound']); const hp = E.hp; E.x = P.x + 90; E.y = P.y;
    P.y -= 220; P.vy = 0; P.grounded = false; P.ground = null; P.input.down = true; let maxVy = 0, launch = 0;
    for (let i = 0; i < 40; i++) { step(); maxVy = Math.max(maxVy, P.vy); launch = Math.min(launch, E.vy) }
    P.input.down = false;
    check(maxVy >= 1500, `holding down in the air should dive fast (max vy ${maxVy | 0})`);
    check(E.hp < hp && launch < -400, `the slam should hurt and launch a nearby rival (hp ${hp}->${E.hp | 0}, launch vy ${launch | 0})`);
    check(P.hp === P.s.maxHp, 'your own slam should not hurt you');
  }

  // no wall jumps: pressing jump against a wall in mid-air with no double jump left does nothing
  {
    const [P] = setup([], [], A.MAPS.findIndex((m) => m.name === 'Divider')); const wall = A.solids.find((r) => r.x === 770);
    P.ctrl = 'mouse'; P.x = wall.x - P.r - 1; P.y = 620; P.vy = 100; P.grounded = false; P.ground = null; P.airJumps = 0; P.coyote = 0;
    A.keys.add('KeyD'); A.edges.add('KeyW'); A.keys.add('KeyW'); step(); A.keys.delete('KeyD'); A.keys.delete('KeyW');
    check(P.vy > 0, `jumping against a wall should not climb it (vy ${P.vy | 0})`);
  }

  // Ricochet stacks: two copies, four bounces
  { const [P] = setup(['Ricochet', 'Ricochet']); check(P.s.bounces === 4, `two Ricochets should give 4 bounces (${P.s.bounces})`) }

  console.log(JSON.stringify({ cases: 9, failures: fail.length, fail }));
  process.exit(fail.length ? 1 : 0);
})();
