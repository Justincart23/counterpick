// Spawns, everywhere: for every arena and every way it's played (a duel, a 3- or 4-player free-for-all, 2v2, Survival with
// 1 to 4 heroes and its waves of enemies), every fighter is placed where the game places it and left alone for 2 seconds.
// Nobody may start inside a wall, over a pit, on top of another fighter, or drop out of the arena; everyone must land.
//   node tests/spawns.js
const { load, flushTimers } = require('./env');
const fail = [], DT = 1 / 120;
(async () => {
  const A = (await load({ seed: +(process.env.SEED || 77) })).api;
  A.startMatch('cpu'); flushTimers();
  const settle = (ps) => { for (const p of ps) { p.ctrl = 'idle'; p.input = { move: 0, aim: 0 } } const G = A.game; G.state = 'play'; G.dropT = 0; G.dropOff = 0; G.paused = false; G.bg = false; for (let i = 0; i < 240 && G.state === 'play'; i++) A.update(DT) };
  let checked = 0;
  const check = (tag, ps) => {
    for (const p of ps) { checked++;
      if (A.solidBoxP(p.x, p.y, p.r - 2, p.r - 2)) fail.push(`${tag}: ${p.name} starts inside a wall at ${p.x | 0},${p.y | 0}`) }
    const at = ps.map((p) => [p.x, p.y]); settle(ps);
    ps.forEach((p, i) => { const [x0, y0] = at[i];
      if (!p.alive) fail.push(`${tag}: ${p.name} died within 2 s of spawning at ${x0 | 0},${y0 | 0}`);
      else if (!p.grounded) fail.push(`${tag}: ${p.name} hasn't landed 2 s after spawning at ${x0 | 0},${y0 | 0} (now ${p.x | 0},${p.y | 0})`);
      else if (p.y - y0 > 260) fail.push(`${tag}: ${p.name} fell ${Math.round(p.y - y0)} px from its spawn at ${x0 | 0},${y0 | 0}`) });
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) if (Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1]) < 2 * 26) fail.push(`${tag}: ${ps[i].name} and ${ps[j].name} spawn on top of each other (${at[i].map(Math.round)} / ${at[j].map(Math.round)})`) };
  const versus = (mi, n) => { const G = A.game; G.mode = 'cpu'; G.party = n > 2; A.loadMap(mi);
    const ps = Array.from({ length: n }, (_, k) => { const p = A.makePlayer(k, 'idle', 'F' + k, k); A.recompute(p); return p }); A.setPlayers(ps);
    ps.forEach((p, k) => A.resetPlayer(p, A.spawnFor(p, k))); return ps };
  for (let mi = 0; mi < A.MAPS.length; mi++) { const M = A.MAPS[mi], name = M.name;
    if (!M.big && !M.party) check(`${name} duel`, versus(mi, 2));
    if (M.party) { check(`${name} 3-player`, versus(mi, 3)); check(`${name} 4-player`, versus(mi, 4)) } }
  // Survival: heroes (1 to 4) and every kind of round on its arenas
  A.startMatch('survival'); flushTimers();
  for (const nh of [1, 2, 4]) for (let r = 1; r <= 22; r++) {
    const G = A.game; G.mode = 'survival';
    const hs = Array.from({ length: nh }, (_, k) => { const p = A.makePlayer(k, 'idle', 'Hero' + k, 0); Object.assign(p, { team: 0, xp: 0, lvl: 1, ups: [], cards: [], scrap: 0 }); A.recompute(p); return p });
    A.setPlayers(hs); A.survRound(r); flushTimers();
    check(`survival ${nh} hero${nh > 1 ? 'es' : ''} round ${r} (${G.map.name}, ${G.rkind})`, A.players.slice()) }
  const res = { arenas: A.MAPS.length, fightersPlaced: checked, failures: fail.length };
  console.log(JSON.stringify(res)); if (fail.length) console.error([...new Set(fail)].slice(0, 40).map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0) })();
