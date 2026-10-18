// Match pacing (not part of CI): CPU-vs-CPU full matches with drafting, reporting how long points last, how close matches
// end, how often the trailing fighter comes back, and how often a point drags into overtime.
//   node scripts/pacing.js [matches=40]
const { load, flushTimers } = require('../tests/env');
(async () => {
  const N = +(process.argv[2] || 40); const { api: A } = await load({ seed: 77 });
  const pts = [], finals = []; let comebacks = 0, overtime = 0, points = 0, edgeKills = 0;
  for (let m = 0; m < N; m++) {
    A.settings.len = 5; A.startMatch('watch'); let t = 0, ptStart = 0, last = A.game.state, behind = [0, 0];
    while (A.game.state !== 'over' && t < 60 * 60 * 15) { A.update(1 / 60); flushTimers(); t++;
      const st = A.game.state;
      if (st === 'play' && last !== 'play') ptStart = t;
      if (st === 'pointEnd' && last !== 'pointEnd') { points++; pts.push((t - ptStart) / 60); if (A.game.overtime) overtime++;
        const w = A.game.wins; if (w[0] - w[1] >= 2) behind[1] = 1; if (w[1] - w[0] >= 2) behind[0] = 1 }
      last = st }
    const w = A.game.wins; finals.push(w.slice()); const winner = w[0] > w[1] ? 0 : 1; if (behind[winner]) comebacks++ }
  pts.sort((a, b) => a - b); const q = (k) => pts[Math.floor(pts.length * k)].toFixed(1);
  const margins = finals.map((w) => Math.abs(w[0] - w[1])); const close = margins.filter((d) => d <= 2).length;
  console.log(JSON.stringify({ matches: N, points, pointSecondsMedian: +q(.5), pointSecondsP90: +q(.9), overtimePct: +(100 * overtime / points).toFixed(1),
    closeMatchesPct: Math.round(100 * close / N), shutoutsPct: Math.round(100 * margins.filter((d) => d === 5).length / N), comebackPct: Math.round(100 * comebacks / N),
    roundsPerMatch: +(finals.reduce((a, w) => a + w[0] + w[1], 0) / N).toFixed(1) }));
})();
