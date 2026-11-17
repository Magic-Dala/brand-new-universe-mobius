// World Chase route generator (v0.40) — authored, validated route MODULES assembled procedurally. Pure JS (no
// three.js): the streaming world (chaseWorld.js), the renderer (worldRenderer.js) and the unit tests all use it.
//
// A module is a piece of corridor in its own frame: u = metres along the route (0..L), v = metres to the right of
// the centre line, y = height. Module types (authored templates): straight, gentle turns (≤ 30°), rise / descend
// (±12 m), high bridge (swing under), low bridge (swing over / land), gate (opening at flight height), high / low
// branch (an obstacle with a route above and one below that reconnect), landmark set pieces, recovery (calm, low,
// platforms) and the start (safe platform). Each module defines: entry / exit frame (position, heading, height),
// the free corridor (halfW), structures (+ collision tiers), fixed anchors on those structures, coin patterns along
// valid swing arcs, the enemy flight path (= the centre line + bossDy), safe recovery points and its type, which the
// sequence grammar uses to pick compatible neighbours (no two demanding modules in a row, recovery after hard
// sections, heading kept within ±40° of the start, heights inside the map's range).
// Validation (validateModule) runs on every generated module: corridor clear, anchors reachable from the centre
// line with the real reach / rope limits, attached to their structure, coins outside geometry.
import { mulberry32, hash2 } from '../data/box.js';
import { MAPS } from './maps.js';

export const ROUTE_CFG = {
  anchorReach: 58, // m: anchors must stay within this of the centre line points they serve (settings.anchorMaxDist = 60)
  maxAnchorGap: 19, // m along the route between consecutive anchors (both sides together)
  minSideSpacing: 8, // m between anchors on the same side
  anchorMinAbove: 6, // m above the flight path
  anchorOut: 0.35, // m in front of the face
  bridgeClear: 1.6, // anchors within ±16 m of a high bridge / gate stay this far below its underside
  coinClear: 1.4,
  bossDy: 5.5,
  maxHeading: 0.7, // rad from the start heading
};

const TEMPL = {
  start: { L: [70, 70], turn: 0, dy: 0 },
  straight: { L: [64, 80], turn: 0, dy: 0 },
  turnL: { L: [80, 92], turn: -0.5, dy: 0, demanding: true },
  turnR: { L: [80, 92], turn: 0.5, dy: 0, demanding: true },
  rise: { L: [72, 84], turn: 0, dy: 12 },
  descend: { L: [72, 84], turn: 0, dy: -12 },
  bridgeHigh: { L: [66, 78], turn: 0, dy: 0 },
  bridgeLow: { L: [66, 78], turn: 0, dy: 0, demanding: true },
  gate: { L: [72, 80], turn: 0, dy: 0, demanding: true },
  branch: { L: [104, 112], turn: 0, dy: 0, demanding: true },
  landmark: { L: [112, 126], turn: 0, dy: 0, demanding: true },
  recovery: { L: [58, 66], turn: 0, dy: 0 },
};
export const DEMANDING = new Set(Object.entries(TEMPL).filter(([, v]) => v.demanding).map(([k]) => k));
const CALM_NEXT = ['straight', 'recovery', 'rise', 'descend', 'bridgeHigh'];

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;

/** Position / heading of the centre line at u (module frame). heading a: forward = (sin a, −cos a), right = (cos a, sin a). */
export function frameAt(m, u, out = {}) {
  const a = m.a0 + m.k * u;
  if (Math.abs(m.k) < 1e-7) { out.x = m.x0 + Math.sin(m.a0) * u; out.z = m.z0 - Math.cos(m.a0) * u; }
  else { const r = 1 / m.k; out.x = m.x0 + r * (Math.cos(m.a0) - Math.cos(a)); out.z = m.z0 + r * (Math.sin(m.a0) - Math.sin(a)); }
  out.a = a; return out;
}
/** Module frame (u, v) → world xz. */
export function toWorld(m, u, v, out = [0, 0]) {
  const f = frameAt(m, u, _f); out[0] = f.x + Math.cos(f.a) * v; out[1] = f.z + Math.sin(f.a) * v; return out;
}
const _f = {};
/** Flight height along the module (entry → exit smoothstep + the branch hump). */
export function pathY(m, u) { return baseY(m, u) + bumpY(m, u); }
export function baseY(m, u) { return lerp(m.yIn, m.yOut, smooth(u / m.L)); }
export function bumpY(m, u) { const b = m.bump; if (!b) return 0; return b.h * smooth((u - (b.u0 - b.ramp)) / b.ramp) * (1 - smooth((u - b.u1) / b.ramp)); }

export class RouteGen {
  /** @param map an entry of MAPS (or its id) */
  constructor(map, seed = 1) {
    this.map = typeof map === 'string' ? MAPS.find((x) => x.id === map) : map;
    this.P = this.map.gen; this.seed = seed >>> 0;
    this.modules = []; this.lastOf = {};
  }
  rng(idx, salt = 0) { return mulberry32((Math.floor(hash2(this.seed ^ salt, idx * 7919 + 13) * 4294967296) | 0) || 1); }
  /** Make sure modules 0..n exist (generated in order). */
  ensure(n) { while (this.modules.length <= n) this._next(); return this.modules; }
  _pick(idx, prev) {
    const P = this.P, r = this.rng(idx, 0x7a11);
    if (idx === 0) return 'start';
    if (idx <= 2) return 'straight';
    const last = (k) => idx - (this.lastOf[k] ?? -99);
    if (last('recovery') >= 8) return 'recovery';
    const allowed = { ...P.weights };
    if (DEMANDING.has(prev.type)) for (const k of Object.keys(allowed)) if (!CALM_NEXT.includes(k)) allowed[k] = 0;
    const rel = prev.a0 + prev.k * prev.L - this.modules[0].a0;
    if (rel > ROUTE_CFG.maxHeading - 0.5) allowed.turnR = 0;
    if (rel < -(ROUTE_CFG.maxHeading - 0.5)) allowed.turnL = 0;
    if (rel > 0.15) allowed.turnL *= 2.2; else if (rel < -0.15) allowed.turnR *= 2.2; // drift back toward the main direction
    const y = prev.yOut;
    if (y + 12 > P.yRange[1]) allowed.rise = 0;
    if (y - 12 < P.yRange[0]) allowed.descend = 0;
    if (last('landmark') < 7) allowed.landmark = 0;
    if (last('branch') < 5) allowed.branch = 0;
    if (last('gate') < 4) allowed.gate = 0;
    if (last('recovery') < 4) allowed.recovery = 0;
    if (prev.type === 'rise' || prev.type === 'descend') { allowed.rise = 0; allowed.descend = 0; }
    let tot = 0; for (const v of Object.values(allowed)) tot += v;
    let x = r() * tot;
    for (const [k, v] of Object.entries(allowed)) { x -= v; if (x <= 0 && v > 0) return k; }
    return 'straight';
  }
  _next() {
    const idx = this.modules.length, prev = this.modules[idx - 1];
    const type = this._pick(idx, prev);
    const T = TEMPL[type], r = this.rng(idx, 0x51);
    const L = Math.round(lerp(T.L[0], T.L[1], r()));
    let x0 = 0, z0 = 0, a0 = 0, yIn = this.P.yBase;
    if (prev) { const f = frameAt(prev, prev.L); x0 = f.x; z0 = f.z; a0 = f.a; yIn = prev.yOut; }
    const m = { idx, type, L, x0, z0, a0, k: T.turn / L, yIn, yOut: yIn + T.dy, halfW: this.P.halfW, mapId: this.map.id, seed: Math.floor(r() * 1e9), structures: [], anchors: [], coins: [], checkpoints: [], bump: null };
    m.s0 = prev ? prev.s1 : 0; m.s1 = m.s0 + L;
    buildModule(m, this.P, r);
    this.lastOf[type] = idx;
    this.modules.push(m);
    return m;
  }
}

// =============================================================================================== module content
function buildModule(m, P, r) {
  const rand = (a, b) => lerp(a, b, r());
  const pick = (list) => { let tot = 0; for (const [, w] of list) tot += w; let x = r() * tot; for (const [k, w] of list) { x -= w; if (x <= 0) return k; } return list[0][0]; };
  let sid = 0;
  const S = (o) => { const s = { id: `${m.idx}:${sid++}`, seed: Math.floor(r() * 1e9), tiers: null, ...o }; if (!s.tiers) s.tiers = [{ y0: s.y0 ?? 0, y1: s.h, w: s.w, d: s.d, du: 0, dv: 0 }]; m.structures.push(s); return s; };
  const type = m.type, halfW = m.halfW;
  // ---- set pieces first (they constrain heights / anchors around them)
  const spans = []; // high crossings: { u, y0 } — anchors near them stay below
  if (type === 'branch') {
    const uc = m.L / 2, len = 24;
    m.bump = { u0: uc - len / 2 - 4, u1: uc + len / 2 + 4, ramp: 22, h: 13 };
    const yb = baseY(m, uc);
    m.obstacle = S({ role: 'obstacle', kind: 'obstacle', u: uc, v: 0, w: len, d: 2 * (halfW + 5), y0: yb - 4, h: yb + 5 });
    m.lowPath = { u0: m.bump.u0 - m.bump.ramp, u1: m.bump.u1 + m.bump.ramp, dy: -12 };
    m.checkpoints.push({ u: uc, v: 0, y: yb + 5, sid: m.obstacle.id, kind: 'roof' });
  }
  if (type === 'bridgeHigh' || type === 'gate') {
    const u = m.L * rand(0.45, 0.6), y = pathY(m, u);
    if (type === 'bridgeHigh') {
      const b = S({ role: 'bridge', kind: 'bridgeHigh', u, v: 0, w: rand(5, 7), d: 2 * (halfW + 5), y0: y + 9.5, h: y + 9.5 + (P.bridgeTh ?? 3.5) });
      spans.push({ u, y0: b.y0, w: b.w });
    } else {
      const g = S({ role: 'gate', kind: 'gate', u, v: 0, w: 10, d: 2 * (halfW + 6), y0: y + 10.5, h: y + 26,
        tiers: [{ y0: y + 10.5, y1: y + 26, w: 10, d: 2 * (halfW + 6), du: 0, dv: 0 }, { y0: 0, y1: y - 11, w: 10, d: 2 * (halfW + 6), du: 0, dv: 0 }] });
      spans.push({ u, y0: g.y0, w: 10 }); m.gate = g;
    }
  }
  if (type === 'bridgeLow') {
    const u = m.L * rand(0.45, 0.6), y = pathY(m, u);
    const b = S({ role: 'bridge', kind: 'bridgeLow', u, v: 0, w: rand(6, 8), d: 2 * (halfW + 5), y0: y - 8 - (P.bridgeTh ?? 3.5), h: y - 8 });
    m.checkpoints.push({ u, v: rand(-0.4, 0.4) * halfW, y: b.h, sid: b.id, kind: 'roof' });
  }
  if (type === 'landmark') buildLandmark(m, P, r, S, spans);
  if (type === 'start') {
    const y = m.yIn;
    m.startPlatform = S({ role: 'platform', kind: 'startPlatform', u: 12, v: 0, w: 16, d: 2 * (halfW + 4), y0: y - 6.5, h: y - 2.5 });
    S({ role: 'closure', kind: 'closure', u: -7, v: 0, w: 10, d: 2 * (halfW + 26), h: y + rand(30, 48) });
    m.checkpoints.push({ u: 12, v: 0, y: y - 2.5, sid: m.startPlatform.id, kind: 'roof', start: true });
  }

  // ---- side walls: an inner row (the swing walls) and a sparser outer row (depth / parallax)
  const hAbove = type === 'recovery' ? [Math.max(8, P.hAbove[0] - 4), Math.min(32, P.hAbove[1])] : P.hAbove;
  const tallNeed = type === 'branch' ? 30 : type === 'gate' ? 28 : 0;
  const rows = { '-1': [], '1': [] };
  for (const side of [-1, 1]) {
    let u = rand(-3, 3) + (type === 'start' ? 2 : 0);
    while (u < m.L - 3) {
      let w = rand(P.w[0], P.w[1]), d = rand(P.d[0], P.d[1]);
      const vIn = halfW + rand(0, P.jitter);
      const vC = vIn + d / 2, scale = Math.max(0.6, 1 - side * vC * m.k); // world length per module-u at this lateral offset
      let uw = w / scale; if (u + uw > m.L + 1) { uw = m.L + 1 - u; w = uw * scale; if (w < 6) break; }
      const uc = u + uw / 2;
      let yMax = 0; for (let k = 0; k <= 4; k++) yMax = Math.max(yMax, pathY(m, u + (uw * k) / 4));
      const kind = pick(P.kinds);
      let h = baseY(m, uc) + Math.max(tallNeed, rand(hAbove[0], hAbove[1]));
      if (h < yMax + 10) h = yMax + 10 + rand(0, 6);
      const s = S({ role: 'inner', kind, side, u: uc, v: side * vC, w, d, h, uw });
      s.tiers = shapeTiers(s, P, r);
      if (P.roofAnchors?.setback) corridorSetback(m, s, P.roofAnchors, r);
      rows[side].push(s);
      u += uw + rand(P.gap[0], P.gap[1]) / scale;
    }
    // outer row
    for (let u2 = rand(-4, 6); u2 < m.L; ) {
      const w = rand(P.w[0] * 1.1, P.w[1] * 1.4), d = rand(P.d[0], P.d[1] * 1.3);
      const vC = halfW + P.d[1] + P.jitter + rand(3, 8) + d / 2, scale = Math.max(0.5, 1 - side * vC * m.k), uw = w / scale;
      if (r() < P.outer) { const s = S({ role: 'outer', kind: pick(P.kinds), side, u: u2 + uw / 2, v: side * vC, w, d, h: baseY(m, u2) + rand(hAbove[0] * 0.6, hAbove[1] * 1.25) }); s.tiers = shapeTiers(s, P, r); }
      u2 += uw + rand(2, 10);
    }
  }
  // freestanding pillars (canyon): narrow the corridor a little, bridge the long crossings
  if (P.pillars && type !== 'start' && type !== 'branch' && type !== 'gate') {
    for (let u = rand(8, 20), side = r() < 0.5 ? -1 : 1; u < m.L - 8; u += rand(30, 42), side = -side) {
      if (r() > P.pillars) continue;
      if (spans.some((sp) => Math.abs(sp.u - u) < 12)) continue;
      const y = pathY(m, u), sz = rand(6, 8);
      const s = S({ role: 'pillar', kind: 'pillar', side, u, v: side * (halfW - 4.5), w: sz, d: sz, h: y + rand(10, 18) });
      s.tiers = [{ y0: 0, y1: s.h, w: sz, d: sz, du: 0, dv: 0 }];
      rows[side].push(s);
    }
  }
  // ---- recovery platforms (terraces / balconies / ledges at the corridor edge, a little below the flight path)
  const nPlat = type === 'recovery' ? 2 : type === 'bridgeLow' || type === 'branch' || type === 'start' ? 0 : 1;
  for (let k = 0; k < nPlat; k++) {
    const side = (m.idx + k) % 2 ? 1 : -1, row = rows[side].filter((s) => s.role === 'inner' && s.u > 10 && s.u < m.L - 10 && !spans.some((sp) => Math.abs(sp.u - s.u) < 18));
    if (!row.length) continue;
    const s = row[Math.floor(r() * row.length)];
    const y = pathY(m, s.u), top = y - rand(3, 5);
    // a lower terrace in front of a tall back part: the back keeps the wall continuous for swinging past it
    const back = Math.min(8, s.d * 0.45), front = s.d - back;
    s.platform = { front, top };
    s.tiers = [{ y0: 0, y1: top, w: s.w, d: front, du: 0, dv: -side * (back / 2) }, { y0: 0, y1: s.h, w: s.w, d: back, du: 0, dv: side * (front / 2) }];
    s.role = 'inner'; s.isPlatform = true; delete s.setback; // (the terrace tiers replace a corridor setback)
    m.checkpoints.push({ u: s.u, v: side * (Math.abs(s.v) - s.d / 2 + 2.2), y: top, sid: s.id, kind: 'roof' });
  }
  if (!m.checkpoints.length) { // every module keeps one safe spot: an air checkpoint on the centre line (thrusters on)
    m.checkpoints.push({ u: m.L / 2, v: 0, y: pathY(m, m.L / 2), sid: null, kind: 'air' });
  }

  // ---- anchors on the inner rows (front / back corners facing the corridor, mid-face on long walls)
  const RA = P.roofAnchors;
  const anchorOn = (s, uA, side, yLim = Infinity, yForce = null) => {
    const y = pathY(m, uA);
    let ya, edge = null;
    if (yForce != null) ya = yForce;
    else if (RA) { // roof / setback edge first, else a moderately high transition anchor on the wall
      edge = roofEdge(m, s, uA, side, y, RA, rand);
      ya = Math.min(edge ? edge.y : Math.min(y + rand(RA.fallbackDy[0], RA.fallbackDy[1]), topAt(s) - 1.4), yLim);
    } else ya = Math.min(y + rand(P.anchorDy[0], P.anchorDy[1]), topAt(s) - 1.4, yLim);
    if (yForce == null) {
      for (const sp of spans) if (Math.abs(sp.u - uA) < 16) ya = Math.min(ya, sp.y0 - ROUTE_CFG.bridgeClear);
      if (type === 'branch' && m.bump && uA > m.bump.u0 - m.bump.ramp && uA < m.bump.u1 + m.bump.ramp) ya = Math.max(ya, Math.min(topAt(s) - 1.4, y + 6 + rand(0, 4)));
      if (ya < y + ROUTE_CFG.anchorMinAbove - 0.01 && !(type === 'branch')) return null;
      if (ya < y + 3) return null;
    }
    const t = tierAt(s, ya); if (!t) return null;
    // stay on the tier that carries it (narrow trunks / setbacks): along position clamped onto that tier's face
    const scale = Math.max(0.6, 1 - (s.v + t.dv) * m.k), half = (t.w / scale) / 2, uc = s.u + (t.du || 0);
    if (half < 1) return null;
    uA = Math.max(uc - half + Math.min(1.2, half * 0.5), Math.min(uc + half - Math.min(1.2, half * 0.5), uA));
    const face = Math.abs(s.v) + side * t.dv - t.d / 2;
    const a = { id: `${s.id}:a${m.anchors.length}`, sid: s.id, u: uA, v: side * (face - ROUTE_CFG.anchorOut), y: ya, side, kind: s.role, low: yForce != null };
    if (RA && yForce == null) { a.edgeGap = t.y1 - ya; a.roof = !!edge && ya === edge.y && t === edge.t; } // (stats / tests)
    m.anchors.push(a); return a;
  };
  for (const side of [-1, 1]) {
    let lastU = -1e9, flip = (m.idx + (side > 0 ? 1 : 0)) % 2;
    for (const s of rows[side].sort((a, b) => a.u - b.u)) {
      const uw = s.uw ?? s.w;
      const cands = s.role === 'pillar' ? [s.u] : uw > 20 ? [s.u - uw / 2 + 1.4, s.u, s.u + uw / 2 - 1.4] : flip ? [s.u + uw / 2 - 1.4, s.u - uw / 2 + 1.4] : [s.u - uw / 2 + 1.4, s.u + uw / 2 - 1.4];
      flip ^= 1;
      for (const uA of cands) {
        if (uA < 2 || uA > m.L - 1 || uA - lastU < ROUTE_CFG.minSideSpacing) continue;
        if (s.isPlatform && Math.abs(uA - s.u) < uw / 2 - 1) continue;
        if (anchorOn(s, uA, side)) { lastU = uA; if (uw <= 20 && s.role !== 'pillar') break; }
      }
    }
  }
  // escape anchors (walkable floors): low on the walls so a player who reaches the street can web back up
  if (!P.lethalFloor) for (const side of [-1, 1]) {
    let lastU = -1e9;
    for (const s of rows[side].filter((x) => x.role === 'inner' && x.h > 26).sort((a, b) => a.u - b.u)) {
      if (s.u - lastU < 22) continue;
      // Consume the same random sample as before so the rest of the module stays deterministic.
      const oldY = rand(15, 21), recovery = P.streetRecovery;
      const targetY = recovery ? Math.min(topAt(s) - 3,
        Math.max(recovery.range[0], Math.min(recovery.range[1], topAt(s) * lerp(recovery.fraction[0], recovery.fraction[1], (oldY - 15) / 6)))) : oldY;
      if (anchorOn(s, s.u, side, Infinity, targetY)) lastU = s.u;
    }
  }
  // anchors on set pieces: high bridge / gate undersides, the branch obstacle underside (low route)
  for (const s of m.structures) {
    if (s.role === 'bridge' && s.kind === 'bridgeHigh') for (const v of [-0.5, 0.5]) m.anchors.push({ id: `${s.id}:u${v}`, sid: s.id, u: s.u, v: v * halfW, y: s.y0 - 0.45, side: 0, kind: 'under' });
    if (s.role === 'gate') for (const v of [-0.45, 0.45]) m.anchors.push({ id: `${s.id}:u${v}`, sid: s.id, u: s.u, v: v * halfW, y: s.y0 - 0.45, side: 0, kind: 'under' });
    if (s.role === 'obstacle') for (const du of [-8, 8]) for (const v of [-0.45, 0.45]) m.anchors.push({ id: `${s.id}:u${du}${v}`, sid: s.id, u: s.u + du, v: v * halfW, y: s.y0 - 0.45, side: 0, kind: 'under', low: true });
    if (s.role === 'landmarkSpan') for (const v of [-0.4, 0, 0.4]) m.anchors.push({ id: `${s.id}:u${v}`, sid: s.id, u: s.u, v: v * halfW, y: s.y0 - 0.45, side: 0, kind: 'under' });
  }
  // fill gaps: a mid-face anchor on whichever inner structure covers the middle of a too-long gap
  for (let pass = 0; pass < 3; pass++) {
    const list = m.anchors.filter((a) => !a.low).sort((a, b) => a.u - b.u);
    let fixed = false;
    for (let i = -1; i < list.length; i++) {
      const ua = i < 0 ? (m.type === 'start' ? 14 : -4) : list[i].u, ub = i + 1 < list.length ? list[i + 1].u : m.L + 6;
      if (ub - ua <= ROUTE_CFG.maxAnchorGap) continue;
      const um = (ua + ub) / 2;
      for (const side of [1, -1]) {
        const s = rows[side].find((x) => Math.abs(x.u - um) < (x.uw ?? x.w) / 2 - 1 && !x.isPlatform);
        if (s && anchorOn(s, um, side)) { fixed = true; break; }
      }
      if (fixed) break;
    }
    if (!fixed) break;
  }
  m.anchors.sort((a, b) => a.u - b.u);

  // ---- coins: arcs along the swings (between consecutive anchors on opposite sides), release groups, bonus trails
  let ck = 0;
  const coin = (u, v, y, tag) => m.coins.push({ id: `${m.idx}:c${ck++}`, u, v, y, tag });
  const wallA = m.anchors.filter((a) => a.side !== 0 && !a.low);
  const plan = (m.idx * 7 + 3) % 3; // which swings get a trail (varies module to module)
  for (let i = 0; i + 1 < wallA.length; i++) {
    const a = wallA[i], b = wallA[i + 1];
    if ((i + plan) % 3 !== 0 || a.side === b.side || b.u - a.u < 10 || m.type === 'start' && a.u < 22) continue;
    const n = 5;
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n, u = lerp(a.u + 2, b.u + 6, t), y = pathY(m, u) - 4.5 * Math.sin(Math.PI * t) - 1.0;
      coin(u, lerp(a.v, b.v, t) * 0.35, y, 'arc');
    }
  }
  if (m.type === 'branch' && m.bump) {
    for (let j = 0; j < 6; j++) { const u = lerp(m.bump.u0, m.bump.u1, j / 5); coin(u, 0, pathY(m, u) + 1.5, 'bonusHigh'); }
    for (let j = 0; j < 4; j++) { const u = lerp(m.bump.u0 + 4, m.bump.u1 - 4, j / 3); coin(u, (j % 2 ? 0.25 : -0.25) * halfW, m.obstacle.y0 - 7, 'low'); }
  }
  if (m.type === 'recovery' || m.type === 'straight') { // small group near a natural release (rising out of a swing)
    const u = m.L * rand(0.55, 0.8), y = pathY(m, u) + 2.5;
    for (let j = 0; j < 3; j++) coin(u + j * 2.6, (j - 1) * 1.6, y + j * 0.6, 'release');
  }
  if (m.type === 'landmark' || (m.type === 'rise' && r() < 0.6)) { // elevated bonus trail
    const u0 = m.L * rand(0.25, 0.4);
    for (let j = 0; j < 5; j++) { const u = u0 + j * 5; coin(u, Math.sin(j * 0.9) * 3, pathY(m, u) + 6 + j * 0.8, 'bonus'); }
  }
  if (r() < 0.45) { // optional side path: three coins along a long inner wall (wall-run line), reconnects with the chase
    const side = r() < 0.5 ? -1 : 1;
    const s = rows[side].find((x) => x.role === 'inner' && !x.isPlatform && (x.uw ?? x.w) > 15 && x.h > pathY(m, x.u) + 8);
    if (s) { const face = faceAt(s, pathY(m, s.u) - 1.5); for (let j = -1; j <= 1; j++) coin(s.u + j * 3.4, side * (face - 1.3), pathY(m, s.u) - 1.5, 'wall'); }
  }
  // never inside geometry: drop coins that touch any structure of this module (neighbours are checked in the world)
  m.coins = m.coins.filter((c) => !blockedLocal(m, c.u, c.v, c.y, ROUTE_CFG.coinClear));
  // Independent scenic stream: preserve the established ground layout, anchors and route RNG.
  if (m.mapId === 'foldscape') populateFoldDistrict(m, S);
  if (P.forestDecor) populateForest(m, S, P.forestDecor);
}

/**
 * Forest of Shadow Ruins (gen.forestDecor): the user's Tripo hero models as real, colliding set dressing, plus root
 * collision under the giant trees. Runs AFTER anchors / coins with its own RNG stream, so the corridor, the anchors and
 * every earlier random draw are exactly those of the pre-upgrade route. Everything added sits on the ground / terraces
 * at least `clear` m below the flight path (never in the swing space); coins are re-checked against it.
 *   tree.roots: 'hero' (Tripo buttress stump) | 'kit' (Blender plank roots); inner trees get a low root tier.
 *   decor structures (role 'decor'): heroStatue / heroAltar / heroRuin on stone plinths, at the corridor edge.
 */
export const HERO_DIMS = { // unit-normalised source bounds (forest_kit.json heroes.*.bounds): width x, height y, depth z
  hero_statue: [0.82, 1.0, 0.65], hero_altar: [1.0, 0.944, 0.5], hero_ruin: [0.97, 1.0, 0.59], hero_roots: [0.95, 0.444, 1.0],
};
function populateForest(m, S, F) {
  const r = mulberry32((m.seed ^ 0x666f7265) >>> 0), rand = (a, b) => lerp(a, b, r()), halfW = m.halfW;
  const busy = []; // u ranges taken by low spans (bridges, start platform, branch obstacle)
  for (const s of m.structures) if (s.role === 'bridge' || s.role === 'platform' || s.role === 'obstacle' || s.role === 'closure') busy.push([s.u - s.w / 2 - 9, s.u + s.w / 2 + 9]);
  const free = (u, half) => u - half > 2 && u + half < m.L - 2 && !busy.some(([a, b]) => u + half > a && u - half < b);
  const yLim = (u, half) => Math.min(pathY(m, u - half), pathY(m, u), pathY(m, u + half)) - F.clear;
  for (const s of m.structures) {
    if (s.kind !== 'tree') continue;
    s.roots = r() < (s.role === 'inner' ? F.heroRoots : F.heroRoots + 0.1) ? 'hero' : 'kit';
    if (s.role !== 'inner') continue;
    const t = s.tiers[0], R = t.d / 2; // collision for the dense part of the buttress (thin outer roots are visual only)
    s.tiers.push({ y0: 0, y1: R * F.rootH, w: t.w + R * F.rootPad * 2, d: t.d + R * F.rootPad * 2, du: t.du, dv: t.dv, roots: true });
  }
  // a hero on a stone plinth at the corridor edge (top of the hero ≤ path − clear); never in front of a wall anchor
  // (the low street-recovery anchors included) — tries a few positions around u
  const plinthHero = (hero, u0, side, H, yaw) => {
    const D = HERO_DIMS[hero], wx = D[0] * H / D[1], dz = D[2] * H / D[1];
    const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw)), along = wx * c + dz * sn, lat = wx * sn + dz * c; // footprint after the yaw
    const half = along / 2 + 1.2;
    const blocksAnchor = (u, top) => m.anchors.some((a) => (Math.sign(a.v) === side || a.side === 0) && Math.abs(a.u - u) < half + 2.5 && a.y < top + 3);
    const u = [0, 6, -6, 12, -12].map((d) => u0 + d).find((uu) => free(uu, half) && !blocksAnchor(uu, yLim(uu, half)));
    if (u == null) return null;
    const top = yLim(u, half), y = Math.min(F.maxPlinth ?? 1e9, top - H * D[1]); // hero base (= plinth top; lower is always safe)
    if (y < (F.minPlinth ?? 0)) return null;
    const v = side * (halfW - lat / 2 - 1.2);
    const tiers = [{ y0: 0, y1: Math.max(0.5, y), w: along + 2.4, d: lat + 2.4, du: 0, dv: 0 }, { y0: y, y1: y + H * D[1] * 0.92, w: along * 0.8, d: lat * 0.8, du: 0, dv: 0 }];
    return S({ role: 'decor', kind: hero === 'hero_statue' ? 'heroStatue' : hero === 'hero_altar' ? 'heroAltar' : 'heroRuin', hero, side, u, v, w: along + 2.4, d: lat + 2.4, y0: 0, h: y + H * D[1], tiers, heroY: y, heroH: H, heroYaw: yaw });
  };
  const type = m.type;
  if (type === 'start') { // the showcase seen from the start platform: guardian left, altar right, the wrapped ruin beyond
    plinthHero('hero_statue', 44, -1, F.statueH, 0.55);
    plinthHero('hero_altar', 56, 1, F.altarH, -0.5);
  } else if (type === 'recovery') { // shrines on the two terraces' banks: altar + guardian facing each other
    plinthHero('hero_altar', m.L * 0.35, -1, F.altarH, 0.5);
    plinthHero('hero_statue', m.L * 0.62, 1, F.statueH * 0.85, -0.6);
  } else if (type === 'landmark') { // guardians flanking the great arch
    plinthHero('hero_statue', m.L * 0.5 - 20, -1, F.statueH, 0.35);
    plinthHero('hero_statue', m.L * 0.5 - 20, 1, F.statueH, -0.35);
  }
  if (type !== 'branch' && type !== 'gate' && type !== 'start' && (r() < F.ruinChance || m.idx === 1)) { // a root-wrapped wall on the bank
    const side = m.idx === 1 ? -1 : (m.idx % 2) ? 1 : -1, u = m.idx === 1 ? 18 : rand(0.25, 0.75) * m.L; // (module 1: completes the start showcase)
    plinthHero('hero_ruin', u, side, rand(F.ruinH[0], F.ruinH[1]), side > 0 ? -Math.PI / 2 + 0.4 : Math.PI / 2 - 0.4);
  }
  m.coins = m.coins.filter((c) => !blockedLocal(m, c.u, c.v, c.y, ROUTE_CFG.coinClear));
}

/** Streamed overhead architecture: landmark clusters plus smaller recurring districts. */
export const FOLD_STYLES = ['brick', 'limestone', 'glass', 'deco', 'twin', 'garden'];
function populateFoldDistrict(m, S) {
  const landmark = m.type === 'landmark';
  // Retain the old landmark RNG consumption upstream, but replace its three identical boxes.
  if (landmark) m.structures = m.structures.filter((s) => s.kind !== 'foldBlock');
  if (!landmark && !(m.idx >= 3 && m.idx % 3 === 1 && ['straight', 'turnL', 'turnR', 'rise', 'descend'].includes(m.type))) return;
  const r = mulberry32((m.seed ^ 0x6f766572) >>> 0), rand = (a, b) => lerp(a, b, r());
  const count = landmark ? 8 : 3;
  for (let k = 0; k < count; k++) {
    const style = FOLD_STYLES[(m.idx + k) % FOLD_STYLES.length];
    const u = landmark ? 14 + (m.L - 28) * (Math.floor(k / 2) / 3) : 18 + (m.L - 36) * k / 2;
    const side = k % 2 ? 1 : -1, v = side * rand(8, landmark ? 27 : 22);
    const y0 = pathY(m, u) + rand(58, 72), h = y0 + rand(18, 34);
    const w = rand(13, 21), d = rand(16, 26);
    const tier = (y0, y1, sx = 1, sz = 1, dv = 0, du = 0) => ({ y0, y1, d: d * sx, w: w * sz, dv, du });
    let tiers = [tier(y0, h)];
    if (style === 'limestone' || style === 'deco') {
      const H = h - y0;
      tiers = [tier(y0, y0 + H * .3, .43, .43), tier(y0 + H * .3, y0 + H * .66, .7, .7), tier(y0 + H * .66, h)];
    } else if (style === 'twin') {
      tiers = [tier(y0, h, .38, 1, -d * .3), tier(y0 + 4, h, .38, 1, d * .3)];
    } else if (style === 'garden') {
      tiers = [tier(y0, h, .45, .45, -d * .26, -w * .25), tier(y0 + 8, h, .45, .45, d * .26, -w * .25), tier(y0 + 5, h, .85, .38, 0, w * .28)];
    }
    // A foundation shared by each group member: real collision, not a giant empty bounding cube.
    tiers.push({ y0: h, y1: h + 1.2, d: d + 3, w: w + 3, dv: 0, du: 0 });
    S({ role: 'overhead', kind: 'foldBlock', foldStyle: style, u, v, w, d, y0, h, tiers, seed: Math.floor(r() * 1e9) });
  }
}

/** Point (u, v, y) inside a structure tier of this module (module frame; along extent corrected for the curvature). */
export function blockedLocal(m, u, v, y, pad = 0) {
  for (const s of m.structures) for (const t of s.tiers) {
    if (y < t.y0 - pad || y > t.y1 + pad) continue;
    const vc = s.v + (t.dv || 0), scale = Math.max(0.5, 1 - vc * m.k);
    if (Math.abs(v - vc) <= t.d / 2 + pad && Math.abs(u - (s.u + (t.du || 0))) <= (t.w / scale) / 2 + pad) return true;
  }
  return false;
}

/** |v| of the structure's corridor face at height y (the tier covering y; tiers may be set back). */
export function faceAt(s, y) {
  const side = Math.sign(s.v) || 1; let best = Infinity;
  for (const t of s.tiers) if (y >= t.y0 - 0.01 && y <= t.y1 + 0.01) best = Math.min(best, Math.abs(s.v) + side * t.dv - t.d / 2);
  return best === Infinity ? Math.abs(s.v) - s.d / 2 : best;
}
/** The tier that covers height y (the outermost toward the corridor if several). */
function tierAt(s, y) { const side = Math.sign(s.v) || 1; let best = null, bf = Infinity; for (const t of s.tiers) if (y >= t.y0 - 0.01 && y <= t.y1 + 0.01) { const f = Math.abs(s.v) + side * t.dv - t.d / 2; if (f < bf) { bf = f; best = t; } } return best; }
/** Top of the structure (highest tier). */
function topAt(s) { let top = 0; for (const t of s.tiers) top = Math.max(top, t.y1); return top; }

/**
 * Roof-edge anchor (maps with gen.roofAnchors): the highest tier top (roof or setback terrace) whose corridor face
 * carries a point `below` m under its edge inside the band above the route, with a clear line from the centre line
 * (here and 14 m before it: where the player fires). Returns { y, t } or null (→ the caller's wall fallback).
 */
function roofEdge(m, s, uA, side, y, RA, rand) {
  const below = rand(RA.below[0], RA.below[1]);
  for (const t of [...s.tiers].sort((a, b) => b.y1 - a.y1)) {
    const e = t.y1 - below;
    if (e - y > RA.band[1] || e - y < Math.max(RA.band[0], ROUTE_CFG.anchorMinAbove)) continue;
    if (tierAt(s, e) !== t) continue; // that edge is not on the corridor-side surface at its height
    const scale = Math.max(0.6, 1 - (s.v + t.dv) * m.k), half = (t.w / scale) / 2, uc = s.u + (t.du || 0);
    if (half < 1) continue;
    const u = Math.max(uc - half + Math.min(1.2, half * 0.5), Math.min(uc + half - Math.min(1.2, half * 0.5), uA));
    const v = side * (Math.abs(s.v) + side * t.dv - t.d / 2 - ROUTE_CFG.anchorOut);
    if (!sightClear(m, u - 14, u, v, e) || !sightClear(m, u, u, v, e)) continue;
    return { y: e, t };
  }
  return null;
}
/** Straight line from the centre line at u0 to an anchor (u, v, y) misses every tier of the module (own building too). */
function sightClear(m, u0, u, v, y) {
  if (u0 < 0) u0 = 0;
  const y0 = pathY(m, u0), L = Math.hypot(u - u0, v, y - y0), n = Math.ceil(L);
  for (let i = 1; i < n; i++) {
    const f = i / n; if (L * (1 - f) < 1.2) break; // the last metre is the mount itself
    if (blockedLocal(m, u0 + (u - u0) * f, v * f, y0 + (y - y0) * f, 0.15)) return false;
  }
  return true;
}
/**
 * Inner tower whose roof is above the anchor band: (chance) a setback on the CORRIDOR side — a full-depth base up to
 * `at` m above the route (a terrace edge the rope can reach) and the tower above it stepped back `back` m. The corridor
 * only widens above the terrace, so the free corridor and the route validation are unaffected.
 */
function corridorSetback(m, s, RA, r) {
  const sb = RA.setback, y = pathY(m, s.u), top = s.h;
  if (top - y <= RA.band[1] + RA.below[1] || r() >= sb.chance) return;
  const h1 = y + lerp(sb.at[0], sb.at[1], r()), back = Math.min(s.d * 0.4, lerp(sb.back[0], sb.back[1], r()));
  if (h1 > top - 8) return;
  const side = s.side || 1;
  s.tiers = [{ y0: 0, y1: h1, w: s.w, d: s.d, du: 0, dv: 0 }, { y0: h1, y1: top, w: s.w, d: s.d - back, du: 0, dv: side * back / 2 }];
  s.setback = { y: h1, back };
}

/** Collision tiers (setbacks) per structure kind — kits draw inside these boxes (+ small decorations). */
function shapeTiers(s, P, r) {
  const T = [], rand = (a, b) => a + (b - a) * r(), side = s.side || 1;
  const k = s.kind;
  if (k === 'tree') { // trunk + flare (the canopy above is foliage: no collision)
    const trunk = Math.min(s.w, s.d) * rand(0.62, 0.78);
    T.push({ y0: 0, y1: s.h, w: trunk, d: trunk, du: 0, dv: -side * (s.d - trunk) * 0.35 });
    s.trunk = trunk; return T;
  }
  if (k === 'glass' || k === 'tower' || k === 'tower2' || k === 'limestone' || k === 'castle' || k === 'fortress' || k === 'palace' || k === 'timber') {
    if (s.h > 50 && r() < 0.55) { // one setback (only on the far side: the corridor face stays straight)
      const h1 = s.h * rand(0.62, 0.8), back = s.d * rand(0.18, 0.3);
      T.push({ y0: 0, y1: h1, w: s.w, d: s.d, du: 0, dv: 0 });
      T.push({ y0: h1, y1: s.h, w: s.w, d: s.d - back, du: 0, dv: -side * back / 2 });
      return T;
    }
  }
  T.push({ y0: s.y0 ?? 0, y1: s.h, w: s.w, d: s.d, du: 0, dv: 0 });
  return T;
}

function buildLandmark(m, P, r, S, spans) {
  const id = m.mapId, rand = (a, b) => a + (b - a) * r(), halfW = m.halfW, uc = m.L * 0.5, y = pathY(m, uc);
  const style = { foldscape: 'fold', forest: 'arch', redrock: 'arch', neon: 'tower', moonlit: 'tower', cloudpalace: 'gate', aurora: 'arch', molten: 'tower' }[id] || 'arch';
  m.landmark = { style, u: uc, y };
  if (style === 'arch') {
    const y0 = y + rand(24, 28), th = 8;
    const s = S({ role: 'landmarkSpan', kind: 'landmarkArch', u: uc, v: 0, w: 12, d: 2 * (halfW + 14), y0, h: y0 + th });
    spans.push({ u: uc, y0, w: 12 }); m.landmark.sid = s.id;
  } else if (style === 'gate') {
    const g = S({ role: 'gate', kind: 'grandGate', u: uc, v: 0, w: 14, d: 2 * (halfW + 8), y0: y + 12, h: y + 34,
      tiers: [{ y0: y + 12, y1: y + 34, w: 14, d: 2 * (halfW + 8), du: 0, dv: 0 }, { y0: 0, y1: y - 12, w: 14, d: 2 * (halfW + 8), du: 0, dv: 0 }] });
    spans.push({ u: uc, y0: g.y0, w: 14 }); m.gate = g; m.landmark.sid = g.id;
  } else if (style === 'fold') {
    // overhead: inverted city blocks hanging far above the street (the folded city), high enough never to block a swing
    for (let k = 0; k < 3; k++) {
      const u = uc + (k - 1) * 28, y0 = y + rand(46, 58);
      S({ role: 'overhead', kind: 'foldBlock', u, v: rand(-0.5, 0.5) * halfW, w: rand(16, 22), d: rand(22, 34), y0, h: y0 + rand(20, 34) });
    }
  } else { // tower: a giant tower beside the corridor (castle keep / furnace / hologram spire)
    const side = m.idx % 2 ? 1 : -1, d = 34, w = 30;
    const s = S({ role: 'landmarkTower', kind: 'landmarkTower', side, u: uc, v: side * (halfW + 2 + d / 2), w, d, h: y + rand(70, 90) });
    s.tiers = [{ y0: 0, y1: s.h, w, d, du: 0, dv: 0 }];
    m.landmark.sid = s.id; m.landmark.side = side; m.landmarkTower = s;
  }
}

// =============================================================================================== validation
/**
 * Validate a module against the real movement limits. `w` = a ChaseWorld-like object with the module instantiated
 * (collidersNear / segmentBlocked / pointBlocked). Returns { ok, problems[] }.
 */
export function validateModule(m, w, { step = 4, reach = ROUTE_CFG.anchorReach } = {}) {
  const problems = [];
  for (let u = m.type === 'start' ? 24 : 2; u < m.L - 1; u += step) {
    const [x, z] = toWorld(m, u, 0), y = pathY(m, u);
    if (w.pointBlocked(x, y, z, 2.5)) problems.push(`corridor blocked at u=${u.toFixed(0)}`);
    // an anchor ahead (or level) that can be reached and seen
    let ok = false;
    for (const a of w.anchorsNear(x, z, reach)) {
      const d = Math.hypot(a.p.x - x, a.p.y - y, a.p.z - z);
      if (d > reach || d < 5) continue;
      if (a.s < m.s0 + u - 6) continue;
      if (a.p.y < y + 2) continue;
      if (w.segmentBlocked(x, y, z, a.p.x, a.p.y, a.p.z, a.building)) continue;
      ok = true; break;
    }
    if (!ok) problems.push(`no reachable anchor ahead at u=${u.toFixed(0)}`);
  }
  for (const c of m.coins) { const [x, z] = toWorld(m, c.u, c.v); if (w.pointBlocked(x, c.y, z, 0.9)) problems.push(`coin ${c.id} inside geometry`); }
  return { ok: !problems.length, problems };
}
export { TEMPL as MODULE_TEMPLATES };
