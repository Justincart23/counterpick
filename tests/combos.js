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

  // Limpet Mines hurt their owner too
  {
    const [P] = setup(['Limpet Mines']); const hp = P.hp;
    A.spawnBullet(P, P.x, P.y, Math.PI / 2); step(60);
    check(P.hp < hp, `your own mine should hurt you when you stand on it (hp ${hp}->${P.hp | 0})`);
  }

  // Bulwark: blocking raises a wall that stops the rival's bullets, not your own
  {
    const [P, E] = setup(['Bulwark']); const flat = (o, x, ang) => { A.spawnBullet(o, x, P.y, ang, { plain: true, dmg: 30, speed: 1400 }); A.bullets[A.bullets.length - 1].grav = 0 }; P.aim = 0; E.x = P.x + 400; E.y = P.y; const hp = P.hp;
    A.doBlock(P); step(); A.render();   // the wall draws without errors
    flat(E, E.x - 30, Math.PI); step(30);
    check(P.hp === hp, `the shield wall should stop the rival's bullet (hp ${hp}->${P.hp | 0})`);
    flat(P, P.x + 25, 0); const hpE = E.hp; step(30);
    check(E.hp < hpE, 'your own bullets should pass through your shield wall');
    step(150); flat(E, E.x - 30, Math.PI); step(30);
    check(P.hp < hp, 'the shield wall should be gone after 2 seconds');
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



  // wall jumps work off the arena's blocks: jumping against one in mid-air with no double jump left kicks you up and away
  {
    const [P] = setup([], [], A.MAPS.findIndex((m) => m.name === 'Divider')); const wall = A.solids.find((r) => r.x === 770);
    P.ctrl = 'mouse'; P.x = wall.x - P.r - 1; P.y = 620; P.vy = 100; P.grounded = false; P.ground = null; P.airJumps = 0; P.coyote = 0;
    A.keys.add('KeyD'); A.edges.add('KeyW'); A.keys.add('KeyW'); step(); A.keys.delete('KeyD'); A.keys.delete('KeyW');
    check(P.vy < -500 && P.vx < -150, `jumping off a block should wall-jump up and away (vy ${P.vy | 0}, vx ${P.vx | 0})`);
    // and you can climb it: hug the wall and keep jumping until you're on top of it
    const [Q] = setup([], [], A.MAPS.findIndex((m) => m.name === 'Divider')); Q.ctrl = 'mouse'; Q.x = 700; Q.s.airJumps = 0; Q.airJumps = 0; let top = Q.y;   // no double jump: only wall jumps can get you up there
    for (let f = 0; f < 400; f++) { A.keys.add('KeyD'); if (f % 14 === 0) A.edges.add('KeyW'); if (f % 14 < 9) A.keys.add('KeyW'); else A.keys.delete('KeyW'); step(); top = Math.min(top, Q.y) }
    A.keys.delete('KeyD'); A.keys.delete('KeyW');
    check(top < wall.y - Q.r + 5, `wall-jumping should get you to the top of a tall block (top ${top | 0}, wall top ${wall.y})`);
  }

  // the CPU climbs blocks too: on Divider it gets over the centre wall to reach you
  {
    const [P, E] = setup([], [], A.MAPS.findIndex((m) => m.name === 'Divider')); E.ctrl = 'cpu'; let crossed = false;
    for (let f = 0; f < 60 * 12 && !crossed; f++) { step(); P.hp = P.s.maxHp; E.hp = E.s.maxHp; if (E.x < 760) crossed = true }
    check(crossed, `the CPU should get over Divider's centre wall (x ${E.x | 0})`);
  }

  // explosive rounds hurt their shooter a little when the blast is close; a rival takes the full blast
  {
    const [P] = setup(['Blast Cap']); const hp = P.hp;
    A.spawnBullet(P, P.x, P.y, Math.PI / 2); step(30);
    const lost = hp - P.hp;
    check(lost > 3 && lost < 20, `your own Blast Cap blast should hurt you a little (lost ${lost.toFixed(1)})`);
    const [Q, E] = setup(['Blast Cap']); E.x = Q.x + 40; E.y = Q.y + 10; const hpE = E.hp;
    A.spawnBullet(Q, E.x, E.y - 30, Math.PI / 2); step(30);
    check(hpE - E.hp > lost * 1.8, `a rival should take far more from the blast (${(hpE - E.hp).toFixed(1)} vs ${lost.toFixed(1)})`);
  }

  // the arena's side edges can't be climbed: holding into one while spamming jump never gets higher than a jump plus a
  // double jump, and every touch hurts
  {
    const [P] = setup(); P.ctrl = 'mouse'; P.x = 40; step(20); const y0 = P.y, hp = P.hp; let top = P.y;
    for (let f = 0; f < 180 && P.alive; f++) { A.keys.add('KeyA'); if (f % 8 === 0) A.edges.add('KeyW'); if (f % 8 < 4) A.keys.add('KeyW'); else A.keys.delete('KeyW'); step(); top = Math.min(top, P.y) }
    A.keys.delete('KeyA'); A.keys.delete('KeyW');
    check(y0 - top < 420, `spamming jump into the edge should not climb it (rose ${(y0 - top) | 0}px)`);
    check(P.hp < hp, 'touching the edge should hurt');
  }

  // arrow keys move and jump as well as WASD
  {
    const [P] = setup(); P.ctrl = 'mouse'; const x0 = P.x;
    A.keys.add('ArrowRight'); step(30); A.keys.delete('ArrowRight');
    check(P.x - x0 > 150, `the right arrow should move you (moved ${(P.x - x0) | 0}px)`);
    step(30); const y0 = P.y; let top = P.y; A.edges.add('ArrowUp'); A.keys.add('ArrowUp');
    for (let i = 0; i < 20; i++) { step(); top = Math.min(top, P.y) } A.keys.delete('ArrowUp');
    check(y0 - top > 80, `the up arrow should jump (rose ${(y0 - top) | 0}px)`);
  }

  // ---- ROUNDS mechanics from the guide video ----
  const shoot = (o, x, y, ang, extra = {}) => { A.spawnBullet(o, x, y, ang, { plain: true, dmg: 30, speed: 1300, ...extra }); const b = A.bullets[A.bullets.length - 1]; b.grav = 0; return b };
  // duck: hold S on the ground and a shot at head height flies over you; standing, it hits
  {
    const [P, E] = setup(); E.x = P.x + 400; E.y = P.y; P.ctrl = 'mouse'; A.keys.add('KeyS'); step(10); const hp = P.hp;
    shoot(E, E.x - 40, P.y - 12, Math.PI); step(30); A.keys.delete('KeyS'); step(5);
    check(P.hp === hp, `a ducking fighter should dodge a head-height shot (hp ${hp}->${P.hp | 0})`);
    shoot(E, E.x - 40, P.y - 12, Math.PI); step(30);
    check(P.hp < hp, 'standing up, the same shot should hit');
  }
  // perfect parry: a block that meets a bullet in its first instant sends it back and hurts the shooter; a late block just stops it
  {
    const [P, E] = setup(); E.x = P.x + 300; E.y = P.y; const b = shoot(E, E.x - 40, P.y, Math.PI); const hpE = E.hp;
    while (Math.abs(b.x - P.x) > P.r + 20 && !b.dead) A.update(1 / 240); A.doBlock(P); step(40);
    check(b.owner === P && E.hp < hpE, `a perfectly timed block should deflect the bullet into the shooter (owner ${b.owner === P ? 'you' : 'them'}, rival hp ${hpE}->${E.hp | 0})`);
    const [Q, F] = setup(); F.x = Q.x + 150; F.y = Q.y; A.doBlock(Q); step(12); const c = shoot(F, F.x - 40, Q.y, Math.PI); const hpF = F.hp; step(30);
    check(c.dead && c.owner === F && F.hp === hpF && Q.hp === Q.s.maxHp, 'a late block should stop the bullet without deflecting it');
  }
  // sketchy jump: blocking into a side border fires you back in fast with no damage
  {
    const [P] = setup(); P.y -= 200; P.grounded = false; P.ground = null; P.x = 40; P.vx = -500; P.edgeT = 0; const hp = P.hp; A.doBlock(P); step(2);
    check(P.vx > 1000 && P.hp === hp, `blocking into the side border should launch you inward unharmed (vx ${P.vx | 0}, hp ${hp}->${P.hp | 0})`);
  }
  // wall grip: hold toward a wall in the air and you barely slide
  {
    const [P] = setup([], [], A.MAPS.findIndex((m) => m.name === 'Divider')); const wall = A.solids.find((r) => r.x === 770);
    P.ctrl = 'mouse'; P.x = wall.x - P.r - 1; P.y = 560; P.vy = 0; P.grounded = false; P.ground = null; A.keys.add('KeyD'); step(30); A.keys.delete('KeyD');
    check(P.vy <= 75 && P.y < 600, `holding toward a wall should grip it (vy ${P.vy | 0}, slid to ${P.y | 0})`);
  }
  // fast fall: holding S in the air drops you faster
  {
    const fallTo = (down) => { const [P] = setup(); P.ctrl = 'mouse'; P.y = 300; P.vy = 0; P.grounded = false; P.ground = null; if (down) A.keys.add('KeyS'); step(12); A.keys.delete('KeyS'); return P.vy };
    const plain = fallTo(false), fast = fallTo(true); check(fast > plain * 1.4, `holding S should fall faster (${fast | 0} vs ${plain | 0})`);
  }
  // a hanging block swung hard into you hurts; blocking knocks it back instead
  {
    const hitBy = (blocking) => { const [P, E] = setup([], [], A.MAPS.findIndex((m) => m.name === 'Gallows')); const w = A.swings[0]; E.x = 1300;
      P.x = w.ax + w.w / 2 + P.r - 10; P.y = w.len; P.vy = 0; P.grounded = false; P.ground = null; w.ang = -.25; w.av = 2.4; w.lastHit = E; const hp = P.hp;
      if (blocking) A.doBlock(P); for (let i = 0; i < 20; i++) { A.update(1 / 60); P.vy = Math.min(P.vy, 0) } return { lost: hp - P.hp, av: w.av } };
    const hit = hitBy(false), safe = hitBy(true);
    check(hit.lost >= 12, `a fast-swinging block should hurt whoever it hits (lost ${hit.lost | 0})`);
    check(safe.lost === 0, `blocking should knock the swinging block back (lost ${safe.lost | 0})`);
  }
  // Echo Guard: one press, two blocks; Shield Charge: block dashes you along your aim and rams your rival
  {
    const [P] = setup(['Echo Guard']); A.doBlock(P); step(21); check(P.blockT > 0, `Echo Guard should block again a beat later (blockT ${P.blockT.toFixed(2)})`);
    const [Q, E] = setup(['Shield Charge']); Q.aim = 0; E.x = Q.x + 160; E.y = Q.y; const hp = E.hp; A.doBlock(Q); const vx = Q.vx; step(20);
    check(vx > 1000, `Shield Charge should launch you along your aim (vx ${vx | 0})`);
    check(E.hp < hp, `ramming your rival should hurt them (hp ${hp}->${E.hp | 0})`);
  }
  // Long Haul bullets grow as they fly
  {
    const [P] = setup(['Long Haul']); A.spawnBullet(P, P.x + 30, P.y - 400, 0); const b = A.bullets[A.bullets.length - 1]; b.grav = 0; const r0 = b.r; step(30);
    check(b.r > r0 * 1.3, `Long Haul bullets should grow as they fly (r ${r0} -> ${b.r.toFixed(1)})`);
  }

  // Ricochet stacks: two copies, four bounces
  { const [P] = setup(['Ricochet', 'Ricochet']); check(P.s.bounces === 4, `two Ricochets should give 4 bounces (${P.s.bounces})`) }

  // Sandbox: pick any cards for either side, no drafting, points just keep coming, the CPU can be set to stand still
  {
    const S = A.sandbox; S.seen = true; S.decks = [[card(A, 'Blast Cap'), card(A, 'Ricochet'), card(A, 'Ricochet')], [card(A, 'Thick Skin')]];
    A.startMatch('sandbox'); flushTimers();
    const [P, E] = A.players;
    check(A.game.state === 'ready', `sandbox should skip the opening draft (state ${A.game.state})`);
    check(P.s.bounces === 4 && P.s.explode > 0 && E.s.maxHp > 100, 'sandbox loadouts should apply to both fighters and stack');
    A.game.state = 'play'; A.die(E); step(200);
    check(A.game.state !== 'pick' && A.game.wins[0] === 1, `a sandbox point should just tally and carry on (state ${A.game.state}, tally ${A.game.wins})`);
    S.cpu = 'still'; S.arena = 3; S.decks[1] = []; A.applySandbox();
    check(A.players[1].ctrl === 'idle' && A.game.map.name === 'Divider' && A.players[1].cards.length === 0, 'changing the sandbox setup should take effect on the next point');
    for (let i = 0; i < 400; i++) step(); 
    check(!A.bullets.some((b) => b.owner === A.players[1]), 'a CPU set to stand still should never shoot');
    S.cpu = 'fight'; S.arena = -1; S.decks = [[], []];
  }

  console.log(JSON.stringify({ cases: 25, failures: fail.length, fail }));
  process.exit(fail.length ? 1 : 0);
})();
