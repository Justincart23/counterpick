// Loads the game's script headlessly. Stubs just enough DOM, canvas and timers for the simulation to run,
// and exposes internals through globalThis.__API so tests can drive and inspect the game.
// Several copies can be loaded into one process (each gets its own closure); they share one virtual clock.
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'src', 'counterpick.html');

const EXPOSE = `game, MAPS, CARDS, ART, BOUNDS, newPoint, update, startMatch, spawnBullet, updateBullets,
  drawCardArt, drawIcon, ICONS, sfx, initAudio, aimSolution, bulletG, keys, edges, mouse, settings,
  loadMap, resetPlayer, recompute, clearShot, aimSolutionAt, die, damage, matchProgress, newPoint, chipAt, dealHand, shotSound, BASE, doBlock, render, sandbox, applySandbox, shieldsLen: () => shields.length, wallet, awardMatch, shopClick, cleanCos, COS, showEnd, updateSwings, get swings() { return swings },
  net, hostGame, joinGame, leaveOnline, setName, choose, netChoose, requestRematch, MiniMqtt, RelayConn, RELAY_BROKERS,
  get players() { return players }, get bullets() { return bullets }, get solids() { return solids },
  get hand() { return hand }, get pickFor() { return pickFor }, get pickMode() { return pickMode }, get pickLock() { return pickLock }`;

// A function-shaped proxy that absorbs any property access or call (stands in for canvas contexts, DOM nodes, gradients).
const noop = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === Symbol.iterator ? function* () {} : k === 'then' ? undefined : noop),
  apply: () => noop,
  construct: () => noop,
  set: () => true,
});

function element() {
  const base = {
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, contains() { return false } },
    children: [], hidden: true, value: '', textContent: '',
    getContext: () => noop, appendChild() {}, addEventListener() {}, focus() {}, select() {},
    querySelector: () => element(), querySelectorAll: () => [],
  };
  return new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true } });
}

// One virtual clock and timer queue for every loaded copy, so message latency and game timers stay in step.
const clock = { t: 0, timers: [] };
let timerSeq = 0;
function schedule(f, ms) { const id = ++timerSeq; clock.timers.push({ id, at: clock.t + (ms || 0), f }); return id }
function cancel(id) { clock.timers = clock.timers.filter((x) => x.id !== id) }
function every(f, ms) { const box = { id: 0 }; const tick = () => { box.id = schedule(() => { tick(); f() }, ms) }; tick(); const handle = ++timerSeq; intervals.set(handle, box); return handle }
const intervals = new Map();
function stopEvery(handle) { const box = intervals.get(handle); if (box) { cancel(box.id); intervals.delete(handle) } }
/** Advance virtual time and run every timer that comes due, in order. */
function advance(ms) {
  clock.t += ms;
  for (;;) {
    const due = clock.timers.filter((x) => x.at <= clock.t).sort((a, b) => a.at - b.at);
    if (!due.length) break;
    clock.timers = clock.timers.filter((x) => x.at > clock.t);
    for (const x of due) x.f();
  }
}
/** Run every pending timer immediately, regardless of its delay. */
function flushTimers() { while (clock.timers.length) { const q = clock.timers; clock.timers = []; q.forEach((x) => x.f()) } }

const NATIVE_WEBSOCKET = globalThis.WebSocket;
/** Load the game. Options: seed makes Math.random deterministic; virtualTime makes performance.now follow the shared clock;
 *  realTime keeps Node's real timers and WebSocket (for live network checks); WebSocket supplies a mock socket class. */
async function load({ seed, file = SOURCE, virtualTime = false, realTime = false, WebSocket } = {}) {
  const html = fs.readFileSync(file, 'utf8');
  let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  js = js.replace(/\}\)\(\);\s*$/, `;globalThis.__API={${EXPOSE}};})();`);

  if (seed != null) {
    let s = seed >>> 0;
    Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 };
  }
  if (virtualTime) Object.defineProperty(performance, 'now', { value: () => clock.t, configurable: true, writable: true });

  Object.assign(globalThis, {
    window: globalThis,
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: () => element(), documentElement: {},
      querySelector: () => element(),
    },
    getComputedStyle: () => ({ getPropertyValue: () => '#123456' }),
    addEventListener() {},
    innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    ...(realTime ? {} : { setTimeout: schedule, clearTimeout: cancel, setInterval: every, clearInterval: stopEvery }),
    fetch: () => Promise.reject(new Error('offline in tests')),   // /api/turn unreachable: the game falls back to STUN
    location: { origin: 'https://cuued.com', pathname: '/', search: '', hash: '', hostname: 'cuued.com' },
    history: { replaceState() {} },
  });
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  // no relay sockets in tests unless a mock is supplied (or realTime asks for the real thing)
  Object.defineProperty(globalThis, 'WebSocket', { value: realTime ? NATIVE_WEBSOCKET : WebSocket, configurable: true, writable: true });

  (0, eval)(js);
  await new Promise((r) => setImmediate(r)); // the game boots after a font-loading promise settles
  return { api: globalThis.__API, flushTimers, advance };
}

module.exports = { load, noop, SOURCE, clock, advance, flushTimers, schedule };
