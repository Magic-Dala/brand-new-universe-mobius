// Green Maniac (綠狂魔) — rigged Tripo/Mixamo model with baked Mixamo clips + procedural tail.
// Model: public/models/green_maniac_mixamo_tail.glb (= 3D_Models/Green_Maniac/
//   "Green Maniac 3d model (smart_mesh) rigged mixamo tail.glb": the smart_mesh model on the Mixamo-named rig the
//   animations were made on, + 8 weighted tail bones Tail_01..Tail_08 under mixamorig:Hips, + 4 trimmed clips:
//   wait (idle, loop), surf (riding the Green Bat Jet, loop), throw (pumpkin bomb, right hand), turn (~170° turn);
//   v4 adds stretch (waiting for the player: room window + factory interior, loop), dance (arcade, loop, tempo
//   matched to the song) and fall (kicked off the jet / falling through the roof: one-shot, holds the lying pose)).
// One AnimationMixer per instance; every state change is a fade (never a hard cut); throw / turn are LoopOnce +
// clampWhenFinished and fade back to the base loop (surf when riding, else wait). The tail is a TailSpring chain
// applied after mixer.update(). Same API as the procedural / v2 Green Maniac in enemies.js:
//   { root, update(dt, t), setState(name), throwHand, hitCenter, mesh, state }
// States: 'ride' / 'fly-away' → surf · 'stand' / 'crouch' → wait · 'hurt' → wait + shake · 'throw' · 'turn' ·
//   'stretch' / 'dance' → those loops as the base · 'fall' → fall clip, lies until the next base state (gets up with a fade)
//   · 'getup' (v5) → situp-to-idle clip from the lying pose, then wait ('stand')
//   · 'faceBack' (v6) → turn clip, then stretch facing BACKWARDS on the jet (toward Mobius behind him) · 'faceFront' →
//   the turn yawed 180° (back → front), then surf. A throw while facing back uses the 180°-yawed throw.
//   · 'taunt' (v0.46) → like 'faceBack', but the loop facing Mobius is the (yawed) taunt clip; 'faceFront' leaves it
//   · 'hit' (v0.46, setState('hit', 'head' | 'body')) → headHit / bodyHit one-shot (yawed while he faces Mobius), then back
//     to whatever base loop is current when it ends. Older GLB: taunt = faceBack, hit = the hurt shake. Returns true
//     when the reaction played, false when ignored (during throw / turn / turnFwd / fall / getup).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { TailSpring } from './TailSpring.js';
import { CLOSE } from '../data/closeCombat.js';

/** Animation tunables (seconds). Crossfades are all ~0.2–0.5 s. */
export const GM_ANIM = {
  fade: 0.3, // base loop ↔ base loop (wait ↔ surf)
  throwIn: 0.2, throwOut: 0.35, // into / out of a throw
  throwChain: 0.15, // a new throw while one is still playing (two alternating actions → still a fade)
  turnIn: 0.25, turnOut: 0.5, // the turn (and the turned-around throw) fade back slower: reads as turning back
  oneShotTail: 0.2, // a one-shot starts fading back this long before its clip ends (the rest of the fade holds its last frame)
  baseIn: 0.45, // into stretch / dance (slower: they are whole-body moves)
  fallIn: 0.12, // the kick is sudden
  getUp: 0.8, // fall (lying) → wait / surf / stretch / dance without the getup clip
  getUpIn: 0.5, getUpOut: 0.4, getUpSpeed: 1.35,
  angryIn: 0.3, angryOut: 0.4, angrySpeed: 1.2, // v7 'angry' clip (3.5 s → ≈ 2.9 s): roof (after getting up), lost battle, before the escape // v5 getup clip (Mixamo situp-to-idle, 4.4 s → ≈ 3.3 s): lying side → back → sits up → stands
  throwSpeed: 1.6, turnSpeed: 1.7, // time scales of the one-shot clips (turn: the 170° spin is done ≈ 0.6 s after setState)
  throwReleaseClip: 0.933, // s into the (trimmed) throw clip where the right hand releases (peak hand speed)
  height: 1.9, // m (same as the procedural Green Maniac)
};
/** Seconds from setState('throw') to the bomb leaving the hand. */
export const gmThrowRelease = () => GM_ANIM.throwReleaseClip / GM_ANIM.throwSpeed;

const YAW_PI = new THREE.Quaternion(0, 1, 0, 0);

/** Loads the GLB once; returns the shared model (instances are cloned in createGreenManiacAnimated). */
export async function loadGreenManiacAnimated(path = 'models/green_maniac_mixamo_tail.glb') {
  const base = (import.meta.env && import.meta.env.BASE_URL) || './';
  const href = new URL(path.startsWith('/') ? path : base + path, document.baseURI).href;
  const gltf = await new GLTFLoader().loadAsync(href);
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  for (const k of ['wait', 'surf', 'throw', 'turn']) if (!clips[k]) throw new Error(`${path}: missing clip '${k}'`);
  // v4 clips are optional (an older GLB still works: stretch / dance fall back to wait, fall to the hurt shake)
  for (const k of ['stretch', 'dance']) if (!clips[k]) { clips[k] = clips.wait.clone(); clips[k].name = k; }
  // (v5 'getup' is optional too: without it 'getup' = a slow fade from the lying pose to wait)
  // throw played right after the turn: same clip with the hips yawed 180° (he is facing backwards by then)
  const back = clips.throw.clone(); back.name = 'throwBack';
  const hq = back.tracks.find((t) => t.name.endsWith('Hips.quaternion'));
  if (hq) { const v = hq.values, q = new THREE.Quaternion(); for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i).premultiply(YAW_PI); q.toArray(v, i); } }
  clips.throwBack = back;
  clips.throw2 = clips.throw.clone(); clips.throw2.name = 'throw2'; // second action → back-to-back throws still crossfade
  // v6: facing backwards on the jet (toward Mobius behind him): stretch yawed 180°, and the turn yawed 180° (= turning
  // from facing backwards back to the front)
  const yawed = (src, name) => { const c = src.clone(); c.name = name; const h = c.tracks.find((t) => t.name.endsWith('Hips.quaternion')); if (h) { const v = h.values, q = new THREE.Quaternion(); for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i).premultiply(YAW_PI); q.toArray(v, i); } } return c; };
  clips.stretchBack = yawed(clips.stretch, 'stretchBack');
  if (clips.angry) { clips.angryLoop = clips.angry.clone(); clips.angryLoop.name = 'angryLoop'; } // (looping copy: lost the battle)
  clips.turnFwd = yawed(clips.turn, 'turnFwd');
  // v0.46 optional close-combat clips: taunt (loop), headHit / bodyHit (one-shots). Facing Mobius: 180°-yawed copies.
  // Each hit clip gets a second copy (…2) so a hit during a hit restarts the other action → a crossfade, never a pop.
  if (clips.taunt) clips.tauntBack = yawed(clips.taunt, 'tauntBack');
  for (const k of ['headHit', 'bodyHit']) {
    if (!clips[k]) continue;
    clips[k + 'Back'] = yawed(clips[k], k + 'Back');
    for (const n of [k, k + 'Back']) { clips[n + '2'] = clips[n].clone(); clips[n + '2'].name = n + '2'; }
  }
  let mesh = null; gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!mesh) throw new Error(`${path}: no skinned mesh`);
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
  const hips = gltf.scene.getObjectByName('mixamorigHips');
  const hp = hips.getWorldPosition(new THREE.Vector3());
  const scale = GM_ANIM.height / (box.max.y - box.min.y);
  return { scene: gltf.scene, clips, scale, offset: new THREE.Vector3(-hp.x * scale, -box.min.y * scale, -hp.z * scale), material: mesh.material };
}

export function createGreenManiacAnimated(model) {
  const root = new THREE.Group(); root.name = 'green-maniac';
  const inner = cloneSkinned(model.scene); // shares geometry / material / clips; own skeleton + mixer
  inner.scale.setScalar(model.scale); inner.position.copy(model.offset); // feet on y = 0, hips over the origin, faces +Z
  root.add(inner);
  let mesh = null; inner.traverse((o) => { if (o.isSkinnedMesh) { mesh ??= o; o.frustumCulled = false; } });
  const bone = (n) => inner.getObjectByName(n);
  const spine2 = bone('mixamorigSpine2'), handR = bone('mixamorigRightHand');

  // attachments (same names / roles as before): bomb spawn just past the right palm, hit centre on the chest
  inner.updateMatrixWorld(true);
  const throwHand = new THREE.Object3D(); throwHand.name = 'throwHand';
  const mid = bone('mixamorigRightHandMiddle1'); if (mid) throwHand.position.copy(mid.position).multiplyScalar(1.3);
  handR.add(throwHand);
  const hitCenter = new THREE.Object3D(); hitCenter.name = 'hitCenter';
  const hc = spine2.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05 * model.scale / 1.9, 0.08 * model.scale / 1.9));
  hitCenter.position.copy(spine2.worldToLocal(hc)); spine2.add(hitCenter);

  // animation
  const mixer = new THREE.AnimationMixer(inner);
  const A = {};
  const HITS = ['headHit', 'headHit2', 'bodyHit', 'bodyHit2', 'headHitBack', 'headHitBack2', 'bodyHitBack', 'bodyHitBack2'];
  for (const k of ['wait', 'surf', 'throw', 'throw2', 'throwBack', 'turn', 'turnFwd', 'stretch', 'stretchBack', 'dance', 'fall', 'getup', 'angry', 'angryLoop', 'tauntBack', ...HITS]) if (model.clips[k]) A[k] = mixer.clipAction(model.clips[k]);
  for (const k of ['throw', 'throw2', 'throwBack', 'turn', 'turnFwd', 'fall', 'getup', 'angry', ...HITS]) if (A[k]) { A[k].setLoop(THREE.LoopOnce, 1); A[k].clampWhenFinished = true; }
  for (const k of ['angry', 'angryLoop']) if (A[k]) A[k].timeScale = GM_ANIM.angrySpeed;
  A.turnFwd.timeScale = GM_ANIM.turnSpeed;
  if (A.getup) A.getup.timeScale = GM_ANIM.getUpSpeed;
  for (const k of ['throw', 'throw2', 'throwBack']) A[k].timeScale = GM_ANIM.throwSpeed;
  A.turn.timeScale = GM_ANIM.turnSpeed;
  // Weight fades are driven here (linear, per action, normalised to sum 1) instead of action.fadeIn/fadeOut:
  // three's fadeOut() always starts from weight 1, which pops when a fade is interrupted (rapid arcade throws,
  // turn → throw). Every change below is therefore a crossfade of `dur` seconds from the CURRENT blend.
  const acts = Object.values(A), W = new Map(acts.map((a) => [a, { w: 0, to: 0, rate: 1, on: false }]));
  let cur = null; // the action fading in / dominant
  function fadeTo(action, dur, restart = action.loop === THREE.LoopOnce) {
    if (cur === action && !restart) return;
    const st = W.get(action);
    if (restart || !st.on) { action.reset(); action.play(); st.on = true; if (!cur) st.w = 1; } // (a clamped one-shot is paused, not stopped)
    for (const a of acts) { const s = W.get(a); s.to = a === action ? 1 : 0; s.rate = dur > 0 ? 1 / dur : 1e9; }
    cur = action;
  }
  function blend(dt) {
    let sum = 0;
    for (const a of acts) {
      const s = W.get(a); if (!s.on) continue;
      s.w = s.to > s.w ? Math.min(s.to, s.w + s.rate * dt) : Math.max(s.to, s.w - s.rate * dt);
      if (s.w <= 0 && s.to === 0) { a.stop(); s.w = 0; s.on = false; } else sum += s.w;
    }
    for (const a of acts) { const s = W.get(a); if (s.on) a.setEffectiveWeight(sum > 0 ? s.w / sum : 0); }
  }
  const w = (a) => W.get(a).w;
  let base = 'wait', state = 'stand', one = null, turned = false, hurtT = -1, lastT = NaN;
  let hitRet = null; // v0.46: the state a hit reaction returns to ('hurt' during a stagger; else the base loop's state)
  const baseAction = () => A[base];
  const isBack = (b) => b === 'stretchBack' || b === 'tauntBack'; // base loops facing Mobius (behind him on the jet)
  const baseState = () => (base === 'surf' ? 'ride' : base === 'wait' ? 'stand' : base === 'tauntBack' ? 'taunt' : base);
  const HIT_WINS = new Set(['ride', 'fly-away', 'faceBack', 'faceFront', 'taunt', 'throw', 'turn', 'fall', 'getup']); // these end a hit reaction at once
  const HIT_BLOCKED = new Set(['throw', 'turn', 'turnFwd', 'fall', 'getup']); // a hit reaction never interrupts these
  function setState(next, variant = 'head') {
    if (next === 'hit') return hit(variant); // (true = the reaction started, false = ignored)
    const endedHit = one === 'hit' && HIT_WINS.has(next); if (endedHit) one = null;
    // lying after a fall: a landing ('crouch') or more 'hurt' keeps him down; 'fall' again does not restart it
    if (one === 'fall' && (next === 'fall' || next === 'crouch' || next === 'hurt')) return;
    if (next === 'fall') {
      if (!A.fall) { setState('hurt'); return; } // older GLB: the shake instead
      base = 'wait'; hurtT = -1; fadeTo(A.fall, GM_ANIM.fallIn); one = 'fall'; turned = false; state = 'fall';
      return;
    }
    const wasDown = one === 'fall';
    if (wasDown) one = null; // any other state gets him up (slow fade from the lying pose)
    const prevBase = base;
    if (next === 'ride' || next === 'fly-away') base = 'surf';
    else if (next === 'stand' || next === 'crouch' || next === 'hurt') base = 'wait';
    else if (next === 'stretch' || next === 'dance') base = next;
    if (next === 'angry') { // v7: one-shot, then back to the current base loop (state → 'stand' / 'ride' / …)
      if (!A.angry) { state = base === 'surf' ? 'ride' : 'stand'; return; }
      if (one !== 'angry') { fadeTo(A.angry, GM_ANIM.angryIn); one = 'angry'; turned = false; state = 'angry'; }
      return;
    }
    if (next === 'angryLoop') { if (A.angryLoop) { base = 'angryLoop'; state = 'angryLoop'; if (!one) fadeTo(A.angryLoop, GM_ANIM.angryIn); } return; } // v7: lost the battle
    if (next === 'taunt' && !A.tauntBack) next = 'faceBack'; // (older GLB: no taunt clip)
    if (next === 'faceBack' || next === 'taunt') { // v6: turn around on the jet (turn clip) to face Mobius behind him, then stretch facing him
      // (v0.46 taunt: the same turn, then the taunt loop facing him; already facing him → a plain crossfade between the two loops)
      const loop = next === 'taunt' ? 'tauntBack' : 'stretchBack';
      if (base !== loop) {
        const wasBack = isBack(base); base = loop; state = next;
        if (wasBack) { if (!one) fadeTo(A[loop], CLOSE.anim.tauntIn); }
        else if (one !== 'turn') { fadeTo(A.turn, GM_ANIM.turnIn); one = 'turn'; turned = false; }
      } else if (endedHit) { state = next === 'taunt' ? 'taunt' : baseState(); fadeTo(A[loop], CLOSE.anim.hitOut); } // (already in that loop: the hit just ends)
      else if (state === 'hurt') state = next; // (older GLB: the hurt shake on that loop just ends — no turn, no fade)
      return;
    }
    if (next === 'faceFront') { // v6: from facing backwards: turn back to the front (yawed turn clip), then surf
      const wasBack = isBack(base); base = 'surf';
      if (wasBack) { if (one === 'turn') { one = null; } fadeTo(A.turnFwd, GM_ANIM.turnIn); one = 'turnFwd'; turned = false; state = 'faceFront'; }
      else if (!one) { state = 'ride'; fadeTo(A.surf, GM_ANIM.fade); }
      return;
    }
    if (next === 'hurt' && state !== 'hurt') hurtT = 0;
    if (next === 'throw') {
      // right after a turn (still facing backwards) → the 180°-yawed throw; else the less-weighted of the two
      // throw actions (a throw during a throw restarts the OTHER one → still a crossfade, never a reset pop)
      const back = one === 'turn' || turned || w(A.turn) > 0.25 || isBack(base);
      const a = back ? A.throwBack : w(A.throw) <= w(A.throw2) ? A.throw : A.throw2;
      fadeTo(a, one === 'turn' || w(A.turn) > 0 ? GM_ANIM.turnIn : one ? GM_ANIM.throwChain : GM_ANIM.throwIn);
      turned = back; one = 'throw'; state = 'throw';
      return;
    }
    if (next === 'getup') { // from lying (fall): situp-to-idle clip, then back to wait automatically (state → 'stand')
      base = 'wait';
      if (!A.getup) { state = 'stand'; fadeTo(A.wait, GM_ANIM.getUp); return; }
      if (one !== 'getup') { fadeTo(A.getup, GM_ANIM.getUpIn); one = 'getup'; turned = false; state = 'getup'; }
      return;
    }
    if (next === 'turn') { if (one !== 'turn') { fadeTo(A.turn, GM_ANIM.turnIn); one = 'turn'; turned = true; state = 'turn'; } return; }
    if (one === 'hit') { hitRet = next; return; } // (e.g. 'hurt' from a stagger: the reaction plays on, then returns to it)
    state = next;
    const SLOW = ['stretch', 'stretchBack', 'tauntBack', 'dance', 'angryLoop'], slow = SLOW.includes(base) || SLOW.includes(prevBase);
    if (!one) fadeTo(baseAction(), !cur ? 0 : wasDown ? GM_ANIM.getUp : slow ? GM_ANIM.baseIn : GM_ANIM.fade);
  }
  /** v0.46 hit reaction: headHit / bodyHit facing the way he faces now, back to the current base loop when it ends. */
  function hit(variant) {
    if (one === 'fall' || HIT_BLOCKED.has(one)) return false;
    const k = (variant === 'body' ? 'bodyHit' : 'headHit') + (isBack(base) ? 'Back' : '');
    if (!A[k]) { if (state !== 'hurt') hurtT = 0; state = 'hurt'; return true; } // older GLB: the hurt shake on the current loop
    if (one !== 'hit') hitRet = state;
    const a = w(A[k]) <= w(A[k + '2']) ? A[k] : A[k + '2']; // (a hit during a hit restarts the less-weighted copy → crossfade)
    fadeTo(a, CLOSE.anim.hitIn, true); one = 'hit'; turned = false; state = 'hit';
    return true;
  }
  /** Arcade: play the dance loop on the song's tempo (a whole number of beats per loop). */
  function setTempo(bpm) {
    if (!A.dance || !(bpm > 0)) return;
    const dur = A.dance.getClip().duration, beats = Math.max(1, Math.round(dur * bpm / 60));
    A.dance.timeScale = dur / (beats * 60 / bpm);
  }
  const tail = [];
  for (let i = 1; i <= 16; i++) { const b = bone(`Tail_${String(i).padStart(2, '0')}`); if (!b) break; tail.push(b); }
  const spring = tail.length ? new TailSpring(tail) : null;
  const _sq = new THREE.Quaternion(), _e = new THREE.Euler();

  function update(dt, t) {
    if (t === lastT && dt > 0) return; // some flows call boss.update() twice in one frame → don't double-step
    lastT = t;
    if (one && one !== 'fall' && cur) { // one-shot near its end (the fall holds its last frame until a new state) → fade back to the base loop (the clamped last frame holds meanwhile)
      const left = (cur.getClip().duration - cur.time) / Math.max(1e-3, cur.timeScale);
      const out = one === 'hit' ? CLOSE.anim.hitOut : one === 'angry' ? GM_ANIM.angryOut : one === 'getup' ? GM_ANIM.getUpOut : one === 'turn' && base === 'tauntBack' ? CLOSE.anim.tauntIn : one === 'turn' && base === 'stretchBack' ? GM_ANIM.turnOut : one === 'turnFwd' ? GM_ANIM.throwOut : turned ? GM_ANIM.turnOut : GM_ANIM.throwOut;
      if (left <= Math.min(out, GM_ANIM.oneShotTail)) {
        const ret = one === 'hit' && hitRet === 'hurt' && base === 'wait' ? 'hurt' : null; // (a reaction during a stagger returns to the hurt pose)
        one = null; turned = false; state = ret || baseState(); fadeTo(baseAction(), out);
      }
      // (base 'stretchBack' after a 'faceBack' turn: both face backwards → a plain crossfade, no spin back)
    }
    blend(dt);
    mixer.update(dt);
    if (hurtT >= 0 && state === 'hurt') { // hit reaction on top of the clip (additive shake, decays)
      hurtT += dt;
      const s = Math.exp(-hurtT * 5) * Math.sin(hurtT * 50) * 0.08;
      spine2.quaternion.multiply(_sq.setFromEuler(_e.set(-0.15 * Math.exp(-hurtT * 3), 0, s)));
    } else if (state !== 'hurt') hurtT = -1;
    spring?.update(dt);
  }
  setState('stand');
  update(0, -1);
  return {
    root, update, setState, setTempo, throwHand, hitCenter, mesh, mixer, tailSpring: spring,
    get state() { return state; },
    /** v0.46: a backwards loop (stretchBack / tauntBack: facing Mobius behind him on the jet) is the base. */
    get facingBack() { return isBack(base); },
  };
}
