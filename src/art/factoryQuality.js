// v0.31 factory interior quality switches (renderer only; never imported by src/data).
//   factoryQ 'v1' = the v0.31 rebuild (tools/blender/build_factory_v2.py + bake_factory_v2.py), 'v0' = the v0.30 hall.
//   URL overrides (not saved): ?fq=0 | ?fq=1, ?fqoff=probe,cones   (settings.factoryQOff = [...] in the dev panel)
// Features (each can be turned off on its own):
//   probe    box-projected reflection probe on the wet floor + glossy metal (off: matte floor)
//   streaks  camera-facing lamp reflection streaks on the floor (1 draw call)
//   cones    volumetric light cones under the lamps + the moonlight beam through the breach
//   dust     floating dust motes + dust falling through the breach
//   sway     banners / cobwebs sway in the wind from the breach (vertex shader)
//   props    the optional dressing (prop kit + machine detail; the frozen-layout machines always stay)
//   lmfull   full-resolution lightmap (off: half resolution, −75% lightmap memory)
//   life     sparks from the broken wire, steam puffs from the pipes, lamp hum / pumpkin candle flicker
import { settings } from '../core/settings.js';

export const FACTORY_Q_FEATURES = ['probe', 'streaks', 'cones', 'dust', 'sway', 'props', 'lmfull', 'life'];

function url() {
  try { const u = new URLSearchParams(location.search); return { q: u.get('fq'), off: u.get('fqoff') ? u.get('fqoff').split(',').map((s) => s.trim()) : null }; } catch { return { q: null, off: null }; }
}

/** { level: 'v0'|'v1', probe, streaks, cones, dust, sway, props, lmfull, life } */
export function factoryFlags() {
  const U = typeof location !== 'undefined' ? url() : { q: null, off: null };
  let level = U.q === '0' ? 'v0' : U.q === '1' ? 'v1' : settings.factoryQ || 'v0';
  if (level !== 'v0') level = 'v1';
  const off = new Set([...(settings.factoryQOff || []), ...(U.off || [])]);
  const f = { level };
  for (const k of FACTORY_Q_FEATURES) f[k] = level === 'v1' && !off.has(k);
  return f;
}
