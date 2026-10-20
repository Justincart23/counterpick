// Survival: a CPU stand-in plays whole runs: picks a starter card, fights round after round, buys what it can in the
// shop between rounds, until its 3 lives are gone. Checks: the shop opens after every cleared round and scrap is paid
// and spent; enemies get tougher; a boss comes on round 5 and every boss special shows its full warning first; capsules
// drop in Survival and never in a normal CPU match; the run ends with the best round saved. Reports how far runs get.
//   node tests/survival.js [runs=6]
const { load, flushTimers } = require('./env');
const RUNS = +(process.argv[2] || 6);
(async () => {
  const { api: A } = await load({ seed: 41 });
  const fail = [], check = (ok, m) => { if (!ok) fail.push(m) };
  const reached = []; let shops = 0, spent = 0, bossRounds = 0, specials = 0, shortTells = 0, sawDrop = false, errors = 0, hpGrows = true;
  for (let r = 0; r < RUNS; r++) {
    A.startSurvival(); flushTimers(); A.players[0].ctrl = 'cpu'; A.players[0].skill = 'hard';   // a decent player
    let lastK = -1, round = 0;
    for (let f = 0; f < 60 * 60 * 25 && A.game.state !== 'over'; f++) {
      if (A.game.state === 'pick' && A.pickFor && !A.pickLock) A.choose(A.hand[0], null);
      if (A.game.state === 'shop') { shops++; const s0 = A.game.scrap; for (let i = 0; i < 4; i++) A.survBuy(i); spent += s0 - A.game.scrap; A.survNext(); }
      try { A.update(1 / 60) } catch (e) { if (errors++ < 2) console.error(e) }
      flushTimers();
      if (A.game.round !== round) { round = A.game.round; const e = A.players[1];
        if (!e.boss) { const k = e.cards.length + e.hpMul * 10; if (k < lastK) hpGrows = false; lastK = k } else bossRounds++;
        if (round === 5) check(!!e.boss, 'round 5 should be a boss'); }
      if (A.drops.length) sawDrop = true;
      const b = A.players[1]; if (b.boss && b.bs) { b.bs._seen = true }
      if (b.boss && b.bs && b.bs.n && !b.bs._counted && A.game.state === 'over') {}
    }
    const b = A.players[1]; if (b.bs && b.bs.n) { specials += b.bs.n; if (b.bs.minTell < (b.boss && b.boss.special === 'snipe' ? 0.84 : 0.74)) shortTells++ }
    check(A.game.state === 'over', `run ${r + 1} should end`); reached.push(A.game.cleared || 0);
  }
  check(shops >= reached.reduce((a, b) => a + b, 0) - RUNS && shops > 0, `the shop should open after each cleared round (${shops} shops)`);
  check(spent > 0, 'scrap should be spent in the shop');
  check(hpGrows, 'ordinary enemies should get tougher each round');
  check(sawDrop, 'power-up capsules should drop in Survival');
  check(!shortTells, `every boss special should show its full warning (${shortTells} runs did not)`);
  check(!errors, `no errors (${errors})`);
  check(A.wallet.survBest === Math.max(...reached), `the best round should be saved (${A.wallet.survBest} vs ${Math.max(...reached)})`);
  // normal CPU matches stay pure: nothing drops
  { A.startMatch('cpu'); flushTimers(); while (A.game.state === 'pick') { A.choose(A.hand[0], null); flushTimers() } A.game.state = 'play';
    let any = false; for (let i = 0; i < 60 * 40; i++) { A.update(1 / 60); flushTimers(); if (A.drops.length) any = true } check(!any, 'nothing should drop in a normal CPU match') }
  reached.sort((a, b) => a - b);
  console.log(JSON.stringify({ runs: RUNS, roundsReached: reached, median: reached[reached.length >> 1], bossRounds, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
