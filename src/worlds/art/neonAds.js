import * as THREE from 'three';

export const NEON_SIGN = 32;
export const NEON_FACADE = 33;

// Original brands for the city. Each poster is one tile in the same opaque LED atlas.
const posters = [
  ['NOVA', 'AFTER HOURS', '#ff6ec8', '#613cff', '#200d38'],
  ['ORBIT', 'SKY TRANSIT', '#7de9ff', '#3674f3', '#091d38'],
  ['VANTA', 'OPTICAL SYSTEMS', '#dbbaff', '#8e55ee', '#211035'],
  ['KITE', 'AEROWORKS', '#ffcb93', '#f05888', '#2e1530'],
  ['SIGNAL', 'NIGHT BROADCAST', '#88ffd5', '#277baa', '#0a2632'],
  ['PULSE', 'SYNTH RADIO', '#ff9edf', '#b44bff', '#321039'],
  ['LUMA', 'LATE MARKET', '#fff4b5', '#f79548', '#3a1b29'],
  ['AXIOM', 'CITY NETWORK', '#a3c8ff', '#4e55ef', '#121a3b'],
];
export const NEON_POSTER_COUNT = posters.length;

function drawPoster(ctx, i) {
  const [name, line, light, mid, dark] = posters[i];
  ctx.save();
  ctx.translate(i % 4 * 256, Math.floor(i / 4) * 256);
  ctx.beginPath();
  ctx.rect(0, 0, 256, 256);
  ctx.clip();
  ctx.fillStyle = '#0d1024';
  ctx.fillRect(0, 0, 256, 256);
  const gradient = ctx.createLinearGradient(10, 240, 242, 8);
  gradient.addColorStop(0, dark);
  gradient.addColorStop(0.55, dark);
  gradient.addColorStop(1, mid);
  ctx.fillStyle = gradient;
  ctx.fillRect(9, 9, 238, 238);
  ctx.strokeStyle = light;
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, 232, 232);
  ctx.globalAlpha = 0.22;
  for (let x = 27; x < 239; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, 22);
    ctx.lineTo(x, 223);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = light;
  ctx.fillRect(21, 22, 42, 3);
  ctx.fillRect(193, 231, 42, 3);
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('NTC / 0' + (i + 1), 230, 39);

  ctx.translate(128, 94);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 5;
  ctx.beginPath();
  switch (i % 4) {
    case 0:
      for (const x of [-30, 0, 30]) {
        ctx.moveTo(x - 12, 21);
        ctx.lineTo(x, -29);
        ctx.lineTo(x + 12, 21);
      }
      break;
    case 1:
      ctx.ellipse(0, 0, 48, 20, -0.45, 0, Math.PI * 2);
      ctx.moveTo(22, 0);
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      break;
    case 2:
      ctx.moveTo(-50, 0);
      ctx.lineTo(-29, 0);
      ctx.lineTo(-12, -26);
      ctx.lineTo(7, 28);
      ctx.lineTo(23, -8);
      ctx.lineTo(48, -8);
      break;
    default:
      ctx.moveTo(0, -33);
      ctx.lineTo(39, 0);
      ctx.lineTo(0, 33);
      ctx.lineTo(-39, 0);
      ctx.closePath();
      ctx.moveTo(-39, 0);
      ctx.lineTo(39, 0);
  }
  ctx.shadowColor = light;
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.translate(-128, -94);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8f4ff';
  ctx.font = '900 43px sans-serif';
  ctx.fillText(name, 128, 176, 208);
  ctx.fillStyle = light;
  ctx.font = 'bold 15px monospace';
  ctx.fillText(line, 128, 203, 210);
  ctx.restore();
}

let atlas = null;
let users = 0;

export function bindNeonAds(material) {
  if (typeof document === 'undefined') return;
  if (!atlas) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    posters.forEach((_, i) => drawPoster(ctx, i));
    atlas = new THREE.CanvasTexture(canvas);
    atlas.name = 'Neon city LED ads';
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 2;
  }
  material.uniforms.uNeonAds.value = atlas;
  users++;
  const release = () => {
    material.removeEventListener('dispose', release);
    material.uniforms.uNeonAds.value = null;
    if (--users === 0) {
      atlas.dispose();
      atlas = null;
    }
  };
  material.addEventListener('dispose', release);
}
