// v0.46 close combat: the three retargeted Mixamo clips (taunt, headHit, bodyHit) baked into the Green Maniac GLB.
// Plain Node GLB parsing (JSON chunk + BIN chunk), no three.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const glb = readFileSync(new URL('../public/models/green_maniac_mixamo_tail.glb', import.meta.url));
const jsonLen = glb.readUInt32LE(12);
const J = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen;
const BIN = glb.subarray(binOff + 8, binOff + 8 + glb.readUInt32LE(binOff));
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** The raw bytes of a float accessor (tightly packed in every animation accessor of this file). */
const accBytes = (i) => {
  const a = J.accessors[i], bv = J.bufferViews[a.bufferView];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  return BIN.subarray(off, off + a.count * NC[a.type] * 4);
};
const accFloats = (i) => { const b = accBytes(i); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const anim = (name) => J.animations.find((a) => a.name === name);
const dur = (name) => { const a = anim(name); return Math.max(...a.samplers.map((s) => J.accessors[s.input].max[0])); };
const targets = (name) => anim(name).channels.map((c) => J.nodes[c.target.node].name);
const hipsRange = (name) => {
  const a = anim(name), c = a.channels.find((ch) => ch.target.path === 'translation' && /Hips$/.test(J.nodes[ch.target.node].name));
  const v = accFloats(a.samplers[c.sampler].output), r = { x: [Infinity, -Infinity], z: [Infinity, -Infinity] };
  for (let i = 0; i < v.length; i += 3) { r.x = [Math.min(r.x[0], v[i]), Math.max(r.x[1], v[i])]; r.z = [Math.min(r.z[0], v[i + 2]), Math.max(r.z[1], v[i + 2])]; }
  return { x: r.x[1] - r.x[0], z: r.z[1] - r.z[0] }; // metres (the Armature node has an identity transform)
};
const animHash = (a) => {
  const h = createHash('sha256');
  h.update(JSON.stringify({ channels: a.channels, samplers: a.samplers }));
  for (const s of a.samplers) { h.update(accBytes(s.input)); h.update(accBytes(s.output)); }
  return h.digest('hex');
};
const NEW = ['taunt', 'headHit', 'bodyHit'];

// sha256 of the animation's channels / samplers JSON + every sampler's input and output accessor bytes, recorded from the v0.45 file (commit 69324e3)
const V045 = {
  wait: '36914d24c3ffc483f8d8b97334219e6d9c4d9162a54e2cb0c258c5433a546971',
  surf: '7be741c27117425c804016da04228a1ebf8fbac712938456bf87284e77fd5cb4',
  throw: 'd3f53feac2a2cfbf1409402e616dc5299551d21d3ac9528992d1aef8565ebdb9',
  turn: '071c052e7d9529b73316d321b7c7172e660893ed753233635d9606822f1694b2',
  stretch: 'f446f5b68ff43abb240ad607968ec6110f944dd685df93438459328239b9f8f4',
  fall: '6c392f456e4c054f7c539b7ec84fb2d166f5f27e407c5fe71e34d89d190ffae2',
  dance: 'fcb9c299bf94f2e70db2f4007fc19cf34c96977d58a557b5c33d312327b28707',
  angry: 'a564296805767dc72feff0bf487d363d96caa2742abd04b52cefee0d36a11491',
  getup: 'd7179f186f6d1b353ed7597aaefc9e48f808d76f4636c4ede139cf96728ebc3c',
};

test('the GLB has the three close-combat clips', () => { for (const n of NEW) assert.ok(anim(n), n); });

test('durations: taunt 2.83 s, headHit 1.43 s, bodyHit 1.17 s (±0.05)', () => {
  assert.ok(Math.abs(dur('taunt') - 2.83) < 0.05, `taunt ${dur('taunt')}`);
  assert.ok(Math.abs(dur('headHit') - 1.43) < 0.05, `headHit ${dur('headHit')}`);
  assert.ok(Math.abs(dur('bodyHit') - 1.17) < 0.05, `bodyHit ${dur('bodyHit')}`);
});

test('new clips animate only mixamorig bones, never the tail', () => {
  for (const n of NEW) for (const t of targets(n)) assert.match(t, /^mixamorig/);
});

test('new clips animate the same bones as the existing clips', () => {
  const key = (name) => anim(name).channels.map((c) => `${J.nodes[c.target.node].name}.${c.target.path}`).sort().join();
  for (const n of NEW) assert.equal(key(n), key('getup'), n);
});

test('hips stay on the jet: horizontal range under 2 cm in every new clip', () => {
  for (const n of NEW) { const r = hipsRange(n); assert.ok(r.x < 0.02 && r.z < 0.02, `${n} ${JSON.stringify(r)}`); }
});

test('every pre-existing clip is byte-identical to the v0.45 file', () => {
  for (const [name, hash] of Object.entries(V045)) { assert.ok(anim(name), name); assert.equal(animHash(anim(name)), hash, name); }
});

test('all rotation keys are unit quaternions and finite', () => {
  for (const n of NEW) {
    const a = anim(n);
    for (const c of a.channels) {
      const v = accFloats(a.samplers[c.sampler].output);
      for (const x of v) assert.ok(Number.isFinite(x), `${n} non-finite`);
      if (c.target.path !== 'rotation') continue;
      for (let i = 0; i < v.length; i += 4) assert.ok(Math.abs(Math.hypot(v[i], v[i + 1], v[i + 2], v[i + 3]) - 1) < 1e-3, `${n} ${J.nodes[c.target.node].name}`);
    }
  }
});
