// v0.30 VFX feature flags. Every new effect family can be switched off on its own; when a flag is off the OLD
// v0.29 code path runs unchanged.
//   URL  ?vfx=0                  → every effect uses the old look
//        ?vfxoff=webShot,missBlast → only these use the old look
//   settings.vfxOff = ['fanWeb', …] (persisted, see src/core/settings.js)
import { settings, onSettingsChange } from '../../core/settings.js';

export const VFX_FEATURES = ['webShot', 'swingRope', 'fanWeb', 'blueBomb', 'thruster', 'wind', 'pumpkinFlight', 'pumpkinBurst', 'missBlast', 'giantBomb', 'roofExplosion', 'chaseBomb'];

let _off = null;
function rebuild() {
  const off = new Set();
  let q = '';
  try { q = typeof location !== 'undefined' ? location.search : ''; } catch { q = ''; }
  const sp = new URLSearchParams(q);
  if (sp.get('vfx') === '0') for (const f of VFX_FEATURES) off.add(f);
  for (const f of (sp.get('vfxoff') || '').split(',')) if (f) off.add(f.trim());
  for (const f of settings.vfxOff || []) off.add(f);
  _off = off;
}
onSettingsChange((k) => { if (k === 'vfxOff') _off = null; });

/** Is the new look of this effect family enabled? */
export function vfxOn(name) { if (!_off) rebuild(); return !_off.has(name); }
/** Turn one family on/off at runtime (persisted in settings.vfxOff). */
export function setVfx(name, on) {
  const cur = new Set(settings.vfxOff || []);
  if (on) cur.delete(name); else cur.add(name);
  settings.vfxOff = [...cur];
  _off = null;
}
/** Re-read the URL / settings (the preview changes location.search without a reload). */
export function refreshVfxFlags() { _off = null; }
export function vfxFlagState() { return Object.fromEntries(VFX_FEATURES.map((f) => [f, vfxOn(f)])); }
