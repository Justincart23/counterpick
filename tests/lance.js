// Sun Lance, the Legendary: a tap winds up briefly and fires a light beam; holding charges it (stronger the longer, up to full,
// then it lets go by itself); one beam a magazine (then a reload); it cuts through wooden planks but not stone, sets the rival on
// fire, and the whole beam burns anyone who walks into it while it still shows, once per beam. Other gun cards can't turn it into
// a fan or a burst, and it is as rare as promised
//   node tests/lance.js
const { load, flushTimers } = require('./env');

(async () => {
  const { api: A } = await load({ seed: 11 });
  const step = (n) => { for (let i = 0; i < n; i++) { A.update(1 / 60); flushTimers() } };
  const fail = [], out = {};
  const L = A.CARDS.find((c) => c.n === 'Sun Lance'), by = (n) => A.CARDS.find((c) => c.n === n);
  if (!L || L.r !== 3) { console.log('no Legendary Sun Lance'); process.exit(1) }
  const duel = (deck, ex = 1100) => {
    A.startMatch('cpu'); flushTimers(); A.loadMap(0); A.game.state = 'play'; A.game.dropT = 0;
    const [P, E] = A.players; P.cards = deck; E.cards = []; for (const p of A.players) { A.recompute(p); p.ctrl = 'idle' }
    A.resetPlayer(P, [400, 700]); A.resetPlayer(E, [ex, 700]); step(30); A.bullets.length = 0; return [P, E] };
  // a duel on Yard with an extra wall or plank between the two fighters; the trigger is let go after `release` frames
  const shoot = (deck, block, frames = 40, release = 3) => {
    const [P, E] = duel(deck);
    if (block) A.solids.push({ x: 740, y: 300, w: block.w, h: 760, kind: 0, oneway: block.oneway });
    const hp = E.hp; let firstAt = -1, made = 0; const seen = new Set();
    P.aim = Math.atan2(E.y - P.y, E.x - P.x); P.input.aim = P.aim; P.input.fire = true;
    for (let i = 0; i < frames; i++) { if (i === release) P.input.fire = false; step(1); P.aim = P.input.aim = Math.atan2(E.y - P.y, E.x - P.x);
      for (const b of A.bullets) if (b.owner === P && !seen.has(b)) { seen.add(b); made++; if (firstAt < 0) firstAt = i + 1 } }
    P.input.fire = false; const hit = hp - E.hp; step(150);
    return { firstAt, made, hit, total: hp - E.hp, ammo: P.s.ammo, proj: P.s.projectiles, burst: P.s.burst, E, P } };

  const tap = shoot([L]);
  out.tapFrames = tap.firstAt; out.beams = tap.made; out.tapHit = Math.round(tap.hit); out.withBurn = Math.round(tap.total);
  if (tap.firstAt < Math.floor(A.LANCE_TAP * 60) || tap.firstAt > Math.ceil(A.LANCE_TAP * 60) + 2) fail.push(`a tap's beam left after ${tap.firstAt} frames (want its short ${A.LANCE_TAP}s wind-up)`);
  if (tap.made !== 1) fail.push(`${tap.made} beams from one tap`);
  if (tap.total <= tap.hit + 2) fail.push(`no burn after the hit (${tap.hit | 0} then ${tap.total | 0})`);
  const half = shoot([L], null, 60, 25), full = shoot([L], null, 80, 50);
  out.halfHit = Math.round(half.hit); out.fullHit = Math.round(full.hit); out.fullFrames = full.firstAt;
  if (full.firstAt < 50) fail.push(`a held charge fired at frame ${full.firstAt}, before the trigger was let go`);
  if (!(tap.hit < half.hit && half.hit < full.hit)) fail.push(`holding longer isn't stronger: tap ${tap.hit | 0}, half ${half.hit | 0}, full ${full.hit | 0}`);
  if (full.hit < tap.hit * 2.2) fail.push(`a full charge (${full.hit | 0}) isn't much stronger than a tap (${tap.hit | 0})`);
  if (full.hit < 100) fail.push(`a full charge did only ${full.hit | 0}`);
  if (full.total >= full.E.s.maxHp) fail.push('a lone full Sun Lance killed a full-health duelist');
  const plain = shoot([]);
  if (full.hit < plain.hit * 2) fail.push(`a full charge hit only ${full.hit | 0} against a plain shot's ${plain.hit | 0}`);
  // held down and never let go: it charges, holds full a moment, then lets go by itself; one beam a magazine
  const auto = A.LANCE_FULL + A.LANCE_KEEP, held = shoot([L], null, Math.ceil(auto * 60) + 30, 1e9); out.autoFrames = held.firstAt;
  if (held.made !== 1 || Math.abs(held.firstAt - auto * 60) > 3) fail.push(`held without letting go: ${held.made} beams, first at frame ${held.firstAt} (want 1 at ~${Math.round(auto * 60)})`);
  // the wind-up shows: a third of the way through a tap, full at a full charge
  { const [P, E] = duel([L]); P.aim = P.input.aim = 0; P.input.fire = true; step(Math.ceil(A.LANCE_FULL * 60) + 2); out.windFull = A.lanceWind(P);
    if (!(out.windFull >= 1)) fail.push(`a full charge shows ${out.windFull} wound up`); P.input.fire = false; step(4); if (A.lanceWind(P) !== -1) fail.push('still winding after the beam left') }
  const wood = shoot([L], { w: 300, oneway: true }), stone = shoot([L], { w: 60, oneway: false });
  out.throughWood = Math.round(wood.hit); out.throughStone = Math.round(stone.hit);
  if (wood.hit < tap.hit * .9) fail.push(`a wooden plank stopped the beam (${wood.hit | 0})`);
  if (stone.hit > 0) fail.push(`the beam went through stone (${stone.hit | 0})`);
  const mix = shoot([by('Scattergun'), by('Triple Tap'), L, by('Deep Magazine'), by('Splitter') || by('Scattergun')], null, 40);
  if (mix.ammo !== 1 || mix.proj !== 1 || mix.burst !== 1 || mix.made !== 1) fail.push(`with fans and bursts: ammo ${mix.ammo}, pellets ${mix.proj}, burst ${mix.burst}, beams ${mix.made}`);
  if (A.shotSound(A.players[0].s) !== 'shotLance') fail.push('no Sun Lance shot sound');

  // the whole beam burns: a rival who steps into it after it has landed is hit (once), until it fades; the shooter never is
  // (fired away from the rival, into the far wall, then the rival is put on the middle of the beam's path)
  const walkIn = (wait) => { const [P, E] = duel([L], 150); P.aim = P.input.aim = 0; P.input.fire = true; step(2); P.input.fire = false;
    let landed = -1; for (let i = 0; i < 40 && landed < 0; i++) { step(1); if (A.beams.length && A.beams[0].b.dead) landed = i }
    const sg = A.beams.length ? A.beams[0].b.hz.segs[0] : [0, 0, 0, 0], mx = (sg[0] + sg[2]) / 2, my = (sg[1] + sg[3]) / 2;
    const hp0 = E.hp, P0 = P.hp; step(wait); E.x = mx; E.y = my; E.vx = E.vy = 0; E.dots = []; step(1); const once = hp0 - E.hp; E.dots = []; step(6); E.x = mx + 20; E.y = my; E.vx = E.vy = 0; step(1);
    return { landed, hit: once, again: hp0 - E.hp - once, self: P0 - P.hp } };
  const soon = walkIn(6), late = walkIn(Math.ceil(A.LANCE_LIVE * 60) + 8);
  out.walkInHit = Math.round(soon.hit); out.walkInLate = Math.round(late.hit);
  if (soon.landed < 0) fail.push('the test beam never landed');
  if (soon.hit < 20) fail.push(`a rival who walked into a still-blazing beam took only ${soon.hit | 0}`);
  if (soon.again > soon.hit * .5) fail.push(`one beam hit the same rival twice (${soon.hit | 0} then ${soon.again | 0} more)`);
  if (late.hit > 1) fail.push(`a beam that had faded still hurt (${late.hit | 0})`);
  if (soon.self > 0) fail.push(`the shooter was burnt by their own beam (${soon.self | 0})`);
  // crossing the beam while it is still in flight counts too
  { const [P, E] = duel([L], 1500); P.aim = P.input.aim = 0; P.input.fire = true; step(2); P.input.fire = false; const hp0 = E.hp;
    let crossed = false; for (let i = 0; i < 20; i++) { step(1); const b = A.bullets.find((q) => q.lance); if (b && !crossed && b.x > 800) { E.x = 650; E.y = P.y; E.vx = E.vy = 0; crossed = true } }
    out.crossHit = Math.round(hp0 - E.hp); if (!crossed || hp0 - E.hp < 20) fail.push(`a rival who stepped behind the beam's head, into its trail, took ${hp0 - E.hp | 0}`) }

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
