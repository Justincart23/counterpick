// Card stacking and block cards: stacked cards keep both effects, block cards do what they say, and blocking into
// the bottom edge is a clean save that launches you high.
//   node tests/combos.js
const { load, flushTimers } = require('./env');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg) };
const card = (A, n) => A.CARDS.find((c) => c.n === n);

(async () => {
  const { api: A } = await load({ seed: 7 });
  const step = (n = 1) => { for (let i = 0; i < n; i++) { A.update(1 / 60); flushTimers() } };
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

  // Ricochet stacks: two copies, four bounces
  { const [P] = setup(['Ricochet', 'Ricochet']); check(P.s.bounces === 4, `two Ricochets should give 4 bounces (${P.s.bounces})`) }

  console.log(JSON.stringify({ cases: 6, failures: fail.length, fail }));
  process.exit(fail.length ? 1 : 0);
})();
