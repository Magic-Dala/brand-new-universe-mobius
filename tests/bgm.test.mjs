// v0.43 background music selection (src/core/bgm.js): which track plays in which scene, levels, loudness gains.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { BGM, MAP_BGM, pickBgm, bgmGain } from '../src/core/bgm.js';
import { MAPS } from '../src/worlds/maps.js';

test('every World Chase map has its own track; Foldscape (daylight) shares the Dala City BGM with the story chase', () => {
  for (const m of MAPS) assert.ok(MAP_BGM[m.id], `${m.id} has a BGM`);
  assert.equal(MAP_BGM.foldscape, 'dala');
  assert.equal(pickBgm({ state: 'story', storyStage: 'chase' }).id, 'dala');
  assert.equal(pickBgm({ state: 'story', storyStage: 'endless' }).id, 'dala');
  const ids = MAPS.map((m) => MAP_BGM[m.id]);
  assert.equal(new Set(ids).size, MAPS.length, 'one distinct track per map');
  for (const [id, b] of Object.entries(BGM)) assert.ok(existsSync(new URL(`../public/audio/bgm/${b.file}`, import.meta.url)), `${id}: public/audio/bgm/${b.file}`);
});

test('no BGM in the room, the rest of the story, the arcade or the title; levels for pause / menu / results / loading', () => {
  for (const stage of ['intro', 'suit', 'mirror', 'window', 'roofEvent', 'loadingInterior', 'factory', 'arcadeBattle', 'escape']) assert.equal(pickBgm({ state: 'story', storyStage: stage }), null, stage);
  for (const state of ['title', 'modeSelect', 'songSelect', 'arcade', 'results', 'calibrate']) assert.equal(pickBgm({ state }), null, state);
  assert.deepEqual(pickBgm({ state: 'world', worldMapId: 'neon' }), { id: 'neon', level: 1 });
  assert.equal(pickBgm({ state: 'world', worldMapId: 'neon', worldPaused: true, menuOpen: true }).level, 0.35);
  assert.equal(pickBgm({ state: 'world', worldMapId: 'neon', worldResolved: true, menuOpen: true }).level, 0.6);
  assert.equal(pickBgm({ state: 'story', storyStage: 'chase', storyPaused: true }).level, 0.35);
  assert.deepEqual(pickBgm({ state: 'loading', worldLoadingMap: 'molten' }), { id: 'molten', level: 0.6 });
  assert.equal(pickBgm({ state: 'loading' }), null, 'factory / city loading: silence');
  assert.equal(pickBgm({ state: 'title', worldMapId: 'neon' }), null, 'back home: stops even though the last map id is remembered');
});

test('loudness normalisation: every track lands on the same target', () => {
  for (const [id, b] of Object.entries(BGM)) { const g = bgmGain(id); assert.ok(g > 0.3 && g <= 1, id); assert.ok(Math.abs(b.lufs + 20 * Math.log10(g) + 20) < 1e-9, id); }
});
