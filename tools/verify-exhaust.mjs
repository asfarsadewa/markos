import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, values) { super(type); Object.assign(this, values); }
};
async function load(filename) {
  const bytes=fs.readFileSync(filename), length=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.toString("utf8",20,20+length));
  json.buffers[0].uri="data:application/octet-stream;base64,"+bytes.subarray(28+length).toString("base64");
  delete json.materials; delete json.images; delete json.textures;
  for(const mesh of json.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  return new GLTFLoader().parseAsync(JSON.stringify(json),"");
}
fs.mkdirSync("output/verification",{recursive:true});
fs.writeFileSync("output/verification/engine-exhaust.mjs",ts.transpile(
  fs.readFileSync("src/engine-exhaust.ts","utf8"),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}));
const {createEngineExhaust,updateEngineExhaust}=await import("../output/verification/engine-exhaust.mjs");
const hero=await load("public/models/markos.glb"), effect=await load("public/models/exhaust.glb");
let geometry;
effect.scene.traverse(o=>{if(o.isMesh)geometry=o.geometry;});
const plumes=createEngineExhaust(hero.scene,geometry);
assert.equal(plumes.length,4);
const vertices=geometry.attributes.position,index=geometry.index;
for(let i=0;i<index.count;i+=3)
  assert.ok(![0,1,2].every(c=>Math.abs(vertices.getZ(index.getX(i+c))-geometry.boundingBox.min.z)<.00001),
    "The plume has no solid base cap over the nozzle opening");
const mixer=new T.AnimationMixer(hero.scene),clip=hero.animations.find(a=>a.name==="Transform");
const action=mixer.clipAction(clip);action.play();action.paused=true;
const starts=[];
for(let frame=0;frame<=144;frame++) {
  action.time=(frame<=72?frame:144-frame)/72*(clip.duration-.00001);
  mixer.update(0);hero.scene.updateMatrixWorld(true);
  for(let i=0;i<plumes.length;i++) {
    const plume=plumes[i],socket=plume.parent;
    assert.equal(socket.parent.name,i<2?"shin_L":"shin_R");
    assert.equal(plume.geometry,geometry,"Reuse Blender-exported plume geometry");
    const origin=socket.getWorldPosition(new T.Vector3());
    if(frame===0) {
      assert.ok(origin.distanceTo(new T.Vector3(i<2?-.47:.47,i%2===0?.11:-.52,4.18))<.0001,
        "Authored socket retains the inspected nozzle location");
      starts[i]=origin.clone();
    }
    for(const thrust of [0,.5,1]) {
      updateEngineExhaust(plume,thrust,frame/30,true);
      hero.scene.updateMatrixWorld(true);
      const base=new T.Vector3(0,0,geometry.boundingBox.min.z).applyMatrix4(plume.matrixWorld);
      const tip=new T.Vector3(0,0,geometry.boundingBox.max.z).applyMatrix4(plume.matrixWorld);
      assert.ok(base.distanceTo(origin)<.00001,"Thrust never pulls the plume base out of its socket");
      assert.ok(Math.abs(base.distanceTo(tip)-2.7*(1+thrust*2))<.0001,"Thrust extends the plume length");
      assert.equal(plume.scale.x,1);assert.equal(plume.scale.y,1);
      assert.ok(plume.matrixWorld.elements.every(Number.isFinite));
      if(frame===72) {
        assert.ok(origin.distanceTo(starts[i])>3,"Nozzle follows the deployed leg");
        assert.ok(tip.sub(base).normalize().y<-.9,"Robot exhaust points downward with the leg");
      }
    }
    if(frame===144)assert.ok(origin.distanceTo(starts[i])<.00001,"Reversal restores nozzle attachment");
  }
}
console.log("Four Blender nozzle sockets verified through 145 forward/reverse poses: anchored bases, proportional length, fixed width and downward robot thrust.");
