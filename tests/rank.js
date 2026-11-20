// Rank: a rating you climb, a grade for every match, titles to brag about. Wins against the CPU raise your rating (more on
// Hard), losses lower it, a clean 5-0 with good aim grades S, enough wins earn new titles, and the end screen shows it all
//   node tests/rank.js
const { load, flushTimers } = require('./env');
(async () => {
  const { api: A } = await load({ seed: 11 }), fail = [], check = (ok, m) => { if (!ok) fail.push(m) };
  const play = (won, diff, myW, oppW, shots, hits, took) => {
    A.game.diff = diff; A.startMatch('cpu'); flushTimers(); A.game.diff = diff;
    A.game.wins = won ? [myW, oppW] : [oppW, myW].reverse(); if (!won) A.game.wins = [myW, oppW];
    A.game.shotsBy = [shots, 10, 0, 0]; A.game.hitsBy = [hits, took, 0, 0]; A.game.awarded = false;
    A.awardMatch(won ? 0 : 1); return A.rk();
  };
  const r0 = A.rk().r; check(r0 === 1000, `a new player starts at 1000 (${r0})`);
  check(A.matchGrade(true, 0, 1).L, 'a grade is given');
  let k = play(true, 'hard', 5, 0, 20, 14, 0); const afterWin = k.r;
  check(afterWin > r0 + 20, `beating Hard 5-0 should raise the rating a lot (${r0} -> ${afterWin})`);
  check(k.g.S === 1, `a clean 5-0 with 70% aim should grade S (${JSON.stringify(k.g)})`);
  k = play(false, 'easy', 1, 5, 20, 2, 9);
  check(k.r < afterWin, `losing to Easy should cost rating (${afterWin} -> ${k.r})`);
  check(k.g.D + k.g.C >= 1, 'a heavy loss with poor aim grades C or D');
  const before = k.r; k = play(true, 'easy', 5, 4, 20, 8, 6); const easyGain = k.r - before;
  const b2 = k.r; k = play(true, 'hard', 5, 4, 20, 8, 6); const hardGain = k.r - b2;
  check(hardGain > easyGain, `a win over Hard should count more than over Easy (${hardGain} vs ${easyGain})`);
  let t0 = A.rankIx(A.rk().r); for (let i = 0; i < 40; i++) play(true, 'hard', 5, 1, 20, 12, 2);
  check(A.rankIx(A.rk().r) > t0 + 2, `forty strong wins should climb several titles (${A.RANKS[t0][1]} -> ${A.RANKS[A.rankIx(A.rk().r)][1]})`);
  check(A.rk().peak >= A.rk().r, 'the peak is kept');
  const el = A.document && A.document.querySelector ? A.document.querySelector('#endRank') : null;
  console.log(JSON.stringify({ rating: A.rk().r, title: A.RANKS[A.rankIx(A.rk().r)][1], grades: A.rk().g, easyGain, hardGain, failures: fail.length }));
  fail.forEach((f) => console.log('  - ' + f)); process.exit(fail.length ? 1 : 0);
})();
