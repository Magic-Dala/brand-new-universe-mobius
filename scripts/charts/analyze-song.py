"""Analyse a song for the Arcade chart builder (scripts/charts/build-chart.mjs) and write <id>.analysis.json.

  pip install librosa
  python3 scripts/charts/analyze-song.py <file.mp3> <id> [--bpm 150] [--bpm-range 140 160] [--offset 0.31] [--grid kick|onset]

What it finds (printed as it goes, and written to scripts/charts/<id>.analysis.json):
  - tempo: the BPM whose beat grid lines up best with the onsets (0.01 BPM steps), and its phase in six segments (drift);
  - the beat: the onset grid has two candidates half a beat apart; --grid kick (default) takes the one the kick drum
    (30-110 Hz onsets) sits on, --grid onset the one with the stronger onsets overall;
  - the downbeat ("1"): which of the four beats of a bar carries the kick and the big entrances (energy jumps);
  - sections: bars grouped by loudness (intro / verse / chorus / break / outro), never shorter than 4 bars;
  - for every half-beat slot from the first downbeat: onset strength, kick strength and loudness (0 ... 1);
  - accents: the strongest downbeats of loud and medium sections (where a giant pumpkin may go);
  - runs (three or more strong hits on consecutive beats or half beats) and held notes (a sound that sustains for two
    beats or more with no new hit): where an armored pumpkin may go. Each ends on the beat that follows it.
The chart builder reads only the JSON, so the charts can be rebuilt without Python. Nothing here knows a particular song.
"""
import argparse, json, os, sys
import numpy as np
import librosa

ap = argparse.ArgumentParser()
ap.add_argument('file'); ap.add_argument('id')
ap.add_argument('--bpm', type=float); ap.add_argument('--bpm-range', type=float, nargs=2, default=(80, 200))
ap.add_argument('--offset', type=float, help='first downbeat (s); skips the beat and downbeat search')
ap.add_argument('--grid', choices=['kick', 'onset'], default='kick')
ap.add_argument('--out', default=None)
A = ap.parse_args()

y, sr = librosa.load(A.file, sr=44100, mono=True)
dur = len(y) / sr
hop = 256
M = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=hop, n_mels=128, fmax=16000)
mf = librosa.mel_frequencies(n_mels=128, fmax=16000)
dB = librosa.power_to_db(M)
def band_onset(lo, hi):
    idx = np.where((mf >= lo) & (mf < hi))[0]
    return librosa.onset.onset_strength(S=dB[idx], sr=sr, hop_length=hop)
ON = librosa.onset.onset_strength(S=dB, sr=sr, hop_length=hop)
KICK = band_onset(30, 110)
RMS = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
n = min(len(ON), len(KICK), len(RMS)); ON, KICK, RMS = ON[:n], KICK[:n], RMS[:n]
T = librosa.frames_to_time(np.arange(n), sr=sr, hop_length=hop)

def peak(sig, x, w=0.02):
    m = (T >= x - w) & (T <= x + w)
    return float(sig[m].max()) if m.any() else 0.0
def grid_score(sig, p, o, a=0, b=None):
    g = np.arange(o, dur if b is None else b, p); g = g[g >= a]
    return float(np.interp(g, T, sig).mean()) if len(g) else 0.0

# ------------------------------------------------------------------ tempo
if A.bpm:
    bpm = A.bpm
else:
    lo, hi = A.bpm_range; best = None
    for b in np.arange(lo, hi + 1e-9, 0.25):
        p = 60 / b; s = max(grid_score(ON, p, o) for o in np.arange(0, p, 0.004))
        if best is None or s > best[0]: best = (s, b)
    best2 = None
    for b in np.arange(best[1] - 0.3, best[1] + 0.3001, 0.01):
        p = 60 / b; s = max(grid_score(ON, p, o) for o in np.arange(0, p, 0.002))
        if best2 is None or s > best2[0]: best2 = (s, round(b, 2))
    bpm = best2[1]
p = 60 / bpm
phase = max(np.arange(0, p, 0.002), key=lambda o: grid_score(ON, p, o))
segs = np.linspace(0, dur, 7)
seg_phase = [round(float(max(np.arange(0, p, 0.002), key=lambda o: grid_score(ON, p, o, a, b))), 3) for a, b in zip(segs[:-1], segs[1:])]
print(f'tempo {bpm:.2f} BPM (beat {p:.4f} s); onset phase {phase:.3f} s; per segment {seg_phase}')

# ------------------------------------------------------------------ the beat (two grids half a beat apart) and the downbeat
gridA, gridB = float(phase), float((phase + p / 2) % p)
ev_grid = []
for name, o in (('A', gridA), ('B', gridB)):
    g = np.arange(o, dur, p)
    ev_grid.append({'grid': name, 'phase': round(o, 3), 'kick': round(float(np.mean([peak(KICK, x) for x in g])), 3), 'onset': round(float(np.mean([peak(ON, x) for x in g])), 3),
                    'kickBySegment': [round(float(np.mean([peak(KICK, x) for x in g if a <= x < b])), 3) for a, b in zip(segs[:-1], segs[1:])]})
key = 'kick' if A.grid == 'kick' else 'onset'
beat_grid = max(ev_grid, key=lambda e: e[key])
print('beat grids:', json.dumps(ev_grid))
print(f'beat grid: {beat_grid["grid"]} (phase {beat_grid["phase"]} s), chosen by {key}')
o = beat_grid['phase']
beats = np.arange(o, dur, p)
# energy entrances: loudness of the next 8 beats against the previous 8
rms_beat = np.array([float(RMS[(T >= x) & (T < x + p)].mean()) if ((T >= x) & (T < x + p)).any() else 0.0 for x in beats])
def novelty(W): return np.array([max(0.0, rms_beat[i:i + W].mean() - rms_beat[i - W:i].mean()) if i >= W else 0.0 for i in range(len(beats))])
nov = 0.5 * (novelty(8) + novelty(16))  # section-scale entrances (a pickup or a fill is too short to show here)
peaks = [i for i in range(len(nov)) if nov[i] > 0 and nov[i] == nov[max(0, i - 2):i + 3].max()]
top = sorted(peaks, key=lambda i: -nov[i])[:8]
kick_b = np.array([peak(KICK, x) for x in beats])
down = []
for m in range(4):
    sel = np.arange(m, len(beats), 4)
    down.append({'phase': m, 'kick': round(float(kick_b[sel].mean() / (kick_b.mean() + 1e-9)), 3), 'entrances': round(float(sum(nov[i] for i in top if i % 4 == m) / (nov[top[0]] + 1e-12)), 3)})  # (weighted by size: the biggest entrance counts 1)
on_b = np.array([peak(ON, x) for x in beats]); first_beat = int(np.argmax(on_b > 0.3 * on_b.max()))
for m in range(4): down[m]['firstSound'] = 1 if first_beat % 4 == m else 0  # a song usually starts on "1"
# chords and the bass usually change on "1": harmonic change from one beat to the next (chroma of the harmonic part, and of the bass)
yh = librosa.effects.harmonic(y)
CH = librosa.feature.chroma_cqt(y=yh, sr=sr, hop_length=512); TC = librosa.frames_to_time(np.arange(CH.shape[1]), sr=sr, hop_length=512)
ylo = librosa.resample(yh, orig_sr=sr, target_sr=4000)
CL = librosa.feature.chroma_stft(y=ylo, sr=4000, n_fft=2048, hop_length=128); TL = librosa.frames_to_time(np.arange(CL.shape[1]), sr=4000, hop_length=128)
def change(Cm, Tm):
    v = np.array([Cm[:, (Tm >= x) & (Tm < x + p)].mean(1) if ((Tm >= x) & (Tm < x + p)).any() else np.zeros(12) for x in beats]); v /= np.linalg.norm(v, axis=1, keepdims=True) + 1e-9
    return np.r_[0, 1 - (v[1:] * v[:-1]).sum(1)]
chord, bass = change(CH, TC), change(CL, TL)
for m in range(4): down[m]['chordChange'] = round(float(chord[m::4].mean()), 4); down[m]['bassChange'] = round(float(bass[m::4].mean()), 4)
score = lambda m: sum(down[m][k] / (max(d[k] for d in down) + 1e-9) for k in ('entrances', 'chordChange', 'bassChange', 'kick', 'firstSound'))
for m in range(4): down[m]['score'] = round(score(m), 3)
ranked = sorted(range(4), key=lambda m: -score(m))
dm = ranked[0]  # each measure scaled to its best phase, summed: no single one decides
close = score(ranked[1]) > 0.95 * score(ranked[0])
if close:  # a near tie: the section entrances decide (the bar lines the charts care most about: fan rows, giant pumpkins)
    dm = max(range(4), key=lambda m: down[m]['entrances'])
    print(f'downbeat: near tie ({score(ranked[0]):.3f} vs {score(ranked[1]):.3f}): the section entrances decide')
print('the 8 biggest section entrances (beat, s, beat of the bar, size):', [(int(i), round(float(beats[i]), 2), int(i % 4), round(float(nov[i]), 3)) for i in sorted(top)])
print('downbeat evidence per beat of the bar (kick relative to the mean, section entrances among the 8 biggest, chord change, bass change, the first sound; score = each scaled to its best and summed):', json.dumps(down), '→', dm)
offset = float(o + dm * p) if A.offset is None else A.offset
if A.offset is not None: print(f'first downbeat given: {offset} s')

# ------------------------------------------------------------------ slots (half beats from the first downbeat)
half = p / 2
k_n = int((dur - offset) / half)
slot_t = offset + np.arange(k_n) * half
on_s = np.array([peak(ON, x) for x in slot_t]); kick_s = np.array([peak(KICK, x) for x in slot_t])
rms_s = np.array([float(RMS[(T >= x - half / 2) & (T < x + half / 2)].mean()) for x in slot_t])
nz = lambda v: v / (np.percentile(v, 99) + 1e-9)
on_n, kick_n, rms_n = np.clip(nz(on_s), 0, 1), np.clip(nz(kick_s), 0, 1), np.clip(nz(rms_s), 0, 1)
# where the music ends: the last moment the loudness (over half a second) is above a quarter of its typical level
sm = np.convolve(rms_n, np.ones(5) / 5, mode='same')
loud_ref = np.percentile(sm, 90)
end_slot = int(np.where(sm > 0.35 * loud_ref)[0].max())
music_end = float(slot_t[end_slot])
hit_thr = max(0.25, float(np.percentile(on_n[: end_slot + 1], 60)))
last_hit = int(max(i for i in range(end_slot + 1) if on_n[i] >= hit_thr))
print(f'music ends about {music_end:.2f} s; last strong hit {slot_t[last_hit]:.2f} s')

# ------------------------------------------------------------------ sections
bar = 8  # slots per bar
nb = int(np.ceil(k_n / bar))
bar_e = np.array([rms_n[b * bar:(b + 1) * bar].mean() for b in range(nb)])
end_bar = int(end_slot // bar)
inside = bar_e[: end_bar + 1]
q1, q2 = np.percentile(inside, 30), np.percentile(inside, 68)
sm_bar = np.convolve(bar_e, np.ones(2) / 2, mode='same')
cls = ['quiet' if e < q1 else 'loud' if e > q2 else 'medium' for e in sm_bar]
runs = []
for b in range(nb):
    c = cls[b] if b <= end_bar else 'tail'
    if runs and runs[-1][2] == c: runs[-1][1] = b + 1
    else: runs.append([b, b + 1, c])
changed = True
while changed:  # merge runs shorter than 4 bars into the neighbour with the closer loudness
    changed = False
    for i, r in enumerate(runs):
        if r[1] - r[0] < 4 and r[2] != 'tail' and len(runs) > 1:
            e = bar_e[r[0]:r[1]].mean()
            nbrs = [j for j in (i - 1, i + 1) if 0 <= j < len(runs) and runs[j][2] != 'tail']
            if not nbrs: continue
            j = min(nbrs, key=lambda j: abs(bar_e[runs[j][0]:runs[j][1]].mean() - e))
            runs[j] = [min(runs[j][0], r[0]), max(runs[j][1], r[1]), runs[j][2]]; runs.pop(i); changed = True; break
    for i in range(len(runs) - 1, 0, -1):
        if runs[i][2] == runs[i - 1][2]: runs[i - 1][1] = runs[i][1]; runs.pop(i); changed = True
sections = []
first_on = next((i for i, r in enumerate(runs) if r[2] != 'quiet'), 0)
for i, (a, b, c) in enumerate(runs):
    kind = 'outro' if c == 'tail' else 'intro' if i < first_on else {'quiet': 'break', 'medium': 'verse', 'loud': 'chorus'}[c]
    sections.append({'fromBar': a, 'toBar': b, 'kind': kind, 'energy': round(float(bar_e[a:b].mean()), 3), 'fromSec': round(offset + a * 4 * p, 2), 'toSec': round(offset + b * 4 * p, 2)})
if sections[-1]['kind'] != 'outro':
    sections[-1]['toBar'] = nb
print('sections:'); [print('  bars %3d-%3d  %6.1f-%6.1f s  %-6s energy %.2f' % (s['fromBar'], s['toBar'] - 1, s['fromSec'], s['toSec'], s['kind'], s['energy'])) for s in sections]
kind_at = lambda b: next((s['kind'] for s in sections if s['fromBar'] <= b < s['toBar']), 'outro')

# ------------------------------------------------------------------ accents (downbeats)
# strength of a downbeat = its onset and kick against the typical downbeat of its own section (a dense chorus has its
# accents too), plus a section entry and a downbeat a fill leads into; the strongest 45 % of each section are accents
acc = []
for sec in sections:
    if sec['kind'] in ('intro', 'outro', 'break'): continue
    dbs = [b for b in range(sec['fromBar'], sec['toBar']) if b * bar <= end_slot]
    if not dbs: continue
    mo = float(np.median([on_n[b * bar] for b in dbs])) + 1e-3; mk = float(np.median([kick_n[b * bar] for b in dbs])) + 1e-3
    cand = []
    for b in dbs:
        sl = b * bar
        entry = b == sec['fromBar']
        after_fill = sl >= 4 and on_n[sl - 4:sl].mean() > 1.25 * float(np.mean([on_n[x * bar - 4:x * bar].mean() for x in dbs if x * bar >= 4]))
        st = 0.5 * on_n[sl] / mo + 0.5 * kick_n[sl] / mk + (0.6 if entry else 0) + (0.25 if after_fill else 0)
        cand.append({'bar': b, 'beat': b * 4, 'sec': round(float(slot_t[sl]), 3), 'strength': round(float(st), 3),
                     'reason': f"{sec['kind']} entry" if entry else f"downbeat a fill leads into ({sec['kind']})" if after_fill else f"strong downbeat ({sec['kind']})"})
    cut = np.percentile([c['strength'] for c in cand], 55)
    acc += [c for c in cand if c['strength'] >= cut]
accents = sorted(acc, key=lambda a: a['beat'])
print(f'accents: {len(accents)} downbeats')

# ------------------------------------------------------------------ runs and held notes
body = on_n[: end_slot + 1]
strong_thr = max(0.35, float(np.percentile(body, 66)))
# a run (a fill): three or more strong hits in a row on consecutive beats or half beats, ending on the last beat before
# a downbeat — the shell beats ride it and the wave lands on the downbeat it leads into. "Strong" is measured against the
# section's own beats (a dense chorus and a sparse verse each have their runs); busier = the run's beats against the bar before.
sec_med = {}
for sec in sections:
    sl = [i for i in range(sec['fromBar'] * bar, min(sec['toBar'] * bar, end_slot + 1)) if i % 2 == 0]
    sec_med[sec['fromBar']] = float(np.median(on_n[sl])) if sl else 1.0
med_at = lambda i: next((sec_med[sec['fromBar']] for sec in sections if sec['fromBar'] * bar <= i < sec['toBar'] * bar), 1.0)
runs_out = []
for b in range(2, nb):
    D = b * bar
    if D > end_slot or kind_at(b - 1) in ('intro', 'outro'): continue
    thr = max(0.2, 0.85 * med_at(D - 1))
    beat_hits = 0
    for i in (D - 2, D - 4, D - 6, D - 8):  # consecutive strong beats back from the last beat
        if on_n[i] >= thr: beat_hits += 1
        else: break
    half_hits = 0
    for i in range(D - 1, D - 9, -1):  # consecutive strong half beats back from the last half beat
        if on_n[i] >= thr: half_hits += 1
        elif half_hits == 0 and i == D - 1: continue  # (the run may end on the last beat itself)
        else: break
    hits = max(beat_hits, half_hits)
    if hits < 3: continue
    span = 2 * beat_hits if beat_hits >= half_hits else half_hits + 1
    busy = float(on_n[D - span:D].mean()) / (float(on_n[D - span - bar:D - span].mean()) + 1e-6)
    change = any(sec['fromBar'] == b for sec in sections)
    runs_out.append({'kind': 'run', 'fromSlot': D - span, 'toSlot': D - 1, 'hits': hits, 'onBeats': beat_hits >= half_hits, 'endBeat': D // 2, 'endSec': round(float(offset + D * half), 3),
                     'strength': round(float(on_n[D - span:D].mean()) / max(med_at(D - 1), 1e-3), 3), 'busier': round(busy, 2), 'sectionChange': bool(change)})
held = []
quiet_on = float(np.percentile(body, 45))
i = 0
while i <= end_slot:
    if on_n[i] < quiet_on and rms_n[i] > 0.5 and kind_at(i // bar) not in ('intro', 'outro'):
        j = i
        while j + 1 <= end_slot and on_n[j + 1] < quiet_on and rms_n[j + 1] > 0.45: j += 1
        if j - i + 1 >= 4:  # two beats or more with no new hit
            start = i - 1 if i > 0 and on_n[i - 1] >= quiet_on else i  # the hit that starts the held sound
            nxt = j + 1 + ((j + 1) % 2)
            held.append({'kind': 'held', 'fromSlot': int(start), 'toSlot': int(j), 'beats': round((j - start + 1) / 2, 1), 'endBeat': int(nxt // 2), 'endSec': round(float(offset + nxt * half), 3), 'strength': round(float(rms_n[start:j + 1].mean()), 3)})
        i = j + 1
    else: i += 1
print(f'runs: {len(runs_out)}; held notes: {len(held)}')

out = {
    'id': A.id, 'source': os.path.basename(A.file), 'durationSec': round(dur, 2),
    'tempo': {'bpm': bpm, 'beatSec': round(p, 5), 'onsetPhase': round(float(phase), 3), 'phaseBySegment': seg_phase, 'segmentsSec': [round(float(x), 1) for x in segs]},
    'beat': {'chosenBy': key, 'grids': ev_grid, 'grid': beat_grid['grid']},
    'downbeat': {'beatOfBar': dm, 'evidence': down, 'nearTie': bool(close)},
    'offsetSec': round(offset, 3), 'beatsPerBar': 4,
    'musicEndSec': round(music_end, 2), 'lastStrongHitSec': round(float(slot_t[last_hit]), 3), 'lastStrongHitSlot': last_hit,
    'sections': sections,
    'slots': {'per': 'half beat from offsetSec', 'onset': [round(float(v), 2) for v in on_n], 'kick': [round(float(v), 2) for v in kick_n], 'loud': [round(float(v), 2) for v in rms_n]},
    'accents': accents, 'runs': runs_out, 'held': held,
}
path = A.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), f'{A.id}.analysis.json')
with open(path, 'w') as f: json.dump(out, f, separators=(',', ':'))
print('wrote', path, os.path.getsize(path), 'bytes')
