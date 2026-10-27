// Plays every sound effect into a mock Web Audio graph and checks each one schedules sound
// with valid parameters (exponential ramps to positive values, finite frequencies and gains).
//   node tests/audio.js
const fs = require('fs');
const { load, SOURCE, advance } = require('./env');

const problems = [];
let started = 0;
class Param {
  setValueAtTime(v) { if (!Number.isFinite(v)) problems.push(`setValueAtTime(${v})`); return this }
  exponentialRampToValueAtTime(v, t) { if (!(v > 0) || !Number.isFinite(t)) problems.push(`exponentialRamp(${v}, ${t})`); return this }
  linearRampToValueAtTime(v, t) { if (!Number.isFinite(v) || !Number.isFinite(t)) problems.push(`linearRamp(${v}, ${t})`); return this }
  setTargetAtTime(v, t, k) { if (!Number.isFinite(v) || !Number.isFinite(t) || !(k > 0)) problems.push(`setTarget(${v}, ${t}, ${k})`); return this }
  set value(v) { if (!Number.isFinite(v)) problems.push(`value=${v}`) }
  get value() { return 1 }
}
class Node {
  constructor() { for (const k of ['frequency', 'gain', 'Q', 'threshold', 'ratio', 'attack', 'release', 'detune']) this[k] = new Param() }
  connect(n) { return n }
  start() { started++ }
  stop() {}
}
class MockAudioContext {
  static now = 0; // shared clock the test advances between effects
  constructor() { this.sampleRate = 44100; this.destination = new Node() }
  get currentTime() { return MockAudioContext.now }
  createOscillator() { return new Node() } createGain() { return new Node() } createBiquadFilter() { return new Node() }
  createDynamicsCompressor() { return new Node() } createWaveShaper() { return new Node() } createBufferSource() { return new Node() } createConvolver() { return new Node() }
  createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) } }
}

(async () => {
  const { api: A } = await load();
  globalThis.AudioContext = MockAudioContext;
  A.initAudio();
  A.game.bg = false;
  const keys = [...new Set([...fs.readFileSync(SOURCE, 'utf8').matchAll(/case'([a-z]+)':/g)].map((m) => m[1]))];
  const silent = [];
  for (const k of keys) {
    const before = started;
    MockAudioContext.now += 0.2; // step past the game's per-window voice cap before each effect
    A.sfx(k);
    if (started === before) silent.push(k);
  }
  // the music loop schedules notes on its own timer: run it for 8 bars and make sure it plays and stays valid
  const beforeMusic = started;
  for (let i = 0; i < 200; i++) { MockAudioContext.now += 0.1; advance(100) }
  const musicNotes = started - beforeMusic;
  if (musicNotes < 50) silent.push('music');
  // drum fills (snare rolls, hi-hat stutters) come now and then: run four minutes and count them (never two within three phrases)
  for (let i = 0; i < 2400; i++) { MockAudioContext.now += 0.1; advance(100) }
  const fills = A.musicFills, phrases = Math.floor(240 / (60 / 126 * 16)), back2back = fills.some((p, i) => i && p - fills[i - 1] < 3);
  if (fills.length < 3 || fills.length > phrases / 3 || back2back) problems.push(`drum fills: ${fills.length} in ${phrases} phrases (${fills.join(',')})`);
  console.log(JSON.stringify({ effects: keys.length, musicNotes, fills: A.musicFills.length, silent, invalidParams: problems.length }));
  if (problems.length) console.error(problems.slice(0, 10).join('\n'));
  process.exit(silent.length || problems.length ? 1 : 0);
})();
