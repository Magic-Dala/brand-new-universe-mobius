// Dala City / 達拉城 (v0.20, modular NYC-style swing city) — ALL city / streaming tunables in one place.
// Units: metres, seconds. Gameplay feel of the swing itself (speed, assist, rope…) lives in
// src/core/settings.js (player / dev adjustable); everything about the city layout, streaming,
// recycling, level of detail and the playable corridor is here.
export const CITY_CFG = {
  seed: 20261022, // endless route + appearance variants (same seed → same route / same city)
  storySeed: 7311, // appearance variants of the fixed story route

  // ---------------------------------------------------------------- grid / modules
  cell: 72, // one module = a 72 × 72 m square centred on a 4-way intersection
  street: 24, // building line ↔ building line (road 14 m + two 5 m sidewalks)
  road: 14,
  sidewalk: 5,
  originZ: -24, // world z of the centre of cell (0, 0): the home tower A (window) sits on its south edge
  floorH: { res: 3.3, com: 3.9, glass: 3.8, ind: 4.2 },

  // ---------------------------------------------------------------- streaming / recycling
  aheadMinTiles: 4, // always prepared in front of the player (route tiles)
  aheadMaxTiles: 9,
  aheadSeconds: 7, // preload = current speed × this (+ aheadMinTiles) → fast swinging never reaches empty tiles
  behindTiles: 2, // kept behind (looking back / short back-swings)
  keepRadius: 120, // a cell within this distance of the player is NEVER recycled (VR players turn their heads)
  createPerFrame: 3, // max new cells (data) per frame
  buildBudgetMs: 3, // renderer time slice per frame for cell visuals
  slowDownNearUnready: 26, // m: if the next route tile is not built yet, cap the speed within this distance
  rebaseDist: 1500, // shift the world origin back when the player gets this far (float precision)

  // ---------------------------------------------------------------- level of detail
  ledgeRange: 60, // v0.26: sill courses / storefront belts (real geometry) only on cells this close (+30 m hysteresis)
  detailRange: 170, // rooftop props, fire escapes, lamps, trees, anchor brackets: only cells this close
  backdropRadius: 430, // low-detail buildings (same silhouettes as the real cells) around the active area
  backdropFarRadius: 650, // v0.27: simplified far ring (one box per building ≥ 32 m) out to here — no empty ground band from high up
  backdropMax: 2800, // instances (near + far ring)
  backdropBudgetMs: 1.0, // v0.26: per-frame time slice for rebuilding the (double-buffered) backdrop
  skylineRadius: 950,
  fog: { color: 0xc99a9a, near: 90, far: 640 },

  // ---------------------------------------------------------------- object pools (renderer)
  pools: { ledges: 2800, awnings: 700, walks: 1400, kits: 160, signs: 400, cells: 72, perCell: 64, waterTowers: 260, fireEscapes: 520, roofBoxes: 1100, lamps: 520, trees: 420, brackets: 1100, masts: 80, cars: 140 },
  traffic: { count: 12, radius: 150 }, // v0.27 decorative traffic on the north–south streets (renderer only)

  // ---------------------------------------------------------------- playable corridor
  corridor: {
    halfWidth: 66, // max lateral distance from the route centre line (one block into the side streets)
    maxHeight: 175, // soft ceiling (no anchors above, pushed back down)
    outGrace: 0.6, // s outside the corridor before the safe recovery
  },

  // ---------------------------------------------------------------- swing anchors
  anchors: {
    roofDrop: 1.2, // roof-edge anchors this far below the roof line
    midMinH: 44, // buildings this tall also get a reinforced mid-facade anchor (at 0.6 h)
    mastMinH: 96, // towers this tall get a rooftop mast anchor
    minRoofH: 16, // no anchors on lower buildings
    out: 0.35, // bracket offset in front of the facade
    clear: [3, 8, 15], // the space in front of an anchor must be free at these distances
  },

  // ---------------------------------------------------------------- endless route generation
  endless: {
    minStraight: 2, // straight tiles between two turns
    maxSideRun: 3, // tiles heading sideways before returning to the main direction
    pTurn: 0.14, pCross: 0.16, // per-tile chances (main heading)
    leadTiles: 6, // Green Maniac leads this many tiles after the factory, then escapes into the sky
    commitDist: 16, // m past an intersection centre along one exit = the player chose that exit
    flyH: { res: 42, com: 58 },
  },
};

/** Floor height of a style family. */
export const floorHOf = (family) => CITY_CFG.floorH[family] || 3.5;
