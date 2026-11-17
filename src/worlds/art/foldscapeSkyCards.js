// Foldscape City — remote sky districts (v0.42). FAR-ONLY scenery: the cards live in the WorldRenderer backdrop group,
// which follows the camera in x / z (y fixed) and faces the route's start heading, so they never parallax and never
// enter the playable corridor (SKY_LIMITS: every vertex ≥ minDist m away horizontally or ≥ highY m up, ≥ minRange from
// the eye and inside the sky dome at any flight height — tests/foldscape-art.test.mjs checks this). Near / mid modules
// keep full 3D parallax.
//
// Three DISTINCT transparent paintings (public/textures/foldscape/, see docs/ASSETS.md):
//   skyline  — an upright NYC skyline strip (opaque flat base: dissolved into haze, cut into four non-overlapping crops)
//   district — a huge concave folded avenue rising into the sky (ahead: it carries the 3D fold's rise on into the sky)
//   canopy   — an upside-down curved city ribbon (behind the player, arching across the sky)
// Every heading gets a composition: front = the 3D fold's ramp + the district above it + the Empire / Chrysler crops on
// the horizon, rear = the canopy, left = an inverted crop hanging high, right = a tilted crop folding up. Placed by
// heading / elevation / distance from the flight-height eye so they read from the street canyon's fore / aft sky slot.
//
// Rendering: one merged mesh per image (3 draw calls), alpha-tested (+ alpha-to-coverage edge smoothing), opaque, depth
// writing, no blending → correct in both XR eyes without sorting. Card sizes keep the source crop's pixel aspect.
// Haze toward the daylight fog colour (more toward the base) instead of three's fog. Owns and disposes its textures,
// materials and geometries.
import * as THREE from 'three';

export const SKY_SOURCES = {
  skyline: { url: 'textures/foldscape/daylight-skyline.png', px: [2172, 724] },
  district: { url: 'textures/foldscape/daylight-fold-district.png', px: [1536, 1024] },
  canopy: { url: 'textures/foldscape/daylight-city-canopy.png', px: [1942, 809] },
};
/**
 * Far-only limits (backdrop frame = camera-relative, y absolute; flight path ~36..70 m, structures ≤ ~150 m): every
 * vertex is either ≥ minDist m away horizontally or ≥ highY m up (far above any building), ≥ minRange m from the eye and
 * inside the sky dome (skyRadius) for every camera height in camY.
 */
export const SKY_LIMITS = { minDist: 560, highY: 300, minRange: 450, skyRadius: 1100, camY: [0, 160] };

// h: heading of the card centre (deg; 0 = the route's start direction, + = right), e: its elevation seen from the
// flight height (deg), R: its distance, w: width (height from the crop's pixel aspect), crop: [u0, u1, v0, v1] of the
// source (v from the bottom), roll: rotation in the card plane (π = upside down), tilt: lean back (deg, default = e →
// the card faces the eye), haze: 0..1, base: dissolve the bottom edge (sources with a flat opaque base).
export const SKY_EYE = 50;
export const SKY_CARDS = [
  // front: the folded district continues the 3D fold's rise up into the sky (the concept's main read)
  { src: 'district', h: 8, e: 28, R: 800, w: 1000, crop: [0, 1, 0, 1], haze: 0.2, base: 0 },
  // front horizon, either side of the fold's foot: the iconic pair (bases sink behind the far 3D ring + haze)
  { src: 'skyline', h: -27, e: 8, R: 950, w: 330, crop: [0.27, 0.52, 0, 1], haze: 0.34, base: 1 },
  { src: 'skyline', h: 31, e: 8, R: 960, w: 320, crop: [0.52, 0.76, 0, 1], haze: 0.38, base: 1 },
  // rear: the upside-down city ribbon arching across the sky behind the player
  { src: 'canopy', h: 180, e: 27, R: 860, w: 1100, crop: [0, 1, 0, 1], haze: 0.24, base: 0 },
  // left, high: an inverted crop hanging from the sky
  { src: 'skyline', h: -88, e: 40, R: 860, w: 330, crop: [0.76, 1, 0, 1], haze: 0.24, base: 1, roll: Math.PI + 0.2 },
  // right: a crop folding up out of the city, leaning like the fold ahead
  { src: 'skyline', h: 92, e: 26, R: 880, w: 340, crop: [0, 0.27, 0, 1], haze: 0.34, base: 1, roll: -0.42 },
];

const VERT = /* glsl */`
attribute vec3 aCard; // x: height fraction on the card (0 = base), y: haze, z: base dissolve on/off
varying vec2 vUv; varying vec3 vCard;
void main() { vUv = uv; vCard = aCard; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
uniform sampler2D map; uniform vec3 uHaze; uniform float uCut;
varying vec2 vUv; varying vec3 vCard;
void main() {
  vec4 c = texture2D(map, vUv);
  float a = c.a;
  float base = 0.0;
  if (vCard.z > 0.5) { // a flat image base dissolves into the air along a wavy, cloud-like edge (no straight seam)
    float wave = 0.045 * (sin(vUv.x * 91.0) + 0.6 * sin(vUv.x * 37.0 + 1.3) + 0.4 * sin(vUv.x * 223.0 + 0.7));
    base = 1.0 - smoothstep(0.04, 0.3, vCard.x + wave);
    a *= smoothstep(0.03, 0.16, vCard.x + wave);
  }
  #ifdef ALPHA_TO_COVERAGE
  a = smoothstep(uCut, uCut + fwidth(a), a);
  if (a <= 0.0) discard;
  #else
  if (a < uCut) discard;
  a = 1.0;
  #endif
  float h = vCard.y + (1.0 - vCard.y) * max(0.4 * (1.0 - smoothstep(0.0, 0.45, vCard.x)), 0.85 * base); // thicker air toward the base
  gl_FragColor = vec4(mix(c.rgb, uHaze, h), a);
  #include <colorspace_fragment>
}`;

/** Card height from the crop's pixel aspect. */
export function cardHeight(card) { const S = SKY_SOURCES[card.src], [u0, u1, v0, v1] = card.crop; return card.w * ((v1 - v0) * S.px[1]) / ((u1 - u0) * S.px[0]); }
/** Centre of a card in the backdrop frame. */
export function cardCenter(card, out = new THREE.Vector3()) {
  const h = THREE.MathUtils.degToRad(card.h), e = THREE.MathUtils.degToRad(card.e), d = Math.cos(e) * card.R;
  return out.set(Math.sin(h) * d, SKY_EYE + Math.sin(e) * card.R, -Math.cos(h) * d);
}
/** Matrix of a card in the backdrop frame (local quad: x across, y up, centred; facing the eye unless tilt overrides). */
export function cardMatrix(card, out = new THREE.Matrix4()) {
  const h = THREE.MathUtils.degToRad(card.h), tilt = THREE.MathUtils.degToRad(card.tilt ?? card.e);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, -h, card.roll || 0, 'YXZ'));
  return out.compose(cardCenter(card), q, new THREE.Vector3(1, 1, 1));
}
/** Merged geometry of all cards of one source (position, uv = crop, aCard). */
export function buildCardGeometry(src, cards = SKY_CARDS) {
  const P = [], U = [], C = [], I = [], M = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const card of cards) {
    if (card.src !== src) continue;
    const H = cardHeight(card), [u0, u1, v0, v1] = card.crop, k = P.length / 3;
    cardMatrix(card, M);
    for (const [fx, fy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      // the upside-down roll keeps the same uv corners (the painting itself turns over)
      v.set((fx - 0.5) * card.w, (fy - 0.5) * H, 0).applyMatrix4(M); P.push(v.x, v.y, v.z);
      U.push(u0 + (u1 - u0) * fx, v0 + (v1 - v0) * fy);
      C.push(fy, card.haze, card.base ? 1 : 0);
    }
    I.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I); g.computeBoundingSphere();
  return g;
}

export function createFoldscapeSkyCards(parent, { haze = 0xc4dbee } = {}) {
  const root = new THREE.Group(); root.name = 'FoldscapeSkyCities';
  parent.add(root);
  let disposed = false;
  const textures = [], materials = [], meshes = [], loaded = new Set();
  for (const [src, S] of Object.entries(SKY_SOURCES)) {
    if (!SKY_CARDS.some((c) => c.src === src)) continue;
    // Node's geometry / lifecycle tests have no DOM; browser verification covers image loading. A mesh stays hidden
    // until its image arrives (an unloaded texture would sample opaque black → no placeholder rectangles).
    let mesh = null;
    const onLoad = () => { loaded.add(src); if (!disposed && mesh) mesh.visible = true; };
    const tex = typeof document === 'undefined' ? new THREE.Texture() : new THREE.TextureLoader().load(S.url, onLoad, undefined, (e) => console.warn('[foldscape] sky card failed', S.url, e));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.name = `fs-sky-${src}`;
    const mat = new THREE.ShaderMaterial({
      name: `FoldscapeSky-${src}`, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { map: { value: tex }, uHaze: { value: new THREE.Color(haze) }, uCut: { value: 0.4 } },
      side: THREE.DoubleSide, alphaToCoverage: true, depthWrite: true, depthTest: true, transparent: false, fog: false, toneMapped: false,
    });
    mesh = new THREE.Mesh(buildCardGeometry(src), mat);
    mesh.name = `SkyCity-${src}`; mesh.visible = typeof document === 'undefined' || loaded.has(src);
    root.add(mesh); textures.push(tex); materials.push(mat); meshes.push(mesh);
  }
  const stats = { cards: SKY_CARDS.length, draws: meshes.length, tris: meshes.reduce((n, m) => n + m.geometry.index.count / 3, 0), textures: textures.length };
  // TextureLoader readiness is polled by the preview / e2e through image.complete; the game draws the cards as soon as
  // their maps arrive (until then the alpha test discards everything: no placeholder rectangles).
  return { root, textures, texture: textures[0], meshes, stats, get loaded() { return loaded.size; }, dispose() {
    if (disposed) return; disposed = true;
    root.removeFromParent();
    for (const m of meshes) m.geometry.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
  } };
}
