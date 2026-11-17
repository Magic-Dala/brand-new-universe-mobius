// v0.48 Arcade sound: the seven new names each have a synthesized sound, the rising steps exist, the sample bank is on in
// the Arcade, and the Arcade's own samples sit in their own manifest so World Chase and Story sound as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SFX_MANIFEST, SFX_MANIFEST_STORY, SFX_MANIFEST_ARCADE } from '../src/data/sfxManifest.js';
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const audio = src('src/core/audio.js'), main = src('src/main.js'), arcade = src('src/game/arcade.js');
const NAMES = ['comboUp', 'comboBreak', 'hallBurst', 'waveCharge', 'waveFire', 'shellCrack', 'shellRegrow'];

test('each of the seven new names has a synthesized sound in audio.js', () => {
  for (const n of NAMES) assert.ok(audio.includes(`case '${n}':`), `${n} has no synthesized case`);
});
test('comboUp and shellCrack rise in three steps (comboUp1…3, shellCrack1…3), and the Arcade plays them by step', () => {
  assert.ok(/\/\^\(comboUp\|shellCrack\)\(\[1-9\]\)\$\//.test(audio), 'the step suffix is parsed');
  for (const n of ['comboUp', 'shellCrack']) { const i = audio.indexOf(`case '${n}':`); assert.ok(/this\._step/.test(audio.slice(i, i + 400)), `${n} uses the step`); assert.ok(/\* k/.test(audio.slice(i, i + 500)), `${n} rises with the step`); }
  assert.ok(arcade.includes('audio.play(`shellCrack${q.seq.stage}`'), 'one step per layer removed (1, 2, 3)');
  assert.ok(arcade.includes('`comboUp${lv.level}`'), 'one step per show level (1, 2, 3)');
});
test('the new stings are unpitched (noise only), so they fit any song', () => {
  for (const n of NAMES) { const i = audio.indexOf(`case '${n}':`), j = audio.indexOf('break;', i); assert.ok(!/this\.tone\(/.test(audio.slice(i, j)), `${n} uses a pitched tone`); }
});
test('the sample bank is on in the Arcade, with the Arcade\'s own manifest consulted only there', () => {
  assert.ok(/const arcadeOn = this\.state === 'arcade' \|\| this\.state === 'results'/.test(main));
  assert.ok(/audio\.useBank = this\.state === 'world' \|\| storyCombatOn \|\| arcadeOn;/.test(main));
  assert.ok(/audio\.useArcade = arcadeOn;/.test(main));
  assert.ok(/if \(this\.useArcade && this\.arcadeBank && this\.arcadeBank\.play\(name, o\)\) return true;/.test(audio));
  assert.ok(/if \(!this\.useBank \|\| settings\.designedSfx === false\) return false;/.test(audio), 'designedSfx still governs every sample');
  assert.ok(arcade.includes('audio.loadArcadeSfx?.()'));
});
test('the Arcade manifest: only v0.48 names, every listed file exists and is under 200 kB; the other two manifests are untouched by it', () => {
  const allowed = new Set([...NAMES, 'comboUp1', 'comboUp2', 'comboUp3', 'shellCrack1', 'shellCrack2', 'shellCrack3']);
  for (const [name, e] of Object.entries(SFX_MANIFEST_ARCADE)) {
    assert.ok(allowed.has(name), `${name} is not a v0.48 name`);
    for (const f of e.files) { const u = new URL(`../public/audio/sfx/${f}`, import.meta.url); assert.ok(existsSync(u), `${f} is missing`); assert.ok(readFileSync(u).length < 200 * 1024, `${f} is too large`); }
  }
  for (const n of allowed) { assert.ok(!(n in SFX_MANIFEST), `${n} leaked into World Chase's manifest`); assert.ok(!(n in SFX_MANIFEST_STORY), `${n} leaked into the Story's manifest`); }
});
test('the Arcade plays the wave, shell and hall sounds through names that fall back to a synthesized sound', () => {
  for (const call of ["audio.playOr('waveFire', 'boomBlue', 0)", "audio.playOr('waveCharge', 'fanCharge', 0)", "audio.playOr('shellRegrow', 'miss'", "audio.playOr('hallBurst', 'hallBurst')", "'comboBreak'"]) assert.ok(arcade.includes(call), call);
});
