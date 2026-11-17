// v0.47 Story chase sound and voice: the Story's own sample manifest, the synthesized fallbacks, playOr, the Story-only bank,
// and Green Maniac's new lines (subtitle-only when a line has no recording).
import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync, existsSync } from 'node:fs';
import { SFX_MANIFEST, SFX_MANIFEST_STORY } from '../src/data/sfxManifest.js';
import { SampleBank } from '../src/core/sfx.js';
import { audio } from '../src/core/audio.js';
import { settings } from '../src/core/settings.js';
import { FEEL } from '../src/data/feel.js';
import { VO_LINES, VoiceDirector } from '../src/game/voice.js';

const NEW = ['jetStall', 'jetRecover', 'heavyWindup', 'flowUp', 'playerHit', 'punch', 'coinBurst']; // goal section 3
const fakeCtx = () => {
  const made = [];
  const node = (kind, extra = {}) => { const n = { kind, connect(x) { return x; }, disconnect() {}, ...extra }; made.push(n); return n; };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  const ctx = { state: 'running', currentTime: 0, sampleRate: 100,
    createGain: () => node('gain', { gain: param() }), createStereoPanner: () => node('pan', { pan: param() }),
    createBiquadFilter: () => node('filter', { frequency: param(), Q: { value: 0 } }), createOscillator: () => node('osc', { frequency: param(), start() {}, stop() {} }),
    createBufferSource: () => node('src', { start() {}, stop() {}, playbackRate: { value: 1 } }), createBuffer: () => ({ getChannelData: () => new Float32Array(100) }) };
  return { ctx, made };
};
/** Run fn with a fake running engine; every audio field it touches is restored. */
const withEngine = (fn, { bank = null, storyBank = null, useBank = false, useStory = false, sw = true } = {}) => {
  const f = fakeCtx(), sv = [audio.ctx, audio.sfx, audio.master, audio.voice, audio._lpos, audio._lright, audio.bank, audio.storyBank, audio.useBank, audio.useStory, settings.designedSfx];
  audio.ctx = f.ctx; audio.sfx = { kind: 'bus' }; audio.master = { kind: 'master' }; audio.voice = null; audio._lpos = null; audio._lright = null;
  audio.bank = bank; audio.storyBank = storyBank; audio.useBank = useBank; audio.useStory = useStory; settings.designedSfx = sw;
  try { return fn(f); } finally { [audio.ctx, audio.sfx, audio.master, audio.voice, audio._lpos, audio._lright, audio.bank, audio.storyBank, audio.useBank, audio.useStory, settings.designedSfx] = sv; }
};
const fakeBank = (names, log, tag) => ({ play(name) { log.push(`${tag}:${name}`); return names.includes(name); } });
function mp3Info(file) { // (as tests/sfx.test.mjs: walks the MPEG frame headers)
  const b = readFileSync(file); let i = 0, frames = 0, rate = 0, mono = null, secs = 0;
  if (b.toString('latin1', 0, 3) === 'ID3') i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    const br = (ver === 3 ? BR1 : BR2)[bri] * 1000, sr = SR[ver][sri], len = Math.floor((ver === 3 ? 144 : 72) * br / sr) + pad;
    if (!frames) { rate = sr; mono = (b[i + 3] >> 6) === 3; }
    frames++; secs += (ver === 3 ? 1152 : 576) / sr; i += len;
  }
  return { frames, rate, mono, secs };
}

test('Story manifest: every file exists, is mono 44.1 kHz and under 60 kB; a new file is at most 1.44 s (a World Chase file keeps its 1.5 s); the new files stay under 1 MB', () => {
  let total = 0; const world = new Set(Object.values(SFX_MANIFEST).flatMap((e) => e.files));
  for (const [name, e] of Object.entries(SFX_MANIFEST_STORY)) {
    assert.ok(e.files.length > 0 && typeof e.gain === 'number', name);
    for (const f of e.files) {
      const size = statSync(`public/audio/sfx/${f}`).size, m = mp3Info(`public/audio/sfx/${f}`); if (!world.has(f)) total += size;
      assert.ok(size < 60000, `${f}: ${size} bytes`); assert.ok(m.frames > 0, `${f}: no MP3 frames`);
      assert.equal(m.mono, true, `${f}: not mono`); assert.equal(m.rate, 44100, `${f}: ${m.rate} Hz`); assert.ok(m.secs <= (world.has(f) ? 1.5 : 1.44), `${f}: ${m.secs.toFixed(3)} s`);
    }
  }
  assert.ok(total < 1e6, `${total} bytes`);
});

test('the World Chase manifest is untouched by the Story names (17 names, none of the seven new ones added)', () => {
  assert.equal(Object.keys(SFX_MANIFEST).length, 17);
  for (const n of ['jetStall', 'jetRecover', 'heavyWindup', 'flowUp', 'playerHit', 'punch', 'coinBurst']) assert.equal(n in SFX_MANIFEST, false, n);
  for (const n of Object.keys(SFX_MANIFEST_STORY)) if (n in SFX_MANIFEST) for (const f of SFX_MANIFEST[n].files) assert.ok(SFX_MANIFEST_STORY[n].files.includes(f), `${n}: the Story set keeps the World Chase file ${f}`);
});

test('each of the seven new names has a synthesized fallback (heavyWindup through playOr; play("heavyWindup") itself stays silent)', () => {
  for (const n of NEW) {
    const made = withEngine((f) => { if (n === 'heavyWindup') audio.playOr('heavyWindup', 'heavyWindupStory'); else audio.play(n); return f.made.length; });
    assert.ok(made > 0, `${n}: nothing synthesized`);
  }
  assert.equal(withEngine((f) => { audio.play('heavyWindup'); return f.made.length; }), 0);
});

test('the Story bank is asked only while useBank and useStory are both on, and before the World Chase bank', () => {
  const run = (opt, name = 'punch') => { const log = []; withEngine(() => audio.play(name), { bank: fakeBank(['web'], log, 'world'), storyBank: fakeBank(['punch'], log, 'story'), ...opt }); return log; };
  assert.deepEqual(run({ useBank: false, useStory: true }), [], 'bank off (Arcade, Story with the switch off)');
  assert.deepEqual(run({ useBank: true, useStory: false }), ['world:punch'], 'World Chase: never the Story bank');
  assert.deepEqual(run({ useBank: true, useStory: true }), ['story:punch'], 'Story: its own sample plays');
  assert.deepEqual(run({ useBank: true, useStory: true }, 'web'), ['story:web', 'world:web'], 'Story: no Story sample → the World Chase one');
  assert.deepEqual(run({ useBank: true, useStory: true, sw: false }), [], 'designedSfx off: no bank at all');
});

test('playOr: a sample that plays stops there; none → the fallback name is synthesized', () => {
  const log = [];
  const a = withEngine((f) => { audio.playOr('heavyWindup', 'heavyWindupStory'); return f.made.length; }, { useBank: true, useStory: true, bank: fakeBank([], log, 'world'), storyBank: fakeBank(['heavyWindup'], log, 'story') });
  assert.equal(a, 0); assert.deepEqual(log, ['story:heavyWindup']);
  const b = withEngine((f) => { audio.playOr('heavyWindup', 'heavyWindupStory'); return f.made.length; }, { useBank: true, useStory: false, bank: fakeBank([], [], 'world') });
  assert.ok(b > 0, 'World-Chase-style bank without the sample: the Story fallback is synthesized');
  const sv = audio.ctx; audio.ctx = null; try { assert.doesNotThrow(() => audio.playOr('heavyWindup', 'heavyWindupStory')); } finally { audio.ctx = sv; } // not running: nothing
});

test('loadStorySfx: one voice pool for both banks (FEEL.sfx.maxVoices in all), never rejects without a context', async () => {
  const sv = [audio.ctx, audio.bank, audio.storyBank];
  audio.ctx = null; audio.bank = null; audio.storyBank = null;
  try {
    await audio.loadStorySfx();
    assert.ok(audio.bank instanceof SampleBank && audio.storyBank instanceof SampleBank);
    assert.equal(audio.storyBank.voices, audio.bank.voices);
    assert.equal(audio.storyBank.manifest, SFX_MANIFEST_STORY);
    assert.ok(FEEL.sfx.maxVoices <= 12);
  } finally { [audio.ctx, audio.bank, audio.storyBank] = sv; }
});

test('voice: STALL (3), PUNCHED (2), ESCAPE (1) with English and Traditional Chinese text; every recording named exists', () => {
  assert.deepEqual([VO_LINES.STALL.length, VO_LINES.PUNCHED.length, VO_LINES.ESCAPE.length], [3, 2, 1]);
  assert.deepEqual(VO_LINES.STALL.map((l) => l.text.en), ['My jet!', 'No, no, no!', 'You little pest!']);
  assert.deepEqual(VO_LINES.PUNCHED.map((l) => l.text.en.replace('’', "'")), ["You'll pay for that!", 'Lucky shot, bug!']);
  assert.equal(VO_LINES.ESCAPE[0].text.en.replace('’', "'"), "This city can't hold me, Mobius. Until next time!");
  for (const slot of ['STALL', 'PUNCHED', 'ESCAPE']) for (const l of VO_LINES[slot]) {
    assert.ok(l.text.en && /[一-鿿]/.test(l.text.zh), l.id);
    for (const f of Object.values(l.file || {})) { assert.ok(existsSync(`public/audio/vo/${f}`), f); const m = mp3Info(`public/audio/vo/${f}`); assert.equal(m.mono, true, f); assert.equal(m.rate, 44100, f); }
    if (!l.file) assert.ok(l.dur > 0, `${l.id}: a subtitle-only line needs a duration`);
  }
});

test('voice: a line without a recording shows its subtitle for its duration, plays nothing, and frees the slot afterwards', () => {
  withEngine((f) => {
    const said = []; const app = { story: { say: (tag, text, dur) => said.push({ tag, text, dur }), subtitle: null }, camera: null };
    const V = new VoiceDirector(app); V.preload = () => null;
    const line = { id: 'T1', dur: 1.5, text: { en: 'Test line.', zh: '測試。' } };
    VO_LINES.__T = [line];
    try {
      const n0 = f.made.filter((n) => n.kind === 'src').length;
      assert.ok(V.say('__T', null) > 0);
      assert.equal(f.made.filter((n) => n.kind === 'src').length, n0, 'no buffer source');
      assert.equal(said.length, 1); assert.equal(said[0].text, 'Test line.'); assert.ok(said[0].dur >= 1.5);
      assert.equal(V.speaking, true); assert.equal(V.say('__T', null), 0, 'one line at a time');
      for (let i = 0; i < 100; i++) V.update(1 / 60);
      assert.equal(V.speaking, false);
      assert.ok(V.say('__T', null, { interrupt: true }) > 0); assert.doesNotThrow(() => { V.fadeOut(0.2); V.update(0.016); V.stop(); });
    } finally { delete VO_LINES.__T; }
  });
});
