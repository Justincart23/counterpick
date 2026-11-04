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
  // a save from the game site's account: it wins, but what this device owns and its records are kept; junk is cleaned
  Object.assign(W, { coins: 5, earned: 9, wins: 4, streak: 1, best: 3, owned: ['hat:party'], eq: { hat: 'party', pattern: '', trail: '' }, survBest: 12, survBy: { Duelist: 12 } });
  A.loadWallet({ coins: 40, earned: 50, wins: 2, streak: 0, best: 1, owned: ['hat:crown', 'hat:nope', 'trail:gold'], eq: { hat: 'crown', pattern: '', trail: 'laser' }, survBest: 7, survBy: { Tank: 7, '<b>': 99 } });
  check(W.coins === 40 && W.eq.hat === 'crown' && W.eq.trail === '', `the account's coins and look win (${W.coins}, ${W.eq.hat})`);
  check(['hat:crown', 'trail:gold', 'hat:party'].every((x) => W.owned.includes(x)) && !W.owned.includes('hat:nope'), `items from both are kept, unknown ones dropped (${W.owned})`);
  check(W.earned === 50 && W.wins === 4 && W.best === 3 && W.survBest === 12 && W.survBy.Duelist === 12 && W.survBy.Tank === 7 && !('<b>' in W.survBy), 'the best of each record is kept');
  A.loadWallet('junk'); A.loadWallet(null); A.loadWallet([1]); check(W.coins === 40, 'a broken save is ignored');
  // Flick Plus: off Flick nothing changes; with Plus, every look (but the secret) can be worn, Plus looks can be worn (and show), house rules start; without it, they don't
  Object.assign(W, { coins: 0, earned: 0, plusCoins: 0, owned: [], eq: { hat: '', pattern: '', trail: 'flick' } });
  check(A.myCos().trail === '' && !A.owns('trail', 'flick'), 'a Plus look is not worn without Plus');
  check(A.earn(2) === 2 && W.coins === 2, 'coins are normal without Plus');
  A.setPlus(true); check(A.portal.flick && A.myCos().trail === 'flick' && A.owns('trail', 'flick'), 'with Plus the Plus look is worn and shows');
  check(A.earn(2) === 2 && W.coins === 4, `Plus does not change coins (${W.coins})`);
  check(A.owns('hat', 'crown') && !W.owned.includes('hat:crown'), 'Plus unlocks every look without owning it');
  check(!A.owns('hat', A.COS.hat.find((i) => i.secret).id), 'Plus does not unlock the secret hat');
  check(A.myCos().m === 1 && A.cleanCos({ m: 1 }).m === 1 && A.cleanCos({ m: 2 }).m === undefined, 'a member carries the Plus name-tag mark');
  W.eq.hat = 'crown';
  A.fixWallet(); check(W.eq.trail === 'flick' && !W.owned.includes('trail:flick'), 'a Plus look stays chosen but is never owned');
  A.settings.bsTwist = 'low'; A.startMatch('cpu'); A.game.screen = true;
  A.setPlus(false); check(A.settings.bsTwist === false && A.myCos().trail === '' && A.myCos().hat === '' && !A.myCos().m, 'losing Plus turns off house rules, unbought looks and the member mark');
  W.owned = ['trail:flick', 'hat:party']; A.fixWallet(); check(!W.owned.includes('trail:flick') && W.owned.includes('hat:party'), 'a Plus look can never end up owned');
  console.log(JSON.stringify({ coins: W.coins, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
