// Title / home page (pre-VR). One primary entry: Enter VR Game. Settings,
// master volume and a language DROPDOWN (English / 繁體中文).
import { t, getLang, setLang, LANGS, onLangChange } from '../core/i18n.js';
import { desktopLinkShown } from '../data/modeMenu.js';
import { settings, resetSettings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { listSongs, importSongFile, setSongTiming, deleteSong, reattachAudio } from '../core/songs.js';

export function initTitle(app) {
  const $ = (id) => document.getElementById(id);
  const root = $('title'), enter = $('enter'), statusEl = $('status'), desktopBtn = $('enter-desktop');
  const lang = $('lang'), vol = $('volume'), volOut = $('volume-out'), dlg = $('settings');
  let lastStatus = { key: 'title.status.checking', vars: null, kind: '' };
  let xrMode = 'checking'; // 'vr' | 'emulated' | 'none' | 'insecure'

  for (const l of LANGS) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.label; lang.appendChild(o); }
  lang.value = getLang();
  lang.addEventListener('change', () => setLang(lang.value));


  const applyI18n = () => {
    document.documentElement.lang = getLang() === 'zh-Hant' ? 'zh-Hant' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    enter.querySelector('span').textContent = xrMode === 'none' || xrMode === 'insecure' ? t('title.enterDesktop') : t('title.enter');
    setStatus(lastStatus.key, lastStatus.vars, lastStatus.kind);
    lang.value = getLang();
    renderSongs();
  };
  onLangChange(applyI18n);

  vol.value = Math.round(settings.masterVolume * 100); volOut.value = `${vol.value}%`;
  vol.addEventListener('input', () => { settings.masterVolume = vol.value / 100; volOut.value = `${vol.value}%`; audio.applyVolumes(); });

  function setStatus(key, vars, kind = '') {
    lastStatus = { key, vars, kind };
    statusEl.textContent = t(key, vars || {});
    statusEl.dataset.kind = kind;
  }

  enter.addEventListener('click', () => {
    audio.unlock(); // user-gesture audio start
    if (xrMode === 'vr' || xrMode === 'emulated') app.enterXR();
    else app.enterDesktop();
  });
  desktopBtn.addEventListener('click', () => app.enterDesktop());

  // ---------------- settings dialog
  $('open-settings').addEventListener('click', () => { audio.unlock(); syncSettings(); dlg.showModal(); renderSongs(); });
  $('reset-settings').addEventListener('click', () => { resetSettings(); syncSettings(); vol.value = Math.round(settings.masterVolume * 100); volOut.value = `${vol.value}%`; });
  function syncSettings() {
    dlg.querySelectorAll('[data-setting]').forEach((el) => {
      const k = el.dataset.setting, sc = +(el.dataset.scale || 1);
      if (el.type === 'checkbox') el.checked = !!settings[k];
      else el.value = el.dataset.num ? String(settings[k]) : typeof settings[k] === 'number' ? Math.round(settings[k] * sc) : settings[k];
    });
  }
  dlg.querySelectorAll('[data-setting]').forEach((el) => {
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      const k = el.dataset.setting, sc = +(el.dataset.scale || 1);
      if (el.type === 'checkbox') settings[k] = el.checked;
      else if (el.dataset.num || el.type === 'number' || el.type === 'range') { const v = Number(el.value); if (Number.isFinite(v)) settings[k] = v / sc; }
      else settings[k] = el.value;
    });
  });

  // ---------------- song import
  const impStatus = $('import-status');
  $('import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    audio.unlock();
    impStatus.dataset.kind = ''; impStatus.textContent = t('import.analyzing', { name: file.name });
    try {
      const r = await importSongFile(file);
      impStatus.dataset.kind = r.autoFailed ? 'warn' : 'ok';
      impStatus.textContent = (r.autoFailed ? t('import.autoFailed') + ' ' : '') + t('import.done', { name: r.title, bpm: r.bpm, offset: r.offsetSec.toFixed(3) }) + (r.stored ? '' : ` ${t('import.storageFailed')}`);
      settings.songId = r.id;
    } catch (err) {
      impStatus.dataset.kind = 'error';
      impStatus.textContent = t('import.failed', { msg: err.code === 'decode' ? t('import.decodeFailed') : err.message });
    }
    e.target.value = '';
    renderSongs();
  });
  async function renderSongs() {
    const ul = $('song-list'); if (!ul) return;
    const songs = await listSongs();
    ul.innerHTML = '';
    for (const s of songs) {
      const li = document.createElement('li');
      const title = document.createElement('strong'); title.textContent = s.title + (s.builtin ? ' ★' : ''); li.appendChild(title);
      if (!s.builtin) {
        const del = document.createElement('button'); del.type = 'button'; del.className = 'btn small'; del.textContent = t('import.delete');
        del.onclick = async () => { await deleteSong(s.id); if (settings.songId === s.id) settings.songId = 'mobius-boss-01'; renderSongs(); };
        li.appendChild(del);
        const row = document.createElement('div'); row.className = 'timing';
        const bpm = Object.assign(document.createElement('input'), { type: 'number', step: '0.01', value: s.chart.timing.bpm });
        const off = Object.assign(document.createElement('input'), { type: 'number', step: '0.001', value: s.chart.timing.offsetSec });
        const apply = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: t('import.apply') });
        apply.onclick = async () => { await setSongTiming(s.id, Number(bpm.value), Number(off.value)); impStatus.dataset.kind = 'ok'; impStatus.textContent = '✓'; renderSongs(); };
        row.append(t('import.bpm'), bpm, t('import.offsetLabel'), off, apply);
        if (!s.hasAudio) {
          const warn = document.createElement('div'); warn.className = 'status'; warn.dataset.kind = 'warn'; warn.textContent = t('import.reselect', { name: s.title });
          const pick = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*' });
          pick.onchange = async () => { if (pick.files[0]) { await reattachAudio(s.id, pick.files[0]); renderSongs(); } };
          row.append(warn, pick);
        }
        li.appendChild(row);
      } else {
        const info = document.createElement('small'); info.textContent = 'BPM 125 · offset 0.310 s · 0:56'; li.appendChild(info);
      }
      ul.appendChild(li);
    }
  }

  async function checkXR() {
    setStatus('title.status.checking');
    let supported = false;
    if (!window.isSecureContext) { xrMode = 'insecure'; setStatus('title.status.insecure', null, 'warn'); }
    else if (navigator.xr) {
      try { supported = await navigator.xr.isSessionSupported('immersive-vr'); } catch { supported = false; }
      const emulated = !!(window.IWER_DEVICE || window.__THREE__IWER__); // IWER spoofs a Quest UA, so detect the device object
      xrMode = supported ? (emulated ? 'emulated' : 'vr') : 'none';
      setStatus(supported ? (xrMode === 'vr' ? 'title.status.ready' : 'title.status.emulated') : 'title.status.noxr', null, supported ? 'ok' : 'warn');
    } else { xrMode = 'none'; setStatus('title.status.noxr', null, 'warn'); }
    desktopBtn.hidden = !desktopLinkShown(xrMode); // v0.49: on a headset the page has one button only
    enter.disabled = false;
    applyI18n();
    return xrMode;
  }

  applyI18n();
  return {
    setStatus, checkXR,
    hide() { root.style.display = 'none'; if (dlg.open) dlg.close(); },
    show() { root.style.display = ''; },
    get xrMode() { return xrMode; },
  };
}
