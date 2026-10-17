// Renders every card's animated art against a mock canvas for 12 seconds of frames (normal and hovered)
// and checks that every card has its own animation and none of them throw.
//   node tests/card-art.js
const { load, noop } = require('./env');

(async () => {
  const { api: A } = await load();
  let failures = 0;
  const missing = A.CARDS.filter((c) => !A.ART[c.n]).map((c) => c.n);
  for (const c of A.CARDS) {
    const canvas = { width: 360, height: 236, getContext: () => noop };
    try {
      for (let t = 0; t < 12; t += 0.037) { A.drawCardArt(canvas, c, t, false); A.drawCardArt(canvas, c, t, true) }
    } catch (e) { failures++; console.error(`${c.n}: ${e.message}`) }
  }
  console.log(JSON.stringify({ cards: A.CARDS.length, uniqueAnimations: A.CARDS.length - missing.length, missing, failures }));
  process.exit(failures || missing.length ? 1 : 0);
})();
