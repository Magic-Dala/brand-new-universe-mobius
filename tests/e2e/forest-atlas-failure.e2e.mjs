// Atlas failure in the real preview: block forest_leaf.png → the whole bundle must fail transactionally, the kit
// must fall back to the procedural forest, nothing must throw.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
let blocked = 0; await p.route('**/models/forest/forest_leaf.png', (r) => { blocked++; r.abort(); });
await p.goto(`${process.env.URL || 'https://localhost:8462'}/forest-preview.html?clean#view=foliage`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__fp?.ready, null, { timeout: 300000, polling: 500 });
await p.evaluate(async () => { window.__fp.setView('foliage'); await window.__fp.whenReady(); window.__fp.render(); });
const i = await p.evaluate(() => window.__fp.info());
if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
console.log(JSON.stringify({ blocked, pageErrors: errs, assets: i.detail?.assets, pools: i.detail?.pools, tex: i.tex, geo: i.geo, tris: i.tris, legacyTris: i.rendererStats.tris }));
await b.close();
assert.ok(blocked > 0, 'the atlas request was actually blocked');
assert.deepEqual(errs, [], 'no page errors during fallback');
assert.equal(i.detail?.assets, 'failed', 'missing atlas selects the legacy forest');
assert.equal(i.detail?.pools, 0, 'no incomplete detail pools attach');
assert.equal(i.tex, 0, 'partial bundle textures are not uploaded');
assert.ok(i.rendererStats.tris > 0, 'fallback world geometry exists');
