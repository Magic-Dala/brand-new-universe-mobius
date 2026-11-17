// Shared cutout foliage. The transparent gaps and leaf veins live in one small atlas.
import { mulberry32 } from '../data/box.js';
import { GeoBuilder, K } from '../worlds/art/builder.js';
import { canvasTexture } from './toon.js';

const TILE = 128;
const SIZE = TILE * 2;
export const FOLIAGE_CUTOFF = 0.34;
const tiles = { broad: [0, 1], blossom: [1, 1], pine: [0, 0] };
const uvFor = ([x, y]) => [(x * TILE + 2) / SIZE, (y * TILE + 2) / SIZE, (TILE - 4) / SIZE, (TILE - 4) / SIZE];
let atlas;

function drawSpray(ctx, blossom) {
  const random = mulberry32(blossom ? 682 : 543);
  const clusters = [[-26, 8, 17], [-16, -17, 20], [12, -25, 16], [29, -8, 19], [26, 14, 14], [-1, 13, 23]];
  ctx.save();
  ctx.translate(64, 63);
  ctx.strokeStyle = '#8c8c8c';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.5;
  for (const [x, y] of clusters) {
    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.quadraticCurveTo(x * 0.24, y + 12, x, y);
    ctx.stroke();
  }

  for (const [cx, cy, radius] of clusters) {
    for (let i = 0; i < 27; i++) {
      const angle = random() * Math.PI * 2;
      const offset = Math.sqrt(random()) * radius;
      const x = cx + Math.cos(angle) * offset;
      const y = cy + Math.sin(angle) * offset * 0.85;
      const length = 4.2 + random() * 7;
      const width = length * (0.34 + random() * 0.22);
      const light = Math.round(143 + random() * 106 - cy * 0.4);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = `rgb(${light}, ${light}, ${light})`;
      ctx.beginPath();
      ctx.moveTo(-length, 0);
      ctx.quadraticCurveTo(-1, -width * 1.8, length, 0);
      ctx.quadraticCurveTo(0, width * 1.8, -length, 0);
      ctx.fill();
      if (blossom && i % 3 === 0) {
        ctx.fillStyle = '#fff';
        for (let petal = 0; petal < 5; petal++) {
          const a = petal * Math.PI * 2 / 5;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 2.8, Math.sin(a) * 2.8, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.strokeStyle = 'rgba(45,45,45,0.38)';
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.moveTo(-length * 0.65, 0);
        ctx.lineTo(length * 0.8, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawSnowyPine(ctx) {
  const random = mulberry32(166);
  ctx.save();
  ctx.translate(TILE / 2, TILE);
  for (let tier = 0; tier < 8; tier++) {
    const y = 24 + tier * 12;
    const radius = 54 - tier * 7;
    for (const side of [-1, 1]) {
      for (let branch = 0; branch < 9; branch++) {
        const t = (branch + 1) / 9;
        const x = side * radius * t;
        const end = -y + 13 * t + random() * 5;
        ctx.lineWidth = 3 + 5 * (1 - t);
        ctx.lineCap = 'round';
        ctx.strokeStyle = branch % 3 === 0 ? '#cbdde7' : branch % 2 ? '#42635d' : '#36534e';
        ctx.beginPath();
        ctx.moveTo(x * 0.55, end - 9);
        ctx.lineTo(x, end);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export function treeLeafTexture() {
  if (!atlas && typeof document !== 'undefined') {
    atlas = canvasTexture(SIZE, SIZE, ctx => {
      drawSpray(ctx, false);
      ctx.save();
      ctx.translate(TILE, 0);
      drawSpray(ctx, true);
      ctx.restore();
      ctx.save();
      ctx.translate(0, TILE);
      drawSnowyPine(ctx);
      ctx.restore();
      // Opaque white texel region for bark in the Dala City tree batch.
      ctx.fillStyle = '#fff';
      ctx.fillRect(TILE, TILE, TILE, TILE);
    }, { anisotropy: 2 });
    atlas.name = 'Tree leaves and blossoms';
  }
  return atlas ?? null;
}

/** Several overlapping, tilted leaf cards, with gaps that show through from both sides. */
export function foliage(builder, x, y, z, radius, heightRatio, options) {
  // Keep cutouts separate so the opaque architecture can use early depth testing.
  const leaves = builder.leaves ??= new GeoBuilder();
  leaves.push(builder.mat);
  leafCards(leaves, x, y, z, radius, heightRatio, options);
  leaves.pop();
}

function leafCards(builder, x, y, z, radius, heightRatio, {
  col, var: variation = 0.5, seed = 0, variant = 'broad', cards = 5,
} = {}) {
  const random = mulberry32(Math.round(seed * 119 + variation * 65521));
  const heading = random() * Math.PI;
  const uv = uvFor(tiles[variant]);
  for (let i = 0; i < cards; i++) {
    const yaw = heading + i * 2.4;
    const lean = i < 3 ? (i - 1) * (variant === 'pine' ? 0.12 : 0.23) : i % 2 ? 1.08 : -0.98;
    const width = radius * (variant === 'pine' ? 1 : 0.86 + random() * 0.18);
    const height = radius * heightRatio;
    const offset = variant === 'pine' || cards <= 3 ? 0 : radius * (i === 0 ? 0 : 0.18);
    builder.pushTRS(x + Math.cos(yaw) * offset, y + height * (i < 3 ? 0 : 0.08), z + Math.sin(yaw) * offset,
      yaw, 1, 1, 1, lean);
    const first = builder.vcount;
    builder.quad([-width, -height, 0], [width, -height, 0], [width, height, 0], [-width, height, 0],
      col, K.LEAF_CARD, variation, uv);
    // Back faces reuse the same four vertices and UVs, so the atlas reads correctly from either side.
    builder.I.push3(first, first + 2, first + 1);
    builder.I.push3(first, first + 3, first + 2);
    builder.pop();
  }
}

/** Dala City reuses its existing instanced tree pool for both quality levels. */
export function streetTreeGeometry(detailed = false) {
  const builder = new GeoBuilder();
  const bark = { col: 0x755943, kind: K.BARK, caps: '' };
  builder.cyl(0, 0, 0, 0.18, 0.10, 3.65, 6, bark);
  if (detailed) {
    builder.pipe([0, 2.35, 0], [0.9, 3.85, -0.4], 0.1, 5, { ...bark, r1: 0.035 });
    builder.pipe([0, 2.55, 0], [-0.8, 3.9, 0.52], 0.09, 5, { ...bark, r1: 0.03 });
  }
  for (let i = 0; i < builder.vcount; i++) builder.setUV(i, 0.75, 0.25);
  leafCards(builder, 0, 4.2, 0, 1.95, 0.84, { col: 0x91b879, seed: 17, cards: detailed ? 5 : 3 });
  return builder.build();
}
