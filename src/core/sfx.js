// v0.45 sample bank: decoded one-shot samples in front of the synthesized SFX. Plain-Node importable (no AudioContext
// at import time). play() returns false when it cannot play, so the caller falls back to the synth sound.
import { SFX_MANIFEST } from '../data/sfxManifest.js';
import { FEEL } from '../data/feel.js';

/** A variation index in [0, count), never equal to `last` when count > 1. */
export function pickVariation(count, last, rnd = Math.random) {
  if (count <= 1) return 0;
  if (last < 0 || last >= count) return Math.min(count - 1, Math.floor(rnd() * count));
  const k = Math.min(count - 2, Math.floor(rnd() * (count - 1)));
  return k >= last ? k + 1 : k;
}

/** v0.45: stereo pan (-1…1) of a world point for a listener { pos, right } (right vector dot direction to the point); `fallback` when there is no listener / point. Shared by SampleBank and the synth path. */
export function panFor(pos, listener, fallback = 0) {
  if (!pos || !listener?.pos) return fallback;
  const dx = pos.x - listener.pos.x, dy = pos.y - listener.pos.y, dz = pos.z - listener.pos.z, d = Math.hypot(dx, dy, dz);
  return d > 1e-4 && listener.right ? (dx * listener.right.x + dy * listener.right.y + dz * listener.right.z) / d : fallback;
}
export class SampleBank {
  constructor(engine, manifest = SFX_MANIFEST, cfg = FEEL.sfx) {
    this.engine = engine; this.manifest = manifest; this.cfg = cfg;
    this.buffers = new Map(); // name → AudioBuffer[]
    this.last = new Map(); // name → last variation played
    this.voices = []; // playing sources, oldest first
  }
  /** Fetch + decode every manifest file. Never rejects; a failed file is skipped (its name falls back to synth). */
  load(baseUrl) {
    if (!this.engine.ctx) return Promise.resolve(); // nothing to decode with yet; not cached, so a later call (after audio.unlock()) loads normally
    if (this._loading) return this._loading;
    this._loading = this._load(baseUrl).finally(() => { this._loading = null; });
    return this._loading;
  }
  async _load(baseUrl) {
    await Promise.all(Object.entries(this.manifest).map(async ([name, e]) => {
      if (this.buffers.has(name)) return; // already decoded
      const bufs = [];
      for (const f of e.files) {
        try {
          const res = await fetch(baseUrl + f);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          bufs.push(await this.engine.decode(await res.arrayBuffer()));
        } catch (err) { console.warn('sfx', f, err?.message || err); }
      }
      if (bufs.length) this.buffers.set(name, bufs);
    }));
  }
  has(name) { return this.buffers.has(name); }
  play(name, { pan = 0, pos = null, listener = null, gain: mul = 1 } = {}) {
    const eng = this.engine, bufs = this.buffers.get(name);
    if (!bufs || !eng.ctx || !eng.running || !eng.sfx) return false;
    const e = this.manifest[name], c = eng.ctx;
    let gain = (e.gain ?? 1) * mul;
    if (pos && listener?.pos) { // position → stereo pan (listener's right vector) + distance falloff; no HRTF panner (Quest cost)
      const dx = pos.x - listener.pos.x, dy = pos.y - listener.pos.y, dz = pos.z - listener.pos.z, d = Math.hypot(dx, dy, dz);
      pan = panFor(pos, listener, pan);
      if (e.falloff !== false) gain /= 1 + d / 12; // (manifest falloff: false = pan only, full level at any distance)
    }
    try {
      const k = pickVariation(bufs.length, this.last.get(name) ?? -1); this.last.set(name, k);
      const src = c.createBufferSource(); src.buffer = bufs[k];
      const jit = e.pitch ?? this.cfg.pitchJitter; src.playbackRate.value = 1 + (Math.random() * 2 - 1) * jit;
      const g = c.createGain(); g.gain.value = gain; src.connect(g);
      const p = c.createStereoPanner ? c.createStereoPanner() : null;
      if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(eng.sfx); } else g.connect(eng.sfx);
      while (this.voices.length >= this.cfg.maxVoices) { const old = this.voices.shift(); try { old.stop(); } catch { /* */ } } // oldest voice makes room
      src.onended = () => { const i = this.voices.indexOf(src); if (i >= 0) this.voices.splice(i, 1); try { g.disconnect(); p?.disconnect(); } catch { /* */ } };
      src.start();
      this.voices.push(src); // only after start() succeeded
    } catch (err) { console.warn('sfx play', name, err?.message || err); return false; }
    return true;
  }
}
