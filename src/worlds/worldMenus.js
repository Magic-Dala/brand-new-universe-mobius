// World Chase VR menus (v0.40): the map selector (8 world cards with thumbnails, name, short description, the
// selected / best record) and the World Chase pause menu (Resume · Restart · Change Map · Settings · Recenter ·
// Main Menu, plus the session stats). Also adds a "World Chase" entry to the in-room mode menu.
import * as THREE from 'three';
import { Panel, techFrame, fitText, wrapText, COLORS, FONT } from '../ui/panel.js';
import { t, getLang, onLangChange } from '../core/i18n.js';
import { MAPS, getSelectedMap, setSelectedMap, getWorldBest, mapById } from './maps.js';
import { formatChaseTime } from './chaseCombat.js';
import { MODE_MENU } from '../data/modeMenu.js';

const thumbs = new Map();
/** Thumbnail <img> per map (public/maps/<id>.jpg, from the concept art); redraws the panels once loaded. */
export function thumbOf(id, onload) {
  let im = thumbs.get(id);
  if (!im && typeof Image !== 'undefined') { im = new Image(); im.decoding = 'async'; im.src = `maps/${id}.jpg`; thumbs.set(id, im); }
  if (im && !im.complete && onload) im.addEventListener('load', onload, { once: true });
  return im;
}
const fmt = (n) => Math.round(n).toLocaleString();

function header(g, W, H, title, sub) {
  techFrame(g, 6, 6, W - 12, H - 12, { fill: 'rgba(5,16,34,0.92)', c: 28 });
  g.fillStyle = COLORS.accent; g.font = `700 22px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('BRAND NEW UNIVERSE · MOBIUS', 40, 30);
  g.fillStyle = COLORS.text; fitText(g, title, W - 80, 50, 800); g.fillText(title, 40, 60);
  if (sub) { g.fillStyle = COLORS.dim; g.font = `500 24px ${FONT}`; fitText(g, sub, W - 80, 24, 500); g.fillText(sub, 40, 122); }
  g.strokeStyle = COLORS.lineDim; g.lineWidth = 2; g.beginPath(); g.moveTo(40, 158); g.lineTo(W - 40, 158); g.stroke();
}

export function installWorldMenus(app) {
  const menus = app.menus;
  const mk = (name, w, h, render) => {
    const p = new Panel({ width: w, height: h, ppm: 1000, name, render: (g) => render(g, p) });
    p.visible = false; menus.root.add(p.root); app.panels.add(p); menus.panels[name] = p; return p;
  };
  // ---------------------------------------------------------------- map selector (8 cards)
  const maps = mk('worldMaps', 1.25, 0.88, (g, p) => header(g, p.cw, p.ch, t('world.select'), t('mode.world.desc')));
  const W = maps.cw, cols = 4, gap = 18, cw = (W - 80 - gap * (cols - 1)) / cols, ch = 272;
  const card = (m) => (g, b, st) => {
    const sel = getSelectedMap() === m.id;
    techFrame(g, b.x, b.y, b.w, b.h, { fill: st.hover ? 'rgba(25,80,130,0.95)' : 'rgba(8,24,48,0.95)', stroke: sel || st.hover ? '#7ef0ff' : COLORS.lineDim, lw: sel ? 5 : st.hover ? 4 : 2, c: 12, glow: sel || st.hover });
    const im = thumbOf(m.id, () => { maps.dirty = true; });
    const tw = b.w - 16, th = Math.round(tw * 9 / 16);
    if (im?.complete && im.naturalWidth) g.drawImage(im, b.x + 8, b.y + 8, tw, th);
    else { g.fillStyle = '#0a1a30'; g.fillRect(b.x + 8, b.y + 8, tw, th); }
    if (sel) { g.fillStyle = '#7ef0ff'; g.font = `800 20px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText('●', b.x + b.w - 16, b.y + 14); }
    const name = m.name[getLang()] || m.name.en;
    g.fillStyle = COLORS.text; g.textAlign = 'left'; g.textBaseline = 'top'; fitText(g, name, b.w - 24, 25, 800); g.fillText(name, b.x + 12, b.y + th + 16);
    g.fillStyle = COLORS.dim; g.font = `500 17px ${FONT}`; wrapText(g, m.desc[getLang()] || m.desc.en, b.x + 12, b.y + th + 48, b.w - 24, 21, 3);
  };
  maps.setButtons([
    ...MAPS.map((m, i) => ({ id: `map-${m.id}`, x: 40 + (i % cols) * (cw + gap), y: 176 + Math.floor(i / cols) * (ch + gap), w: cw, h: ch, label: () => m.name[getLang()] || m.name.en, draw: card(m),
      selected: () => getSelectedMap() === m.id, onClick: () => { setSelectedMap(m.id); maps.dirty = true; app.startWorld(m.id); } })),
    { id: 'back', x: 40, y: maps.ch - 104, w: 260, h: 78, label: () => t('world.back'), onClick: () => { const from = menus.ctx.from; if (from === 'pause') menus.show('worldPause', {}, { place: false }); else menus.show('mode'); } },
  ]);
  // ---------------------------------------------------------------- pause (World Chase)
  const pause = mk('worldPause', 0.78, 0.9, (g, p) => {
    const ctl = app.worldChase, m = ctl.map, s = ctl.summary();
    header(g, p.cw, p.ch, t('menu.title'), m ? (m.name[getLang()] || m.name.en) : '');
    g.fillStyle = COLORS.text; g.font = `600 24px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
    fitText(g, t('world.stats', { m: fmt(s.distance), c: s.coins, b: s.bombs, k: s.tethers }), p.cw - 80, 24, 600);
    g.fillText(t('world.stats', { m: fmt(s.distance), c: s.coins, b: s.bombs, k: s.tethers }), 40, 172);
    g.fillStyle = COLORS.warn; g.font = `600 22px ${FONT}`;
    g.fillText(s.best ? t('world.best', { m: fmt(Math.max(s.best.distance, s.distance)), c: Math.max(s.best.coins, s.coins) }) : t('world.noBest'), 40, 208);
  });
  const items = [
    ['resume', 'menu.resume', () => app.menuResume(), 'primary'],
    ['restart', 'menu.restart', () => { menus.hide(); app.worldChase.restart(); }],
    ['maps', 'menu.changeMap', () => menus.show('worldMaps', { from: 'pause' }, { place: false })],
    ['settings', 'menu.settings', () => menus.show('settings', { back: 'worldPause' }, { place: false })],
    ['recenter', 'menu.recenter', () => app.recenter()],
    ['main', 'menu.main', () => app.menuMain()],
  ];
  pause.setButtons(items.map(([id, key, fn, style], i) => ({ id, x: 40, y: 250 + i * 104, w: pause.cw - 80, h: 88, label: () => t(key), onClick: fn, style })));
  // ---------------------------------------------------------------- v0.41 results (victory / defeat)
  const res = mk('worldResults', 0.92, 0.74, (g, p) => {
    const r = menus.ctx.worldResult || {}, won = r.outcome === 'victory', W = p.cw;
    header(g, W, p.ch, won ? t('world.victory') : t('world.defeat'), won ? t('world.bossDown') : t('world.playerDown'));
    g.textBaseline = 'middle'; g.textAlign = 'right'; g.font = `900 italic 92px ${FONT}`;
    g.fillStyle = won ? COLORS.perfect : COLORS.bad; g.shadowColor = g.fillStyle; g.shadowBlur = 26;
    g.fillText(won ? '✓' : '✕', W - 60, 92); g.shadowBlur = 0;
    const rows = [[t('world.res.map'), r.mapName || ''], [t('world.res.time'), formatChaseTime(r.time || 0)], [t('world.res.coins'), `₿ ${r.coins || 0}`], [t('world.res.distance'), `${fmt(r.distance || 0)} m`]];
    if (r.style != null) rows.push([t('world.res.style'), fmt(r.style)], [t('world.res.flow'), `${r.peakFlow || 0}`]); // v0.45 Flow meter (off: no rows)
    rows.forEach(([k, v], i) => {
      const y = 214 + i * 76;
      g.textAlign = 'left'; g.fillStyle = COLORS.dim; g.font = `600 28px ${FONT}`; g.fillText(k, 50, y);
      g.fillStyle = i === 1 ? COLORS.accent : COLORS.text; g.font = `800 ${i === 1 ? 48 : 40}px ${FONT}`; fitText(g, v, W - 400, i === 1 ? 48 : 40, 800); g.fillText(v, 330, y);
    });
  });
  const resButtons = () => res.setButtons([
    { id: 'home', x: 40, y: res.ch - 124, w: (res.cw - 100) * 0.58, h: 90, style: 'primary', label: () => t('world.res.home'), onClick: () => app.returnHome() },
    { id: 'again', x: 60 + (res.cw - 100) * 0.58, y: res.ch - 124, w: (res.cw - 100) * 0.42, h: 90, label: () => t('world.res.again'), onClick: () => { menus.hide(); app.worldChase.restart(); } },
  ]);
  resButtons();
  // v0.45: with the Flow rows (Style, Peak Flow) the panel is two rows taller (0.74 → 0.90 m) and the buttons move down with it
  const resHeight = (h) => {
    if (res.h === h) return;
    res.h = h; res.ch = Math.round(h * 1000); res.canvas.height = res.ch; res.tex.dispose(); // (new canvas size → re-upload)
    res.mesh.geometry.dispose(); res.mesh.geometry = new THREE.PlaneGeometry(res.w, h); resButtons();
  };
  const show = menus.show.bind(menus);
  menus.show = (name, ctx, opt) => { if (name === 'worldResults') resHeight(ctx?.worldResult?.style != null ? 0.9 : 0.74); return show(name, ctx, opt); };
  // ---------------------------------------------------------------- the in-room mode menu: + World Chase
  // (v0.49: Story, Arcade, World Chase from the top: src/data/modeMenu.js)
  const mode = menus.panels.mode, MW = mode.cw, wm = MODE_MENU.find((m) => m.id === 'world'), old = mode.buttons;
  const world = { id: 'world', x: 40, y: wm.y, w: MW - 80, h: wm.h, label: () => t('mode.world'), sub: () => t('mode.world.desc'), onClick: () => menus.show('worldMaps', { from: 'mode' }) };
  mode.setButtons([...old.filter((b) => MODE_MENU.some((m) => m.id === b.id)), world, ...old.filter((b) => !MODE_MENU.some((m) => m.id === b.id))]);
  onLangChange(() => { maps.dirty = true; pause.dirty = true; res.dirty = true; });
  // the pause panel shows live numbers: refresh while open
  const upd = menus.update.bind(menus);
  menus.update = () => { upd(); if (menus.current === 'worldPause' && (performance.now() - (pause._t || 0)) > 500) { pause._t = performance.now(); pause.dirty = true; } };
  for (const m of MAPS) thumbOf(m.id);
  return { maps, pause, res };
}
export { mapById, THREE };
