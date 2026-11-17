// Song registry: built-in songs (shipped chart + audio), imported songs
// (IndexedDB: audio blob + generated chart), chart cache, BPM/offset analysis.
import { audio } from './audio.js';
import { validateChart, buildChart, guessSections } from './chart.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || './';
export const BUILTIN_SONGS = [
  {
    id: 'mobius-boss-01',
    title: 'Brand New Universe - Mobius',
    chartUrl: `${BASE}songs/mobius-boss-01/chart.json`,
    builtin: true,
    // source mapping: original file "Brand_New_Universe-Mobius(Music).mp3" (unmodified copy)
  },
];

// ------------------------------------------------------------- IndexedDB
const DB_NAME = 'mobius-songs', DB_VER = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('IndexedDB unavailable'));
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('songs', { keyPath: 'id' }); d.createObjectStore('chartCache', { keyPath: 'url' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    const r = fn(s); t.oncomplete = () => res(r && 'result' in r ? r.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const idbGetAll = (store) => tx(store, 'readonly', (s) => s.getAll()).catch(() => []);
const idbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key)).catch(() => undefined);
const idbPut = (store, v) => tx(store, 'readwrite', (s) => s.put(v));
const idbDel = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));

// ------------------------------------------------------------- listing
const memSongs = new Map(); // imported songs when IDB is unavailable (this visit only)
export async function listSongs() {
  const imported = (await idbGetAll('songs')).map((s) => ({ id: s.id, title: s.title, builtin: false, chart: s.chart, hasAudio: !!s.audio }));
  for (const s of memSongs.values()) if (!imported.find((x) => x.id === s.id)) imported.push({ id: s.id, title: s.title, builtin: false, chart: s.chart, hasAudio: true, volatile: true });
  return [...BUILTIN_SONGS, ...imported];
}

const chartMem = new Map();
async function fetchChart(url) {
  if (chartMem.has(url)) return chartMem.get(url);
  let chart;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    chart = validateChart(await res.json());
    idbPut('chartCache', { url, chart, at: Date.now() }).catch(() => {});
  } catch (e) {
    const cached = await idbGet('chartCache', url); // offline fallback
    if (!cached) throw e;
    chart = validateChart(cached.chart);
  }
  chartMem.set(url, chart);
  return chart;
}

/** Load chart + decoded audio. Throws Error with .code ('reselect' | 'audio' | 'chart'). */
export async function loadSong(id) {
  const b = BUILTIN_SONGS.find((s) => s.id === id);
  if (b) {
    let chart;
    try { chart = await fetchChart(b.chartUrl); } catch (e) { const err = new Error(e.message); err.code = 'chart'; throw err; }
    let buffer;
    try { buffer = await audio.loadBuffer(`${BASE}${chart.song.audio.src}`); } catch (e) { const err = new Error(e.message); err.code = 'audio'; throw err; }
    return { id, title: chart.song.title, chart, buffer };
  }
  const rec = (await idbGet('songs', id)) || memSongs.get(id);
  if (!rec) { const err = new Error('not found'); err.code = 'reselect'; throw err; }
  if (!rec.audio) { const err = new Error('audio missing'); err.code = 'reselect'; err.title = rec.title; throw err; }
  const key = `import:${id}:${rec.audio.size}`;
  let buffer = audio.buffers.get(key);
  if (!buffer) { buffer = await audio.decode(await rec.audio.arrayBuffer()); audio.buffers.set(key, buffer); }
  return { id, title: rec.title, chart: validateChart(rec.chart), buffer };
}

// ------------------------------------------------------------- analysis
/** Onset-envelope beat analysis. Returns { bpm, offsetSec, confidence, barEnergy } */
export function analyzeBuffer(buffer, { bpmMin = 80, bpmMax = 170 } = {}) {
  const sr = buffer.sampleRate, n = buffer.length;
  const ch0 = buffer.getChannelData(0), ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const hop = 256, win = 1024;
  const frames = Math.floor((n - win) / hop);
  const env = new Float32Array(frames), rms = new Float32Array(frames);
  // simple spectral-flux surrogate: positive difference of band energies (low/high via 1-pole filters)
  let prevLow = 0, prevHigh = 0, lp = 0;
  for (let f = 0; f < frames; f++) {
    let lowE = 0, highE = 0;
    for (let i = f * hop, e = i + win; i < e; i += 2) {
      const x = (ch0[i] + ch1[i]) * 0.5;
      lp += 0.08 * (x - lp);
      lowE += lp * lp; const hpv = x - lp; highE += hpv * hpv;
    }
    lowE = Math.log1p(lowE * 50); highE = Math.log1p(highE * 50);
    env[f] = Math.max(0, lowE - prevLow) * 1.5 + Math.max(0, highE - prevHigh);
    rms[f] = lowE + highE;
    prevLow = lowE; prevHigh = highE;
  }
  // normalise
  let mx = 0; for (const v of env) mx = Math.max(mx, v); if (mx > 0) for (let i = 0; i < frames; i++) env[i] /= mx;
  const fps = sr / hop;
  const sample = (tSec) => { const x = tSec * fps; const i = Math.floor(x); if (i < 0 || i + 1 >= frames) return 0; return env[i] + (env[i + 1] - env[i]) * (x - i); };
  const dur = n / sr;
  let best = { score: -1 }, scores = [];
  for (let bpm = bpmMin; bpm <= bpmMax; bpm += 0.25) {
    const p = 60 / bpm;
    let bs = -1, bo = 0;
    for (let o = 0; o < p; o += 0.005) {
      let s = 0, k = 0;
      for (let tt = o; tt < dur; tt += p) { s += sample(tt); k++; }
      s /= Math.max(1, k);
      if (s > bs) { bs = s; bo = o; }
    }
    scores.push(bs);
    if (bs > best.score) best = { score: bs, bpm, offsetSec: bo };
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const confidence = mean > 0 ? best.score / mean : 0;
  // refine BPM to 0.01
  const p0 = 60 / best.bpm;
  for (let bpm = best.bpm - 0.25; bpm <= best.bpm + 0.25; bpm += 0.01) {
    const p = 60 / bpm;
    for (let o = Math.max(0, best.offsetSec - 0.03); o < best.offsetSec + 0.03; o += 0.002) {
      let s = 0, k = 0; for (let tt = o; tt < dur; tt += p) { s += sample(tt); k++; } s /= k;
      if (s > best.score) best = { ...best, score: s, bpm: Math.round(bpm * 100) / 100, offsetSec: o };
    }
  }
  void p0;
  // first beat: earliest grid point after audio actually starts
  let firstSound = 0; const thr = 0.02 * Math.max(...rms.slice(0, Math.min(frames, 2000)));
  for (let f = 0; f < frames; f++) if (rms[f] > thr) { firstSound = f / fps; break; }
  const per = 60 / best.bpm;
  let offset = best.offsetSec; while (offset + per < firstSound) offset += per;
  // per-bar energy
  const barLen = per * 4, bars = Math.floor((dur - offset) / barLen);
  const barEnergy = [];
  for (let b = 0; b < bars; b++) { let s = 0, k = 0; for (let f = Math.floor((offset + b * barLen) * fps); f < Math.floor((offset + (b + 1) * barLen) * fps) && f < frames; f++) { s += rms[f]; k++; } barEnergy.push(k ? s / k : 0); }
  const emax = Math.max(...barEnergy, 1e-6);
  return { bpm: best.bpm, offsetSec: Math.round(offset * 1000) / 1000, confidence, barEnergy: barEnergy.map((e) => e / emax), durationSec: dur };
}

function chartFor({ id, title, bpm, offsetSec, durationSec, barEnergy }) {
  const per = 60 / bpm, bars = Math.max(4, Math.floor((durationSec - offsetSec - 1) / (per * 4)));
  const energy = barEnergy && barEnergy.length >= bars ? barEnergy.slice(0, bars) : Array.from({ length: bars }, (_, i) => (i % 8 < 4 ? 0.5 : 0.9));
  return buildChart({
    song: { id, title, artist: '', audio: { storeKey: id, originalName: title }, durationSec },
    timing: { bpm, offsetSec, beatsPerBar: 4, tempoMap: [{ beat: 0, bpm }] },
    sections: guessSections(energy), totalBars: bars, lastBeat: bars * 4 - 1, seed: Math.round(bpm * 100),
  });
}

/** Import an audio file. Returns { id, title, bpm, offsetSec, confidence, autoFailed, stored } */
export async function importSongFile(file) {
  const buf = await file.arrayBuffer();
  let decoded;
  try { decoded = await audio.decode(buf.slice(0)); } catch { const e = new Error('decode'); e.code = 'decode'; throw e; }
  const id = `import-${Date.now().toString(36)}`;
  const title = file.name.replace(/\.[^.]+$/, '');
  let a = analyzeBuffer(decoded);
  const autoFailed = !(a.confidence > 1.4);
  if (autoFailed) a = { ...a, bpm: 120, offsetSec: 0 };
  const chart = chartFor({ id, title, bpm: a.bpm, offsetSec: a.offsetSec, durationSec: decoded.duration, barEnergy: a.barEnergy });
  const rec = { id, title, chart, audio: new Blob([buf], { type: file.type || 'audio/mpeg' }), analysis: a, importedAt: Date.now() };
  let stored = true;
  try { await idbPut('songs', rec); } catch { stored = false; memSongs.set(id, rec); }
  audio.buffers.set(`import:${id}:${rec.audio.size}`, decoded);
  return { id, title, bpm: a.bpm, offsetSec: a.offsetSec, confidence: a.confidence, autoFailed, stored };
}
/** Manually override BPM / first-beat offset of an imported song and rebuild its chart. */
export async function setSongTiming(id, bpm, offsetSec) {
  const rec = (await idbGet('songs', id)) || memSongs.get(id);
  if (!rec) throw new Error('not found');
  rec.chart = chartFor({ id, title: rec.title, bpm, offsetSec, durationSec: rec.chart.song.durationSec, barEnergy: rec.analysis?.barEnergy });
  try { await idbPut('songs', rec); } catch { memSongs.set(id, rec); }
  return rec.chart;
}
/** Re-attach audio to an imported song whose blob was lost (browser asked to reselect). */
export async function reattachAudio(id, file) {
  const rec = (await idbGet('songs', id)) || memSongs.get(id);
  if (!rec) throw new Error('not found');
  rec.audio = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' });
  try { await idbPut('songs', rec); } catch { memSongs.set(id, rec); }
}
export async function deleteSong(id) { memSongs.delete(id); await idbDel('songs', id).catch(() => {}); }
