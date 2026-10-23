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
  // Customize is the shop too: a tap on something you don't own tries it on (nothing is spent); the big button buys it
  A.lockK = 'hat'; A.lockPick('crown'); check(W.coins === 3 && W.eq.hat !== 'crown', 'tapping an item only tries it on');
  A.lockGo(); check(!W.owned.includes('hat:crown') && W.coins === 3, 'an item you cannot afford is not bought');
  A.lockPick('party'); A.lockGo(); check(W.owned.includes('hat:party') && W.eq.hat === 'party' && W.coins === 3 - party.price, `buying spends coins and equips (${W.coins})`);
  A.lockPick(''); check(W.eq.hat === '', 'tapping None takes the hat off'); const c = W.coins; A.lockPick('party'); check(W.coins === c && W.eq.hat === 'party', 'tapping something you own wears it, free');
  // the secret hat: no price buys it, only its code does
  A.lockPick('darkhelm'); A.lockGo(); check(!W.owned.includes('hat:darkhelm'), 'the secret hat cannot be bought');
  check(!A.lockUnlock('1234') && !W.owned.includes('hat:darkhelm'), 'a wrong code unlocks nothing');
  check(A.lockUnlock('6767') && W.owned.includes('hat:darkhelm') && W.eq.hat === 'darkhelm', 'the right code unlocks and wears the secret hat');
  // your shades: kept inside their colour family (they also arrive from other players online), and worn in a match
  check(JSON.stringify(A.cleanCos({ co: [99, 10], cb: [0, 99] })) === JSON.stringify({ hat: '', pattern: '', trail: '', co: [40, 44], cb: [195, 68] }), 'a shade is kept inside its colour family');
  check(!('co' in A.cleanCos({ co: 'red' })), 'a broken shade is dropped');
  check(crown.price > party.price, 'the crown is a prize');
  // only looks: equipping cosmetics never changes a fighter's stats
  A.startMatch('cpu'); const P = A.players[0]; check(P.cos.hat === W.eq.hat && W.eq.hat === 'darkhelm', 'your equipped hat goes on your fighter');
  const base = JSON.stringify(P.s); A.recompute(P); check(JSON.stringify(P.s) === base, 'cosmetics never change stats');
  // tampered or unknown values are dropped
  const cc = A.cleanCos({ hat: '<script>', pattern: 'stripes', trail: 'laser', extra: 1 }); check(cc.hat === '' && cc.pattern === 'stripes' && cc.trail === '' && !('extra' in cc), 'unknown cosmetics from a save or an opponent are ignored');
  A.render();   // fighters with a hat draw without errors
  console.log(JSON.stringify({ coins: W.coins, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
