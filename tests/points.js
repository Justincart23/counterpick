// Point scoring: the first death decides the point (there are no trades). A second death never counts: crossing bullets,
// a shared explosion, a survivor who jumps off the map or takes damage afterwards all leave the point with the survivor.
//   node tests/points.js
const { load, flushTimers } = require('./env');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg) };

(async () => {
  const { api: A } = await load({ seed: 3 });
  const setup = () => {
    A.startMatch('cpu'); flushTimers();
    A.loadMap(0); A.game.state = 'play'; A.game.dropT = 0; A.game.points = [0, 0]; A.game.wins = [0, 0];
    for (const p of A.players) { p.ctrl = 'idle'; A.resetPlayer(p, A.game.map.sp[p.id]) }
    for (let i = 0; i < 30; i++) A.update(1 / 60);
  };
  const finishPoint = () => { for (let i = 0; i < 600 && A.game.state === 'pointEnd'; i++) A.update(1 / 60) };
  const [P0, P1] = [0, 1];

  // the reported bug: the opponent dies, then the winner jumps off the map half a second later
  setup(); A.die(A.players[P1]);
  for (let i = 0; i < 30; i++) A.update(1 / 60);
  A.players[P0].y = 900 + 400; A.players[P0].vy = 1000;
  for (let i = 0; i < 10; i++) A.update(1 / 60);
  check(A.players[P0].alive, 'a survivor who falls off the map after the point is decided should not die');
  finishPoint();
  check(A.game.points[P0] === 1 && A.game.points[P1] === 0, `falling after the opponent died should still score the point (points ${A.game.points})`);

  // damage after the point is decided is ignored
  setup(); A.die(A.players[P1]);
  for (let i = 0; i < 30; i++) A.update(1 / 60);
  A.damage(A.players[P0], 1000, A.players[P1]);
  check(A.players[P0].alive, 'the survivor should take no damage once the point is decided');
  finishPoint();
  check(A.game.points[P0] === 1, `a late hit should not cancel the point (points ${A.game.points})`);

  // no trades: two deaths in the same moment, or a few frames apart, still give the point to whoever fell second
  setup(); A.die(A.players[P1]); A.die(A.players[P0]);
  check(A.game.lastWinner === P0 && A.players[P0].alive, 'two deaths at the same moment: the first decides, the survivor stands');
  finishPoint();
  check(A.game.points[P0] === 1 && A.game.points[P1] === 0, `the point should go to the survivor (points ${A.game.points})`);
  setup(); A.die(A.players[P1]); A.update(1 / 60); A.update(1 / 60); A.die(A.players[P0]); A.damage(A.players[P0], 1000, null);
  check(A.game.lastWinner === P0 && A.players[P0].alive, 'a hit a couple of frames later changes nothing');

  // the sky's dawn tracks match progress: night at the start, nearly dawn at match point
  setup(); A.game.target = 5; A.game.wins = [0, 0]; A.game.points = [0, 0];
  const p0 = A.matchProgress(); A.game.wins = [2, 1]; const pMid = A.matchProgress(); A.game.wins = [4, 3]; A.game.points = [1, 0]; const pEnd = A.matchProgress();
  check(p0 === 0 && pMid > 0.3 && pMid < 0.6 && pEnd >= 0.95, `dawn should run 0 -> ~0.4 -> ~1 across a match (got ${p0}, ${pMid.toFixed(2)}, ${pEnd.toFixed(2)})`);
  A.game.wins = [4, 0]; A.game.points = [0, 0]; A.newPoint(true);
  check(A.game.banner === 'FINAL ROUND', `the last round should be announced (banner "${A.game.banner}")`);
  // arena edges: a damaging bounce, not a wall
  setup(); { const p = A.players[P0], hp0 = p.hp; p.x = 12; p.vx = -400; A.update(1 / 60);
    check(p.hp < hp0 && p.vx > 0 && p.x > 10 + p.r - 1, `touching the left edge should hurt and knock you back inside (hp ${hp0}->${p.hp}, vx ${p.vx | 0}, x ${p.x | 0})`); }
  setup(); { const p = A.players[P0], hp0 = p.hp; p.y = 895; p.vy = 600; A.update(1 / 60);
    check(p.alive && p.hp < hp0 && p.vy < 0, `the bottom should pop you up with damage, not kill you outright (hp ${hp0}->${p.hp | 0}, vy ${p.vy | 0})`);
    check(-p.vy < 1050, 'the bottom pop should be smaller than a jump'); }
  setup(); { const p = A.players[P0]; p.hp = 30; p.y = 895; p.vy = 600; let t = 0;
    while (p.alive && t < 4) { if (p.vy > 0 && p.y > 860) p.x = 700; A.update(1 / 60); t += 1 / 60 }
    check(!p.alive && A.game.lastWinner === P1, `repeated bottom hits at low health should finish you and score for the other player (alive=${p.alive}, winner=${A.game.lastWinner})`); }
  setup(); { const p = A.players[P0]; p.x = 10 + p.r + 1; p.y = 400; p.vy = 0; p.grounded = false; A.keys.add('KeyA'); A.update(1 / 60); A.keys.delete('KeyA');
    check(p.wallDir === 0, 'you should not be able to cling to or wall-jump off the arena edge'); }
  console.log(JSON.stringify({ cases: 10, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
