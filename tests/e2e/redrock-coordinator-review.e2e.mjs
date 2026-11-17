import fs from 'node:fs';
import {chromium} from 'playwright';
const BASE=process.env.URL||'https://localhost:8464';
const OUT=process.env.OUT||'/private/tmp/mobius-redrock-art/coordinator-before';
fs.mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--ignore-certificate-errors']});
const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:720}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'||/kit redrock|GLSL|WebGL: INVALID|Program Info Log/i.test(m.text()))errors.push(m.text());});
await page.route('**/redrock-coordinator-review.html*',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0;overflow:hidden}canvas{display:block}</style><script type="module">
window.__rrStage='fetch';
const wt=await fetch('/src/worlds/worldRenderer.js').then(r=>r.text());
const spec=wt.match(/from[ ]*["']([^"']*(?:three|super-three)[^"']*)["']/)?.[1];
if(!spec)throw new Error('Could not resolve production Three module');
const T=await import(spec);
window.__rrStage='three imported';
import {mapById} from '/src/worlds/maps.js';
import {ChaseWorld} from '/src/worlds/chaseWorld.js';
import {WorldRenderer} from '/src/worlds/worldRenderer.js';
import {frameAt} from '/src/worlds/route.js';
const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(1);renderer.setSize(1280,720);renderer.outputColorSpace=T.SRGBColorSpace;document.body.append(renderer.domElement);
const map=mapById('redrock'),world=new ChaseWorld(map,{seed:20261103+7919}),scene=new T.Scene(),camera=new T.PerspectiveCamera(62,1280/720,0.1,1800);
const app=location.search.includes('xr=1')?{xrActive:true,renderer:{xr:{isPresenting:true}}}:null;
const wr=new WorldRenderer(app,map,world);scene.add(wr.root);scene.add(camera);
window.__rrStage='renderer created';
await wr.extras?.whenReady?.();
window.__rrStage='assets ready';
world.route.ensure(40);let at=0;
const views={start:{s:14},street:{s:120},turn:{type:'turnL'},landmark:{type:'landmark',pitch:0.2},bridge:{type:'bridgeLow',pitch:-0.12},river:{s:240,dy:-50,pitch:0.2},rear:{s:640,yaw:Math.PI,pitch:0.1},left:{s:640,yaw:Math.PI/2,pitch:0.15},right:{s:640,yaw:-Math.PI/2,pitch:0.15},up:{s:640,pitch:0.8}};
function pose(v){const a=world.pointAt(v.s),b=world.pointAt(v.s+30),ang=Math.atan2(-(b.x-a.x),-(b.z-a.z));camera.position.set(a.x,a.y+(v.dy||0),a.z);camera.rotation.set(v.pitch||0.02,ang+(v.yaw||0),0,'YXZ');camera.updateMatrixWorld(true);}
function setView(name){let v={...views[name]};if(v.type){const m=world.route.modules.find(m=>m.idx>0&&m.type===v.type);v.s=m?m.s0+m.L*0.2:300;}const dir=Math.sign(v.s-at)||1;for(let s=at;dir*(v.s-s)>50;s+=dir*50){world.update(world.pointAt(s),{x:0,y:0,z:0},1/60,{force:true});wr.pump(1e9);}world.update(world.pointAt(v.s),{x:0,y:0,z:0},1/60,{force:true});wr.pump(1e9);at=v.s;pose(v);wr.update(0,camera.position,camera);renderer.render(scene,camera);return v;}
window.__rr={renderer,map,world,scene,camera,wr,T,views,setView,ready:true};
</script>`}));
const rows=[];
try{
 await page.goto(BASE+'/redrock-coordinator-review.html'+(process.env.XR==='1'?'?xr=1':''));
 try { await page.waitForFunction(()=>window.__rr?.ready,null,{timeout:45000}); }
 catch(e){console.log('Readiness diagnosis',await page.evaluate(()=>({url:location.href,stage:window.__rrStage,html:document.body.innerHTML.slice(0,800),resources:performance.getEntriesByType('resource').slice(-12).map(r=>({name:r.name,duration:r.duration}))})));throw e;}
 for(const view of (process.env.VIEWS||'start,street,turn,landmark,bridge,river,rear,left,right,up').split(',')){
  await page.evaluate(v=>window.__rr.setView(v),view);
  await page.screenshot({path:OUT+'/'+view+'.png'});
  const row=await page.evaluate(view=>{const {renderer:R,scene,camera,wr,world,T}=window.__rr,gl=R.getContext(),p=new Uint8Array(4),time=[];const render=()=>{R.render(scene,camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);};for(let i=0;i<15;i++)render();for(let i=0;i<30;i++){const t=performance.now();render();time.push(performance.now()-t);}time.sort((a,b)=>a-b);
const bodies=[...wr.visuals.values()].flatMap(v=>v.meshes.filter(m=>m.name==='arch'));
wr.extras?.group?.traverse(o=>{if(o.isMesh&&o.visible&&(!o.isInstancedMesh||o.count>0))bodies.push(o);});
scene.updateMatrixWorld(true);const ray=new T.Raycaster(),n=new T.Vector3(),p1=new T.Vector3(),clip=new T.Vector3(),support={checked:0,missing:[],maxDistance:0};
for(const c of world.live.values())for(const a of c.anchors){
 if(!c.ready||!a.valid||a.p.distanceTo(camera.position)>65)continue;
 clip.copy(a.p).project(camera);if(Math.abs(clip.x)>.95||Math.abs(clip.y)>.95||clip.z<0||clip.z>1)continue;
 n.fromArray(a.normal);if(n.lengthSq()<.5)continue;n.normalize();p1.copy(a.p).addScaledVector(n,.8);ray.set(p1,n.clone().negate());ray.far=4.8;
 const hit=ray.intersectObjects(bodies,false)[0];support.checked++;if(!hit)support.missing.push({id:a.id,p:a.p.toArray(),normal:a.normal,kind:a.kind});else support.maxDistance=Math.max(support.maxDistance,hit.distance);
}
return {view,anchorSupport:support,calls:R.info.render.calls,tris:R.info.render.triangles,geo:R.info.memory.geometries,tex:R.info.memory.textures,meanMs:time.reduce((a,b)=>a+b,0)/time.length,p90Ms:time[26],detail:wr.extras?{...wr.extras.stats,byPool:wr.extras.stats.byPool?{...wr.extras.stats.byPool}:undefined}:null,live:world.live.size,anchors:wr.anchorMesh.count};},view);
  rows.push(row);console.log(JSON.stringify({view,calls:row.calls,tris:row.tris,meanMs:+row.meanMs.toFixed(3),quality:row.detail?.quality}));
 }
}finally{fs.writeFileSync(OUT+'/metrics.json',JSON.stringify({desktopProxyOnly:true,xrFlag:process.env.XR==='1',errors,rows},null,2));await browser.close();}
if(errors.length)throw new Error(errors.join('\n'));

