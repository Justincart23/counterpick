// Ghost Rounds drill like ROUNDS' Drill Ammo: through a wall or two, stopped by thick rock and by a block. Survival: the horde grabs power-ups too.
//   node tests/drill.js
const { load } = require('./env');
(async () => {
  const { api: A, flushTimers } = await load({ seed: 11 });
  const fail = [], check = (ok, msg) => { if (!ok) fail.push(msg) };
  const shot = (cards, wallW, block) => {
    A.startMatch('cpu'); A.game.state = 'play'; const [P, E] = A.players;
    P.cards = cards.map((n) => A.CARDS.find((c) => c.n === n)); A.recompute(P); E.cards = []; A.recompute(E);
    const S = A.solids; S.length = 0; S.push(...A.BOUNDS);
    if (wallW) S.push({ x: 700, y: 300, w: wallW, h: 400, kind: 0 });
    Object.assign(P, { x: 500, y: 500, vx: 0, vy: 0 }); Object.assign(E, { x: 760 + wallW + 140, y: 500, vx: 0, vy: 0, blockT: block ? 0.4 : 0 });
    const hp = E.hp; A.bullets.length = 0; A.spawnBullet(P, 560, 500, 0); A.bullets[0].grav = 0;
    for (let i = 0; i < 120 && A.bullets.length; i++) { A.updateBullets(1 / 120); if (block) E.blockT = 0.4 }
    return E.hp < hp };
  check(shot(['Ghost Rounds'], 40, false), 'Ghost Rounds should drill through a thin wall');
  check(shot(['Ghost Rounds'], 120, false), 'Ghost Rounds should drill through a thick block');
  check(!shot(['Ghost Rounds'], 400, false), 'Ghost Rounds should stop inside a very thick wall');
  check(shot(['Ghost Rounds', 'Ghost Rounds'], 280, false), 'two copies should drill deeper');
  check(!shot([], 40, false), 'a plain shot should stop at a wall');
  check(!shot(['Ghost Rounds'], 0, true), 'a block should stop a Ghost Rounds shot');
  { const c = A.CARDS.find((c) => c.n === 'Ghost Rounds'), s = { ...A.BASE }; c.a(s); check(s.reload > A.BASE.reload + 0.2, 'Ghost Rounds should cost reload time') }
  // Survival: an opponent that walks over a power-up takes it
  A.startSurvival(); flushTimers(); A.game.state = 'play';
  const foe = A.players.find((p) => p.team !== 0 && p.alive && !p.boss);
  check(!!foe, 'a Survival opponent should be in play');
  if (foe) { A.drops = [{ id: 99, kind: 'over', x: foe.x, y: foe.y, ty: foe.y, state: 'ready', t: 9, vy: 0 }]; A.dropTick(1 / 60);
    check(!A.drops.length && foe.buffOver > 0, 'a Survival opponent should pick up a power-up') }
  if (fail.length) { console.log('FAIL\n  - ' + fail.join('\n  - ')); process.exit(1) }
  console.log(JSON.stringify({ checks: 9, failures: 0 })) })();
