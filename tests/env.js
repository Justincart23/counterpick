// Loads the game's script headlessly. Stubs just enough DOM, canvas and timers for the simulation to run,
// and exposes internals through globalThis.__API so tests can drive and inspect the game.
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'src', 'counterpick.html');

const EXPOSE = `game, MAPS, CARDS, ART, BOUNDS, newPoint, update, startMatch, spawnBullet, updateBullets,
  drawCardArt, sfx, initAudio,
  get players() { return players }, get bullets() { return bullets }, get solids() { return solids }`;

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
    children: [], hidden: true,
    getContext: () => noop, appendChild() {}, addEventListener() {}, focus() {},
    querySelector: () => element(), querySelectorAll: () => [],
  };
  return new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true } });
}

/** Load the game. Options: seed (number) makes Math.random deterministic; file overrides the source path. */
async function load({ seed, file = SOURCE } = {}) {
  const html = fs.readFileSync(file, 'utf8');
  let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  js = js.replace(/\}\)\(\);\s*$/, `;globalThis.__API={${EXPOSE}};})();`);

  if (seed != null) {
    let s = seed >>> 0;
    Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 };
  }

  const timers = [];
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
    setTimeout: (f) => { timers.push(f); return 0 },
  });
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });

  (0, eval)(js);
  await new Promise((r) => setImmediate(r)); // the game boots after a font-loading promise settles
  return { api: globalThis.__API, flushTimers() { while (timers.length) timers.shift()() } };
}

module.exports = { load, noop, SOURCE };
