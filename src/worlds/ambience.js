// World Chase ambient audio (v0.40): one procedural bed per world (WebAudio noise + filtered tones, no assets),
// routed to the ambient bus so the music / voice ducking and volume settings apply. Restrained: a wind / water /
// rain bed + rare positional accents. stop() cancels every timer and node (no leaks across map switches).
import { audio } from '../core/audio.js';

const SPECS = {
  city: { base: 'city' },
  forest: { bed: [{ type: 'lowpass', f: 520, g: 0.16 }, { type: 'bandpass', f: 2600, q: 0.6, g: 0.035 }], accent: 'birds', every: [2.5, 6] },
  canyon: { bed: [{ type: 'lowpass', f: 260, g: 0.2, wobble: 0.35 }, { type: 'bandpass', f: 1200, q: 0.8, g: 0.02 }], accent: 'hawk', every: [14, 26] },
  neon: { bed: [{ type: 'bandpass', f: 3800, q: 0.4, g: 0.07 }, { type: 'lowpass', f: 140, g: 0.18 }], hum: [60, 0.025], accent: 'zap', every: [5, 11] },
  moonlit: { bed: [{ type: 'lowpass', f: 380, g: 0.12, wobble: 0.25 }, { type: 'bandpass', f: 1800, q: 0.5, g: 0.02 }], accent: 'chime', every: [3, 8] },
  palace: { bed: [{ type: 'lowpass', f: 420, g: 0.13, wobble: 0.3 }], accent: 'bell', every: [9, 18] },
  ice: { bed: [{ type: 'bandpass', f: 700, q: 0.7, g: 0.12, wobble: 0.45 }, { type: 'highpass', f: 5200, g: 0.015 }], accent: 'crystal', every: [3, 7] },
  molten: { bed: [{ type: 'lowpass', f: 110, g: 0.34, wobble: 0.2 }, { type: 'bandpass', f: 2200, q: 1.2, g: 0.03 }], accent: 'crackle', every: [0.6, 1.8] },
};

export function startWorldAmbience(kind) {
  const S = SPECS[kind] || SPECS.city;
  if (S.base === 'city') { const a = audio.startCityAmbience?.(); a?.setLevel(0.55); return a ? { setLevel: (v) => a.setLevel(0.55 * v), stop: () => a.stop() } : null; }
  const c = audio.ctx; if (!c) return null;
  const out = c.createGain(); out.gain.value = 0; out.connect(audio.ambient);
  const nodes = [], lfos = [];
  for (const b of S.bed || []) {
    const n = c.createBufferSource(); n.buffer = audio.noiseBuffer(); n.loop = true; n.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = b.type; f.frequency.value = b.f; if (b.q) f.Q.value = b.q;
    const g = c.createGain(); g.gain.value = b.g;
    n.connect(f).connect(g).connect(out); n.start(); nodes.push(n);
    if (b.wobble) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.07 + Math.random() * 0.08; lg.gain.value = b.g * b.wobble; l.connect(lg).connect(g.gain); l.start(); lfos.push(l); }
  }
  if (S.hum) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = S.hum[0]; g.gain.value = S.hum[1]; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; o.connect(f).connect(g).connect(out); o.start(); nodes.push(o); }
  let stopped = false, timer = 0, level = 1;
  const pan = () => { const p = c.createStereoPanner ? c.createStereoPanner() : null; if (p) { p.pan.value = Math.random() * 1.6 - 0.8; p.connect(out); return p; } return out; };
  const tone = (freq, dur, { type = 'sine', gain = 0.05, slide = 0, when = 0, dst } = {}) => {
    const t0 = c.currentTime + when, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain * level, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dst || out); o.start(t0); o.stop(t0 + dur + 0.05);
  };
  const burst = (dur, f, gain, dst) => { const n = c.createBufferSource(); n.buffer = audio.noiseBuffer(); const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = 2; const g = c.createGain(); const t0 = c.currentTime; g.gain.setValueAtTime(gain * level, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); n.connect(fl).connect(g).connect(dst || out); n.start(t0); n.stop(t0 + dur + 0.05); };
  const ACC = {
    birds: () => { const d = pan(), f = 2600 + Math.random() * 1800; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) tone(f * (1 + Math.random() * 0.2), 0.09, { gain: 0.03, slide: f * 1.4, when: i * 0.13, dst: d }); },
    hawk: () => { const d = pan(); tone(2400, 0.9, { type: 'triangle', gain: 0.025, slide: 1500, dst: d }); },
    zap: () => { const d = pan(); burst(0.12, 5000, 0.04, d); tone(180, 0.25, { type: 'square', gain: 0.012, slide: 90, dst: d }); },
    chime: () => { const d = pan(), base = [1318, 1568, 1760, 2093][Math.floor(Math.random() * 4)]; tone(base, 1.6, { type: 'sine', gain: 0.022, dst: d }); tone(base * 2.01, 1.0, { gain: 0.008, dst: d }); },
    bell: () => { const d = pan(); tone(196, 4.5, { type: 'sine', gain: 0.05, dst: d }); tone(196 * 2.76, 3.0, { gain: 0.015, dst: d }); tone(196 * 5.4, 1.5, { gain: 0.006, dst: d }); },
    crystal: () => { const d = pan(); for (let i = 0; i < 3; i++) tone(3000 + Math.random() * 2500, 0.6, { type: 'sine', gain: 0.012, when: i * 0.07, dst: d }); },
    crackle: () => { const d = pan(); burst(0.04 + Math.random() * 0.05, 1500 + Math.random() * 2500, 0.05, d); },
  };
  const next = () => { if (stopped) return; if (S.accent && level > 0.05) ACC[S.accent]?.(); const [a, b] = S.every || [5, 10]; timer = setTimeout(next, (a + Math.random() * (b - a)) * 1000); };
  timer = setTimeout(next, 2500);
  out.gain.setTargetAtTime(0.9, c.currentTime, 1.2);
  return {
    setLevel: (v) => { level = Math.max(0, Math.min(1, v)); out.gain.setTargetAtTime(0.9 * level, c.currentTime, 0.4); },
    stop: () => { stopped = true; clearTimeout(timer); out.gain.setTargetAtTime(0, c.currentTime, 0.3); setTimeout(() => { for (const n of [...nodes, ...lfos]) { try { n.stop(); } catch { /* */ } } out.disconnect(); }, 1500); },
  };
}
