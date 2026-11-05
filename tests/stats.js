// Stats and rivalries (free): every finished match counts in its mode; online and Big Screen matches also count against each
// human rival (known by their player id), and the end screen says where the rivalry stands. Saves merge without losing games.
//   node tests/stats.js
const { load } = require('./env');

(async () => {
  const { api: A } = await load({ seed: 5 });
  const fail = [], check = (ok, m) => { if (!ok) fail.push(m) };
  const W = A.wallet;
  check(/^[a-z0-9]{8,16}$/.test(W.pid), `every player gets an id (${W.pid})`);
  const me = W.pid, maya = 'maya00000001', theo = 'theo00000001';

  // CPU modes count by mode, never as a rival
  A.startMatch('cpu'); A.showEnd(0); check(W.md.cpu[0] === 1 && !Object.keys(W.vs).length, 'a CPU win counts in Practice, with no rival');
  A.startMatch('cpu'); A.showEnd(1); check(W.md.cpu[1] === 1, 'a CPU loss counts too');

  // 1v1 online as the guest: the host's end message names who played
  const duel = (w) => { A.startMatch('online-guest'); A.net.me = 1; A.game.endIds = A.cleanIds([[0, maya, 'Maya'], [1, me, 'Me']]); A.showEnd(w) };
  duel(1); check(W.vs[maya] && W.vs[maya].w === 1 && W.vs[maya].l === 0 && W.md.online[0] === 1, 'an online win counts against the rival');
  const line1 = A.rivalLine(W.vs[maya]);
  check(/first match against Maya, and you took it/.test(line1), `first meeting line (${line1})`);
  duel(0); duel(0); const r = W.vs[maya];
  check(r.w === 1 && r.l === 2 && r.s === -2, `losses count and the streak flips (${JSON.stringify(r)})`);
  const line2 = A.rivalLine(W.vs[maya]);
  check(/Maya leads you 2–1: one more win to tie/.test(line2), `trailing by one says so (${line2})`);
  duel(1); duel(1); duel(1); duel(1);
  check(/4 wins in a row against Maya/.test(A.rivalLine(W.vs[maya])), `a run of wins is called out (${A.rivalLine(W.vs[maya])})`);

  // teams/FFA: a win counts against every opponent; a loss only against the winners; teammates never
  const ids = [[0, me, 'Me'], [0, 'mate00000001', 'Mate'], [1, theo, 'Theo'], [1, 'cpu', 'CPU']].filter((x) => x[1] !== 'cpu');
  check(A.rivalsIn(ids, 0, 0, true).map((x) => x.id).join() === theo, 'a team win counts against the other team only');
  const ffa = [[0, me, 'Me'], [1, theo, 'Theo'], [2, maya, 'Maya']];
  check(A.rivalsIn(ffa, 0, 2, false).map((x) => x.id).join() === maya, 'a free-for-all loss counts only against the winner');
  check(A.rivalsIn(ffa, 0, 0, true).length === 2, 'a free-for-all win counts against everyone');
  check(A.cleanIds([[0, '<script>', 'x'], [1, theo, '<b>Theo</b>'], 'junk']).length === 1 && A.cleanIds([[1, theo, '<b>Theo</b>']])[0][2] === 'bTheo/b', 'ids from the network are cleaned');

  // a phone on a Big Screen
  A.ctl.awarded = false; A.ctl.team = 1; A.ctl.solo = false; A.ctl.sides = [{ n: 'Theo' }, { n: 'Me' }];
  A.padOver(1, A.cleanIds([[0, theo, 'Theo'], [1, me, 'Me']]));
  check(W.vs[theo] && W.vs[theo].w === 1 && W.md.screen[0] === 1, 'a Big Screen win on your phone counts against the rival');

  // the account's save merges: games from either side are kept, the newest name wins, a bad save can't break it
  const before = JSON.parse(JSON.stringify(W));
  A.loadWallet({ pid: 'acct00000001', md: { online: [2, 9] }, vs: { [maya]: { n: 'Maya B', w: 1, l: 9, t: Date.now() + 1000, s: -1 }, nope: { w: 5 } }, coins: before.coins });
  check(W.pid === 'acct00000001', 'the account id wins, so friends see the same player on every device');
  check(W.md.online[0] === before.md.online[0] && W.md.online[1] === 9, `mode records keep the most from either side (${W.md.online})`);
  check(W.vs[maya].w === before.vs[maya].w && W.vs[maya].l === 9 && W.vs[maya].n === 'Maya B', 'rival records merge, newest name wins');
  check(!('nope' in W.vs) && W.vs[theo], 'junk rivals are dropped, others kept');
  A.loadWallet({ md: 'x', vs: [1, 2], pid: 12 }); check(W.pid === 'acct00000001' && Array.isArray(W.md.cpu) && W.vs[maya], 'a broken save changes nothing');
  // a rival can never be yourself
  A.recordMatch('online', true, [{ id: W.pid, n: 'Me' }]); check(!W.vs[W.pid], 'you are never your own rival');
  // the save stays small
  for (let i = 0; i < 60; i++) A.recordMatch('online', true, [{ id: 'zz' + String(i).padStart(10, '0'), n: 'P' + i }]);
  check(Object.keys(W.vs).length === 40, `only the 40 most recent rivals are kept (${Object.keys(W.vs).length})`);
  check(JSON.stringify(W).length < 8000, `the save stays small (${JSON.stringify(W).length} bytes)`);

  // the Stats screen renders
  try { A.openStats(); A.closeStats() } catch (e) { check(false, 'the Stats screen opens and closes: ' + e.message) }

  if (fail.filter(Boolean).length) { console.log('FAIL stats:\n  ' + fail.filter(Boolean).join('\n  ')); process.exit(1) }
  console.log('ok stats');
})();
