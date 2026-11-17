// v0.49 Story tutorials — the content. PURE data: three tutorials, their pages, the clips of each page (files in
// public/tutorials/, H.264 960×540 copies of the original recordings in story_mode_tutorials/ and arcade_mode_tutorials/) and
// the i18n keys of each page's title and line. A page with two media entries shows them side by side.
//   move    in the room, when the radio broadcast has finished
//   skills  in the room, right after the hands-up at the mirror
//   arcade  in the factory, after the blue-circle countdown (Story only; never in the standalone Arcade or World Chase)
const v = (file) => ({ kind: 'video', file });
const img = (file) => ({ kind: 'image', file });
const page = (id, n, ...media) => ({ title: `tutorial.${id}.${n}.title`, line: `tutorial.${id}.${n}.line`, media });

export const TUTORIALS = {
  move: { pages: [
    page('move', 1, v('s00_movement.mp4'), v('s00_teleport.mp4')),
    page('move', 2, v('s01_turn.mp4'), img('s01_turn_swipe.png')),
  ] },
  skills: { pages: [
    page('skills', 1, v('s02_open_window.mp4')),
    page('skills', 2, v('s03_collect_coins.mp4')),
    page('skills', 3, v('s04_climb_wall.mp4')),
    page('skills', 4, v('s05_light_web.mp4')),
    page('skills', 5, v('s06_light_bomb.mp4')),
    page('skills', 6, v('s07_fan_web.mp4')),
    page('skills', 7, v('s08_light_shield.mp4')),
    page('skills', 8, v('s09_red_target_punch.mp4'), v('s10_fly_kick.mp4')),
  ] },
  arcade: { pages: [
    page('arcade', 1, v('a01_fan_web.mp4')),
    page('arcade', 2, v('a02_light_web.mp4')),
    page('arcade', 3, v('a03_energy_wave.mp4')), // (the clip first named "Blast": the game's name for the move is Energy Wave)
    page('arcade', 4, v('a04_light_bomb.mp4')),
  ] },
};

/** i18n keys of the panel's buttons. */
export const TUTORIAL_UI = { skip: 'tutorial.skip', back: 'tutorial.back', next: 'tutorial.next', done: 'tutorial.done' };

/**
 * The panel: size in metres, canvas pixels per metre, and its layout in canvas pixels (1560 × 936). dist: metres in front of
 * the head (1.3 m wide at 1.25 m looks as wide as 1.7 m at 1.6 m, and fits Mobius's room). wallMargin: how far inside the
 * room's walls its centre stays. countdown: the get-ready seconds after tutorial 3 closes, before the song.
 */
export const TUTORIAL_PANEL = {
  width: 1.3, height: 0.78, ppm: 1200, dist: 1.25, yOff: -0.02, wallMargin: 0.2, minDist: 0.9,
  titleH: 100,
  media: { x: 40, y: 108, w: 1480, h: 560 }, gap: 40,
  caption: { x: 40, y: 684, w: 1480, h: 112 },
  buttons: { y: 816, h: 92, w: 250, pad: 40 },
  countdown: 3,
  uploadGap: 30, // ms: a playing clip's picture goes to the GPU at most this often (the clips are 30 frames a second)
};
