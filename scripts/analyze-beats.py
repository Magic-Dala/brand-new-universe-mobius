# Quick beat check for any song: BPM, first-beat phase, drift and the bar phase (librosa + an onset phase search).
#   python3 scripts/analyze-beats.py <file> [bpm_min bpm_max]        (default 80 200)
# Prints the best BPM (0.01 steps), the phase of the beat grid over the whole song and in six segments (equal phases =
# no drift), the low-frequency energy and onset strength on each beat of a bar (the downbeat usually has the most), and
# the onset strength on the off-beats. The full analysis for a chart: scripts/charts/analyze-song.py.
import sys
import librosa, numpy as np
f = sys.argv[1]
lo, hi = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (80.0, 200.0)
y, sr = librosa.load(f, sr=44100, mono=True)
dur = len(y) / sr
hop = 128
on = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop); t = librosa.frames_to_time(np.arange(len(on)), sr=sr, hop_length=hop)
def score(p, o, a, b):
  g = np.arange(o, dur, p); g = g[(g >= a) & (g < b)]; return np.interp(g, t, on).mean() if len(g) else 0
coarse = max(np.arange(lo, hi + 1e-9, 0.25), key=lambda bpm: max(score(60 / bpm, o, 0, dur) for o in np.arange(0, 60 / bpm, 0.004)))
best = None
for bpm in np.arange(coarse - 0.3, coarse + 0.301, 0.01):
  p = 60 / bpm; s, o = max((score(p, o, 0, dur), o) for o in np.arange(0, p, 0.002))
  if best is None or s > best[0]: best = (s, bpm, o)
s, bpm, o = best; p = 60 / bpm
print(f'BPM {bpm:.2f}  phase {o:.3f} s  score {s:.3f}')
segs = np.linspace(0, dur, 7)
for a, b in zip(segs[:-1], segs[1:]):
  s2, o2 = max((score(p, x, a, b), x) for x in np.arange(0, p, 0.002)); print(f'segment {a:6.1f}-{b:6.1f} s  phase {o2:.3f} s')
# downbeat: low-frequency energy per beat of the bar
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512)); fr = librosa.fft_frequencies(sr=sr, n_fft=2048)
low = S[fr < 150].sum(0); tl = librosa.frames_to_time(np.arange(len(low)), sr=sr, hop_length=512)
for ph in range(4):
  g = np.arange(o + ph * p, dur, 4 * p); print(f'beat {ph + 1} of 4 (from {o + ph * p:.3f} s): low {np.interp(g, tl, low).mean():.1f}  onset {np.interp(g, t, on).mean():.2f}')
for sub in (2, 4):
  g = np.arange(o + p / sub, dur, p); print(f'off-beat 1/{sub}: onset {np.interp(g, t, on).mean():.2f}')
