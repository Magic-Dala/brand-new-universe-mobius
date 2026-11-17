// v0.49 Story tutorials: the content (src/data/tutorials.js), the page logic and the panel's layout helpers
// (src/game/tutorial.js, pure), the game copies of the clips (public/tutorials/) and the captions in both languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
const { TUTORIALS, TUTORIAL_UI, TUTORIAL_PANEL } = await import('../src/data/tutorials.js');
const { Tutorials, mediaSlots, fitInto, panelSpot, clipUpload, newClip } = await import('../src/game/tutorial.js');
const { _tables } = await import('../src/core/i18n.js');

const files = (id) => TUTORIALS[id].pages.map((p) => p.media.map((m) => m.file));

// ---------------------------------------------------------------- content
test('three tutorials: move (2 pages), skills (8 pages), arcade (4 pages)', () => {
  assert.deepEqual(Object.keys(TUTORIALS), ['move', 'skills', 'arcade']);
  assert.deepEqual(Object.values(TUTORIALS).map((t) => t.pages.length), [2, 8, 4]);
});
test('move: Movement + Teleport side by side, then Turn + the swipe picture side by side', () => {
  assert.deepEqual(files('move'), [['s00_movement.mp4', 's00_teleport.mp4'], ['s01_turn.mp4', 's01_turn_swipe.png']]);
});
test('skills: window, coins, wall, web, bomb, fan web, shield one per page; the last page is Red Target Punch + Fly Kick', () => {
  assert.deepEqual(files('skills'), [['s02_open_window.mp4'], ['s03_collect_coins.mp4'], ['s04_climb_wall.mp4'], ['s05_light_web.mp4'], ['s06_light_bomb.mp4'], ['s07_fan_web.mp4'], ['s08_light_shield.mp4'], ['s09_red_target_punch.mp4', 's10_fly_kick.mp4']]);
});
test('arcade: Fan Web, Light Web, Energy Wave (the "Blast" clip), Light Bomb, one per page', () => {
  assert.deepEqual(files('arcade'), [['a01_fan_web.mp4'], ['a02_light_web.mp4'], ['a03_energy_wave.mp4'], ['a04_light_bomb.mp4']]);
});
test('every page has a title and a line, and every media entry says what it is', () => {
  for (const [id, tut] of Object.entries(TUTORIALS)) for (const [i, p] of tut.pages.entries()) {
    assert.ok(p.title && p.line, `${id} page ${i}`);
    for (const m of p.media) assert.equal(m.kind, m.file.endsWith('.png') ? 'image' : 'video', m.file);
  }
});

// ---------------------------------------------------------------- the game copies of the clips
const all = Object.values(TUTORIALS).flatMap((t) => t.pages.flatMap((p) => p.media));
test('every clip named in the content exists in public/tutorials/ (17 files, no file used twice)', () => {
  assert.equal(all.length, 17); assert.equal(new Set(all.map((m) => m.file)).size, 17);
  for (const m of all) assert.ok(existsSync(new URL(`../public/tutorials/${m.file}`, import.meta.url)), `${m.file} is missing`);
});
test('the clips are H.264 (not HEVC), without an audio track, and small: under 2 MB each, under 20 MB in all', () => {
  let total = 0;
  for (const m of all) {
    const u = new URL(`../public/tutorials/${m.file}`, import.meta.url), size = statSync(u).size; total += size;
    assert.ok(size < 2 * 1024 * 1024, `${m.file}: ${size} bytes`);
    if (m.kind !== 'video') continue;
    const b = readFileSync(u).toString('latin1');
    assert.ok(b.includes('avc1'), `${m.file}: no H.264 track`); assert.ok(!b.includes('hvc1') && !b.includes('hev1'), `${m.file}: HEVC`);
    assert.ok(!b.includes('mp4a'), `${m.file}: has an audio track`);
  }
  assert.ok(total < 20 * 1024 * 1024, `${total} bytes`);
});

// ---------------------------------------------------------------- captions and buttons, both languages
test('every title, line and button exists in English and in Traditional Chinese, and is not left untranslated', () => {
  const keys = [...Object.values(TUTORIALS).flatMap((t) => t.pages.flatMap((p) => [p.title, p.line])), ...Object.values(TUTORIAL_UI), 'settings.tutorials'];
  for (const k of keys) {
    const en = _tables.en[k], zh = _tables['zh-Hant'][k];
    assert.ok(en && en.trim(), `en: ${k}`); assert.ok(zh && zh.trim(), `zh-Hant: ${k}`); assert.notEqual(en, zh, k);
  }
  assert.deepEqual(Object.keys(TUTORIAL_UI), ['skip', 'back', 'next', 'done']);
});

// ---------------------------------------------------------------- page logic
const types = (ev) => ev.map((e) => e.type + (e.how ? ':' + e.how : ''));
test('open: the first page of that tutorial; one event', () => {
  const T = new Tutorials(); assert.equal(T.active, null);
  assert.equal(T.open('move'), true); assert.equal(T.active, 'move'); assert.equal(T.page, 0); assert.equal(T.pageCount, 2);
  assert.equal(T.isFirst, true); assert.equal(T.isLast, false); assert.equal(T.current, TUTORIALS.move.pages[0]);
  assert.deepEqual(T.drain(), [{ type: 'open', id: 'move' }]);
});
test('next and back move one page and stop at the ends', () => {
  const T = new Tutorials(); T.open('move'); T.drain();
  assert.equal(T.back(), false); assert.equal(T.next(), true); assert.equal(T.page, 1); assert.equal(T.isLast, true);
  assert.equal(T.next(), false); assert.equal(T.page, 1); assert.equal(T.back(), true); assert.equal(T.page, 0);
  assert.deepEqual(types(T.drain()), ['page', 'page']);
});
test('done closes it only from the last page', () => {
  const T = new Tutorials(); T.open('move'); assert.equal(T.done(), false); assert.equal(T.active, 'move');
  T.next(); T.drain(); assert.equal(T.done(), true); assert.equal(T.active, null);
  assert.deepEqual(T.drain(), [{ type: 'close', id: 'move', how: 'done' }]);
});
test('skip closes the whole tutorial from any page', () => {
  const T = new Tutorials(); T.open('skills'); T.next(); T.next(); T.drain();
  assert.equal(T.skip(), true); assert.equal(T.active, null); assert.deepEqual(T.drain(), [{ type: 'close', id: 'skills', how: 'skip' }]);
  assert.equal(T.skip(), false); assert.equal(T.next(), false); assert.equal(T.done(), false);
});
test('once per Story run: a closed tutorial does not open again until reset()', () => {
  const T = new Tutorials(); T.open('move'); T.skip();
  assert.equal(T.shown('move'), true); assert.equal(T.open('move'), false); assert.equal(T.open('skills'), true); T.skip();
  T.reset(); assert.equal(T.shown('move'), false); assert.equal(T.open('move'), true);
});
test('one at a time; an unknown tutorial does not open', () => {
  const T = new Tutorials(); T.open('move'); assert.equal(T.open('skills'), false); assert.equal(T.active, 'move'); assert.equal(T.shown('skills'), false);
  assert.equal(new Tutorials().open('nope'), false);
});
test('the switch off: nothing opens, and it is not counted as shown', () => {
  const T = new Tutorials(); assert.equal(T.open('move', { enabled: false }), false); assert.equal(T.active, null); assert.equal(T.shown('move'), false);
  assert.equal(T.open('move'), true);
});
test('reset() while one is open closes it without an event', () => {
  const T = new Tutorials(); T.open('move'); T.reset(); assert.equal(T.active, null); assert.deepEqual(T.drain(), []);
});

// ---------------------------------------------------------------- layout helpers
const A = TUTORIAL_PANEL.media; // the media area in panel pixels { x, y, w, h }
const inside = (s) => s.x >= A.x - 1e-6 && s.y >= A.y - 1e-6 && s.x + s.w <= A.x + A.w + 1e-6 && s.y + s.h <= A.y + A.h + 1e-6;
test('one clip: a 16:9 slot as large as the area allows, centred', () => {
  const [s] = mediaSlots(1); assert.ok(inside(s)); assert.ok(Math.abs(s.w / s.h - 16 / 9) < 1e-6);
  assert.ok(Math.abs(s.h - A.h) < 1e-6 || Math.abs(s.w - A.w) < 1e-6); assert.ok(Math.abs(s.x + s.w / 2 - (A.x + A.w / 2)) < 1e-6);
});
test('two clips: two equal 16:9 slots side by side with a gap, centred in the area', () => {
  const [a, b] = mediaSlots(2); assert.ok(inside(a) && inside(b)); assert.equal(a.w, b.w); assert.equal(a.h, b.h); assert.equal(a.y, b.y);
  assert.ok(Math.abs(a.w / a.h - 16 / 9) < 1e-6); assert.ok(b.x - (a.x + a.w) >= TUTORIAL_PANEL.gap - 1e-6);
  assert.ok(Math.abs((a.x + b.x + b.w) / 2 - (A.x + A.w / 2)) < 1e-6); assert.ok(Math.abs(a.y + a.h / 2 - (A.y + A.h / 2)) < 1e-6);
});
test('fitInto: a picture with another shape keeps its shape, centred inside the slot', () => {
  const slot = { x: 100, y: 50, w: 720, h: 405 }, f = fitInto(875 / 482, slot);
  assert.ok(Math.abs(f.w / f.h - 875 / 482) < 1e-6); assert.ok(f.w <= slot.w + 1e-6 && f.h <= slot.h + 1e-6);
  assert.ok(Math.abs(f.x + f.w / 2 - (slot.x + slot.w / 2)) < 1e-6); assert.ok(Math.abs(f.y + f.h / 2 - (slot.y + slot.h / 2)) < 1e-6);
});
test('the panel fits its canvas: the media area, the caption and the buttons do not overlap', () => {
  const P = TUTORIAL_PANEL; assert.ok(P.media.y >= P.titleH); assert.ok(P.caption.y >= P.media.y + P.media.h); assert.ok(P.buttons.y >= P.caption.y + P.caption.h);
  assert.ok(P.buttons.y + P.buttons.h <= P.height * P.ppm + 1e-6); assert.ok(P.media.x + P.media.w <= P.width * P.ppm + 1e-6);
});

// ---------------------------------------------------------------- where the panel goes
const D = TUTORIAL_PANEL.dist, near = (a, b) => Math.abs(a - b) < 1e-6;
test('panelSpot in the open: straight ahead at the panel distance', () => {
  const s = panelSpot({ x: 10, z: 20 }, { x: 0, z: -1 }); assert.ok(near(s.x, 10) && near(s.z, 20 - D));
});
const ROOM = { minX: -2.5, maxX: 2.5, minZ: -3, maxZ: 3 };
test('panelSpot in the room with space ahead: straight ahead', () => {
  const s = panelSpot({ x: 0, z: 1 }, { x: 0, z: -1 }, ROOM); assert.ok(near(s.x, 0) && near(s.z, 1 - D));
});
test('panelSpot facing a wall half a metre away: the panel goes toward the middle of the room instead, inside the walls', () => {
  const head = { x: -2.0, z: -2.0 }, s = panelSpot(head, { x: -1, z: 0 }, ROOM), m = TUTORIAL_PANEL.wallMargin;
  assert.ok(s.x >= ROOM.minX + m && s.x <= ROOM.maxX - m && s.z >= ROOM.minZ + m && s.z <= ROOM.maxZ - m, JSON.stringify(s));
  assert.ok(Math.hypot(s.x - head.x, s.z - head.z) >= 0.9, 'not in the player\'s face');
  assert.ok((s.x - head.x) * (0 - head.x) + (s.z - head.z) * (0 - head.z) > 0, 'toward the middle');
});
test('panelSpot standing in the middle of the room facing a far wall: still straight ahead', () => {
  const s = panelSpot({ x: 0, z: 0 }, { x: 1, z: 0 }, ROOM); assert.ok(near(s.x, D) && near(s.z, 0));
});

// ---------------------------------------------------------------- when a clip's picture is sent to the GPU again
// (the browser's own "new video frame" signal is not relied on: seen in the browser test under load, a clip that was
// playing stayed black on the panel)
const G = TUTORIAL_PANEL.uploadGap;
test('clipUpload: nothing while the clip is not ready; the first ready frame goes up at once, even at time 0', () => {
  const c = newClip(); assert.equal(clipUpload(c, 0, 1000, false), false); assert.equal(clipUpload(c, 0, 1010, true), true);
});
test('clipUpload: a clip whose time does not move (paused, stalled) is not sent again', () => {
  const c = newClip(); clipUpload(c, 0.5, 1000, true); assert.equal(clipUpload(c, 0.5, 5000, true), false);
});
test('clipUpload: while it plays, at most one upload per uploadGap (about the clip\'s own 30 frames a second)', () => {
  const c = newClip(); clipUpload(c, 0, 1000, true);
  assert.equal(clipUpload(c, 0.01, 1000 + G - 5, true), false); assert.equal(clipUpload(c, 0.03, 1000 + G + 1, true), true);
  let n = 0; for (let i = 1; i <= 90; i++) if (clipUpload(c, 1 + i / 90, 2000 + i * 1000 / 90, true)) n++; // one second at 90 frames a second
  assert.ok(n >= 25 && n <= 1000 / G + 1, `${n}`);
});
test('clipUpload: a loop back to the start counts as moved; a new source starts over', () => {
  const c = newClip(); clipUpload(c, 2.4, 1000, true); assert.equal(clipUpload(c, 0.0, 1100, true), true);
  const d = newClip(); clipUpload(d, 1, 1000, true); Object.assign(d, newClip()); assert.equal(clipUpload(d, 1, 1001, true), true);
});
