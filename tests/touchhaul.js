// Long Haul's blast grows with the bullet (no cap); a phone tap's auto-aim fires exactly where the solver aimed, Rail Slug included;
// and on a phone (where there is no trigger to hold) a tap or a held thumb still gives Bullet Hose its spray
//   node tests/touchhaul.js
const { load, flushTimers, advance } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 33 }), fail = [], check = (ok, m) => { if (!ok) fail.push(m) };
  const C = (n) => A.CARDS.find((c) => c.n === n);
  const setup = (cards) => { A.startMatch('sandbox'); flushTimers(); A.loadMap(0); A.game.state = 'play'; A.game.dropT = 0;
    const [P, E] = A.players; P.cards = cards.map(C); E.cards = []; A.recompute(P); A.recompute(E); A.resetPlayer(P, A.game.map.sp[0]); A.resetPlayer(E, A.game.map.sp[1]);
    P.ctrl = 'mouse'; E.ctrl = 'idle'; P.aim = 0; for (let i = 0; i < 4; i++) { A.update(1 / 60); flushTimers() } A.bullets.length = 0; return [P, E] };
  setup([]); for (let i = 0; i < 90; i++) { A.update(1 / 60); flushTimers() }   // let the first round's intro play out
  // Long Haul: the bullet keeps growing, and the blast is sized to it
  for (const [dist, far] of [[3000, 400], [6000, 700]]) {
    const [P, E] = setup(['Long Haul']); A.spawnBullet(P, 400, 300, 0); const b = A.bullets[A.bullets.length - 1]; b.grav = 0; b.life = 99; b.vx = 5; b.vy = 0; A.update(1 / 60); A.update(1 / 60); flushTimers(); const r0 = b.r0 || b.r; b.dist = dist; A.update(1 / 60);
    check(b.r > r0 * (dist === 3000 ? 3 : 5), `Long Haul: at ${dist}px the bullet is far past x1.8 (${(b.r / r0).toFixed(2)}x)`);
    E.x = b.x + far; E.y = b.y; E.vx = E.vy = 0; A.longShock(b, null);
    check(E.vx > 20, `Long Haul: a ${dist}px shot's blast reaches a rival ${far}px away (pushed ${E.vx.toFixed(0)})`) }
  { const [P, E] = setup(['Long Haul']); A.spawnBullet(P, 400, 300, 0); const b = A.bullets[A.bullets.length - 1]; b.dist = 1000; b.vx = b.vy = 0; b.r = 7;
    E.x = b.x + 600; E.y = b.y; E.vx = 0; A.longShock(b, null); check(Math.abs(E.vx) < 1, 'Long Haul: a mid-range blast stays modest, far targets are not shoved') }
  // tap auto-aim: the barrel's line ends up exactly on the solver's angle, for every gun
  for (const gun of [[], ['Rail Slug'], ['Rail Slug', 'Long Haul'], ['Bullet Hose']]) for (const dy of [0, -180, 160]) {
    const [P, E] = setup(gun); A.touch.on = true; E.x = P.x + 700; E.y = P.y + dy; E.vx = E.vy = 0;
    A.autoAim(); const got = A.aimThrough(P, A.mouse.x, A.mouse.y), want = A.aimSolution(P, E);
    check(Math.abs(got - want) < .004, `tap auto-aim with [${gun}] (rival ${dy}px off): fires at ${got.toFixed(3)}, should be ${want.toFixed(3)}`);
    E.x = P.x - 700; A.autoAim(); const g2 = A.aimThrough(P, A.mouse.x, A.mouse.y), w2 = A.aimSolution(P, E);
    check(Math.abs(Math.atan2(Math.sin(g2 - w2), Math.cos(g2 - w2))) < .004, `tap auto-aim facing left with [${gun}]: fires at ${g2.toFixed(3)}, should be ${w2.toFixed(3)}`);
    A.touch.on = false }
  // Bullet Hose on a phone
  const run = (P, frames, per) => { A.game.shotsBy = [0, 0, 0, 0]; for (let f = 0; f < frames; f++) { if (per) per(f); A.touchFrame(); advance(1000 / 60); A.update(1 / 60); flushTimers() } return A.game.shotsBy[P.id] };
  { const [P] = setup(['Bullet Hose']); A.touch.on = true; A.mouse.tapN = 0; A.touch.hoseN = 0; A.touchShoot(true); const n = run(P, 90);
    check(n >= 5, `Bullet Hose: one tap lets off a spray (${n} rounds)`); check(n <= 7, `Bullet Hose: a tap's spray is short (${n} rounds)`); A.touch.on = false }
  { const [P] = setup([]); A.touch.on = true; A.mouse.tapN = 0; A.touch.hoseN = 0; A.touchShoot(true); const n = run(P, 90); check(n === 1, `a plain gun: one tap is one shot (${n})`); A.touch.on = false }
  { const [P] = setup(['Triple Tap']); A.touch.on = true; A.mouse.tapN = 0; A.touchShoot(true); const n = run(P, 60); check(n === 3, `Triple Tap: one tap is one three-round burst (${n})`); A.touch.on = false }
  { const [P] = setup(['Bullet Hose']); A.touch.on = true; A.mouse.tapN = 0; const t = { id: 1, ox: 0, oy: 0, dx: 60, dy: 0, t0: performance.now(), maxD: 60 };   // a thumb dragged out and held
    A.touch.aim = t; const n = run(P, 60, () => { t.maxD = 60 }); check(n >= 6, `Bullet Hose: a held, aimed thumb keeps spraying (${n} rounds in a second)`);
    A.touch.aim = null; A.touchRelease(t); A.mouse.tapN = 0; A.touch.on = false }
  console.log(JSON.stringify({ failures: fail.length })); fail.forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
