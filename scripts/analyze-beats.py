import librosa, numpy as np, sys
y, sr = librosa.load(sys.argv[1], sr=44100, mono=True)
hop=128
on=librosa.onset.onset_strength(y=y,sr=sr,hop_length=hop); t=librosa.frames_to_time(np.arange(len(on)),sr=sr,hop_length=hop)
def score(p,o,a,b):
  g=np.arange(o,56.5,p); g=g[(g>=a)&(g<b)]; return np.interp(g,t,on).mean()
for bpm in np.arange(124.6,125.41,0.1):
  p=60/bpm; s,o=max((score(p,o,0,57),o) for o in np.arange(0,p,0.002)); print(round(bpm,2),round(s,3),round(o,4))
p=0.48; 
for a,b in [(0,15),(15,30),(30,45),(42,56)]:
  s,o=max((score(p,o,a,b),o) for o in np.arange(0,p,0.002)); print("seg",a,b,round(o,4))
# downbeat: low-freq energy per beat phase mod 4
S=np.abs(librosa.stft(y,n_fft=2048,hop_length=512)); f=librosa.fft_frequencies(sr=sr,n_fft=2048)
low=S[f<150].sum(0); tl=librosa.frames_to_time(np.arange(len(low)),sr=sr,hop_length=512)
o=0.335
for ph in range(4):
  g=np.arange(o+ph*p,56,4*p); print("phase",ph,round(np.interp(g,tl,low).mean(),1), round(np.interp(g,t,on).mean(),2))
# 8th / 16th note onset strength
for sub in [2,4]:
  g=np.arange(o+p/sub,56,p); print("off",sub,round(np.interp(g,t,on).mean(),2))
