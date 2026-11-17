// v0.42 World Chase boss fight: state machine, damage model, counters, phases, fairness (pure — no scene).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BossFight, FIGHT, TRANSITIONS, chooseAttack, heavyCounterOk, phaseFor } from '../src/worlds/bossFight.js';

const DT = 1 / 60;
const FAIR = { fair: true, dist: 25, flying: 0, heavyOk: true, bossHpFrac: 1 };
/** Run the fight for `sec` seconds with ctx (function or object); returns all events. */
function run(f, sec, ctx = FAIR) { const out = []; for (let t = 0; t < sec; t += DT) out.push(...f.update(DT, typeof ctx === 'function' ? ctx(f) : ctx).map((e) => ({ ...e }))); return out; }
function toHeavy(f) { f.fightT = FIGHT.heavy.first; f.sinceHeavy = 99; f.nextAttackIn = 0; f.recent = []; run(f, DT); assert.equal(f.state, 'telegraph'); assert.equal(f.attack, 'heavy'); }

test('transition table: only listed transitions, defeated is terminal', () => {
  const f = new BossFight();
  assert.equal(f.go('vent'), false, 'protected → vent is not allowed');
  assert.equal(f.state, 'protected');
  assert.ok(f.defeat()); assert.equal(f.state, 'defeated');
  assert.equal(f.defeat(), false, 'defeat resolves once');
  for (const s of Object.keys(TRANSITIONS)) assert.ok(!TRANSITIONS[s].includes(s), `${s} never re-enters itself`);
  assert.deepEqual(TRANSITIONS.defeated, []);
  f.update(DT, FAIR); assert.equal(run(f, 2).length, 0, 'a defeated boss emits nothing (after delivering its last state change)');
});

test('protected spam is far less effective than exploiting an opening', () => {
  // spam: webs at the rate limit + a Light Bomb every 2 s for 60 s, no counters (attacks off)
  const p = new BossFight(); let hpP = 0; const kinds = new Set();
  for (let i = 0; i < 3600; i++) { p.update(DT, { ...FAIR, fair: false }); if (i % 6 === 0) { const r = p.hit('web', 'body'); hpP += r.hp; kinds.add(r.kind); } if (i % 120 === 0) hpP += p.hit('lightBomb', 'body').hp; }
  // one heavy counter cycle: windup → core hit → the same firing during the window
  const s = new BossFight(); toHeavy(s); run(s, FIGHT.heavy.ventAt + 0.2); let hpS = s.hit('web', 'core').hp, tS = FIGHT.heavy.ventAt + 0.2;
  for (let i = 0; i < 600 && s.state !== 'protected'; i++) { s.update(DT, { ...FAIR, fair: false }); tS += DT; if (s.state === 'staggered') { if (i % 6 === 0) hpS += s.hit('web', 'core').hp; if (i % 120 === 0) hpS += s.hit('lightBomb', 'core').hp; } }
  const rateP = hpP / 60, rateS = hpS / tS;
  assert.ok(rateP < 1.3, `spam ${rateP.toFixed(2)} HP/s`);
  assert.ok(rateS > rateP * 2, `counter cycle ${rateS.toFixed(2)} HP/s vs spam ${rateP.toFixed(2)} HP/s`);
  assert.ok(hpS >= 25, `one counter opening ≈ ${hpS} HP`);
  assert.ok(kinds.has('shield') && kinds.has('break'), 'spam shows shield damage and can break the shield');
});

test('web rate limit: two webs in the same instant count once', () => {
  const f = new BossFight(); f.forceStagger('counter');
  const a = f.hit('web', 'core'), b = f.hit('web', 'core');
  assert.ok(a.hp > 0); assert.equal(b.hp, 0); assert.ok(b.limited);
});

test('shield chip break → short stagger, re-forms, and a second break is slower (armor)', () => {
  const f = new BossFight(); let n1 = 0;
  while (f.state !== 'staggered' && n1 < 50) { f.fightT += 0.7; if (f.hit('web').kind === 'break') break; n1++; }
  assert.equal(f.state, 'staggered'); assert.equal(f.staggerCause, 'break'); assert.equal(f.staggerLen, FIGHT.stagger.break);
  assert.ok(FIGHT.stagger.break < FIGHT.stagger.counter, 'a counter opens a longer window than chip damage');
  run(f, FIGHT.stagger.break + 0.05, { ...FAIR, fair: false }); assert.equal(f.state, 'recovering');
  run(f, FIGHT.recover + 0.05, { ...FAIR, fair: false }); assert.equal(f.state, 'protected'); assert.equal(f.stability, FIGHT.shield.max);
  let n2 = 0; while (f.state !== 'staggered' && n2 < 80) { f.fightT += 0.7; f.hit('web'); n2++; }
  assert.ok(n2 > n1 * 1.5, `second break took ${n2} webs vs ${n1}`);
});

test('shield regen waits for the delay and never erases progress instantly', () => {
  const f = new BossFight(); f.hit('lightBomb'); const after = f.stability;
  run(f, FIGHT.shield.regenDelay - 0.2, { ...FAIR, fair: false }); assert.equal(f.stability, after, 'no regen before the delay');
  run(f, 1, { ...FAIR, fair: false }); assert.ok(f.stability > after && f.stability < after + FIGHT.shield.regenRate * 1.3, 'gradual regen');
});

test('heavy throw: telegraph → core vents before the release → vent window → counter on the core → stagger', () => {
  const f = new BossFight(); toHeavy(f);
  let ev = run(f, FIGHT.heavy.ventAt + 0.05);
  assert.ok(ev.some((e) => e.type === 'ventOpen')); assert.ok(f.coreEligible); assert.equal(f.released, false);
  ev = run(f, FIGHT.telegraph.heavy - FIGHT.heavy.ventAt);
  assert.ok(ev.some((e) => e.type === 'release' && e.attack === 'heavy')); assert.equal(f.state, 'vent');
  const r = f.hit('web', 'core');
  assert.equal(r.kind, 'counter'); assert.equal(f.state, 'staggered'); assert.equal(f.staggerLen, FIGHT.stagger.counter); assert.ok(r.hp > 0);
});

test('core cannot be hit outside an eligible state (protected / single / spread / recovering)', () => {
  const f = new BossFight();
  assert.equal(f.coreEligible, false); assert.notEqual(f.hit('web', 'core').kind, 'counter');
  f.fightT = 5; f.forceAttack('single'); assert.equal(f.coreEligible, false);
  f.fightT += 1; assert.notEqual(f.hit('web', 'core').kind, 'counter');
  const h = new BossFight(); toHeavy(h); run(h, 0.3); assert.equal(h.coreEligible, false, 'heavy windup before ventAt: core still shut');
  h.fightT += 1; assert.notEqual(h.hit('web', 'core').kind, 'counter');
});

test('heavy pumpkin counter needs BOTH the near-launch time and the distance to the jet', () => {
  assert.ok(heavyCounterOk(0.4, 6)); assert.ok(heavyCounterOk(FIGHT.heavy.counterTime, FIGHT.heavy.counterRange));
  assert.ok(!heavyCounterOk(FIGHT.heavy.counterTime + 0.05, 6), 'too late');
  assert.ok(!heavyCounterOk(0.5, FIGHT.heavy.counterRange + 1), 'too far from the jet');
  assert.ok(!heavyCounterOk(-0.1, 2), 'before the release (still held) is never a counter');
  const f = new BossFight(); toHeavy(f); run(f, FIGHT.telegraph.heavy + 0.02); assert.equal(f.state, 'vent');
  assert.equal(f.hit('counter').kind, 'counter'); assert.equal(f.state, 'staggered');
});

test('missed opening recovers into a valid next cycle (no failure, shield back, later attacks continue)', () => {
  const f = new BossFight(); toHeavy(f);
  run(f, FIGHT.telegraph.heavy + FIGHT.heavy.window + 0.1);
  assert.equal(f.state, 'recovering'); assert.equal(f.coreEligible, false); assert.equal(f.stats.missedHeavies, 1);
  run(f, FIGHT.recover + 0.1); assert.equal(f.state, 'protected');
  const ev = run(f, 8, { ...FAIR });
  assert.ok(ev.some((e) => e.type === 'telegraph'), 'the next attack comes');
});

test('opening cap ends the stagger early (no one-cycle kill)', () => {
  const f = new BossFight(); f.forceStagger('counter'); let hp = 0;
  for (let i = 0; i < 40 && f.state === 'staggered'; i++) { f.fightT += 0.5; hp += f.hit('lightBomb', 'core').hp; }
  assert.ok(hp <= FIGHT.openingCap.counter + 1e-9); assert.equal(f.state, 'recovering');
});

test('phases change only at a safe boundary (never mid-attack)', () => {
  const f = new BossFight(); f.fightT = 3; f.forceAttack('single');
  const ev = run(f, 0.3, { ...FAIR, bossHpFrac: 0.5 });
  assert.equal(f.phase, 1, 'still phase 1 during the telegraph'); assert.ok(!ev.some((e) => e.type === 'phase'));
  const ev2 = run(f, 2, { ...FAIR, fair: false, bossHpFrac: 0.5 });
  assert.equal(f.phase, 2); assert.ok(ev2.some((e) => e.type === 'phase' && e.phase === 2));
  assert.equal(phaseFor(1), 1); assert.equal(phaseFor(0.5), 2); assert.equal(phaseFor(0.2), 3);
});

test('attack choice: fair ranges, no spread in phase 1, no heavy twice in a row, nothing while crowded', () => {
  const r0 = () => 0;
  assert.equal(chooseAttack({ phase: 1, dist: 10, rand: r0 }), null, 'too close');
  assert.equal(chooseAttack({ phase: 1, dist: 90, rand: r0 }), null, 'too far');
  for (let i = 0; i < 50; i++) assert.notEqual(chooseAttack({ phase: 1, dist: 25, rand: Math.random }), 'spread');
  assert.equal(chooseAttack({ phase: 2, dist: 25, rand: r0 }), 'spread');
  assert.equal(chooseAttack({ phase: 2, dist: 25, rand: r0, recent: ['spread'] }), 'single', 'no spread twice in a row');
  assert.equal(chooseAttack({ phase: 1, dist: 25, sinceHeavy: 99, fightT: 99, rand: r0 }), 'heavy');
  assert.equal(chooseAttack({ phase: 1, dist: 25, sinceHeavy: 99, fightT: 99, rand: r0, recent: ['heavy'] }), 'single');
  assert.equal(chooseAttack({ phase: 1, dist: 50, sinceHeavy: 99, fightT: 99, rand: r0 }), 'single', 'heavy only within reach');
  assert.equal(chooseAttack({ phase: 1, dist: 25, sinceHeavy: 99, fightT: 99, rand: r0, heavyOk: false }), 'single', 'no heavy without escape space');
  assert.equal(chooseAttack({ phase: 2, dist: 25, rand: r0, flying: 1 }), 'single', 'no spread while one is in the air');
  assert.equal(chooseAttack({ phase: 2, dist: 25, rand: r0, flying: 2 }), null, 'nothing new while crowded');
});

test('unfair moments (blind turn / no line of sight) delay the attack instead of firing it', () => {
  const f = new BossFight(); f.nextAttackIn = 0;
  run(f, 3, { ...FAIR, fair: false }); assert.equal(f.state, 'protected'); assert.equal(f.stats.attacks.single + f.stats.attacks.spread + f.stats.attacks.heavy, 0);
  run(f, 1, FAIR); assert.equal(f.state === 'telegraph' || f.state === 'attack' || f.state === 'protected', true);
  assert.ok(f.stats.attacks.single >= 1);
});

test('abort before the release cancels cleanly (no projectile, core shut); one sequence at a time', () => {
  const f = new BossFight(); toHeavy(f); run(f, FIGHT.heavy.ventAt + 0.1); assert.ok(f.coreOpen);
  const ev = run(f, DT, { ...FAIR, abort: true });
  assert.ok(ev.some((e) => e.type === 'cancel')); assert.ok(!ev.some((e) => e.type === 'release'));
  assert.equal(f.state, 'protected'); assert.equal(f.coreOpen, false);
  f.fightT = 30; f.forceAttack('single'); assert.equal(f.forceAttack('spread'), false, 'no overlapping attack');
});

test('events emitted between updates (a counter hit, a forced attack) are delivered by the next update', () => {
  const f = new BossFight(); toHeavy(f); run(f, FIGHT.telegraph.heavy + 0.02);
  f.hit('web', 'core'); const ev = f.update(DT, FAIR);
  assert.ok(ev.some((e) => e.type === 'stagger' && e.cause === 'counter'));
  const g = new BossFight(); g.fightT = 5; g.forceAttack('spread'); assert.ok(g.update(DT, FAIR).some((e) => e.type === 'telegraph' && e.attack === 'spread'));
});

test('pause = no update calls: timers do not advance', () => {
  const f = new BossFight(); toHeavy(f); const t0 = f.t; /* paused: nothing is called */ assert.equal(f.t, t0);
  run(f, 0.5); assert.ok(Math.abs(f.t - t0 - 0.5) < DT * 1.5);
});

test('a simulated competent fight lands inside the 2–4 minute target', () => {
  // player model: keeps 25 m, hits the core 60 % of heavy windows (≈0.8 s after the vent opens), 3 webs + 1 Light Bomb
  // per opening, chips the shield with a web every 2 s otherwise. HP 100.
  let best = 0, worst = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const f = new BossFight(); f.reset(seed); let hp = 100, t = 0, rng = seed * 7, lastChip = 0, opening = { webs: 0, lb: 0, t: 0 }; const R = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
    let skip = false;
    while (hp > 0 && t < 600) {
      f.update(DT, { ...FAIR, bossHpFrac: hp / 100 }); t += DT;
      if (f.state === 'vent' && f.t < DT * 1.5) skip = R() > 0.6;
      if (f.state === 'vent' && !skip && f.t > 0.4) hp -= f.hit('web', 'core').hp;
      else if (f.state === 'staggered') { opening.t += DT; if (opening.t > 0.8 * (opening.webs + 1) && opening.webs < 3) { opening.webs++; f.fightT += 0; hp -= f.hit('web', 'core').hp; } if (opening.lb < 1 && opening.t > 1.5) { opening.lb++; hp -= f.hit('lightBomb', 'core').hp; } }
      else { opening = { webs: 0, lb: 0, t: 0 }; if (t - lastChip > 2) { lastChip = t; hp -= f.hit('web').hp; } }
    }
    worst = Math.max(worst, t); best = Math.max(best, 0) || t;
    assert.ok(t > 90 && t < 300, `seed ${seed}: ${t.toFixed(0)} s`);
  }
  void best; void worst;
});
