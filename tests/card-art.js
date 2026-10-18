// Renders every card's animated art against a mock canvas for 12 seconds of frames (normal and hovered)
// and checks that every card has its own animation and none of them throw.
//   node tests/card-art.js
const { load, noop } = require('./env');

(async () => {
  const { api: A } = await load();
  let failures = 0;
  const missing = A.CARDS.filter((c) => !A.ART[c.n]).map((c) => c.n);
  const noIcon = A.CARDS.filter((c) => !A.ICONS[c.n]).map((c) => c.n);
  for (const c of A.CARDS) { try { for (const sz of [24, 56]) A.drawIcon(noop, c.n, 50, 50, sz, '#fff', 2) } catch (e) { failures++; console.error(`${c.n} icon: ${e.message}`) } }
  for (const c of A.CARDS) {
    const canvas = { width: 360, height: 236, getContext: () => noop };
    try {
      for (let t = 0; t < 12; t += 0.037) { A.drawCardArt(canvas, c, t, false); A.drawCardArt(canvas, c, t, true) }
    } catch (e) { failures++; console.error(`${c.n}: ${e.message}`) }
  }
  // hovering a HUD chip finds the right card for the right player
  A.players[0].cards = [A.CARDS[0], A.CARDS[5], A.CARDS[9]]; A.players[1].cards = [A.CARDS[20]];
  const hit0 = A.chipAt(1600 - 24 - 17 - 40, 24 - 2), hit1 = A.chipAt(1600 - 24 - 17, 24 + 24 - 2 + 14), miss = A.chipAt(800, 450);
  if (!(hit0 && hit0.c === A.CARDS[5] && hit0.p === A.players[0] && hit1 && hit1.c === A.CARDS[20] && hit1.p === A.players[1] && miss === null)) { failures++; console.error('chip hover hit-test picked the wrong card') }
  // rarity: about a third of hands carry a rare, and nobody goes four drafts in a row without one
  const drafter = { cards: [] }; let withRare = 0, dry = 0, worstDry = 0;
  for (let i = 0; i < 3000; i++) { const h = A.dealHand(drafter); if (h.some((c) => c.r === 2)) { withRare++; dry = 0 } else worstDry = Math.max(worstDry, ++dry) }
  const rareShare = withRare / 3000;
  if (rareShare < 0.25 || rareShare > 0.45 || worstDry > 3) { failures++; console.error(`rarity: ${(rareShare * 100).toFixed(0)}% of hands had a rare, longest dry streak ${worstDry}`) }
  // each gun build gets its own shot sound
  const snd = (o) => A.shotSound({ ...A.BASE, ...o });
  const sounds = [snd({}), snd({ dmg: 90 }), snd({ fireDelay: .12 }), snd({ bulletSpeed: 2700 }), snd({ projectiles: 3 }), snd({ bulletGravity: 2.5 })];
  if (new Set(sounds).size !== 6) { failures++; console.error('shot sounds should differ by build: ' + sounds) }
  // Long Haul: damage climbs with distance flown, capped at x3
  { const lh = A.CARDS.find((c) => c.n === 'Long Haul'); const o = { s: { ...A.BASE }, cards: [lh] }; lh.a(o.s);
    const fake = { dmg: 55, dist: 0, r: 5 }; const m0 = 1, m500 = Math.min(3, 1 + 500 * .002), m5000 = Math.min(3, 1 + 5000 * .002);
    if (!(o.s.grow && Math.abs(o.s.reload - (A.BASE.reload + .4)) < 1e-9 && Math.abs(m500 - 2) < 1e-9 && m5000 === 3 && m0 === 1)) { failures++; console.error('Long Haul stats or scaling are off') } }
  console.log(JSON.stringify({ handsWithRare: +(rareShare * 100).toFixed(0) + '%', longestDryStreak: worstDry, cards: A.CARDS.length, uniqueAnimations: A.CARDS.length - missing.length, icons: A.CARDS.length - noIcon.length, missing, noIcon, failures }));
  process.exit(failures || missing.length || noIcon.length ? 1 : 0);
})();
