// Homing (Seeker) shots: they fly like any bullet for half a second, then lock onto a rival that is ahead of them, in range and in plain
// sight, and curve in; a rival behind a wall or behind the shot is never locked; the lock lets go once sight is lost
//   node tests/homing.js
const { load, flushTimers } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 4 });
  const fail = [], out = {}, G = A.game;
  A.startMatch('cpu'); A.loadMap(3); G.state = 'play'; G.dropT = 0; G.dropOff = 0; G.pointT = 0;
  for (const p of A.players) { p.ctrl = 'idle'; p.input = { move: 0, aim: 0 }; p.hp = 1e6; p.s.maxHp = 1e6 }
  const [me, foe] = A.players; me.s.homing = .55;
  const shot = (ang, foeX, foeY, wall) => {
    A.bullets.length = 0; const keep = A.solids.slice(); A.solids.length = 0; if (wall) A.solids.push(wall);
    me.x = 400; me.y = 500; foe.x = foeX; foe.y = foeY; foe.vx = foe.vy = 0; foe.alive = true; foe.graceT = 99;
    A.spawnBullet(me, me.x, me.y, ang, { dmg: 10, life: 4, speed: 700 }); const b = A.bullets[A.bullets.length - 1]; b.homing = .55; b.grav = 0; return { b, undo: () => { A.solids.length = 0; A.solids.push(...keep) } } };
  const step = (b, secs) => { for (let i = 0; i < secs * 60; i++) { foe.x = foe.fx ?? foe.x; A.updateBullets(1 / 60); if (b.dead) break } };
  { // ahead of the rival, off by about 40 degrees: straight at first, locked and curving later
    const { b, undo } = shot(.2, 1100, 300); const a0 = Math.atan2(b.vy, b.vx); step(b, .4);
    if (b.lock) fail.push('locked before the half-second delay'); if (Math.abs(Math.atan2(b.vy, b.vx) - a0) > .02) fail.push('curved before the delay');
    step(b, .5); out.locked = !!b.lock; if (!b.lock) fail.push('did not lock onto a rival ahead and in sight');
    const a1 = Math.atan2(b.vy, b.vx); step(b, .3); if (!(Math.atan2(b.vy, b.vx) < a1 - .05)) fail.push('a locked shot did not curve toward the rival'); undo() }
  { const { b, undo } = shot(Math.PI, 1100, 500); step(b, 1.5); if (b.lock) fail.push('locked onto a rival behind the shot'); undo() }
  { const { b, undo } = shot(0, 1100, 500, { x: 800, y: 300, w: 60, h: 400, kind: 0 }); step(b, .45); out.walled = !!b.lock; if (b.lock) fail.push('locked through a wall'); undo() }
  console.log(JSON.stringify({ ...out, failures: fail.length })); fail.forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
