// Diagnostic ablations on the actual renderer. Desktop pixels are a proxy, never a Quest measurement.
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.env.OUT || '/private/tmp/mobius-forest-performance/baseline-profile.json';
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const page = await browser.newPage({ ignoreHTTPSErrors: true });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const rows = [];
try {
  for (const size of (process.env.SIZES || '1280x720,2560x1440').split(',')) {
    const [width, height] = size.split('x').map(Number); await page.setViewportSize({ width, height });
    await page.goto(`${process.env.URL || 'https://localhost:8463'}/forest-preview.html?clean#view=start&q=${process.env.Q || 'high'}`);
    await page.waitForFunction(() => window.__fp?.ready, null, { timeout: 60000 });
    for (const view of (process.env.VIEWS || 'start,foliage,street,landmark,rear').split(',')) {
      await page.evaluate(async v => { window.__fp.setView(v); await window.__fp.whenReady(); }, view);
      const data = await page.evaluate(() => {
        const f = window.__fp, d = f.wr().extras, T = f.THREE, gl = f.renderer.getContext(), pixel = new Uint8Array(4);
        f.render(); f.camera.updateMatrixWorld(true);
        const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(f.camera.projectionMatrix, f.camera.matrixWorldInverse));
        const camera = f.camera.getWorldPosition(new T.Vector3()), off = d.group.position;
        const original = [...d.pools].map(([key, p]) => ({ key, p, visible: p.mesh.visible, geometry: p.mesh.geometry, material: p.mesh.material, count: p.mesh.count, matrices: p.mesh.instanceMatrix.array.slice(), colors: p.mesh.instanceColor.array.slice() }));
        const opaque = [], fastMaterials = new Map();
        f.wr().root.traverse(o => {
          if (!o.isMesh || !o.material?.uniforms || !['WorldMat', 'WorldFloor', 'ForestKitMat'].includes(o.material.name) && !o.material.name.startsWith('ForestHero:')) return;
          const m = o.material;
          if (!fastMaterials.has(m)) fastMaterials.set(m, new T.MeshBasicMaterial({ vertexColors: true, side: m.side, map: m.uniforms.uHeroMap?.value || null }));
          opaque.push([o, m]);
        });
        const restore = () => {
          for (const s of original) { const m = s.p.mesh; m.visible = s.visible; m.geometry = s.geometry; m.material = s.material; m.count = s.count; m.instanceMatrix.array.set(s.matrices); m.instanceColor.array.set(s.colors); m.instanceMatrix.needsUpdate = m.instanceColor.needsUpdate = true; }
          for (const [o, m] of opaque) o.material = m;
        };
        const basicLeaf = new T.MeshBasicMaterial({ map: d.assets.tex.get('leaf'), alphaTest: 0.5, side: T.DoubleSide });
        const modes = ['baseline', 'noFoliage', 'basicFoliage', 'basicWorld', 'noHeroes', 'farLod', 'range140', 'frustum'];
        const results = [];
        for (const mode of modes) {
          restore();
          if (mode === 'basicWorld') for (const [o, m] of opaque) o.material = fastMaterials.get(m);
          for (const s of original) {
            const mesh = s.p.mesh, name = s.key.split(':')[0], alpha = d.alpha.has(name);
            if (mode === 'noFoliage' && alpha || mode === 'noHeroes' && name.startsWith('hero_')) mesh.visible = false;
            if (mode === 'basicFoliage' && alpha) mesh.material = basicLeaf;
            if (mode === 'farLod' && s.key.endsWith(':0')) mesh.geometry = d.assets.geo.get(name)[1];
            if (mode === 'range140' || mode === 'frustum') {
              let n = 0; const mat = new T.Matrix4(), sphere = new T.Sphere(); s.geometry.computeBoundingSphere();
              for (let i = 0; i < s.count; i++) {
                mat.fromArray(s.matrices, i * 16); sphere.copy(s.geometry.boundingSphere).applyMatrix4(mat); sphere.center.add(off);
                const keep = mode === 'frustum' ? frustum.intersectsSphere(sphere) : sphere.center.distanceTo(camera) - sphere.radius <= 140;
                if (!keep) continue;
                mesh.instanceMatrix.array.set(s.matrices.subarray(i * 16, i * 16 + 16), n * 16); mesh.instanceColor.array.set(s.colors.subarray(i * 3, i * 3 + 3), n * 3); n++;
              }
              mesh.count = n; mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
            }
          }
          const render = () => { f.renderer.render(f.wr().root.parent, f.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); };
          for (let i = 0; i < 15; i++) render();
          const times = []; for (let i = 0; i < 30; i++) { const a = performance.now(); render(); times.push(performance.now() - a); }
          times.sort((a, b) => a - b);
          const r = f.renderer.info.render;
          results.push({ mode, meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), p90Ms: +times[27].toFixed(3), calls: r.calls, tris: r.triangles });
        }
        restore(); basicLeaf.dispose(); for (const m of fastMaterials.values()) m.dispose(); f.render();
        return { info: f.info(), results };
      });
      rows.push({ size, view, ...data });
      console.log(size, view, JSON.stringify(data.results));
    }
  }
} finally { fs.writeFileSync(out, JSON.stringify({ errors, rows, desktopProxyOnly: true }, null, 1)); await browser.close(); }
if (errors.length) throw new Error(errors.join('\n'));
