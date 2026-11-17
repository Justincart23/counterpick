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
  A.startMatch('cpu'); idle(); point();
  run(40, () => A.game.overtime); out.duelAt = +A.game.pointT.toFixed(1);
  if (!(out.duelAt > 31.9 && out.duelAt < 33)) fail.push('duel overtime at ' + out.duelAt);
  const kinds = {}; A.MAPS.forEach((m, i) => { A.loadMap(i); A.game.overtime = true; const k = A.otKind(); (kinds[k] = kinds[k] || []).push(i) }); out.kinds = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.length]));
  for (const k of ['tide', 'meteor', 'squeeze']) { if (!kinds[k] || kinds[k].length < 3) fail.push('too few ' + k + ' arenas');
    A.startMatch('cpu'); A.loadMap(kinds[k][0]); idle(); point(); run(40, () => A.game.overtime); const lo = A.players[0]; lo.hp = 5000;
    run(12); out[k + 'Hurt'] = Math.round(5000 - lo.hp) + Math.round(1e6 - A.players[1].hp);
    if (k !== 'meteor' && !(A.game.otRise > 100 || A.game.state === 'pointEnd')) fail.push(k + ' did not advance (' + A.game.otRise + ')');
    if (k === 'meteor' && !(A.game.metT !== 0)) fail.push('no meteors fell');
    if (!(lo.hp < 5000 || A.players[1].hp < 1e6)) fail.push(k + ' hurt nobody in 12 s of idling');
    point(); if (A.game.otRise !== 0 || A.game.mets.length) fail.push(k + ' did not reset') }
  A.startMatch('party'); idle(); point(); run(60, () => A.game.overtime); out.partyAt = +A.game.pointT.toFixed(1);
  if (!(out.partyAt > 49.9 && out.partyAt < 51)) fail.push('4-fighter overtime at ' + out.partyAt);
  A.startMatch('sandbox'); idle(); point(); run(45); if (A.game.otRise !== 0) fail.push('sandbox got a tide');
  console.log(JSON.stringify({ ...out, failures: fail.length })); fail.forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
