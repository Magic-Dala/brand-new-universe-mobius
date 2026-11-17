// v0.48 screenshots (Goal 5.7): the hall at show levels 0 to 3 (on a beat peak) and the armored pumpkin at each stage.
// Saved under docs/screenshots/v0.48/. Desktop headless Chrome with software rendering, not a headset.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, openArcade } from './arcadeharness.mjs';
const OUT = new URL('../../docs/screenshots/v0.48/', import.meta.url); mkdirSync(OUT, { recursive: true });
const b = await launch();
const { p, errors } = await openArcade(b, { viewport: { width: 960, height: 540 } });
const shots = await p.evaluate(async () => {
  const X = window.__x, a = X.a, T = X.T, hall = a.interior, ar = X.ar, S = {};
  X.settings.arcadeArmored = true; X.settings.arcadeShow = true; X.begin('normal'); X.until(6);
  const grab = (cam = a.camera) => { a.renderer.render(a.scene, cam); return a.renderer.domElement.toDataURL('image/jpeg', 0.9); };
  const swing = [0.12, 0.16, 0.20, 0.25];
  for (let L = 0; L < 4; L++) { // every lamp at its peak (no chase), the accent colour of the level's place in the cycle
    hall.setShow({ beat: 1, level: L, dip: 0, hue: [[0.867, 0.4, 1.733], [1.75, 0.91, 0.34], [1.59, 0.31, 1.1], [1.75, 0.91, 0.34]][L], swing: swing[L], phase: 0.083, attack: 0.083, fall: 0.55, chase: 0, strips: L >= 2 ? 1 : 0, flare: L >= 3 ? swing[L] : 0, streak: L >= 3 ? 0.15 : 0 });
    hall.update(0, 100, a.camera); S[`hall-level-${L}`] = grab();
  }
  hall.setShow(); hall.update(0, 100, a.camera); S['hall-rest'] = grab();
  // the armored pumpkin at the centre judgement ring, each stage; a second camera 1.3 m in front of it
  const q = ar.seqs[0]; ar.debug.autoplayArmored = false; X.until(q.holdTime + 0.1);
  const cam = a.camera.clone(), eye = a.camera.getWorldPosition(new T.Vector3()), at = ar.armored.root.position.clone();
  cam.position.copy(at).add(eye.clone().sub(at).normalize().multiplyScalar(1.3)); cam.lookAt(at); cam.updateMatrixWorld(true);
  for (let st = 0; st <= 3; st++) { ar.armored.setStage(st); S[`armored-stage-${st}`] = grab(cam); }
  ar.armored.setStage(0); S['armored-in-play'] = grab();
  return S;
});
for (const [name, url] of Object.entries(shots)) { const f = new URL(`${name}.jpg`, OUT); writeFileSync(f, Buffer.from(url.split(',')[1], 'base64')); console.log(`docs/screenshots/v0.48/${name}.jpg`); }
console.log('errors', JSON.stringify(errors));
await b.close();
