// Card stacking: any number of copies of any card, and big random mixes, must still fire visible bullets that fly and
// can hurt, with no NaN and no crash, and stay inside the screen budget (bullet size and pellets per second). (Sandbox lets you stack up to 9 copies; drafts can stack too.)
//   node tests/stacking.js
const { load, flushTimers } = require('./env');

(async () => {
  const { api: A } = await load({ seed: 5 });
  const step = (n) => { for (let i = 0; i < n; i++) { A.update(1 / 60); flushTimers() } };
  const fail = [];
  // fire for 1.5 s from the floor of Yard at a rival 500 px away; report bullets made, furthest flight, damage dealt
  const fire = (deck, aim = -0.35) => {
    A.startMatch('cpu'); flushTimers(); A.loadMap(0); A.game.state = 'play'; A.game.dropT = 0;
    const [P, E] = A.players; P.cards = deck; E.cards = []; for (const p of A.players) { A.recompute(p); p.ctrl = 'idle' }
    A.resetPlayer(P, [400, 700]); A.resetPlayer(E, [900, 700]); step(30); A.bullets.length = 0;
    const hp = E.hp, seen = new Map(); let far = 0, nan = false;
    P.aim = aim; P.input.aim = aim; P.input.fire = true;
    for (let i = 0; i < 90; i++) { step(1);
      for (const b of A.bullets) { if (b.owner !== P) continue; if (!seen.has(b)) seen.set(b, [b.x, b.y]); const o = seen.get(b); far = Math.max(far, Math.hypot(b.x - o[0], b.y - o[1])); if (!Number.isFinite(b.x + b.y)) nan = true }
      if (!Number.isFinite(P.x + P.y + E.hp + P.hp)) nan = true }
    P.input.fire = false; return { made: seen.size, far, dmg: hp - E.hp, nan, r: P.s.bulletSize * 5, rate: P.s.projectiles * P.s.burst / P.s.fireDelay } };
  // the screen budget: no stack makes bullets huge or fills the air (and the network) with shots
  const budget = (o, what) => { if (o.r > 13.5 || o.rate > 24.5) fail.push(`${what}: bullets ${o.r.toFixed(1)} px, ${o.rate.toFixed(1)} pellets/s (limits 13 px, 24/s)`) };
  let runs = 0;
  for (const c of A.CARDS) for (const k of c.u ? [1] : [1, 3, 6, 9]) { runs++;
    const o = fire(Array(k).fill(c)); budget(o, `${c.n} x${k}`);
    if (!o.made || o.nan || (o.far < 60 && o.dmg <= 0)) fail.push(`${c.n} x${k}: ${o.made} bullets, flew ${o.far | 0}px, dealt ${o.dmg | 0}${o.nan ? ', NaN' : ''}`) }
  // random mixed decks of 4 to 16 cards
  let rs = 99; const rnd = () => (rs = (rs * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 300; t++) { runs++;
    const deck = [], n = 4 + Math.floor(rnd() * 13); while (deck.length < n) { const c = A.CARDS[Math.floor(rnd() * A.CARDS.length)]; if (c.u && deck.includes(c)) continue; deck.push(c) }
    const o = fire(deck); budget(o, 'a mixed deck');
    if (!o.made || o.nan || (o.far < 60 && o.dmg <= 0)) fail.push(`mix [${deck.map((c) => c.n).join(', ')}]: ${o.made} bullets, flew ${o.far | 0}px, dealt ${o.dmg | 0}${o.nan ? ', NaN' : ''}`) }
  console.log(JSON.stringify({ decks: runs, failures: fail.length }));
  if (fail.length) console.error(fail.slice(0, 12).map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
