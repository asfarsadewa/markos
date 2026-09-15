import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.ProgressEvent ??= class extends Event {
  constructor(type,values){super(type);Object.assign(this,values);}
};
async function loadGeometry(filename) {
const bytes=fs.readFileSync(filename),length=bytes.readUInt32LE(12);
const json=JSON.parse(bytes.toString('utf8',20,20+length));
json.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(28+length).toString('base64');
delete json.images;delete json.textures;delete json.materials;
for(const mesh of json.meshes)for(const primitive of mesh.primitives)delete primitive.material;
return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
const gltf=await loadGeometry('public/models/markos.glb');
const clip=gltf.animations.find(c=>c.name==='Transform'),mixer=new T.AnimationMixer(gltf.scene);
const action=mixer.clipAction(clip);action.play();action.paused=true;
const meshes=[];gltf.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
const initial=[];
for(let frame=0;frame<=144;frame++) {
  const amount=(frame<=72?frame:144-frame)/72;
  action.time=amount*(clip.duration-.00001);mixer.update(0);gltf.scene.updateMatrixWorld(true);
  for(const side of ['L','R']) {
    const knee=gltf.scene.getObjectByName('kneeguard_'+side);
    assert.ok(knee?.isBone,'Both knee armor joints are exported');
    assert.equal(knee.parent.name,'legguard_'+side,'Lower armor inherits the upper leg assembly');
    const angle=knee.quaternion.angleTo(new T.Quaternion());
    if(amount<=2/3)assert.ok(angle<.0001,'Knee armor remains locked through fighter stow and early transformation');
    if(frame===72)assert.ok(Math.abs(angle-T.MathUtils.degToRad(20))<.0001,'Deployed knee armor retains its baked 20-degree bend');
    assert.ok(angle<T.MathUtils.degToRad(20.1),'Knee bend never overshoots its mechanical range');
    if(frame===0)initial.push(knee.matrixWorld.clone());
    if(frame===144)assert.ok(knee.matrixWorld.elements.every((n,i)=>Math.abs(n-initial[side==='L'?0:1].elements[i])<.00001),
      'Reversal restores the original knee stow');
  }
}
for(const side of ['L','R']) {
  let vertices=0;
  for(const mesh of meshes) {
    const bone=mesh.skeleton.bones.findIndex(b=>b.name==='kneeguard_'+side);
    if(bone<0)continue;
    const joints=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    for(let i=0;i<joints.count;i++)if(joints.getX(i)===bone&&weights.getX(i)===1)vertices++;
  }
  assert.ok(vertices>100,'Each knee joint drives actual rigid armor vertices');
}
console.log('Baked flight stance verified: weighted knee armor, late deployment, bounded flex and exact reversal.');
if(process.argv[2]) {
  const previous=await loadGeometry(process.argv[2]),oldMixer=new T.AnimationMixer(previous.scene);
  const oldClip=previous.animations.find(c=>c.name==='Transform'),oldAction=oldMixer.clipAction(oldClip);
  oldAction.play();oldAction.paused=true;
  const oldBones=[];previous.scene.traverse(o=>{if(o.isBone)oldBones.push(o);});
  for(let frame=0;frame<=48;frame++) {
    action.time=clip.duration*frame/72;oldAction.time=oldClip.duration*frame/72;
    mixer.update(0);oldMixer.update(0);gltf.scene.updateMatrixWorld(true);previous.scene.updateMatrixWorld(true);
    for(const old of oldBones) {
      const bone=gltf.scene.getObjectByName(old.name);
      assert.ok(bone.matrixWorld.elements.every((v,i)=>Math.abs(v-old.matrixWorld.elements[i])<.0001),
        `${old.name} retains the previous stow and early deployment at frame ${frame}`);
    }
  }
  console.log('Preserved-source comparison passed: all original joints retain stow and early deployment through frame 48.');
}
