// Real streamed geometry (not sky cards): six inverted architecture families.
// Collision tiers are authored by populateFoldDistrict in route.js, and drawn here exactly.
import { foliage } from '../../art/treeFoliage.js';
import * as THREE from 'three';
import { K } from './builder.js';
import { FK } from './foldscapeArt.js';

const M = new THREE.Matrix4();
const PALETTE = {
  brick: [0x8e4534, FK.BRICK_WIN], limestone: [0xd7cfba, FK.STONE_WIN],
  glass: [0x294658, K.GLASS], deco: [0xbfb59b, FK.STONE_WIN],
  twin: [0x345568, K.GLASS], garden: [0xa67858, FK.BRICK_ARCH],
};
export function drawFoldOverhead(b, s, ctx) {
  const style = s.foldStyle || 'brick', [color, kind] = PALETTE[style], X = ctx.extras;
  for (const [i, t] of s.tiers.entries()) {
    const slab = i === s.tiers.length - 1;
    b.box(t.dv, t.y0, -t.du, t.d, t.y1 - t.y0, t.w,
      { col: slab ? 0x757a7c : color, kind: slab ? K.PLAIN : kind, var: (s.seed % 100) / 100, faces: 'xXzZtb', bottom: { col: slab ? 0x596369 : color, kind: slab ? K.METAL : kind } });
    if (slab) continue;
    // Narrow ledges and vertical fins break the silhouette instead of one broad blank cream underside.
    b.box(t.dv, t.y0, -t.du, t.d + .4, .35, t.w + .4, { col: style === 'glass' || style === 'twin' ? 0x1f303a : 0xd0c4aa, kind: K.METAL, faces: 'xXzZb' });
    if (style === 'glass' || style === 'twin') {
      for (let z = -t.w / 2 + 2.5; z < t.w / 2; z += 4) for (const side of [-1, 1])
        b.box(t.dv + side * t.d / 2, t.y0, -t.du + z, .16, t.y1 - t.y0, .2, { col: 0x77929e, kind: K.METAL });
    }
    // Inverted rooftop details: every prop stays within the 58 m overhead safety gap.
    const add = (name, x, z, scale = 1) => {
      if (!X?.on) return;
      M.set(scale, 0, 0, x, 0, -scale, 0, t.y0, 0, 0, -scale, z, 0, 0, 0, 1);
      X.add(name, M);
    };
    if (style === 'brick' && i === 0) { add('fs_water_tank', t.dv, -t.du, .75); add('fs_bulkhead', t.dv + t.d * .25, -t.du + t.w * .25, .65); }
    if (style === 'deco' && i === 0) add('fs_crown', t.dv, -t.du, .32);
    if (style === 'glass' || style === 'twin') add('fs_hvac', t.dv, -t.du, .8);
    if (style === 'garden') {
      // Solid low-poly planted crowns, no transparent leaf overdraw.
      b.cyl(t.dv, t.y0 - 2.5, -t.du, .12, .15, 2.5, 5, { col: 0x65503a, kind: K.WOOD });
      foliage(b, t.dv, t.y0 - 3, -t.du, 1.65, .85, { col: 0x4f7948, seed: s.seed + i });
    }
  }
  // Road-marked upper foundation and readable structural underside beams.
  b.box(0, s.h + 1.2, 0, s.d + 2, .05, .28, { col: 0xd5c686, kind: K.PLAIN });
  for (const side of [-1, 1]) b.box(side * s.d * .4, s.h - .65, 0, .3, .65, s.w + 2, { col: 0x37444d, kind: K.METAL });
}
