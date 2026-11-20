// The chaos cards really do what they say, in a real match: Bullet Hose fires fast from a deep magazine in a real spray;
// Rubber Rounds bounce four more times; Chaos Rounds give every bullet one of seven powers (all of them turn up, and each is
// applied); and online, the guest's prediction rolls the same spray and power as the host for the same shot number
//   node tests/newcards.js
const { load, flushTimers } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 21 }), fail = [], check = (ok, m) => { if (!ok) fail.push(m) };
  const C = (n) => A.CARDS.find((c) => c.n === n);
  const setup = (cards) => { A.startMatch('sandbox'); flushTimers(); A.loadMap(0); A.game.state = 'play'; A.game.dropT = 0;
    const [P, E] = A.players; P.cards = cards.map(C); E.cards = []; A.recompute(P); A.recompute(E); A.resetPlayer(P, A.game.map.sp[0]); A.resetPlayer(E, A.game.map.sp[1]);
    P.ctrl = 'idle'; E.ctrl = 'idle'; P.aim = 0; A.bullets.length = 0; return P };
  const shoot = (P, n) => { const out = []; for (let i = 0; i < n; i++) { P.fireT = 0; P.burstLeft = 0; if (P.ammo <= 0) P.ammo = P.s.ammo; const k = A.bullets.length; A.spawnShot(P); out.push(...A.bullets.slice(k)) } return out };
  // Bullet Hose
  { const P = setup(['Bullet Hose']);
    check(P.s.ammo === A.BASE.ammo + 9, `Bullet Hose: +9 ammo (${P.s.ammo})`);
    check(P.s.fireDelay < A.BASE.fireDelay * .4, `Bullet Hose: about x3 fire rate (${P.s.fireDelay})`);
    const bs = shoot(P, 40), ang = bs.map((b) => Math.atan2(b.vy, b.vx)), m = ang.reduce((a, b) => a + b, 0) / ang.length, sd = Math.sqrt(ang.reduce((a, b) => a + (b - m) ** 2, 0) / ang.length);
    check(bs.length === 40, `Bullet Hose: one round per shot (${bs.length})`);
    check(sd > .03 && sd < .12 && Math.max(...ang.map(Math.abs)) < .2, `Bullet Hose: a real but controlled spray (spread ${sd.toFixed(3)} rad)`);
    // a full magazine empties fast when the trigger is held
    { const Q = setup(['Bullet Hose']); A.game.shotsBy = [0, 0, 0, 0]; for (let f = 0; f < 60; f++) { Q.input.fire = true; A.update(1 / 60); flushTimers() } Q.input.fire = false; const shots = A.game.shotsBy[Q.id];
      check(shots >= 7, `Bullet Hose: holding the trigger for a second fires a stream (${shots} rounds)`) }
    check(A.wildJit(12345, .11) === A.wildJit(12345, .11) && Math.abs(A.wildJit(7, .11)) <= .11, 'Bullet Hose: the spray is the same on both screens for the same shot number') }
  // plain gun stays dead straight
  { const P = setup([]); const bs = shoot(P, 10); check(bs.every((b) => Math.abs(Math.atan2(b.vy, b.vx)) < 1e-9), 'a plain gun still fires dead straight') }
  // Rubber Rounds
  { const P = setup(['Rubber Rounds']); const [b] = shoot(P, 1);
    check(b && b.bounces === A.BASE.bounces + 4, `Rubber Rounds: four more bounces (${b && b.bounces})`);
    check(P.s.bulletSpeed > A.BASE.bulletSpeed * 1.1, 'Rubber Rounds: faster bullets');
    // in flight it really bounces: shoot at the floor and count bounces
    A.bullets.length = 0; P.aim = 1.2; const [c] = shoot(P, 1); let flips = 0, lvy = c.vy; for (let f = 0; f < 240 && !c.dead; f++) { A.update(1 / 60); flushTimers(); if (Math.sign(c.vy) !== Math.sign(lvy) && lvy > 0) flips++; lvy = c.vy }
    check(flips >= 2 || c.bounced, `Rubber Rounds: the bullet bounces in flight (${flips} floor bounces)`) }
  // Chaos Rounds
  { const P = setup(['Chaos Rounds']); const bs = shoot(P, 120), kinds = new Set(bs.map((b) => b.chaosK));
    check(kinds.size === 7, `Chaos Rounds: all seven powers turn up (${[...kinds].join(',')})`);
    const ok = { explode: (b) => b.explode > 0, slow: (b) => b.slow > 0, poison: (b) => b.poison, homing: (b) => b.homing > 0, bounce: (b) => b.bounces >= 3, split: (b) => b.split >= 4, giant: (b) => b.r > 8 };
    for (const k in ok) { const xs = bs.filter((b) => b.chaosK === k); check(xs.length && xs.every(ok[k]), `Chaos Rounds: the ${k} power is applied (${xs.length})`) }
    const plain = setup([]), [pb] = shoot(plain, 1); check(!pb.chaosK && !pb.explode && !pb.homing, 'no chaos without the card');
    check(A.chaosK(321) === A.chaosK(321), 'Chaos Rounds: the same shot number rolls the same power on both screens') }
  console.log(JSON.stringify({ failures: fail.length })); fail.forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
