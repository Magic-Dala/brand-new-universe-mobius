// World layout for Dala City / 達拉城 (v0.20) — the flat, modular, NYC-style swing city.
// Units: metres. three.js axes: +X east, +Y up, −Z north. Gravity = world −Y. No ring, no inverted
// deck, no shell: a normal single-level city streamed module by module (src/data/cityWorld.js).
//
// The fixed STORY ROUTE (src/data/route.js): home tower A (Mobius' window, north facade) → 5 straight
// blocks north → right turn (east) → the factory block; the abandoned factory C closes the avenue at
// the far end of that block (its roll-up door faces the factory exit module → endless route).
// Everything here is derived from the same module generator the streaming world uses, so the hand
// numbers below (window, factory roof, circle) always match what is built.
import { CITY_CFG } from './cityConfig.js';
import { STORY_TILES, transformOf, toWorldXZ, dirToWorld, moduleContent, modulePath, HOME_LOCAL, FACTORY_LOCAL } from './blocks.js';
import { RouteGen, FACTORY_TILE, EXIT_TILE } from './route.js';
import { boxToWorld } from './box.js';
import { cityWorld } from './cityWorld.js';

export const FLOOR_HEIGHT = 3.6; // home tower A (the room's floor numbering)
/** Elevation of the floor slab of storey `n` (1-based). */
export const floorElevation = (n) => (n - 1) * FLOOR_HEIGHT;

// ---------------------------------------------------------------- story route (static, pure)
const ROUTE_GEN = new RouteGen({ seed: CITY_CFG.seed, storySeed: CITY_CFG.storySeed });
const cellCenter0 = (i, j) => [i * CITY_CFG.cell, CITY_CFG.originZ + j * CITY_CFG.cell]; // origin cell (0, 0), no rebase in the story
export const STORY_ROUTE_TILES = ROUTE_GEN.tiles.slice(0, EXIT_TILE + 1).map((t) => ({ ...t, T: transformOf(...cellCenter0(...t.cell), t.heading) }));
const tileContent = (t) => moduleContent({ kind: t.kind, variant: t.variant, seed: t.seed, flyIn: t.fly.in, flyOut: t.fly.out, minH: t.minH, maxH: t.maxH, tag: t.tag });

function boxRecord(id, role, nameKey, T, L, extra) {
  const [x, z] = toWorldXZ(T, L.lx, L.lz);
  return { id, role, nameKey, x, z, yaw: T.yaw, cos: T.cos, sin: T.sin, w: L.hx * 2, d: L.hz * 2, hw: L.hx, hd: L.hz, h: L.h, y0: 0, y1: L.h, deck: 'L', ...extra };
}
const T0 = STORY_ROUTE_TILES[0].T, TF = STORY_ROUTE_TILES[FACTORY_TILE].T;
export const KEY_BUILDINGS = [
  boxRecord('A', 'home', 'place.homeTower', T0, HOME_LOCAL, { floors: 28, style: 'brick' }), // axis-aligned at the world origin
  boxRecord('C', 'factory', 'place.factory', TF, FACTORY_LOCAL, { floors: 6, style: 'industrial' }), // box −Z (door) faces the factory exit
];
export const getKey = (id) => KEY_BUILDINGS.find((b) => b.id === id);
export const HOME = KEY_BUILDINGS[0], FACTORY = KEY_BUILDINGS[1];

// ---------------------------------------------------------------- factory C (exterior, roof event) — C box frame
// x = box-X (right of the approach), z = box-Z (toward the approach side); y above the roof (C.h).
export const FACTORY_EXT = {
  roofCircle: { local: [-4, 9], radius: 1.5 }, // flat roof area on the approach half, ≥ 6 m from edges, away from equipment
  breach: { local: [-4, 9], hw: 3.4, hd: 3.4 }, // breakable roof section directly under the circle
  impact: { local: [-4, 9] }, // where the ONE bomb lands
  stack: { local: [7.5, 14], radius: 1.1, height: 20 }, // smokestack, anchor at the top
  monitor: { x0: 1.5, x1: 8.5, z0: -16.5, z1: -2, h: 2.6 }, // raised clerestory, warm high windows
  door: { face: 'north', x: 0, w: 7, h: 6 }, // roll-up loading door (box −Z face → the factory exit module)
  bossThrow: { local: [-4, -5], up: 9 },
  equipment: [
    { x0: 1.5, x1: 8.5, z0: -16.5, z1: -2 }, { x0: 9, x1: 11.6, z0: -12, z1: 8 }, { x0: 5.5, x1: 9.6, z0: 11.5, z1: 16.5 },
    { x0: -10, x1: -6, z0: -15, z1: -12 }, { x0: -2, x1: 1, z0: -16, z1: -13 },
  ],
};

// ---------------------------------------------------------------- Mobius home (room) — unchanged frame
// Inside home tower A (axis-aligned at the origin), floor 22, window on the NORTH facade (it looks over
// the first intersection and up the avenue). Room-local axes == world axes. Origin = floor centre.
const A = KEY_BUILDINGS[0];
export const ROOM = {
  floor: 22,
  origin: [6, floorElevation(22), A.z - A.d / 2 + 3], // north wall sits on the facade
  size: { w: 5, d: 6, h: 2.8 }, // x ∈ [-2.5,2.5], z ∈ [-3,3]
  window: { xMin: -1.7, xMax: 1.7, yMin: 0.75, yMax: 2.55, z: -3 },
  furniture: {
    bed: { center: [-1.45, 0, -1.55], size: [2.0, 0.55, 1.5], headboard: 'west' },
    nightstand: { center: [-2.15, 0, -2.62], size: [0.55, 0.6, 0.45] },
    musicPlayer: { pos: [-2.25, 0.62, -2.62] },
    policeRadio: { pos: [-2.0, 0.62, -2.62] },
    armorRack: { center: [2.0, 0, -2.25], size: [0.9, 2.35, 0.85], facing: 'west' },
    mirror: { center: [2.47, 1.05, -0.85], size: [0.75, 1.85], facing: 'west' },
    desk: { center: [2.12, 0, 1.15], size: [0.7, 0.76, 1.5], facing: 'east' },
    chair: { center: [1.45, 0, 1.15] },
    rug: { center: [0.1, 0, 0.7], size: [2.3, 3.0] },
    bookshelf: { center: [-2.32, 0, 0.75], size: [0.32, 1.6, 1.1] },
    door: { center: [-1.4, 0, 3], size: [0.95, 2.1] },
  },
  playerStart: { pos: [0.1, 0, 1.0], yaw: 0 }, // facing north (window)
  titleCamera: { pos: [-0.9, 1.45, 2.65], lookAt: [0.75, 1.25, -2.6] },
};
export const roomToWorld = (p) => [p[0] + ROOM.origin[0], p[1] + ROOM.origin[1], p[2] + ROOM.origin[2]];
export const ROOM_BLOCKERS = [
  { x: -1.45, z: -1.55, w: 2.0, d: 1.5 },
  { x: -2.15, z: -2.62, w: 0.55, d: 0.45 },
  { x: 2.0, z: -2.25, w: 0.9, d: 0.85 },
  { x: 2.12, z: 1.15, w: 0.7, d: 1.5 },
  { x: -2.32, z: 0.75, w: 0.32, d: 1.1 },
];

// ---------------------------------------------------------------- story route centre line (chase progress)
export const STORY_ROUTE = (() => {
  const pts = [];
  let sTurn = 0, turn = null, turnYaw = 0;
  STORY_ROUTE_TILES.slice(0, FACTORY_TILE + 1).forEach((t, k) => {
    const lp = modulePath(t.kind, t.exit, t.fly);
    lp.forEach(([x, y, z], q) => { if (k > 0 && q === 0) return; const [wx, wz] = toWorldXZ(t.T, x, z); pts.push([wx, y, wz]); });
    if (t.kind === 'turnR') { turn = toWorldXZ(t.T, 0, 0); turnYaw = t.T.yaw; }
  });
  const seg = []; let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    seg.push({ a: [a[0], a[2]], b: [b[0], b[2]], ya: a[1], yb: b[1], s0: s, len }); s += len;
  }
  // arc length at the turn intersection centre
  { let best = 1e9; for (const g of seg) { const d = Math.hypot(g.a[0] - turn[0], g.a[1] - turn[1]); if (d < best) { best = d; sTurn = g.s0; } } }
  const tileStart = []; { let acc = 0; STORY_ROUTE_TILES.slice(0, FACTORY_TILE + 1).forEach((t, k) => { tileStart.push(acc); const lp = modulePath(t.kind, t.exit, t.fly); for (let q = 1; q < lp.length; q++) acc += Math.hypot(lp[q][0] - lp[q - 1][0], lp[q][2] - lp[q - 1][2]); void k; }); }
  return { pts, seg, length: s, sTurn, turn, turnYaw, tileStart, flyHeight: pts[0][1], endHeight: KEY_BUILDINGS[1].h + 9 };
})();
/** Back-compat alias (chase / tests). */
export const ROUTE = STORY_ROUTE;

/** Respawn checkpoints of the story route (one per tile; the window first). Positions = feet, wall normal. */
export const CHECKPOINTS = (() => {
  const out = [{ id: 'cp-start', s: 0, room: true, tile: 0 }];
  STORY_ROUTE_TILES.slice(1, FACTORY_TILE).forEach((t) => {
    const c = tileContent(t).checkpoint; if (!c || !c.lp) return;
    const [x, z] = toWorldXZ(t.T, c.lp[0], c.lp[2]), [nx, nz] = dirToWorld(t.T, c.ln[0], c.ln[2]);
    out.push({ id: `cp-${t.tag}`, tile: t.idx, pos: [x, c.lp[1], z], normal: [nx, 0, nz], building: c.building, s: +STORY_ROUTE.tileStart[t.idx].toFixed(2) });
  });
  return out;
})();

/**
 * Fly-by right outside the window (across the first cross street), then up the avenue. v6: while the window is closed
 * Green Maniac rampages over the street (streetRampage.js); the fly-by starts from wherever he is when it opens
 * (chase.begin()), via ROOM_BOSS_HOVER if the direct leg is blocked.
 */
export const ROOM_BOSS_HOVER = [-2, 76.6, -33];
export const CHASE_FLYBY = [ROOM_BOSS_HOVER, [-10, 78.6, -23], [6, 77.8, -20.5], [24, 79.5, -27], [8, 84, -48], [2, 86, -74]];

const Cb = KEY_BUILDINGS[1];
const cPos = (ox, y, oz) => boxToWorld(Cb, ox, y, oz);
const exitT = STORY_ROUTE_TILES[EXIT_TILE].T;
export const STORY = {
  circle: { pos: cPos(FACTORY_EXT.roofCircle.local[0], Cb.h, FACTORY_EXT.roofCircle.local[1]), radius: FACTORY_EXT.roofCircle.radius }, // blue circle on the factory roof
  roofSpawn: { pos: cPos(-3, Cb.h, -8) }, // a safe spot on the roof (retries)
  exploreSpawn: { pos: cPos(-3, Cb.h, -8) }, // (back-compat)
  // after the boss fight: outside the broken roll-up door, on the street of the factory exit module
  exitSpawn: { pos: (() => { const [x, z] = toWorldXZ(exitT, 0, 17); return [x, 0, z]; })(), yaw: exitT.yaw },
  exitDoor: { pos: (() => { const [x, z] = toWorldXZ(exitT, 0, 22.4); return [x, 0, z]; })() },
};
/** Direction toward the low sun (world, horizontal): north-west, at the far end of the first avenue. */
export const SUNSET_DIR = (() => { const v = [-0.55, 0, -0.84]; const l = Math.hypot(v[0], v[2]); return [v[0] / l, 0, v[2] / l]; })();

// ---------------------------------------------------------------- arcade arena fallback (Rooftop C) — the arcade itself plays in the factory interior
const fwdC = [-(Cb.sin), 0, -(Cb.cos)]; // box −Z in world = toward the door / factory exit
export const ARCADE = {
  playerPos: cPos(0, Cb.h, 4),
  playerYaw: Math.atan2(-fwdC[0], -fwdC[2]),
  forward: fwdC,
  bossHome: (() => { const p = cPos(0, Cb.h, 4); return [p[0] + fwdC[0] * 15, Cb.h + 5.5, p[2] + fwdC[2] * 15]; })(),
  strikeDistance: 4.2, laneHalfWidth: 1.25, laneYMin: 0.95, laneYMax: 1.95,
};

// ---------------------------------------------------------------- compatibility: the live city world
/** The streaming city (collidersNear, anchorsNear, segmentBlocked, colliderOf, …). */
export const CITY = cityWorld;
export { cityWorld, FACTORY_TILE, EXIT_TILE };
