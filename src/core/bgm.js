// v0.43 background music (looping MP3s in public/audio/bgm/, originals in bgm/).
//   • Story mode while chasing Green Maniac (stages 'chase' + 'endless') → Dala City BGM
//   • World Chase: one track per map (Foldscape City daylight shares the Dala City BGM)
// Loudness: every track was measured with ffmpeg ebur128 (integrated LUFS) and is played at a gain that brings it to
// BGM_TARGET_LUFS before the music bus (Settings → Music volume), so switching maps never jumps in volume.
export const BGM_TARGET_LUFS = -20;
export const BGM = {
  dala: { file: 'brand-new-universe-mobious-dala-city-bgm.mp3', lufs: -14.6 },
  forest: { file: 'forest-shadow-ruins-bgm.mp3', lufs: -15.1 },
  redrock: { file: 'redrock-canyon-bgm.mp3', lufs: -16.0 },
  neon: { file: 'neon-tech-city-bgm.mp3', lufs: -14.6 },
  moonlit: { file: 'moonlit-japanese-city-bgm.mp3', lufs: -13.7 },
  cloudpalace: { file: 'cloud-palace-city-bgm.mp3', lufs: -13.8 },
  aurora: { file: 'aurora-ice-city-bgm.mp3', lufs: -14.5 },
  molten: { file: 'molten-fortress-bgm.mp3', lufs: -15.2 },
};
/** World Chase map id → BGM id. */
export const MAP_BGM = { foldscape: 'dala', forest: 'forest', redrock: 'redrock', neon: 'neon', moonlit: 'moonlit', cloudpalace: 'cloudpalace', aurora: 'aurora', molten: 'molten' };
/** Story stages that are the Green Maniac chase. */
export const STORY_BGM_STAGES = ['chase', 'endless'];
export const bgmGain = (id) => { const b = BGM[id]; return b ? Math.min(1, Math.pow(10, (BGM_TARGET_LUFS - b.lufs) / 20)) : 0; };
export const bgmUrl = (id) => `${import.meta.env?.BASE_URL || '/'}audio/bgm/${BGM[id].file}`;

/**
 * Which BGM should play right now (pure; unit tested). Returns { id, level } or null.
 * level: 1 normal, 0.35 paused / menu open, 0.6 on the World Chase results and while a world loads.
 */
export function pickBgm(s) {
  if (s.state === 'loading' && s.worldLoadingMap && MAP_BGM[s.worldLoadingMap]) return { id: MAP_BGM[s.worldLoadingMap], level: 0.6 }; // behind the loading screen (Chase Again keeps the track going)
  if (s.state === 'world' && s.worldMapId && MAP_BGM[s.worldMapId]) {
    const level = s.worldPaused || s.menuOpen ? (s.worldResolved ? 0.6 : 0.35) : s.worldResolved ? 0.6 : 1;
    return { id: MAP_BGM[s.worldMapId], level };
  }
  if (s.state === 'story' && STORY_BGM_STAGES.includes(s.storyStage)) return { id: 'dala', level: s.storyPaused || s.menuOpen ? 0.35 : 1 };
  return null;
}
