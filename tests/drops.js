// Power-up drops (Survival only): a beam marks the spot before a capsule falls onto a platform; touching it gives its
// power-up (each kind checked); bosses never take one.
//   node tests/drops.js
const { load, flushTimers } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 3 });
  const fail = [], check = (ok, m) => { if (!ok) fail.push(m) };
  const fresh = () => { A.startSurvival(); flushTimers(); while (A.game.state === 'pick') { A.choose(A.hand[0], null); flushTimers() }
    A.loadMap(0); A.players.forEach((p, k) => A.resetPlayer(p, A.game.map.sp[k % 2]));   // a fixed arena (Yard): room for a capsule away from both fighters
    A.game.state = 'play'; for (const p of A.players) { p.ctrl = 'idle'; p.hp = p.s.maxHp } };
  // a drop appears: beam first, then it falls and lands on top of a platform
  fresh(); A.game.capT = 0; A.dropTick(1 / 120);
  check(A.drops.length === 1 && A.drops[0].state === 'warn', 'a capsule starts as a warning beam');
  const d = A.drops[0];
  for (let i = 0; i < 240 && d.state !== 'ready'; i++) A.dropTick(1 / 120);
  check(d.state === 'ready', 'the capsule falls and lands');
  check(A.solids.some((r) => !r.bound && Math.abs(r.y - (d.y + 16 + 2)) < 1 && d.x > r.x && d.x < r.x + r.w), 'it lands on top of a platform');
  // each kind does what it says
  const take = (kind) => { fresh(); const p = A.players[0]; A.drops = [{ id: 99, kind, x: p.x, y: p.y, ty: p.y, state: 'ready', t: 10, vy: 0 }]; A.dropTick(1 / 120); return p };
  { fresh(); const p = A.players[0]; p.hp = 10; A.drops = [{ id: 1, kind: 'heal', x: p.x, y: p.y, ty: p.y, state: 'ready', t: 10 }]; A.dropTick(1 / 120); check(p.hp > 40, `Health heals (hp ${Math.round(p.hp)})`) }
  { const p = take('over'); check(p.buffOver > 7, 'Overcharge gives double damage for 8 s') }
  { const p = take('rapid'); const a0 = p.ammo; p.input.fire = true; for (let i = 0; i < 120; i++) A.update(1 / 120); check(p.ammo === a0 && p.buffRapid > 0, `Rapid fire shoots without using ammo (${a0} -> ${p.ammo})`) }
  { const p = take('bubble'); check(p.aegis >= 1, 'Bubble adds a shield') }
  { const p = take('wild'); check((p.tempCards || []).length === 1, 'Wild card adds a card for the point'); A.newPoint(); check(!(p.tempCards || []).length, 'the Wild card ends with the point') }
  check(A.drops.length === 0, 'a new point clears capsules');
  // bosses never take one
  { fresh(); const b = A.players[1]; b.boss = A.BOSSES[0]; A.drops = [{ id: 7, kind: 'heal', x: b.x, y: b.y, ty: b.y, state: 'ready', t: 10 }]; A.dropTick(1 / 120); check(A.drops.length === 1, 'a boss never picks up a capsule') }
  console.log(JSON.stringify({ kinds: Object.keys(A.DROPS).length, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
