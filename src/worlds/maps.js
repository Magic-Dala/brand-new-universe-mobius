// World Chase (v0.40) — the map registry. One entry per playable world: localized name / description, menu
// thumbnail, the reference concept image, route-generator parameters (corridor, heights, spacing, module weights)
// and the look (sky, fog, lights, palette, floor, particles, ambience). Pure data: no three.js here, so the route
// generator and the unit tests can import it in Node.
//
// Units: metres. `halfW` = half the free corridor width between the inner building faces. `yBase` = the starting
// flight height (the route height drifts inside `yRange`). `hAbove` = inner-row structure tops relative to the
// flight height there. Colours are 0xRRGGBB (linear-ish artist values; the shaders work in sRGB-ish space like the
// city shaders and finish with three's tone mapping + colour-space chunks).

/** Module types the generator knows (see route.js). */
export const MODULE_TYPES = ['straight', 'turnL', 'turnR', 'rise', 'descend', 'bridgeHigh', 'bridgeLow', 'gate', 'branch', 'landmark', 'recovery'];

const W = (o) => ({ straight: 5, turnL: 1.4, turnR: 1.4, rise: 1.2, descend: 1.2, bridgeHigh: 1.4, bridgeLow: 1.0, gate: 0.3, branch: 0.8, landmark: 0.7, recovery: 0.8, ...o });

export const MAPS = [
  {
    id: 'foldscape', order: 1, ref: 'foldscape-city-concept-v1.png',
    name: { en: 'Foldscape City', 'zh-Hant': '折境都市' },
    desc: { en: 'Daylit New York streets beneath layers of cities folding across the sky.', 'zh-Hant': '白晝的紐約街道——層層城市向天空折起。' },
    gen: { halfW: 14, yBase: 44, yRange: [36, 58], hAbove: [14, 58], w: [12, 22], d: [16, 24], gap: [0.5, 3.5], jitter: 1.5, outer: 0.9, anchorDy: [9, 17], weights: W({ landmark: 0.9, gate: 0, branch: 0.6 }), floor: 'street', lethalFloor: false, kinds: [['brick', 0.55], ['limestone', 0.27], ['glass', 0.18]],
      // v0.42 roof-edge anchors (route.js roofEdge): mount 2.5–3 m under the top of the tier carrying the anchor (just
      // under the cornice, as in the concept) when that edge is 6..31 m above the route and in line of sight; towers
      // whose roof is out of that band get a corridor-side setback (a reachable lower terrace edge) — or, without
      // one, a mid-wall transition anchor 17–24 m up. Bridges / branch ceilings retain their clearance rules. Street recovery has its own lower band.
      streetRecovery: { fraction: [0.42, 0.5], range: [24, 36] },
      roofAnchors: { below: [2.5, 3.0], band: [6, 31], fallbackDy: [17, 24], setback: { chance: 0.8, at: [21, 30], back: [3, 5.5] } } },
    look: {
      sky: { zenith: 0x3e8edb, mid: 0x8dc9f0, horizon: 0xd6eafa, below: 0xb5cbd9, sun: 0xfff6df, sunSize: 0.035, sunGlow: 0.45, clouds: 0.52, cloudColor: 0xffffff, cloudShade: 0xa2b9d0, stars: 0, moon: 0, aurora: 0 },
      sunDir: [-0.45, 0.72, -0.52], sunColor: 0xfff3dc, sunI: 2.1, hemiSky: 0xb4d6f4, hemiGround: 0x99988c, hemiI: 1.55,
      fog: { color: 0xb8d4e9, near: 140, far: 1000, height: 0.3 }, backFog: [260, 1500], ao: [0.65, 1.0, 46], rim: 0xc6dded, night: 0, // backFog v0.42: the far 3D city shares the sky cards' air
      win: { lit: 0xffd7a0, litFrac: 0.06, glass: 0x243747, refl: 0xb0d9f5 },
      particles: { kind: 'dust', count: 260, color: 0xffe0b0, size: 0.07 }, ambience: 'city',
      floor: { a: 0x4a4648, b: 0x6a6460, line: 0xf0e8d8, yellow: 0xf2c040 },
      art: 'foldscape', shade: [6, 30, 0.52, 0], // v0.41: FOLDSCAPE shader branch (textured masonry, bay-aligned windows) + canyon sun line y0..y1 m, shade floor
    },
  },
  {
    id: 'forest', order: 2, ref: 'forest-shadow-ruins-concept-v1.png',
    name: { en: 'Forest of Shadow Ruins', 'zh-Hant': '森影遺跡' },
    desc: { en: 'Giant old-growth trees and mossy temple towers above a turquoise stream.', 'zh-Hant': '巨大古樹與長滿青苔的神殿塔，下方是碧綠溪流。' },
    gen: { halfW: 15, yBase: 40, yRange: [32, 52], hAbove: [14, 48], w: [9, 15], d: [10, 16], gap: [3, 8], jitter: 3, outer: 0.8, anchorDy: [9, 16], weights: W({ bridgeHigh: 1.6, gate: 0, branch: 0.9, landmark: 0.8 }), floor: 'stream', lethalFloor: false, kinds: [['tree', 0.62], ['ruin', 0.38]],
      // v0.43 art upgrade (route.js populateForest, own RNG stream: corridor / anchors / coins unchanged): Tripo heroes on
      // plinths at the corridor edge ≥ `clear` m under the flight path, root collision under inner trees (height = R × rootH).
      forestDecor: { clear: 9, statueH: 13, altarH: 6.5, ruinH: [12, 16], ruinChance: 0.6, heroRoots: 0.3, rootH: 0.8, rootPad: 0.3, minPlinth: 0, maxPlinth: 22 } },
    look: {
      sky: { zenith: 0x5a9ee0, mid: 0xa8d0e4, horizon: 0xf0f0c8, below: 0x8aa07a, sun: 0xfff0c0, sunSize: 0.03, sunGlow: 0.9, clouds: 0.25, cloudColor: 0xffffff, cloudShade: 0xd8e0e4, stars: 0, moon: 0, aurora: 0 },
      sunDir: [0.5, 0.55, -0.66], sunColor: 0xffd48a, sunI: 3.4, hemiSky: 0x9cc4cc, hemiGround: 0x56603c, hemiI: 1.65,
      fog: { color: 0xb6ccb4, near: 45, far: 500, height: 0.7 }, ao: [0.38, 1.0, 42], rim: 0xffe6a8, night: 0, moss: 0x4f6c28, stone: [2.4, 1.25],
      win: { lit: 0xffd890, litFrac: 0.0, glass: 0x1c2418, refl: 0x506040 },
      particles: { kind: 'motes', count: 320, color: 0xfff2b0, size: 0.06 }, ambience: 'forest',
      floor: { a: 0x2bb8b0, b: 0x7fe6d6, line: 0xe8fff8, rock: 0x7a7a68 },
      art: 'forest', canopy: [62, 0.42], // v0.43: FOREST shader branch (bark / masonry / leaves / Tripo heroes) + canopy sun dapples below y0 m, shade floor
    },
  },
  {
    id: 'redrock', order: 3, ref: 'redrock-canyon-concept-v1.png',
    name: { en: 'Redrock Canyon', 'zh-Hant': '赤岩峽谷' },
    desc: { en: 'Layered sandstone cliffs, stone arches and rope bridges high above the river.', 'zh-Hant': '層層紅砂岩峭壁、天然石拱與吊橋，河流遠在腳下。' },
    gen: { halfW: 19, yBase: 72, yRange: [62, 86], hAbove: [12, 44], w: [18, 30], d: [22, 32], gap: [0, 3], jitter: 4, outer: 0.7, anchorDy: [8, 15], pillars: 0.75, bridgeTh: 1.2, weights: W({ bridgeHigh: 0.8, bridgeLow: 1.4, gate: 0, branch: 0.7, landmark: 1.0 }), floor: 'river', lethalFloor: true, kinds: [['cliff', 1]] },
    look: {
      sky: { zenith: 0x3a78d0, mid: 0x86b4e6, horizon: 0xd6e6f2, below: 0xc08a6a, sun: 0xfff2d0, sunSize: 0.03, sunGlow: 0.6, clouds: 0.5, cloudColor: 0xffffff, cloudShade: 0x9aa8c8, stars: 0, moon: 0, aurora: 0 },
      sunDir: [0.55, 0.55, -0.45], sunColor: 0xffd29a, sunI: 2.7, hemiSky: 0x9ab4ec, hemiGround: 0x8a5a7a, hemiI: 1.9,
      fog: { color: 0xe0b896, near: 160, far: 1200, height: 0.4 }, ao: [0.45, 1.0, 60], rim: 0xffd0a0, night: 0,
      win: { lit: 0xffb060, litFrac: 0.0, glass: 0x2a1a14, refl: 0x5a3a2a },
      particles: { kind: 'dust', count: 200, color: 0xffd8b0, size: 0.06 }, ambience: 'canyon',
      floor: { a: 0x2f8a8a, b: 0x9ad8d0, line: 0xffffff, rock: 0x8a4a32 },
      art: 'redrock', // v0.46: REDROCK shader branch (layered sandstone, textured Tripo rocks, river) — redrock only
    },
  },
  {
    id: 'neon', order: 4, ref: 'neon-tech-city-concept-v1.png',
    name: { en: 'Neon Tech City', 'zh-Hant': '霓虹科技城' },
    desc: { en: 'Rain-dark glass towers, layered skybridges, cyan light and magenta holograms.', 'zh-Hant': '雨夜玻璃高塔、層層空橋、青色燈光與洋紅全息投影。' },
    gen: { halfW: 14, yBase: 52, yRange: [42, 68], hAbove: [26, 100], w: [14, 24], d: [16, 24], gap: [2, 6], jitter: 2, outer: 1.0, anchorDy: [9, 17], weights: W({ bridgeHigh: 2.2, bridgeLow: 1.6, gate: 0, branch: 1.0, landmark: 0.6 }), floor: 'street', lethalFloor: false, kinds: [['tower', 0.7], ['tower2', 0.3]] },
    look: {
      art: 'neon',
      sky: { zenith: 0x12123d, mid: 0x2d286b, horizon: 0x5546a5, below: 0x1f163d, sun: 0xc8a0ff, sunSize: 0.0, sunGlow: 0.18, clouds: 0.5, cloudColor: 0x655cc2, cloudShade: 0x1e194e, stars: 0.10, moon: 0, aurora: 0 },
      sunDir: [-0.3, 0.35, -0.9], sunColor: 0x8a9cff, sunI: 0.9, hemiSky: 0x655aac, hemiGround: 0x312650, hemiI: 1.25,
      fog: { color: 0x4a4089, near: 75, far: 570, height: 0.62 }, backFog: [180, 1250], ao: [0.4, 1.0, 50], rim: 0x5550a5, night: 0.9,
      win: { lit: 0xffbd81, litFrac: 0.38, glass: 0x172043, refl: 0x5b56ab },
      particles: { kind: 'rain', count: 520, color: 0xa8c8ff, size: 0.05 }, ambience: 'neon',
      floor: { a: 0x15161e, b: 0x2a2c3a, line: 0x7ef0ff, yellow: 0xff5ad8 },
    },
  },
  {
    id: 'moonlit', order: 5, ref: 'moonlit-japanese-city-concept-v2.png',
    name: { en: 'Moonlit Japanese City', 'zh-Hant': '月影和風城' },
    desc: { en: 'A tall canyon of timber towers, tiled eaves and lanterns, racing toward the moonlit castle.', 'zh-Hant': '木造高樓、瓦簷與燈籠組成的高聳街谷，朝月下城堡追去。' },
    gen: { halfW: 11, yBase: 40, yRange: [32, 52], hAbove: [14, 46], w: [9, 15], d: [12, 18], gap: [0, 2], jitter: 1, outer: 1.0, anchorDy: [8, 15], weights: W({ bridgeHigh: 2.0, bridgeLow: 1.4, gate: 0, branch: 0.8, landmark: 0.8 }), floor: 'canal', lethalFloor: true, kinds: [['timber', 0.62], ['castle', 0.24], ['plaster', 0.14]] },
    look: {
      art: 'moonlit', // MOONLIT shader branch (storey-aligned shoji / plaster, navy tiles, canal) — moonlit only
      sky: { zenith: 0x0c1440, mid: 0x26306e, horizon: 0x4a4a8a, below: 0x1a1a3a, sun: 0xeef2ff, sunSize: 0.0, sunGlow: 0.0, clouds: 0.3, cloudColor: 0x6a6aa0, cloudShade: 0x1a1a40, stars: 0.8, moon: 1, aurora: 0 },
      sunDir: [0.0, 0.42, -0.9], sunColor: 0x9aaaf0, sunI: 0.85, hemiSky: 0x4a54a0, hemiGround: 0x3a2a3a, hemiI: 1.0,
      fog: { color: 0x2a2c5e, near: 60, far: 520, height: 0.55 }, ao: [0.42, 1.0, 40], rim: 0xb8c8ff, night: 1.0,
      win: { lit: 0xffb060, litFrac: 0.5, glass: 0x2a1a10, refl: 0x3a3a6a },
      particles: { kind: 'petals', count: 260, color: 0xffb0d0, size: 0.09 }, ambience: 'moonlit',
      floor: { a: 0x0e1838, b: 0x3a4a8a, line: 0xc8d4ff, rock: 0x6a4a2a },
    },
  },
  {
    id: 'cloudpalace', order: 6, ref: 'cloud-palace-city-concept-v1.png',
    name: { en: 'Cloud Palace Ancient City', 'zh-Hant': '雲闕古城' },
    desc: { en: 'Red columns, jade and golden roofs and towering gatehouses above a sea of sunrise clouds.', 'zh-Hant': '朱紅柱、碧瓦金頂與高聳城門，矗立在日出雲海之上。' },
    gen: { halfW: 14, yBase: 46, yRange: [38, 58], hAbove: [14, 48], w: [12, 20], d: [14, 20], gap: [1, 4], jitter: 1.5, outer: 0.9, anchorDy: [9, 16], weights: W({ bridgeHigh: 1.8, bridgeLow: 1.2, gate: 1.4, branch: 0.6, landmark: 0.8 }), floor: 'clouds', lethalFloor: true, kinds: [['palace', 0.7], ['pagoda', 0.3]] },
    look: {
      sky: { zenith: 0x5d84cc, mid: 0xc8a8c8, horizon: 0xffd2a6, below: 0xf2e2d8, sun: 0xffe0a0, sunSize: 0.04, sunGlow: 1.0, clouds: 0.7, cloudColor: 0xfff0e0, cloudShade: 0xc8a0a8, stars: 0, moon: 0, aurora: 0 },
      sunDir: [0.75, 0.16, -0.6], sunColor: 0xffc890, sunI: 1.85, hemiSky: 0xb0b0e0, hemiGround: 0xc89a8a, hemiI: 1.7,
      fog: { color: 0xf0d2c4, near: 90, far: 820, height: 0.5 }, ao: [0.5, 1.0, 46], rim: 0xffe0b0, night: 0.1, stone: [1.6, 0.8],
      win: { lit: 0xffc070, litFrac: 0.16, glass: 0x3a1a10, refl: 0x8a4a3a },
      particles: { kind: 'motes', count: 180, color: 0xfff0d0, size: 0.06 }, ambience: 'palace',
      floor: { a: 0xc0b3cf, b: 0xfff6eb, line: 0xffd0b0, rock: 0xd0c0c0 },
    },
  },
  {
    id: 'aurora', order: 7, ref: 'aurora-ice-city-concept-v1.png',
    name: { en: 'Aurora Ice City', 'zh-Hant': '極光冰城' },
    desc: { en: 'Snow-capped castles, crystal ice spires and arched bridges under green and violet aurora.', 'zh-Hant': '積雪城堡、冰晶尖塔與拱橋，頭頂是綠紫色極光。' },
    gen: { halfW: 13, yBase: 42, yRange: [34, 54], hAbove: [14, 52], w: [10, 17], d: [12, 18], gap: [1, 5], jitter: 2, outer: 0.9, anchorDy: [9, 16], weights: W({ bridgeHigh: 1.8, bridgeLow: 1.4, gate: 0, branch: 0.8, landmark: 0.8 }), floor: 'ice', lethalFloor: false, kinds: [['castle', 0.55], ['round', 0.2], ['crystal', 0.25]] },
    look: {
      sky: { zenith: 0x060c2a, mid: 0x1a2a5e, horizon: 0x3a4a86, below: 0x18203a, sun: 0xdde8ff, sunSize: 0.0, sunGlow: 0.0, clouds: 0.0, cloudColor: 0x5a6aa0, cloudShade: 0x1a2040, stars: 1.0, moon: 0, aurora: 1 },
      sunDir: [-0.2, 0.5, -0.85], sunColor: 0x9ab8ff, sunI: 1.2, hemiSky: 0x5a7ac8, hemiGround: 0x3a4a6a, hemiI: 1.45,
      fog: { color: 0x24346a, near: 70, far: 560, height: 0.5 }, ao: [0.5, 1.0, 40], rim: 0x9af0ff, night: 0.95, stone: [2.2, 1.0],
      win: { lit: 0xffbe6a, litFrac: 0.55, glass: 0x1a2238, refl: 0x4a6ab0 },
      particles: { kind: 'snow', count: 420, color: 0xf4f8ff, size: 0.07 }, ambience: 'ice',
      floor: { a: 0x5a7ab8, b: 0xbfe0ff, line: 0xffffff, rock: 0xe8f0ff },
    },
  },
  {
    id: 'molten', order: 8, ref: 'molten-fortress-concept-v1.png',
    name: { en: 'Molten Fortress', 'zh-Hant': '熔火堡壘' },
    desc: { en: 'Basalt towers, furnaces and steel bridges over a river of lava — the volcano foundry looms.', 'zh-Hant': '玄武岩高塔、熔爐與鋼橋橫跨熔岩河，遠方是火山鑄造廠。' },
    gen: { halfW: 15, yBase: 50, yRange: [42, 62], hAbove: [14, 54], w: [12, 20], d: [14, 22], gap: [1, 5], jitter: 2, outer: 0.9, anchorDy: [9, 16], weights: W({ bridgeHigh: 1.8, bridgeLow: 1.6, gate: 0, branch: 0.8, landmark: 0.8 }), floor: 'lava', lethalFloor: true, kinds: [['fortress', 0.55], ['basalt', 0.3], ['furnace', 0.15]] },
    look: {
      sky: { zenith: 0x1e1630, mid: 0x4a3050, horizon: 0x9a4a40, below: 0x3a1a10, sun: 0xff9a50, sunSize: 0.0, sunGlow: 0.3, clouds: 0.8, cloudColor: 0x7a4a5a, cloudShade: 0x201420, stars: 0, moon: 0, aurora: 0 },
      sunDir: [0.38, 0.40, 0.83], sunColor: 0xb3a3d3, sunI: 1.18, hemiSky: 0x665d80, hemiGround: 0x8e5149, hemiI: 1.23,
      fog: { color: 0x4a2a3e, near: 80, far: 980, height: 0.6 }, ao: [0.42, 1.0, 40], rim: 0xa07080, night: 0.8,
      win: { lit: 0xff8a30, litFrac: 0.6, glass: 0x1a1210, refl: 0x5a2a20 },
      particles: { kind: 'embers', count: 300, color: 0xffa040, size: 0.06 }, ambience: 'molten',
      floor: { a: 0xe8380a, b: 0xffa030, line: 0xffffa0, rock: 0x1a1414 },
    },
  },
];

export const MAP_IDS = MAPS.map((m) => m.id);
export const mapById = (id) => MAPS.find((m) => m.id === id) || null;
/** The classic Dala City entry (story + arcade, the existing flow) — listed first in the title selector. */
export const CLASSIC_ID = 'classic';
const LS = 'mobius.map.v1';
export function getSelectedMap() { try { const v = localStorage.getItem(LS); if (v === CLASSIC_ID || mapById(v)) return v; } catch { /* storage blocked */ } return MAPS[0].id; }
export function setSelectedMap(id) { try { localStorage.setItem(LS, id); } catch { /* ignore */ } }
const BEST = 'mobius.worldBest.v1';
export function getWorldBest(id) { try { return JSON.parse(localStorage.getItem(BEST) || '{}')[id] || null; } catch { return null; } }
export function setWorldBest(id, rec) { try { const all = JSON.parse(localStorage.getItem(BEST) || '{}'); all[id] = rec; localStorage.setItem(BEST, JSON.stringify(all)); } catch { /* ignore */ } }

/**
 * v0.49: what Enter VR Game starts. The website no longer picks a map, so the answer is null (the mode menu in Mobius's
 * room) unless a World Chase map id was handed over directly (app.pendingMap: the browser tests' hook): then that id.
 */
export function launchMap(pendingId) { return pendingId && mapById(pendingId) ? pendingId : null; }
