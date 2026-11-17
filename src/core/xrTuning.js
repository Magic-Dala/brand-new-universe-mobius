// v0.27 stage 4 — XR tuning switches + what the headset session REALLY uses (dev).
//
// What the code path is (checked in node_modules, super-three 0.181 + IWSDK):
//  • IWSDK creates the WebGLRenderer with antialias: true and multiviewStereo: true, and always OFFERS the WebXR
//    'layers' feature (optional). three's WebXRManager then uses an XRProjectionLayer whenever the browser has
//    XRWebGLBinding.createProjectionLayer, and MULTIVIEW (texture-array target, OCULUS_multiview, one draw call per
//    object for both eyes) whenever the extension is present. So on Quest Browser multiview is probably ALREADY on.
//    The perf overlay / report now show the real state (renderer.xr.isMultiview, layer type, render-target size, MSAA).
//  • Projection-layer render target: 4× MSAA when antialias is on (it is). No post-processing anywhere.
//
// Switches (Settings → Developer tools):
//  • xrMultiview 'auto' | 'off'  — 'off' hides OCULUS_multiview from three at session start → one projection-layer
//    texture, both eyes drawn separately (the A/B baseline). Takes effect on the NEXT VR entry.
//  • renderScale 1.0 / 0.9 / 0.85 / 0.8 — framebuffer scale, applied before the next VR entry (three refuses a change
//    while presenting). The real size is shown in the overlay.
//  • xrFoveation 1 / 0.75 / 0.5 / 0.25 / 0 — fixed foveation, applied live; the overlay shows the value the layer
//    reports back (fixedFoveation), which is what the browser accepted — not proof of what the compositor does.
import { settings, onSettingsChange } from './settings.js';

export const RENDER_SCALES = [1.0, 0.9, 0.85, 0.8];
export const FOVEATIONS = [1, 0.75, 0.5, 0.25, 0];

export function installXrTuning(renderer) {
  // multiview A/B: wrap the extension query three makes when the session starts
  const ext = renderer.extensions;
  const has = ext.has.bind(ext); ext._hasUnwrapped = has;
  ext.has = (name) => (name === 'OCULUS_multiview' && settings.xrMultiview === 'off' ? false : has(name));
  const applyScale = () => { if (!renderer.xr.isPresenting) { try { renderer.xr.setFramebufferScaleFactor(settings.renderScale || 1); } catch (e) { console.warn('framebuffer scale', e); } } };
  const applyFov = () => { try { renderer.xr.setFoveation?.(settings.xrFoveation ?? 1); } catch { /* ignore */ } };
  onSettingsChange((k) => { if (k === 'renderScale') applyScale(); if (k === 'xrFoveation') applyFov(); });
  applyScale();
  return { applyFov, applyScale };
}

/** The session's real render setup (null fields when not presenting). */
export function xrInfo(renderer) {
  const xr = renderer.xr, out = { presenting: !!xr.isPresenting, multiview: !!xr.isMultiview, multiviewSetting: settings.xrMultiview || 'auto', layer: null, width: null, height: null, views: null, samples: null, foveationSet: settings.xrFoveation ?? 1, foveationLayer: null, renderScale: settings.renderScale || 1, extension: (renderer.extensions._hasUnwrapped || renderer.extensions.has)('OCULUS_multiview') };
  if (!xr.isPresenting) return out;
  const L = xr.getBaseLayer?.();
  if (L && 'textureWidth' in L) { out.layer = 'projection'; out.width = L.textureWidth; out.height = L.textureHeight; out.views = xr.isMultiview ? 2 : 1; out.foveationLayer = L.fixedFoveation ?? null; }
  else if (L) { out.layer = 'webgl'; out.width = L.framebufferWidth; out.height = L.framebufferHeight; out.views = 1; out.foveationLayer = L.fixedFoveation ?? null; }
  if (out.layer === 'projection') { const rt = renderer.getRenderTarget(); out.samples = rt?.samples ?? null; } // three's own MSAA target (4 when antialias)
  else out.samples = L?.antialias ? 'layer' : 0; // XRWebGLLayer: the layer itself antialiases (no three MSAA target)
  return out;
}
/** Estimated GPU memory of the XR render target (colour + depth, MSAA buffers + resolve). */
export function xrTargetMiB(info) {
  if (!info.width) return null;
  const px = info.width * info.height * (info.views || 1), s = typeof info.samples === 'number' ? Math.max(1, info.samples) : 1;
  return +((px * (4 + 4) * s + (s > 1 ? px * 4 : 0)) / 1048576).toFixed(1);
}
