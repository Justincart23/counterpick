// The CPU can get to you on every arena: with you standing still at either spawn, it must land a hit within 25 s.
// (Catches maps that the jump physics have outgrown, and CPU navigation that stalls under a platform.)
//   node tests/cpu-reach.js
const { load, flushTimers } = require('./env');

(async () => {
  const { api: A } = await load({ seed: 9 });
  const fail = [], times = [];
  for (let mi = 0; mi < A.MAPS.length; mi++) for (const side of [0, 1]) {
    A.startMatch('cpu'); flushTimers(); A.loadMap(mi); A.game.state = 'play'; A.game.dropT = 0;
    const [P, E] = A.players; P.cards = []; E.cards = []; A.recompute(P); A.recompute(E);
    const you = side ? E : P, cpu = side ? P : E; you.ctrl = 'idle'; cpu.ctrl = 'cpu';
    A.resetPlayer(P, A.game.map.sp[0]); A.resetPlayer(E, A.game.map.sp[1]);
    const hp = you.hp; let t = 0;
    for (; t < 25 * 60; t++) { A.update(1 / 60); flushTimers(); you.input.fire = false; if (you.hp < hp || !you.alive || A.game.state !== 'play') break }
    if (t >= 25 * 60) fail.push(`${A.MAPS[mi].name}: the CPU from the ${side ? 'left' : 'right'} never reached you`); else times.push(t / 60);
  }
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ runs: A.MAPS.length * 2, medianSeconds: +(times[times.length >> 1] || 0).toFixed(1), slowest: +(times.at(-1) || 0).toFixed(1), failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
