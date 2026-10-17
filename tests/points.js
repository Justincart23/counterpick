// Point scoring: the first death decides the point. A second death only makes a trade when it lands within the
// trade window (crossing bullets, a shared explosion); a survivor who jumps off the map or takes damage afterwards
// keeps the point.
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

  // true trades still exist: both die in the same moment
  setup(); A.die(A.players[P1]); A.die(A.players[P0]);
  check(A.game.lastWinner === -1, 'two deaths at the same moment should be a trade');
  finishPoint();
  check(A.game.points[P0] === 0 && A.game.points[P1] === 0, `a trade should score nobody (points ${A.game.points})`);

  // ...or within the short trade window (a few frames apart)
  setup(); A.die(A.players[P1]); A.update(1 / 60); A.update(1 / 60); A.die(A.players[P0]);
  check(A.game.lastWinner === -1, 'a second death a couple of frames later should still be a trade');

  // the sky's dawn tracks match progress: night at the start, nearly dawn at match point
  setup(); A.game.target = 5; A.game.wins = [0, 0]; A.game.points = [0, 0];
  const p0 = A.matchProgress(); A.game.wins = [2, 1]; const pMid = A.matchProgress(); A.game.wins = [4, 3]; A.game.points = [1, 0]; const pEnd = A.matchProgress();
  check(p0 === 0 && pMid > 0.3 && pMid < 0.6 && pEnd >= 0.95, `dawn should run 0 -> ~0.4 -> ~1 across a match (got ${p0}, ${pMid.toFixed(2)}, ${pEnd.toFixed(2)})`);
  A.game.wins = [4, 0]; A.game.points = [0, 0]; A.newPoint(true);
  check(A.game.banner === 'FINAL ROUND', `the last round should be announced (banner "${A.game.banner}")`);
  console.log(JSON.stringify({ cases: 6, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
