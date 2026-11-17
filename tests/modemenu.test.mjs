// v0.49 menu order: the website's title page has one Enter VR Game button and no map picker; the in-VR mode menu lists
// Story (recommended) first, then Arcade, then World Chase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
const { MODE_MENU, MODE_ROW, MODE_PANEL, desktopLinkShown } = await import('../src/data/modeMenu.js');
const { launchMap, MAPS, CLASSIC_ID } = await import('../src/worlds/maps.js');
const { _tables } = await import('../src/core/i18n.js');
await import('../src/worlds/i18n.js');
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('the mode menu lists Story, Arcade, World Chase, in that order from the top', () => {
  assert.deepEqual(MODE_MENU.map((m) => m.id), ['story', 'arcade', 'world']);
  for (let i = 1; i < MODE_MENU.length; i++) assert.ok(MODE_MENU[i].y >= MODE_MENU[i - 1].y + MODE_MENU[i - 1].h, `${MODE_MENU[i].id} is below ${MODE_MENU[i - 1].id}`);
});
test('only Story is recommended, and only Story is the highlighted button', () => {
  assert.deepEqual(MODE_MENU.filter((m) => m.recommended).map((m) => m.id), ['story']);
  assert.deepEqual(MODE_MENU.filter((m) => m.primary).map((m) => m.id), ['story']);
});
test('the three modes and the language / exit row fit the panel without overlapping', () => {
  const last = MODE_MENU[MODE_MENU.length - 1];
  assert.ok(MODE_MENU[0].y >= MODE_PANEL.headerH); assert.ok(MODE_ROW.y >= last.y + last.h); assert.ok(MODE_ROW.y + MODE_ROW.h <= MODE_PANEL.height * 1000);
});
test('the "Recommended" label exists in English and Traditional Chinese', () => {
  assert.equal(_tables.en['mode.recommended'], 'Recommended'); assert.ok(_tables['zh-Hant']['mode.recommended']); assert.notEqual(_tables['zh-Hant']['mode.recommended'], 'Recommended');
});

test('the title page: one Enter VR Game button, no map picker', () => {
  const html = read('index.html');
  assert.equal((html.match(/id="enter"/g) || []).length, 1); assert.match(html, /<button id="enter" class="btn primary"/);
  for (const id of ['map-picker', 'map-select', 'map-card', 'map-prev', 'map-next', 'map-thumb']) assert.ok(!html.includes(id), `index.html still has ${id}`);
  const js = read('src/ui/title.js');
  for (const s of ['map-select', 'setSelectedMap', 'getSelectedMap', 'pendingMap']) assert.ok(!js.includes(s), `title.js still uses ${s}`);
  assert.ok(!read('src/ui/title.css').includes('.map-'), 'title.css still has map picker styles');
});

test('launchMap: Enter VR goes to the mode menu, whatever chase world was last played', () => {
  assert.equal(launchMap(undefined), null); assert.equal(launchMap(null), null); assert.equal(launchMap(CLASSIC_ID), null); assert.equal(launchMap('nope'), null);
});
test('launchMap: a world named directly (the browser tests\' hook) still starts that world', () => {
  assert.equal(launchMap(MAPS[0].id), MAPS[0].id);
});

test('on a headset the title page shows only the Enter VR Game button: the desktop-preview link is for the desktop emulator only', () => {
  assert.equal(desktopLinkShown('vr'), false); assert.equal(desktopLinkShown('emulated'), true);
  assert.equal(desktopLinkShown('none'), false); assert.equal(desktopLinkShown('insecure'), false); assert.equal(desktopLinkShown('checking'), false);
});
