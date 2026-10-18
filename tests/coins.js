// CUUED coins and the cosmetics shop: wins pay out once per match (more for harder wins), losses reset the streak, the shop
// only sells looks, prices are enforced, and a tampered save can't hand out items that don't exist.
//   node tests/coins.js
const { load } = require('./env');

(async () => {
  const { api: A } = await load({ seed: 3 });
  const fail = [], check = (ok, m) => { if (!ok) fail.push(m) };
  const W = A.wallet; Object.assign(W, { coins: 0, earned: 0, wins: 0, streak: 0, best: 0, owned: [], eq: { hat: '', pattern: '', trail: '' } });
  const win = (mode, diff, winner) => { A.startMatch(mode); A.game.diff = diff; A.showEnd(winner) };
  win('cpu', 'normal', 0); check(W.coins === 1 && W.wins === 1 && W.streak === 1, `beating a Normal CPU pays 1 coin (${W.coins})`);
  A.showEnd(0); check(W.coins === 1, 'a match pays out only once, even if the end screen shows again');
  win('cpu', 'hard', 0); check(W.coins === 3 && W.streak === 2 && W.best === 2, `beating a Hard CPU pays 2 coins and extends the streak (${W.coins}, streak ${W.streak})`);
  win('cpu', 'easy', 1); check(W.coins === 3 && W.streak === 0 && W.best === 2, 'losing pays nothing and resets the streak');
  win('sandbox', 'normal', 0); win('demo', 'normal', 0); check(W.coins === 3, 'Sandbox and the title-screen demo never pay out');
  // shop: can't buy what you can't afford; buying spends and equips; equipping owned items is free
  const crown = A.COS.hat.find((i) => i.id === 'crown'), party = A.COS.hat.find((i) => i.id === 'party');
  A.shopClick('crown'); check(!W.owned.includes('hat:crown') && W.coins === 3, 'an item you cannot afford is not bought');
  A.shopClick('party'); check(W.owned.includes('hat:party') && W.eq.hat === 'party' && W.coins === 3 - party.price, `buying spends coins and equips (${W.coins})`);
  const c = W.coins; A.shopClick(''); A.shopClick('party'); check(W.coins === c && W.eq.hat === 'party', 'equipping something you own is free');
  check(crown.price > party.price, 'the crown is a prize');
  // only looks: equipping cosmetics never changes a fighter's stats
  A.startMatch('cpu'); const P = A.players[0]; check(P.cos.hat === 'party', 'your equipped hat goes on your fighter');
  const base = JSON.stringify(P.s); A.recompute(P); check(JSON.stringify(P.s) === base, 'cosmetics never change stats');
  // tampered or unknown values are dropped
  const cc = A.cleanCos({ hat: '<script>', pattern: 'stripes', trail: 'laser', extra: 1 }); check(cc.hat === '' && cc.pattern === 'stripes' && cc.trail === '' && !('extra' in cc), 'unknown cosmetics from a save or an opponent are ignored');
  A.render();   // fighters with a hat draw without errors
  console.log(JSON.stringify({ coins: W.coins, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
