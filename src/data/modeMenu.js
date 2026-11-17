// v0.49: the in-VR mode menu (the first panel after Enter VR Game), from the top: Story (recommended to new players, the
// highlighted button), Arcade, World Chase. Pure data: ids, order and layout in panel pixels (the panel is 950 × 620).
// Built in src/ui/menus.js (Story, Arcade, language, exit) and src/worlds/worldMenus.js (World Chase).
export const MODE_PANEL = { width: 0.95, height: 0.62, headerH: 160 };
export const MODE_MENU = [
  { id: 'story', y: 172, h: 104, recommended: true, primary: true },
  { id: 'arcade', y: 288, h: 104 },
  { id: 'world', y: 404, h: 92 },
];
/** The language and Exit VR buttons, side by side under the modes. */
export const MODE_ROW = { y: 512, h: 76 };

/**
 * The website's title page: is the small "Enter Desktop Preview" link shown under the Enter VR Game button? Only under the
 * desktop headset emulator (development). On a real headset ('vr') the page has the one Enter VR Game button; with no VR
 * at all ('none', 'insecure') that one button is itself the desktop preview.
 */
export const desktopLinkShown = (xrMode) => xrMode === 'emulated';
