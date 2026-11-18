// v1.1 Arcade chart rules: never three pumpkins at once (outside the Fan Web), one job per pumpkin. PURE (no three.js,
// no DOM), song-agnostic: the same rules hold for built-in charts, charts generated for an imported song, hand-written
// charts and charts already stored in a browser. Times are ARRIVAL times in seconds (the judgement ring), so a rule means
// the same at 125, 150 and 170 BPM. Unit tested in tests/chartrules.test.mjs.
//   notes:     resolveNotes(...).notes — { id, time, type, hand, beat?, row? } (fan_web_row members carry `row`)
//   sequences: resolveNotes(...).sequences — the armored pumpkins { id, holdTime, shellTimes, waveTime }
export const CHART_RULES = {
  window: 0.35, maxInWindow: 2, // outside a fan_web_row: never more than 2 arrivals inside any 0.35 s
  minGap: { easy: 0.60, normal: 0.40, hard: 0.24 }, // s between arrivals that are not the two halves of a left + right double
  rowClear: { before: 0.72, after: 0.48, beatsBefore: 1.5, beatsAfter: 1.0 }, // s (and never less than 1.5 / 1 beats) around a fan_web_row with no other arrival
  bombGap: 2.9, // s between giant pumpkins (the Light Bomb's own gesture cooldown is 0.5 s: 2.9 s leaves time to aim, throw and see it land)
  heavyClear: 0.48, // s around a giant pumpkin with no other arrival: the throw gets the accent to itself
  doubleEps: 0.005, // s: two arrivals this close are one moment (a double)
  accentEps: 0.03, // s: a giant pumpkin this close to an accent sits on it
};
const EPS = 1e-6;
const isRow = (n) => !!n.row || n.type === 'fanRow' || n.type === 'fan_web_row';
const isDoublePair = (a, b, R) => Math.abs(a.time - b.time) <= R.doubleEps && ((a.hand === 'L' && b.hand === 'R') || (a.hand === 'R' && b.hand === 'L')) && a.type === 'pumpkin' && b.type === 'pumpkin';

/**
 * Every place a difficulty breaks the rules: [{ rule, ids, time }]. rule ∈ cluster | window | minGap | rowClear | bombGap |
 * heavyClear | accent | armoredGap | armoredClear. opts.accents: accent times (s) when the chart has accent data (a giant
 * pumpkin off them is a violation); opts.sequences: the armored sequences (shell spacing ≥ minGap, nothing else from the
 * hold to the wave). opts.secPerBeat (or a note's `beat`) lets the row rule use its beat minimum.
 */
export function chartViolations(notes, difficulty, rules = CHART_RULES, opts = {}) {
  const R = rules, out = [], minGap = R.minGap[difficulty] ?? R.minGap.normal;
  const all = notes.slice().sort((a, b) => a.time - b.time);
  for (const n of all) if (n.type === 'cluster') out.push({ rule: 'cluster', ids: [n.id], time: n.time });
  const A = all.filter((n) => !isRow(n)); // arrivals (a fan row and an armored shell beat are not)
  // window: at most maxInWindow arrivals inside any `window` s
  for (let i = 0, j = 0; i < A.length; i++) {
    while (A[i].time - A[j].time >= R.window - EPS) j++;
    if (i - j + 1 > R.maxInWindow) out.push({ rule: 'window', ids: A.slice(j, i + 1).map((n) => n.id), time: A[j].time });
  }
  // minGap between consecutive moments (arrivals within doubleEps are one moment; two on one moment must be the two
  // halves of a left + right double)
  let m0 = null;
  for (let i = 0; i < A.length; i++) {
    const b = A[i];
    if (m0 && b.time - m0.time <= R.doubleEps) { if (!isDoublePair(m0, b, R)) out.push({ rule: 'minGap', ids: [m0.id, b.id], time: m0.time }); continue; }
    if (m0 && b.time - m0.time < minGap - EPS) out.push({ rule: 'minGap', ids: [m0.id, b.id], time: m0.time });
    m0 = b;
  }
  // fan rows: nothing else arrives in their clear time
  const rows = new Map(); for (const n of all) if (isRow(n)) rows.set(n.row || n.id, n);
  for (const r of rows.values()) {
    const spb = opts.secPerBeat || 0;
    const before = Math.max(R.rowClear.before, R.rowClear.beatsBefore * spb), after = Math.max(R.rowClear.after, R.rowClear.beatsAfter * spb);
    for (const n of A) {
      const tooClose = n.time > r.time - before + EPS && n.time < r.time + after - EPS;
      const beatClose = r.beat !== undefined && n.beat !== undefined && n.beat > r.beat - R.rowClear.beatsBefore + EPS && n.beat < r.beat + R.rowClear.beatsAfter - EPS;
      if (tooClose || beatClose) out.push({ rule: 'rowClear', ids: [r.row || r.id, n.id], time: r.time });
    }
  }
  // giant pumpkins: spacing, the accent to themselves, on an accent
  const H = A.filter((n) => n.type === 'heavy');
  for (let i = 1; i < H.length; i++) if (H[i].time - H[i - 1].time < R.bombGap - EPS) out.push({ rule: 'bombGap', ids: [H[i - 1].id, H[i].id], time: H[i - 1].time });
  for (const h of H) {
    for (const n of A) if (n !== h && Math.abs(n.time - h.time) < R.heavyClear - EPS) out.push({ rule: 'heavyClear', ids: [h.id, n.id], time: h.time });
    if (opts.accents && !opts.accents.some((t) => Math.abs(t - h.time) <= R.accentEps)) out.push({ rule: 'accent', ids: [h.id], time: h.time });
  }
  // armored sequences: shell beats at least minGap apart; nothing else from the hold to the wave (+ heavyClear for a giant)
  for (const q of opts.sequences || []) {
    for (let i = 1; i < q.shellTimes.length; i++) if (q.shellTimes[i] - q.shellTimes[i - 1] < minGap - EPS) out.push({ rule: 'armoredGap', ids: [q.id], time: q.shellTimes[i - 1] });
    const from = q.holdTime, to = q.waveTime;
    for (const n of all) {
      const pad = n.type === 'heavy' ? R.heavyClear : 0;
      if (n.time > from - pad + EPS && n.time < to + pad - EPS) out.push({ rule: 'armoredClear', ids: [q.id, n.id], time: n.time });
    }
  }
  return out;
}

/**
 * The loader's guard (window and maxInWindow only): walk the arrivals in time order and, wherever more than maxInWindow
 * fall inside one `window`, drop the latest ordinary pumpkin of that window. Deterministic; giant pumpkins, fan rows and
 * armored pumpkins are never dropped. Returns { notes (a new array, same order), dropped (the ids) }.
 */
export function enforceThree(notes, rules = CHART_RULES) {
  const R = rules, drop = new Set(), kept = [];
  const order = notes.map((n, i) => ({ n, i })).sort((a, b) => a.n.time - b.n.time || a.i - b.i);
  for (const { n } of order) {
    if (isRow(n) || n.type === 'armored') continue;
    kept.push(n);
    for (;;) {
      const inWin = kept.filter((k) => !drop.has(k.id) && n.time - k.time < R.window - EPS);
      if (inWin.length <= R.maxInWindow) break;
      const victim = inWin.filter((k) => k.type === 'pumpkin' || k.type === 'cluster').pop();
      if (!victim) break;
      drop.add(victim.id);
    }
  }
  return { notes: notes.filter((n) => !drop.has(n.id)), dropped: [...drop] };
}

/**
 * The generator's last pass on a difficulty's CHART events (beats): whatever the patterns above it produced, the result
 * keeps every rule. clock: makeBeatClock(timing). Order: stored clusters become pumpkins; rows clear their time; giant
 * pumpkins keep bombGap and their clear time; then minGap (a double stays only as a left + right pair) and the window.
 * Fan rows and armored events are never removed; a dropped event is the later / ordinary one.
 */
export function fitRules(events, clock, difficulty, rules = CHART_RULES) {
  const R = rules, minGap = R.minGap[difficulty] ?? R.minGap.normal;
  const T = (e) => e.timeSec ?? clock.beatToSec(e.beat);
  let ev = events.map((e) => (e.type === 'cluster' ? { ...e, type: 'pumpkin', hand: 'any', group: undefined } : e)).map((e) => { if (e.group === undefined) { const { group, ...rest } = e; void group; return rest; } return e; });
  const fixed = (e) => e.type === 'fan_web_row' || e.type === 'armored';
  // rows
  const rows = ev.filter((e) => e.type === 'fan_web_row');
  ev = ev.filter((e) => fixed(e) || !rows.some((r) => {
    const spb = 60 / clock.bpmAt(r.beat), before = Math.max(R.rowClear.before, R.rowClear.beatsBefore * spb), after = Math.max(R.rowClear.after, R.rowClear.beatsAfter * spb);
    const d = T(e) - T(r); return d > -before + EPS && d < after - EPS;
  }));
  // giant pumpkins: never with an armored sequence (hold … wave, ± heavyClear); bombGap (a later one too close becomes a
  // pumpkin), then their clear time
  const arm = ev.filter((e) => e.type === 'armored').map((q) => [clock.beatToSec(q.beat - 1), clock.beatToSec(q.beat + ((q.hits ?? 3) - 1) * (q.step ?? 1) + (q.gap ?? 2))]);
  let lastH = -Infinity;
  ev.sort((a, b) => T(a) - T(b) || String(a.id).localeCompare(String(b.id)));
  ev = ev.map((e) => {
    if (e.type !== 'heavy') return e;
    if (T(e) - lastH < R.bombGap - EPS || arm.some(([h, w]) => T(e) > h - R.heavyClear + EPS && T(e) < w + R.heavyClear - EPS)) return { ...e, type: 'pumpkin', hand: 'any' };
    lastH = T(e); return e;
  });
  const heavies = ev.filter((e) => e.type === 'heavy');
  ev = ev.filter((e) => e.type === 'heavy' || fixed(e) || !heavies.some((h) => Math.abs(T(e) - T(h)) < R.heavyClear - EPS));
  // minGap and doubles, in time order (giant pumpkins win over ordinary ones)
  const arr = ev.filter((e) => !fixed(e)), keep = new Set();
  let prev = []; // the arrivals kept at the previous moment
  for (let i = 0; i < arr.length;) {
    const t0 = T(arr[i]); let j = i; while (j < arr.length && T(arr[j]) - t0 <= R.doubleEps) j++;
    let group = arr.slice(i, j); i = j;
    const h = group.find((e) => e.type === 'heavy');
    if (h) group = [h];
    else if (group.length >= 2) { const L = group.find((e) => e.hand === 'L'), Rr = group.find((e) => e.hand === 'R'); group = L && Rr ? [L, Rr] : [group[0]]; }
    const tp = prev.length ? T(prev[0]) : -Infinity;
    if (t0 - tp < minGap - EPS) {
      if (group[0].type === 'heavy' && prev.every((e) => e.type !== 'heavy')) { for (const e of prev) keep.delete(e.id); } else continue;
    }
    for (const e of group) keep.add(e.id); prev = group;
  }
  ev = ev.filter((e) => fixed(e) || keep.has(e.id));
  // a double owns its moment: a neighbour inside `window` goes (not a half of the double)
  const pts = ev.filter((e) => !fixed(e)), dbl = [];
  for (let i = 1; i < pts.length; i++) if (Math.abs(T(pts[i]) - T(pts[i - 1])) <= R.doubleEps) dbl.push(T(pts[i]));
  ev = ev.filter((e) => fixed(e) || e.type === 'heavy' || !dbl.some((t) => { const d = Math.abs(T(e) - t); return d > R.doubleEps && d < R.window - EPS; }));
  // the window (a double next to another arrival inside `window`: the neighbour goes)
  const timed = ev.map((e) => ({ id: e.id, time: T(e), type: e.type, hand: e.hand, ...(e.type === 'fan_web_row' ? { row: e.id } : {}) }));
  const { dropped } = enforceThree(timed, R);
  const gone = new Set(dropped);
  return ev.filter((e) => !gone.has(e.id)).sort((a, b) => a.beat - b.beat || String(a.id).localeCompare(String(b.id)));
}
