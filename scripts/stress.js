// Stress test (not part of CI): CPU vs CPU where both fighters carry big random card stacks, re-dealt every point.
// Looks for crashes, NaN positions, runaway bullet or particle counts, stalls, and slow simulation frames.
//   node scripts/stress.js [gameSeconds=600] [cardsEach=8] [seed=1]
const { load, flushTimers } = require('../tests/env');

const SECS = +(process.argv[2] || 600), CARDS_EACH = +(process.argv[3] || 8), SEED = +(process.argv[4] || 1);
(async () => {
  const { api: A } = await load({ seed: SEED });
  A.startMatch('demo'); flushTimers();
  const deal = () => { for (const p of A.players) { p.cards = Array.from({ length: CARDS_EACH }, () => A.CARDS[Math.floor(Math.random() * A.CARDS.length)]); A.recompute(p) } };
  deal();
  const st = { seconds: SECS, cardsEach: CARDS_EACH, points: 0, errors: 0, nan: 0, maxBullets: 0, stalls: 0, slowFrames: 0, worstFrameMs: 0, meanFrameMs: 0 };
  let t = 0, last = '', pointStart = 0, n = 0, total = 0; const combos = [];
  while (t < SECS) {
    const t0 = performance.now();
    try { A.update(1 / 60) } catch (e) { if (st.errors++ < 3) console.error(e.stack.split('\n').slice(0, 3).join('\n'), '\ncards:', A.players.map((p) => p.cards.map((c) => c.n).join('+'))) }
    flushTimers();
    const ms = performance.now() - t0; total += ms; n++; st.worstFrameMs = Math.max(st.worstFrameMs, ms); if (ms > 8) st.slowFrames++;
    t += 1 / 60;
    st.maxBullets = Math.max(st.maxBullets, A.bullets.length);
    for (const p of A.players) if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.hp)) { st.nan++; if (st.nan < 3) console.error('NaN fighter', p.cards.map((c) => c.n)) }
    const score = `${A.game.wins}|${A.game.points}`;
    if (score !== last) { last = score; st.points++; pointStart = t; deal() }
    if (A.game.state !== 'play') pointStart = t;
    if (t - pointStart > 90) { st.stalls++; combos.push(A.players.map((p) => p.cards.map((c) => c.n).join('+'))); pointStart = t }
  }
  st.meanFrameMs = +(total / n).toFixed(3); st.worstFrameMs = +st.worstFrameMs.toFixed(1);
  console.log(JSON.stringify(st)); if (combos.length) console.log('stalled with', combos.slice(0, 3));
  process.exit(st.errors || st.nan ? 1 : 0);
})();
