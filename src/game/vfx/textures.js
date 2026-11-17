// v0.30 procedural VFX textures (canvas, generated at start-up, no files). Data lives in the RGB channels with
// alpha = 255 (no premultiplied-alpha loss); all are linear masks (NoColorSpace).
//   atlasTexture()   512²  2×2 tiles: 0 soft glow (hot core), 1 spark streak, 2 four-point flare, 3 hex glyph
//   smokeFlipbook()  512²  4×4 frames of billowing fbm smoke: R density, G top-lit shading, B fine noise (erosion)
//   hexTexture()     256×222 tileable hex lattice: R line, G cell-centre falloff
//   faceTexture()    256²  jack-o'-lantern face: R blurred glow mask, G sharp mask
import * as THREE from 'three';
import { mulberry32 } from './rand.js';

const cache = {};
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function finish(c, { repeat = false, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.generateMipmaps = mip; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.anisotropy = 4;
  return t;
}
function fill(c, fn) {
  const g = c.getContext('2d', { willReadFrequently: true }), d = g.createImageData(c.width, c.height), p = d.data;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4, v = fn(x, y);
    p[i] = Math.max(0, Math.min(255, v[0] * 255)); p[i + 1] = Math.max(0, Math.min(255, v[1] * 255)); p[i + 2] = Math.max(0, Math.min(255, v[2] * 255)); p[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
}

// ---- value noise / fbm (tileable over `per`)
function makeNoise(seed) {
  const r = mulberry32(seed), N = 256, perm = new Float32Array(N * N);
  for (let i = 0; i < perm.length; i++) perm[i] = r();
  const at = (x, y, per) => perm[(((y % per) + per) % per) * N + (((x % per) + per) % per)];
  return (x, y, per) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi, per), b = at(xi + 1, yi, per), c = at(xi, yi + 1, per), d = at(xi + 1, yi + 1, per);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function atlasTexture() {
  if (cache.atlas) return cache.atlas;
  const S = 160, c = canvas(S * 2, S * 2);
  const vals = [0, 0, 0];
  fill(c, (x, y) => {
    const tile = (x >= S ? 1 : 0) + (y >= S ? 2 : 0);
    const u = ((x % S) + 0.5) / S * 2 - 1, v = ((y % S) + 0.5) / S * 2 - 1; // -1..1
    const r = Math.hypot(u, v);
    let I = 0;
    if (tile === 0) { // soft glow with a hot core
      I = Math.exp(-r * r * 9) * 0.75 + Math.exp(-r * r * 60) * 0.6 + Math.max(0, 1 - r) * 0.08;
    } else if (tile === 1) { // spark streak (long axis = x)
      const across = Math.exp(-v * v * 90), along = Math.max(0, 1 - Math.abs(u)) ** 1.4;
      I = across * along * (0.6 + 0.4 * Math.exp(-u * u * 8)) + Math.exp(-(u * u * 6 + v * v * 40)) * 0.35;
    } else if (tile === 2) { // four-point flare
      const arm = Math.exp(-Math.abs(v) * 40) * Math.max(0, 1 - Math.abs(u)) ** 2 + Math.exp(-Math.abs(u) * 40) * Math.max(0, 1 - Math.abs(v)) ** 2;
      I = arm * 0.8 + Math.exp(-r * r * 30) * 0.9 + Math.exp(-r * r * 4) * 0.15;
    } else { // hex glyph (Mobius lattice motif)
      const ax = Math.abs(u), ay = Math.abs(v);
      const d = Math.max(ax * 0.866 + ay * 0.5, ay) / 0.62; // pointy hex, edge at d = 1
      I = Math.exp(-((d - 1) ** 2) * 220) + Math.exp(-r * r * 30) * 0.5 + Math.exp(-((d - 1) ** 2) * 12) * 0.12;
      I *= r < 1 ? 1 : 0;
    }
    I *= Math.min(1, Math.max(0, (1 - Math.max(Math.abs(u), Math.abs(v))) * 12)); // clean tile borders
    vals[0] = vals[1] = vals[2] = I; return vals;
  });
  return (cache.atlas = finish(c));
}

export function smokeFlipbook() {
  if (cache.smoke) return cache.smoke;
  const S = 128, c = canvas(S * 4, S * 4), n1 = makeNoise(11), n2 = makeNoise(29);
  const fbm = (x, y, z, oct = 4) => { let a = 0, f = 1, w = 0.55, s = 0; for (let o = 0; o < oct; o++) { a += w * (n1(x * f + z * 3.1 + o * 17, y * f - z * 2.3, 256)); s += w; f *= 2.03; w *= 0.5; } return a / s; };
  const dens = new Float32Array(S * S);
  const g = c.getContext('2d');
  for (let fr = 0; fr < 16; fr++) {
    const z = fr * 0.22, ox = (fr % 4) * S, oy = Math.floor(fr / 4) * S;
    const grow = 0.78 + fr * 0.012;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      // domain-warped billow
      const wx = fbm(u * 1.6 + 5, v * 1.6, z, 2) - 0.5, wy = fbm(u * 1.6, v * 1.6 + 9, z, 2) - 0.5;
      const f = fbm(u * 2.2 + wx * 1.4, v * 2.2 + wy * 1.4 - z * 0.6, z);
      const r = Math.hypot(u, v) / grow;
      const mask = Math.max(0, 1 - r * r);
      dens[y * S + x] = Math.max(0, Math.min(1, (f * 1.35 - 0.25) * mask * 1.6 + mask * mask * 0.35));
    }
    const d = g.createImageData(S, S), p = d.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, D = dens[i];
      const up = dens[Math.max(0, y - 3) * S + x]; // canvas y down = texture top → "up" neighbour
      const shade = Math.max(0, Math.min(1, 0.55 + (D - up) * 3.2 + (0.5 - y / S) * 0.5));
      const fine = n2(x * 0.25 + fr * 7, y * 0.25, 256);
      p[i * 4] = D * 255; p[i * 4 + 1] = shade * 255; p[i * 4 + 2] = fine * 255; p[i * 4 + 3] = 255;
    }
    g.putImageData(d, ox, oy);
  }
  return (cache.smoke = finish(c));
}

export function hexTexture() {
  if (cache.hex) return cache.hex;
  const W = 256, R = W / (2 * Math.sqrt(3)), H = Math.round(3 * R), c = canvas(W, H);
  const sx = Math.sqrt(3) * R, sy = 1.5 * R;
  const vals = [0, 0, 0];
  fill(c, (x, y) => {
    // nearest hex centre (pointy-top, odd rows offset) → distance to the hex border
    let best = 1e9;
    const row = Math.round(y / sy);
    for (let rr = row - 1; rr <= row + 1; rr++) {
      const off = (rr & 1) ? sx / 2 : 0, col = Math.round((x - off) / sx);
      for (let cc = col - 1; cc <= col + 1; cc++) {
        const cx = cc * sx + off, cy = rr * sy, dx = Math.abs(x - cx), dy = Math.abs(y - cy);
        const d = Math.max(dx, dx * 0.5 + dy * 0.866) / (sx / 2); // 1 at the border
        if (d < best) best = d;
      }
    }
    const line = Math.exp(-(((1 - best) * R * 0.9) ** 2) * 0.5) * 0.85 + Math.exp(-(((1 - best) * R) ** 2) * 0.05) * 0.15;
    vals[0] = line; vals[1] = Math.max(0, 1 - best); vals[2] = 0; return vals;
  });
  return (cache.hex = finish(c, { repeat: true }));
}

export function faceTexture() {
  if (cache.face) return cache.face;
  const S = 256, sharp = canvas(S, S), g = sharp.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.fillStyle = '#fff';
  const tri = (pts) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); };
  tri([58, 104, 112, 104, 92, 62]); // left eye (slanted, angry)
  tri([144, 104, 198, 104, 164, 62]); // right eye
  tri([118, 136, 138, 136, 128, 116]); // nose
  // jagged grin
  g.beginPath(); g.moveTo(48, 150);
  const top = [[72, 160], [84, 150], [100, 166], [116, 154], [128, 168], [140, 154], [156, 166], [172, 150], [184, 160], [208, 150]];
  for (const [x, y] of top) g.lineTo(x, y);
  g.quadraticCurveTo(190, 214, 128, 216); g.quadraticCurveTo(66, 214, 48, 150); g.closePath(); g.fill();
  g.fillStyle = '#000'; for (const x of [96, 128, 160]) g.fillRect(x - 6, 186, 12, 30); // teeth
  const ds = g.getImageData(0, 0, S, S).data;
  // separable box blur ×3 ≈ gaussian (canvas `filter` is very slow on some browsers)
  let A = new Float32Array(S * S), B = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) A[i] = ds[i * 4];
  const R = 6;
  for (let pass = 0; pass < 3; pass++) for (const horiz of [true, false]) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let sum = 0, n = 0;
      for (let k = -R; k <= R; k++) { const xx = horiz ? x + k : x, yy = horiz ? y : y + k; if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue; sum += A[yy * S + xx]; n++; }
      B[y * S + x] = sum / n;
    }
    const t = A; A = B; B = t;
  }
  const db = { length: S * S * 4 }; void db;
  const out = canvas(S, S), o = out.getContext('2d'), d = o.createImageData(S, S), p = d.data;
  for (let i = 0; i < S * S; i++) {
    const u = (i % S) / S * 2 - 1, v = Math.floor(i / S) / S * 2 - 1, edge = Math.max(0, Math.min(1, (1 - Math.hypot(u, v)) * 4));
    p[i * 4] = Math.min(255, A[i] * 1.6) * edge; p[i * 4 + 1] = ds[i * 4] * edge; p[i * 4 + 2] = 0; p[i * 4 + 3] = 255;
  }
  o.putImageData(d, 0, 0);
  return (cache.face = finish(out));
}

/** Tapered streak for the wind lines: alpha (G) fades at both ends and across. */
export function windStreakTexture() {
  if (cache.wind) return cache.wind;
  const c = canvas(32, 128), vals = [0, 0, 0];
  fill(c, (x, y) => { const u = (x + 0.5) / 32 * 2 - 1, v = (y + 0.5) / 128; const a = Math.sin(Math.PI * v) ** 2 * (v < 0.5 ? 1 : 0.55 + 0.45 * Math.sin(Math.PI * v)) * Math.max(0, 1 - u * u) ** 2; vals[0] = vals[1] = vals[2] = a; return vals; });
  return (cache.wind = finish(c));
}
