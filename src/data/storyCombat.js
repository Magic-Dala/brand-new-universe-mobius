// v0.21 story chase combat + factory roof finale — every tunable in one place.
// (City layout / streaming: cityConfig.js. Swing feel: settings.js.)
export const STORY_COMBAT = {
  // ---- Green Maniac throws ordinary pumpkin bombs at the player during the chase (not beat-synced)
  bombs: {
    firstDelay: 5, // s after the flyby before the first throw
    interval: [3.4, 5.2], // s between throws (random in range, seeded per run)
    maxActive: 2, // bombs alive at once (held + flying)
    minRange: 10, maxRange: 60, // m: throws only when the player is in this range of Green Maniac
    windup: 0.6, // s: bomb glows in his hand (+ sound) while he turns around (v6: turn clip, ≈ 0.6 s), then the throw animation
    speed: 15, // m/s nominal → flight time = dist / speed …
    flightTime: [1.1, 2.4], // … clamped (s)
    gravity: 6, // m/s² (lighter than real: readable lob)
    leadFactor: 0.35, // limited prediction: aim at pos + vel × flightTime × leadFactor …
    maxLead: 4, // … at most this far (m) from where the player was
    blastRadius: 2.2, // m: explosion within this of the chest = hit
    proximity: 1.1, // m: flying bomb this close to the chest explodes
    life: 4.5, // s max flight before it fizzles
    recycleDist: 90, // m from the player → recycled silently
    scale: 1.6, // model scale (arcade normal = 1 ≈ 0.34 m) — readable at chase distances
    hitZone: 1.1, // m target size for web hits (+ settings.assistMargin)
    hitMinDeg: 5, // minimum aim tolerance (half-angle)
    pauseNearTurn: 45, // m around the right turn: no new throws
  },
  // ---- web sticks to the Green Bat Jet (moving anchor) → Green Maniac blows the web off
  tether: {
    maxDist: 28, minDist: 4, // m from the chest
    assistDeg: 6, minHalf: 1.6, // aim tolerance (half-angle) / min zone half-size (m)
    hook: [0, -0.2, 0.6], // jet-local hook point (behind the cockpit, under the stand point)
    pullAccel: 7, pullTime: 0.5, // m/s² short pull toward the jet / how long
    counterDelay: 1.15, // s stuck before the web is cut: Green Maniac turns around (turn clip), throws (release = cut) → small blast
    cooldown: 4.0, // s before the jet can be tethered again
    bossSlow: 8, // m/s: Green Maniac's max speed while tethered (no yanking)
    breakAway: 1.6, breakAwaySpeed: 6, // s / m/s extra speed after the cut (pulls away smoothly)
  },
  // ---- factory roof: Green Maniac waits over the blue circle; a web hit on him → web dash → kick
  roof: {
    hoverHeight: 6.2, // m above the roof (jet origin) over the circle
    bob: 0.25, // m gentle hover
    arriveDist: 3, // m from the hover point = "arrived"
    dashRange: 50, // m max web distance
    assistDeg: 12, minHalf: 1.8, // generous target zone around Green Maniac
    targetUp: 1.0, // m above the jet origin (his body)
    dashSpeed: 24, dashAccel: 45, // m/s, m/s²
    contactRadius: 1.5, // m: chest within this of his body centre = kick (swept test)
    dashTimeout: 3.0, // s → abort + retry
    retryCooldown: 0.8, // s after an abort
    landTime: 0.9, // s: decelerated landing glide onto the roof after the kick
    maniacLandOffset: 2.4, // m (pre-v5, unused: the landing spot now follows the knock-back below)
    // v5: the kick KNOCKS Green Maniac back: flies `knockback` m (horizontal, along the dash) from where he was hit,
    // touches down, slides the last `maniacSlide` m, lies `recoverTime` s, gets up (Mixamo situp-to-idle clip), and
    // only then picks up / throws the giant pumpkin bomb. Clamped inside the breakable roof section (he falls through
    // it later); never less than `knockbackMin` m.
    knockback: 3.4, knockbackMax: 7.5, maniacSlide: 1.0, slideTime: 0.45, // m (v6: ≥ 3.4 m, and always OUTSIDE the breakable section), m, m, s
    breachClear: 0.9, roofEdge: 1.4, // m: landing keeps this clear of the breakable section / the roof edge
    bombAhead: 1.0, // m: the giant bomb lands this far from Mobius toward Green Maniac (inside the section)
    drawTime: 0.55, drawBack: 0.38, // v7: after the angry fit he pulls the giant bomb from behind his back (s, m behind the chest)
    pickupSpeed: 8, hopTime: 0.45, hopUp: 0.9, // jet comes back for him after the throw; he hops onto it (m/s, s, m)
    maniacFallTime: 0.85, recoverTime: 0.5, // s: flight (= the fall clip's ground contact) / lying before he gets up
    jetDrift: [8, 4], // m sideways / up the empty jet drifts off after the kick
    giantScale: 1.65, windup: 1.4, tossTime: 0.6, fuse: 0.8, // giant pumpkin bomb (story prop)
  },
};
