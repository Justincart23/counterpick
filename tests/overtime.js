// Overtime: starts at 32 s in a duel and 9 s later per extra fighter; then a tide of lava rises from the floor and burns
// anyone it reaches (so a stalemate always ends); the tide resets with each point
//   node tests/overtime.js
const { load, flushTimers } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 5 });
  const fail = [], out = {};
  const run = (secs, stop) => { for (let i = 0; i < secs * 60 && !(stop && stop()); i++) { A.update(1 / 60); flushTimers() } };
  const idle = () => { for (const p of A.players) { p.ctrl = 'idle'; p.input = { move: 0, aim: 0 } } };
  const point = () => { const G = A.game; G.state = 'play'; G.dropT = 0; G.dropOff = 0; G.pointT = 0; G.overtime = false; G.otRise = 0; G.mets = []; G.metT = 0; for (const p of A.players) { p.hp = 1e6; p.alive = true } idle() };
  A.startMatch('cpu'); if (A.game.map.climb) A.loadMap(3); idle(); point();
  run(40, () => A.game.overtime); out.duelAt = +A.game.pointT.toFixed(1);
  if (!(out.duelAt > 31.9 && out.duelAt < 33)) fail.push('duel overtime at ' + out.duelAt);
  for (const k of ['tide', 'meteor', 'squeeze', 'bolt']) {
    A.startMatch('cpu'); A.loadMap(3); idle(); point(); A.game.otMode = k; run(40, () => A.game.overtime); const lo = A.players[0]; lo.hp = 5000;
    if (A.otKind() !== k) fail.push('mode ' + k + ' became ' + A.otKind());
    run(12); out[k + 'Hurt'] = Math.round(5000 - lo.hp) + Math.round(1e6 - A.players[1].hp);
    if ((k === 'tide' || k === 'squeeze') && !(A.game.otRise > 100 || A.game.state === 'pointEnd')) fail.push(k + ' did not advance (' + A.game.otRise + ')');
    if (!(lo.hp < 5000 || A.players[1].hp < 1e6)) fail.push(k + ' hurt nobody in 12 s of idling');
    point(); if (A.game.otRise !== 0 || A.game.mets.length) fail.push(k + ' did not reset') }
  const seen = new Set(); for (let i = 0; i < 40; i++) { A.startMatch('cpu'); if (A.game.map.climb) A.loadMap(3); idle(); point(); A.game.otMode = null; run(40, () => A.game.overtime); seen.add(A.game.otMode) } out.modesSeen = [...seen].sort().join();
  if (seen.size < 3) fail.push('overtime did not vary between rounds: ' + [...seen]);
  A.startMatch('party'); if (A.game.map.climb) A.loadMap(3); idle(); point(); run(60, () => A.game.overtime); out.partyAt = +A.game.pointT.toFixed(1);
  if (!(out.partyAt > 49.9 && out.partyAt < 51)) fail.push('4-fighter overtime at ' + out.partyAt);
  A.startMatch('sandbox'); idle(); point(); run(45); if (A.game.otRise !== 0) fail.push('sandbox got a tide');
  console.log(JSON.stringify({ ...out, failures: fail.length })); fail.forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
