/**
 * Standalone regression probe (writes nothing). Run these from the UnboltKit repository root:
 * node_modules/.bin/esbuild --bundle --platform=node --format=esm --log-level=error < demo-video/research/probes/crossed-bars.ts > /tmp/unbolt-crossed-bars.mjs
 * node /tmp/unbolt-crossed-bars.mjs
 *
 * Before the fix the assertion exits nonzero: this is an actual solver-selected path on unmodified defaults.
 */
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { stage0ParseScene, stage1Prepare, stage2BuildDbg, stage3Peel, stage4Compile, checkClashes, createDefaultPrimitiveRegistry } from './packages/unbolt-core/src/index.ts';
const scene = new Group();
function add(name, dx, dy, dz, centerX) {
  const mesh = new Mesh(new BoxGeometry(dx, dy, dz), new MeshBasicMaterial());
  mesh.name=name; mesh.position.x=centerX; scene.add(mesh);
}
add('Y_bar',0.2,12,0.2, 0);
add('Z_bar',0.2,0.2,9, 1);
add('back_plate',3,16,16, -2);
const s0=stage0ParseScene(scene,{}), s1=stage1Prepare(s0,{});
if(s1.status==='error') throw Error(s1.error.message);
const graph=stage2BuildDbg(s1,s1.config), plan=stage3Peel(s1,graph,s1.config);
if(plan.status!=='solved') throw Error('By inspecting these simple parts safe orders exist; investigate unsolved status.');
const compiled=stage4Compile(plan,s1,s1.config);
if(!compiled.ok) throw Error(compiled.error.message);
const byId=new Map(s1.parts.map(p=>[p.partId,p]));
const registry=createDefaultPrimitiveRegistry();
let oracleTotalHits=0, intersections=[];
plan.steps.forEach((step,index)=>{
  const moving=byId.get(step.partId), statics=plan.steps.slice(index+1).map(later=>byId.get(later.partId));
  oracleTotalHits+=checkClashes(moving,step.dir,statics,s1.config).count;
  const trajectory=compiled.steps[index], primitive=registry.get(trajectory.primitive);
  if(!primitive.ok) throw Error('Missing primitive');
  // At the original first step t=5/6 translates +1 world unit, placing both bars on the same center plane.
  for(const t of [0,0.25,0.5,0.75,5/6,1]){
    const {rotation:r,translation:u}=primitive.value.pose(t,trajectory.params);
    const M=new Matrix4().set(r[0],r[1],r[2],u[0],r[3],r[4],r[5],u[1],r[6],r[7],r[8],u[2],0,0,0,1);
    for(const fixed of statics) if(fixed.bvh.intersectsGeometry(moving.bvh.geometry,M))
      intersections.push({step:index+1, moving:step.partId,fixed:fixed.partId,t,worldTravel:u.map(v=>v/s1.normalization.scale)});
  }
});
console.log(JSON.stringify({status:plan.status, firstStep:plan.steps[0], firstPrimitive:compiled.steps[0].primitive,oracleTotalHits,intersections},null,2));
if(intersections.some(hit=>hit.t>0 && hit.t<1)) throw Error('A compiled path goes through an unremoved part.');
