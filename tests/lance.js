// Sun Lance, the Legendary: the shot waits out its wind-up, one beam a magazine (then a reload), it cuts through wooden planks but
// not stone, it sets the rival on fire, other gun cards can't turn it into a fan or a burst, and it is as rare as promised
//   node tests/lance.js
const { load, flushTimers } = require('./env');

(async () => {
  const { api: A } = await load({ seed: 11 });
  const step = (n) => { for (let i = 0; i < n; i++) { A.update(1 / 60); flushTimers() } };
  const fail = [], out = {};
  const L = A.CARDS.find((c) => c.n === 'Sun Lance'), by = (n) => A.CARDS.find((c) => c.n === n);
  if (!L || L.r !== 3) { console.log('no Legendary Sun Lance'); process.exit(1) }
  // a duel on Yard with an extra wall or plank between the two fighters
  const shoot = (deck, block, frames = 40, hold = false) => {
    A.startMatch('cpu'); flushTimers(); A.loadMap(0); A.game.state = 'play'; A.game.dropT = 0;
    const [P, E] = A.players; P.cards = deck; E.cards = []; for (const p of A.players) { A.recompute(p); p.ctrl = 'idle' }
    A.resetPlayer(P, [400, 700]); A.resetPlayer(E, [1100, 700]); step(30); A.bullets.length = 0;
    if (block) A.solids.push({ x: 740, y: 300, w: block.w, h: 760, kind: 0, oneway: block.oneway });
    const hp = E.hp; let firstAt = -1, made = 0; const seen = new Set();
    P.aim = Math.atan2(E.y - P.y, E.x - P.x); P.input.aim = P.aim; P.input.fire = true;
    for (let i = 0; i < frames; i++) { if (!hold && i === 3) P.input.fire = false; step(1); P.aim = P.input.aim = Math.atan2(E.y - P.y, E.x - P.x);
      for (const b of A.bullets) if (b.owner === P && !seen.has(b)) { seen.add(b); made++; if (firstAt < 0) firstAt = i + 1 } }
    P.input.fire = false; const hit = hp - E.hp; step(150);
    return { firstAt, made, hit, total: hp - E.hp, ammo: P.s.ammo, proj: P.s.projectiles, burst: P.s.burst, E } };

  const open = shoot([L]);
  out.windupFrames = open.firstAt; out.beams = open.made; out.hit = Math.round(open.hit); out.withBurn = Math.round(open.total);
  if (open.firstAt < 12) fail.push(`the beam left after ${open.firstAt} frames, before the 0.2 s wind-up`);
  if (open.made !== 1) fail.push(`${open.made} beams from one pull`);
  const held = shoot([L], null, 120, true); out.beamsIn2s = held.made;
  if (held.made !== 2) fail.push(`${held.made} beams in two seconds of holding the trigger (one, a reload, one more)`);
  const once = shoot([L], null, 70, true); out.beamsIn1s = once.made;
  if (once.made !== 1) fail.push(`${once.made} beams in the first second: a magazine holds one`);
  if (open.total <= open.hit + 5) fail.push(`no burn after the hit (${open.hit | 0} then ${open.total | 0})`);
  if (open.total >= open.E.s.maxHp) fail.push('a lone Sun Lance hit killed a full-health duelist');
  const plain = shoot([]);
  if (open.hit < plain.hit * 2) fail.push(`hit only ${open.hit | 0} against a plain shot's ${plain.hit | 0}`);
  const wood = shoot([L], { w: 300, oneway: true }), stone = shoot([L], { w: 60, oneway: false });
  out.throughWood = Math.round(wood.hit); out.throughStone = Math.round(stone.hit);
  if (open.hit < 100) fail.push(`one beam did only ${open.hit | 0}`);
  if (wood.hit < open.hit * .9) fail.push(`a wooden plank stopped the beam (${wood.hit | 0})`);
  if (stone.hit > 0) fail.push(`the beam went through stone (${stone.hit | 0})`);
  const mix = shoot([by('Scattergun'), by('Triple Tap'), L, by('Deep Magazine'), by('Splitter') || by('Scattergun')], null, 120, true);
  if (mix.ammo !== 1 || mix.proj !== 1 || mix.burst !== 1 || mix.made !== 2) fail.push(`with fans and bursts: ammo ${mix.ammo}, pellets ${mix.proj}, burst ${mix.burst}, beams ${mix.made}`);
  if (A.shotSound(A.players[0].s) !== 'shotLance') fail.push('no Sun Lance shot sound');

  // rarity: 1 hand in 33 from the third round on, 1 in 16 when behind, never early, never twice, never in survival
  A.startMatch('cpu'); flushTimers(); const P = A.players[0]; P.cards = [];
  const rate = (wins, cards = []) => { let n = 0; for (let i = 0; i < 6000; i++) { A.game.wins = wins.slice(); A.game.legendAt = null; P.cards = cards; P.sinceRare = 0; if (A.dealHand(P).some((c) => c.r === 3)) n++ } return n / 6000 };
  out.early = rate([1, 0]); out.even = +rate([1, 1]).toFixed(3); out.behind = +rate([0, 2]).toFixed(3); out.owned = rate([1, 1], [L]);
  if (out.early) fail.push(`offered before two rounds were played (${out.early})`);
  if (out.even < .02 || out.even > .045) fail.push(`even-score odds ${out.even} (want about 0.03)`);
  if (out.behind < .045 || out.behind > .08) fail.push(`behind odds ${out.behind} (want about 0.06)`);
  if (out.owned) fail.push('offered to a player who already holds one');
  { A.game.wins = [1, 1]; A.game.legendAt = null; let twice = 0; for (let i = 0; i < 3000; i++) { A.game.legendAt = null; const a = A.dealHand(P).some((c) => c.r === 3), b = A.dealHand(A.players[1]).some((c) => c.r === 3); if (a && b) twice++ } if (twice) fail.push(`two Legendaries in one draft ${twice} times`) }

  console.log(JSON.stringify({ ...out, failures: fail }));
  if (fail.length) { for (const f of fail) console.error('  ' + f); process.exit(1) }
})();
