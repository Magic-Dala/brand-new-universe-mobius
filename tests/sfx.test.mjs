// v0.45 sample bank: variation picker, manifest budget, graceful fallback (no AudioContext in Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { pickVariation, SampleBank } from '../src/core/sfx.js';
import { SFX_MANIFEST } from '../src/data/sfxManifest.js';
import { DEFAULTS } from '../src/core/settings.js';

test('pickVariation never repeats back to back', () => { let last = -1; for (let i = 0; i < 200; i++) { const k = pickVariation(3, last); assert.notEqual(k, last); assert.ok(k >= 0 && k < 3); last = k; } assert.equal(pickVariation(1, 0), 0); });
test('every manifest file exists and is under 60 kB', () => { for (const [name, e] of Object.entries(SFX_MANIFEST)) for (const f of e.files) { const s = statSync(`public/audio/sfx/${f}`); assert.ok(s.size < 60000, `${name}/${f}`); } });
test('manifest total is under 2 MB', () => { let total = 0; for (const e of Object.values(SFX_MANIFEST)) for (const f of e.files) total += statSync(`public/audio/sfx/${f}`).size; assert.ok(total < 2e6, `total ${total}`); });
test('play without a context or a loaded sample returns false and does not throw', () => { const b = new SampleBank({ ctx: null, running: false }, { web: { files: ['web-1.mp3'], gain: 1 } }); assert.equal(b.has('web'), false); assert.equal(b.play('web'), false); assert.equal(b.play('nope'), false); });
test('load never rejects when fetch fails', async () => { globalThis.fetch = async () => { throw new Error('offline'); }; const b = new SampleBank({ ctx: null, running: false }, { web: { files: ['web-1.mp3'], gain: 1 } }); await b.load('/audio/sfx/'); assert.equal(b.has('web'), false); });
test('settings: the five v0.45 toggles default to on', () => { for (const k of ['designedSfx', 'impactTime', 'flowMeter', 'speedFx', 'finisher']) assert.equal(DEFAULTS[k], true); });
test('play with a fake context: positional pan and falloff, voice limit stops the oldest', async () => {
  const started = [], pans = [], gains = [];
  const node = (extra = {}) => ({ connect(n) { return n; }, disconnect() {}, ...extra });
  const ctx = {
    createBufferSource: () => { const s = node({ playbackRate: { value: 1 }, start() { started.push(s); }, stop() { s.stopped = true; } }); return s; },
    createGain: () => { const g = node({ gain: { value: 1 } }); gains.push(g); return g; },
    createStereoPanner: () => { const p = node({ pan: { value: 0 } }); pans.push(p); return p; },
  };
  const eng = { ctx, running: true, sfx: node(), decode: async () => ({ duration: 0.2 }) };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  const b = new SampleBank(eng, { web: { files: ['a.mp3', 'b.mp3'], gain: 1 } }, { maxVoices: 2, pitchJitter: 0 });
  await b.load('/x/');
  assert.equal(b.has('web'), true);
  assert.equal(b.play('web', { pos: { x: 12, y: 0, z: 0 }, listener: { pos: { x: 0, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 } } }), true);
  assert.equal(pans[0].pan.value, 1); assert.equal(gains[0].gain.value, 0.5);
  b.play('web'); b.play('web');
  assert.equal(started[0].stopped, true); assert.equal(b.voices.length, 2);
});

const fakeNode = (extra = {}) => ({ connect(n) { return n; }, disconnect() {}, ...extra });
const fakeEng = (over = {}) => ({
  ctx: {
    createBufferSource: () => fakeNode({ playbackRate: { value: 1 }, start() {}, stop() {} }),
    createGain: () => fakeNode({ gain: { value: 1 } }),
    createStereoPanner: () => fakeNode({ pan: { value: 0 } }),
    ...over,
  },
  running: true, sfx: fakeNode(), decode: async () => ({ duration: 0.2 }),
});
const okFetch = (log) => async (u) => { log.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };

test('play returns false when node creation throws', async () => {
  globalThis.fetch = okFetch([]);
  const b = new SampleBank(fakeEng({ createGain: () => { throw new Error('closed'); } }), { web: { files: ['a.mp3'], gain: 1 } }, { maxVoices: 2, pitchJitter: 0 });
  await b.load('/x/');
  assert.equal(b.play('web'), false);
  assert.equal(b.voices.length, 0);
});
test('play: a start() that throws returns false and leaves no voice behind', async () => {
  globalThis.fetch = okFetch([]);
  const b = new SampleBank(fakeEng({ createBufferSource: () => fakeNode({ playbackRate: { value: 1 }, start() { throw new Error('bad'); }, stop() {} }) }), { web: { files: ['a.mp3'], gain: 1 } }, { maxVoices: 2, pitchJitter: 0 });
  await b.load('/x/');
  assert.equal(b.play('web'), false);
  assert.equal(b.voices.length, 0);
});
test('load is idempotent: concurrent calls share a promise, decoded names are not refetched', async () => {
  const log = []; globalThis.fetch = okFetch(log);
  const b = new SampleBank(fakeEng(), { web: { files: ['a.mp3', 'b.mp3'], gain: 1 } }, { maxVoices: 2, pitchJitter: 0 });
  const p1 = b.load('/x/'), p2 = b.load('/x/');
  assert.equal(p1, p2);
  await p1;
  assert.equal(log.length, 2);
  await b.load('/x/');
  assert.equal(log.length, 2);
  assert.equal(b.has('web'), true);
});
test('load without a context does not poison a later load', async () => {
  const log = []; globalThis.fetch = okFetch(log);
  const eng = fakeEng(); const ctx = eng.ctx; eng.ctx = null;
  const b = new SampleBank(eng, { web: { files: ['a.mp3'], gain: 1 } }, { maxVoices: 2, pitchJitter: 0 });
  await b.load('/x/');
  assert.equal(b.has('web'), false);
  eng.ctx = ctx;
  await b.load('/x/');
  assert.equal(b.has('web'), true);
  assert.equal(log.length, 1);
});

import { panFor } from '../src/core/sfx.js';
import { audio } from '../src/core/audio.js';
const fakeCtx = () => {
  const made = [], conn = [];
  const node = (kind, extra = {}) => { const n = { kind, connect(x) { conn.push([n, x]); return x; }, disconnect() {}, ...extra }; made.push(n); return n; };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() { this.calls = (this.calls || 0) + 1; } });
  const ctx = { state: 'running', currentTime: 0, sampleRate: 100,
    createGain: () => node('gain', { gain: param() }), createStereoPanner: () => node('pan', { pan: { value: 0 } }),
    createBiquadFilter: () => node('filter', { frequency: param(), Q: { value: 0 } }), createOscillator: () => node('osc', { frequency: param(), start() {}, stop() {} }),
    createBufferSource: () => node('src', { start() {}, stop() {} }), createBuffer: () => ({ getChannelData: () => new Float32Array(100) }) };
  return { ctx, made, conn };
};
const withEngine = (fn) => { const f = fakeCtx(); const sv = [audio.ctx, audio.sfx, audio._lpos, audio._lright, audio.bank]; audio.ctx = f.ctx; audio.sfx = { kind: 'bus' }; audio.bank = null; audio._lpos = null; audio._lright = null; try { fn(f); } finally { [audio.ctx, audio.sfx, audio._lpos, audio._lright, audio.bank] = sv; } };

test('panFor: right-vector dot direction; fallback without listener or point', () => {
  const L = { pos: { x: 0, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 } };
  assert.equal(panFor({ x: 5, y: 0, z: 0 }, L), 1); assert.equal(panFor({ x: -5, y: 0, z: 0 }, L), -1); assert.ok(Math.abs(panFor({ x: 0, y: 0, z: -5 }, L)) < 1e-9);
  assert.equal(panFor({ x: 5, y: 0, z: 0 }, null, 0.3), 0.3); assert.equal(panFor(null, L, 0.2), 0.2); assert.equal(panFor({ x: 5, y: 0, z: 0 }, { pos: null, right: L.right }, 0.1), 0.1);
});
test('audio.play synth: omitted gain adds no gain node vs default graph; gain 0.5 adds a 0.5 multiplier per output', () => {
  let base, half;
  withEngine((f) => { audio.play('web'); base = f.made.map((n) => n.kind); });
  withEngine((f) => { audio.play('web', 0, null, 1); assert.deepEqual(f.made.map((n) => n.kind), base); });
  withEngine((f) => { audio.play('web', 0, null, 0.5); half = f.made.filter((n) => n.kind === 'gain' && n.gain.value === 0.5); assert.equal(half.length, 2); assert.equal(f.made.length, base.length + 2); });
});
test('audio.play synth: pos + listener pans from the right vector; null listener means no position', () => {
  withEngine((f) => { audio.setListener({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }); audio.play('web', 0, { x: 4, y: 0, z: 0 }); const p = f.made.filter((n) => n.kind === 'pan'); assert.ok(p.length > 0 && p.every((n) => n.pan.value === 1)); });
  withEngine((f) => { audio.setListener(null, null); audio.play('web', 0, { x: 4, y: 0, z: 0 }); assert.equal(f.made.filter((n) => n.kind === 'pan').length, 0); });
});
test('startTension.set: skips setTargetAtTime when level and hz moved < 1%; k scales the gain', () => {
  withEngine((f) => {
    const t = audio.startTension(), out = f.made.find((n) => n.kind === 'gain');
    t.set(0.5, 100); const n1 = out.gain.calls; t.set(0.502, 100.5); assert.equal(out.gain.calls, n1); t.set(0.6, 100); assert.ok(out.gain.calls > n1);
  });
});

// Minimal MPEG-1/2 Layer III reader: walks every frame header (skipping an ID3v2 tag) → channel mode, sample rate, duration.
function mp3Info(file) {
  const b = readFileSync(file); let i = 0, frames = 0, rate = 0, mono = null, spf = 0, secs = 0;
  if (b.toString('latin1', 0, 3) === 'ID3') i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    const br = (ver === 3 ? BR1 : BR2)[bri] * 1000, sr = SR[ver][sri], len = Math.floor((ver === 3 ? 144 : 72) * br / sr) + pad;
    if (!frames) { rate = sr; mono = (b[i + 3] >> 6) === 3; spf = ver === 3 ? 1152 : 576; }
    frames++; secs += (ver === 3 ? 1152 : 576) / sr; i += len;
  }
  return { frames, rate, mono, secs, spf };
}
test('every manifest file is mono, 44.1 kHz and at most 1.5 s', () => {
  for (const [name, e] of Object.entries(SFX_MANIFEST)) for (const f of e.files) {
    const m = mp3Info(`public/audio/sfx/${f}`);
    assert.ok(m.frames > 0, `${name}/${f}: no MP3 frames`);
    assert.equal(m.mono, true, `${name}/${f}: not mono`);
    assert.equal(m.rate, 44100, `${name}/${f}: ${m.rate} Hz`);
    assert.ok(m.secs <= 1.5, `${name}/${f}: ${m.secs.toFixed(3)} s`);
  }
});
test('audio.play consults the sample bank only while useBank is on', () => {
  let calls = 0; const bank = { play() { calls++; return true; } };
  withEngine(() => {
    audio.bank = bank;
    assert.equal(audio.useBank, false, 'defaults off');
    audio.play('web'); assert.equal(calls, 0);
    audio.useBank = true;
    try { audio.play('web'); assert.equal(calls, 1); } finally { audio.useBank = false; }
  });
});

// v0.45 fix wave: a name with no sample played (switch off, bank not in use, or no file) plays the v0.44 sound.
import { settings } from '../src/core/settings.js';
const sig = (f) => f.made.map((n) => `${n.kind}${n.type ? ':' + n.type : ''}${n.pan ? '@' + n.pan.value : ''}`);
const graph = (fn, { bank = null, useBank = false, sw = true, listener = false } = {}) => {
  let out; const svB = audio.useBank, svS = settings.designedSfx;
  withEngine((f) => { audio.bank = bank; audio.useBank = useBank; settings.designedSfx = sw; if (listener) audio.setListener({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    try { fn(); out = sig(f); } finally { audio.useBank = svB; settings.designedSfx = svS; } });
  return out;
};
const fakeBank = (names, log) => ({ play(name) { log.push(name); return names.includes(name); } });
const P = { x: 6, y: 0, z: 0 };
test('v0.44 aliases: switch off / bank not in use / no sample → stagger + bossHit play boomEnemy, release plays web, heavyWindup nothing', () => {
  for (const opt of [{ sw: false, useBank: true, bank: fakeBank(['stagger', 'bossHit', 'release', 'boomEnemy', 'web', 'heavyWindup'], []) }, { useBank: false }, { useBank: true, bank: fakeBank([], []) }]) {
    const boom = graph(() => audio.play('boomEnemy'), opt), web = graph(() => audio.play('web'), opt);
    assert.ok(boom.length > 0 && web.length > 0);
    assert.deepEqual(graph(() => audio.play('stagger'), opt), boom, `stagger ${JSON.stringify(opt.sw)}`);
    assert.deepEqual(graph(() => audio.play('bossHit', 0, P, 1), { ...opt, listener: true }), boom, 'bossHit: no positional pan');
    assert.deepEqual(graph(() => audio.play('release', 0, P, 0.5), { ...opt, listener: true }), web, 'release: no pan, no gain change');
    assert.deepEqual(graph(() => audio.play('heavyWindup'), opt), []);
  }
});
test('v0.44 aliases: with the switch off the bank is not consulted at all', () => {
  const log = []; graph(() => { audio.play('stagger'); audio.play('bossHit'); audio.play('release'); }, { sw: false, useBank: true, bank: fakeBank(['stagger', 'bossHit', 'release', 'boomEnemy', 'web'], log) });
  assert.deepEqual(log, []);
});
test('v0.44 aliases: no sample for the name but one for the alias → the alias plays as play(alias) would (its sample)', () => {
  const log = []; const g = graph(() => audio.play('stagger'), { useBank: true, bank: fakeBank(['boomEnemy'], log) });
  assert.deepEqual(log, ['stagger', 'boomEnemy']); assert.deepEqual(g, []);
});
test('v0.44 aliases: a sample present with the bank in use plays the sample and not the alias', () => {
  for (const n of ['bossHit', 'stagger', 'release', 'heavyWindup']) {
    const log = []; const g = graph(() => audio.play(n), { useBank: true, bank: fakeBank([n], log) });
    assert.deepEqual(log, [n], n); assert.deepEqual(g, [], n);
  }
});
test('SampleBank: manifest falloff: false keeps the positional pan, drops the distance attenuation', async () => {
  globalThis.fetch = okFetch([]);
  const gains = [], pans = [];
  const eng = fakeEng({ createGain: () => { const g = fakeNode({ gain: { value: 1 } }); gains.push(g); return g; }, createStereoPanner: () => { const p = fakeNode({ pan: { value: 0 } }); pans.push(p); return p; } });
  const b = new SampleBank(eng, { hit: { files: ['a.mp3'], gain: 0.9, falloff: false }, far: { files: ['b.mp3'], gain: 0.9 } }, { maxVoices: 4, pitchJitter: 0 });
  await b.load('/x/');
  const L = { pos: { x: 0, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 } };
  assert.equal(b.play('hit', { pos: { x: 24, y: 0, z: 0 }, listener: L }), true);
  assert.equal(gains[0].gain.value, 0.9); assert.equal(pans[0].pan.value, 1);
  b.play('far', { pos: { x: 24, y: 0, z: 0 }, listener: L });
  assert.ok(Math.abs(gains[1].gain.value - 0.3) < 1e-9); assert.equal(pans[1].pan.value, 1);
});
test('manifest: bossHit plays with pan but no distance falloff', () => { assert.equal(SFX_MANIFEST.bossHit.falloff, false); });
test('SampleBank: a one-file name (coin) plays twice in a row without error or silence', async () => {
  globalThis.fetch = okFetch([]);
  const eng = fakeEng();
  const b = new SampleBank(eng, { coin: { files: ['coin-1.mp3'], gain: 0.4 } }, { maxVoices: 12, pitchJitter: 0.06 });
  await b.load('/x/');
  for (let i = 0; i < 20; i++) assert.equal(b.play('coin'), true, `play ${i}`);
  assert.equal(b.voices.length, 12);
});
test('manifest: the six World Chase additions', () => {
  for (const [n, g] of [['stagger', 1], ['finisherYank', 1], ['shieldBreak', 0.8], ['whoosh', 0.6], ['launch', 0.6], ['coin', 0.4]]) assert.deepEqual([SFX_MANIFEST[n].files, SFX_MANIFEST[n].gain], [[`${n}-1.mp3`], g], n);
  assert.equal(SFX_MANIFEST.stagger.falloff, false); assert.equal(SFX_MANIFEST.finisherYank.falloff, false);
  assert.equal(Object.keys(SFX_MANIFEST).length, 17);
});

test('v0.49 slowmoIn: a synthesized sound exists (never silent without a sample)', () => {
  withEngine((f) => { audio.play('slowmoIn'); assert.ok(f.made.some((n) => n.kind === 'osc' || n.kind === 'src'), 'no sound source was made'); });
});
