// The fighting-game cards: Launcher (hurt rivals fly farther and crash into walls), Juggler (air hits pop them back up),
// Combo Chain (back-to-back hits build damage, getting hit breaks it) and Uppercut Guard (blocking pops rivals up).
//   node tests/smash.js
const { load, flushTimers } = require('./env');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg) };
const card = (A, n) => A.CARDS.find((c) => c.n === n);

(async () => {
  const { api: A } = await load({ seed: 11 });
  const step = (n = 1) => { for (let i = 0; i < n; i++) { A.update(1 / 60); flushTimers() } };
  const setup = (cards0 = [], cards1 = []) => {
    A.startMatch('cpu'); flushTimers();
    A.loadMap(0); A.game.state = 'play'; A.game.dropT = 0; A.game.points = [0, 0]; A.game.wins = [0, 0];
    A.players[0].cards = cards0.map((n) => card(A, n)); A.players[1].cards = cards1.map((n) => card(A, n));
    for (const p of A.players) { p.ctrl = 'idle'; A.recompute(p); A.resetPlayer(p, A.game.map.sp[p.id]) }
    step(40); A.bullets.length = 0;
    return A.players;
  };
  // fire one shot from P straight into E and step until it lands
  const shoot = (P, E) => { const n = A.bullets.length; A.spawnBullet(P, E.x - 40, E.y, 0); const b = A.bullets[n]; b.dmg = 20;
    for (let i = 0; i < 6 && !b.dead; i++) step() };
  check(!A.CARDS.some((c) => c.n === 'Gravity Well'), 'Gravity Well should be gone');

  // Launcher: a hurt rival flies much farther than a healthy one
  const launch = (hpFrac, cards) => { const [P, E] = setup(cards); E.hp = E.s.maxHp * hpFrac; E.vx = E.vy = 0; shoot(P, E); return Math.hypot(E.vx, E.vy) };
  const healthy = launch(1, ['Launcher']), hurt = launch(.2, ['Launcher']), plainHurt = launch(.2, []);
  check(hurt > plainHurt * 1.8, `Launcher should launch a hurt rival much farther (${hurt.toFixed(0)} vs plain ${plainHurt.toFixed(0)})`);
  check(hurt > healthy * 1.5, `Launcher should scale with how hurt the rival is (${hurt.toFixed(0)} vs healthy ${healthy.toFixed(0)})`);
  // ...and a launched rival who slams into the arena edge crashes for extra damage
  { const [P, E] = setup(['Launcher']); E.hp = E.s.maxHp * .5; E.launchT = .7; E.launchBy = P; E.edgeT = 1; E.x = 70; E.vx = -1500; E.vy = 0; E.ground = null; E.grounded = false;
    const hp = E.hp; step(3); check(hp - E.hp >= 20, `a launched rival hitting the edge should crash (lost ${(hp - E.hp).toFixed(1)})`) }

  // Juggler: hits in the air deal more and pop the rival up
  { const [P, E] = setup(['Juggler']); E.y -= 200; E.vy = 300; E.grounded = false; E.ground = null; const hp = E.hp; shoot(P, E);
    check(E.vy < -400, `Juggler should pop an airborne rival up (vy ${E.vy.toFixed(0)})`); check(hp - E.hp > 20 * 1.3, `Juggler should hit harder in the air (dealt ${(hp - E.hp).toFixed(1)})`) }

  // Combo Chain: the third hit in a row deals more than the first; getting hit resets it
  { const [P, E] = setup(['Combo Chain']); const dealt = [];
    for (let i = 0; i < 3; i++) { E.hp = E.s.maxHp; E.vx = E.vy = 0; const hp = E.hp; shoot(P, E); dealt.push(hp - E.hp); A.resetPlayer(E, A.game.map.sp[1]); step(2) }
    check(dealt[2] > dealt[0] * 1.25, `Combo Chain should build damage (${dealt.map((d) => d.toFixed(1))})`);
    A.damage(P, 5, E); check(!(P.comboT > 0), 'getting hit should break the combo') }

  // Uppercut Guard: blocking pops a nearby rival straight up and hurts them
  { const [P, E] = setup(['Uppercut Guard']); E.x = P.x + 90; E.y = P.y; E.vx = E.vy = 0; P.blockCd = 0; const hp = E.hp; A.doBlock(P);
    check(E.vy < -1000, `Uppercut Guard should pop the rival up (vy ${E.vy.toFixed(0)})`); check(hp - E.hp >= 11, 'Uppercut Guard should deal 12 damage') }

  // Afterburner: a hit straps on a rocket that keeps shoving the rival the way the shot flew
  { const [P, E] = setup(['Afterburner']); E.vx = E.vy = 0; shoot(P, E); const v0 = E.vx; check(E.burnT > .4, 'Afterburner should strap a rocket on'); step(10);
    check(E.vx > v0 && E.vx > 250, `the rocket should keep pushing (vx ${v0.toFixed(0)} -> ${E.vx.toFixed(0)})`); check(!A.CARDS.some((c) => c.n === 'Haymaker'), 'Haymaker became Afterburner') }
  // Jammer Rounds: hits push the rival's block cooldown back
  { const [P, E] = setup(['Jammer Rounds']); E.blockCd = 0; shoot(P, E); check(E.blockCd >= .39, `Jammer should delay their block (${E.blockCd.toFixed(2)})`) }
  // Pickpocket: a gun hit steals a bullet, once per trigger pull, into a magazine with spare room
  { const [P, E] = setup(['Pickpocket']); P.ammo = P.s.ammo; const ea = E.ammo; const n = A.bullets.length; A.spawnBullet(P, E.x - 40, E.y, 0); const b = A.bullets[n]; b.gunShot = true; b.dmg = 20;
    for (let i = 0; i < 6 && !b.dead; i++) step(); check(E.ammo === ea - 1, 'Pickpocket should take a bullet'); check(P.ammo === P.s.ammo + 1, `Pickpocket should overfill your magazine (${P.ammo})`) }
  // Detonator: charges stick (5 at most) and all blow on your block
  { const [P, E] = setup(['Detonator']); for (let i = 0; i < 7; i++) { E.vx = E.vy = 0; const c = E.charges || 0; A.resetPlayer(E, A.game.map.sp[1]); E.charges = c; shoot(P, E) }
    check(E.charges === 5, `Detonator charges should cap at 5 (${E.charges})`); E.x = P.x + 200; E.y = P.y; E.hp = E.s.maxHp; P.blockCd = 0; const hp = E.hp; A.doBlock(P);
    check(E.charges === 0 && hp - E.hp >= 44, `blocking should blow all charges (dealt ${(hp - E.hp).toFixed(1)})`) }
  // Grudge: +20% per round behind, up to +60%, nothing when level or ahead
  { const [P] = setup(['Grudge']); A.game.wins = [0, 0]; const even = A.grudgeMult(P); A.game.wins = [0, 2]; const two = A.grudgeMult(P); A.game.wins = [0, 5]; const max = A.grudgeMult(P); A.game.wins = [3, 0]; const ahead = A.grudgeMult(P);
    check(even === 1 && Math.abs(two - 1.4) < 1e-9 && Math.abs(max - 1.6) < 1e-9 && ahead === 1, `Grudge scaling wrong (${even}, ${two}, ${max}, ${ahead})`) }
  // a storm of blasts stays capped
  { setup(); for (let i = 0; i < 300; i++) A.boomFx(400 + i, 400, 120, '#fff', 2); const imgs = A.parts ? A.parts.filter((q) => q.img).length : 0; check(imgs <= 40, `explosion sprites should be capped (${imgs})`) }

  // Spite against Spite: shrapnel never sets off more shrapnel (it used to chain into 190,000 bullets and freeze co-op)
  { const [P, E] = setup(['Spite', 'Spite'], ['Spite', 'Spite']); E.x = P.x + 30; E.y = P.y; P.s.maxHp = E.s.maxHp = P.hp = E.hp = 1e6; A.spawnBullet(P, E.x - 30, E.y, 0);   // pressed together, so every shard lands
    let most = 0; for (let i = 0; i < 240; i++) { P.hp = E.hp = 1e6; E.x = P.x + 30; E.y = P.y; step(); most = Math.max(most, A.bullets.length) } check(most < 200, `Spite shrapnel should not chain (peaked at ${most} bullets)`) }
  // Long Haul + Hair Trigger + Blast Cap, both fighters shooting flat out for 10 s: bullets, particles and step time stay bounded
  { const deck = ['Long Haul', 'Hair Trigger', 'Hair Trigger', 'Blast Cap', 'Spite', 'Cluster Guard'].filter((n) => A.CARDS.some((c) => c.n === n)); const [P, E] = setup(deck, deck);
    P.s.maxHp = E.s.maxHp = 1e6; let most = 0, parts = 0, slow = 0; const t0 = Date.now();
    for (let i = 0; i < 600; i++) { P.hp = E.hp = 1e6; for (const [a, b] of [[P, E], [E, P]]) { a.ammo = a.s.ammo; a.aim = Math.atan2(b.y - a.y, b.x - a.x); a.input.aim = a.aim; a.input.fire = true; a.ctrl = 'idle' }
      const s0 = Date.now(); step(); slow = Math.max(slow, Date.now() - s0); most = Math.max(most, A.bullets.length); parts = Math.max(parts, A.parts ? A.parts.length : 0) }
    check(most <= 600 && parts <= 1000, `Long Haul storm should stay bounded (${most} bullets, ${parts} particles)`); check(slow < 50, `a step in the storm took ${slow} ms`) }
  console.log(JSON.stringify({ healthy: +healthy.toFixed(0), hurt: +hurt.toFixed(0), plainHurt: +plainHurt.toFixed(0), failures: fail }));
  process.exit(fail.length ? 1 : 0);
})();
