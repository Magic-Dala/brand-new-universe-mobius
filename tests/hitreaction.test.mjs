// v0.46 close combat: Green Maniac hit reactions — which clip a source picks, the gate that spaces reactions out and keeps
// them out of a telegraph / attack, and the dev switch default.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = globalThis.window || { addEventListener() {} };
const { pickReaction, ReactionGate } = await import('../src/worlds/hitReaction.js');
const { DEFAULTS } = await import('../src/core/settings.js');
/** the caller's sequence: ask, and take the slot when the model played the reaction */
const take = (g, t, s) => { if (!g.allow(t, s)) return false; g.mark(t); return true; };

test('punch always picks head', () => { for (let i = 0; i < 50; i++) assert.equal(pickReaction('punch'), 'head'); });
test('other sources split head / body by the random value', () => { assert.equal(pickReaction('web', () => 0.1), 'head'); assert.equal(pickReaction('lightBomb', () => 0.9), 'body'); });
test('gate: 0.4 s between reactions', () => { const g = new ReactionGate(); assert.ok(take(g, 1, 'protected')); assert.equal(take(g, 1.3, 'protected'), false); assert.ok(take(g, 1.41, 'protected')); });
test('gate: never during a telegraph or an attack, and a refusal does not restart the clock', () => { const g = new ReactionGate(); assert.equal(take(g, 1, 'telegraph'), false); assert.equal(take(g, 1.1, 'attack'), false); assert.ok(take(g, 1.2, 'staggered')); });
test('gate: reset', () => { const g = new ReactionGate(); take(g, 1, 'protected'); g.reset(); assert.ok(take(g, 1.01, 'protected')); });
test('gate: a refused or ignored reaction does not consume the slot (only mark() does)', () => { const g = new ReactionGate(); assert.ok(g.allow(1, 'protected')); /* the model ignored it: no mark */ assert.ok(g.allow(1.1, 'protected')); g.mark(1.1); assert.equal(g.allow(1.3, 'protected'), false); assert.equal(g.allow(1.6, 'telegraph'), false); assert.ok(g.allow(1.6, 'protected')); });
test('settings: closeCombat defaults to on', () => assert.equal(DEFAULTS.closeCombat, true));
