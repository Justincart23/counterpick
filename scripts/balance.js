// Card balance probe (not part of CI): for each card, CPU vs CPU points where one fighter holds that single card and the
// other holds nothing, swapping sides every point. Reports the holder's point win rate.
//   node scripts/balance.js [pointsPerCard=60] [cardNameFilter]
const { load, flushTimers } = require('../tests/env');

const POINTS = +(process.argv[2] || 60);
const FILTER = process.argv[3] || '';
const DT = 1 / 60;

(async () => {
  const { api: A } = await load({ seed: 4242 });
  A.startMatch('demo'); flushTimers();
  const playPoint = (holder, card) => {
    for (const p of A.players) { p.cards = p.id === holder && card ? [card] : []; A.recompute(p) }
    A.game.points = [0, 0]; A.game.wins = [0, 0]; A.newPoint(true); A.game.state = 'ready'; A.game.stT = 0.5;
    for (let f = 0; f < 60 * 120; f++) {
      A.update(DT); flushTimers();
      if (A.game.points[0] + A.game.points[1] > 0 || (A.game.state === 'ready' && f > 60 && A.game.lastWinner === -1)) break;
    }
    const w = A.game.points[0] ? 0 : A.game.points[1] ? 1 : -1;
    return w === -1 ? 0.5 : w === holder ? 1 : 0;
  };
  const rows = [];
  const cards = [null, ...A.CARDS].filter((c) => !FILTER || (c && c.n.toLowerCase().includes(FILTER.toLowerCase())));
  for (const card of cards) {
    let score = 0;
    for (let i = 0; i < POINTS; i++) score += playPoint(i % 2, card);
    const rate = score / POINTS;
    rows.push({ card: card ? card.n : '(no card: baseline)', rarity: card ? ['common', 'uncommon', 'rare'][card.r] : '', type: card ? card.k : '', winRate: Math.round(rate * 100) });
  }
  rows.sort((a, b) => a.winRate - b.winRate);
  console.table(rows);
})();
