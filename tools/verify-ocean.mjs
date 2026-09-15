import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { world } from "./load-verification-world.mjs";
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, values) {
    super(type);
    Object.assign(this, values);
  }
};
function read(path) {
  const b = fs.readFileSync(path),
    n = b.readUInt32LE(12);
  return {
    json: JSON.parse(b.toString("utf8", 20, 20 + n)),
    bin: b.subarray(28 + n),
  };
}
const current = read(process.argv[2] ?? "public/models/painted-ocean.glb");
const j = current.json;
if (process.argv[3]) {
  const old = read(process.argv[3]);
  const accessor = (a, index) => {
    const x = a.json.accessors[index],
      v = a.json.bufferViews[x.bufferView];
    return a.bin.subarray(
      (v.byteOffset ?? 0) + (x.byteOffset ?? 0),
      (v.byteOffset ?? 0) + v.byteLength,
    );
  };
  const p = j.meshes[0].primitives[0],
    q = old.json.meshes[0].primitives[0];
  for (const name of ["POSITION", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"])
    assert.deepEqual(
      accessor(current, p.attributes[name]),
      accessor(old, q.attributes[name]),
      name + " preserved",
    );
  // Blender's shape-key normal recalculation differs by under 0.0001 per
  // component from the older static export; the rest surface is unchanged.
  const normals = accessor(current, p.attributes.NORMAL),
    previousNormals = accessor(old, q.attributes.NORMAL);
  let normalDrift = 0;
  for (let i = 0; i < normals.length; i += 4)
    normalDrift = Math.max(
      normalDrift,
      Math.abs(normals.readFloatLE(i) - previousNormals.readFloatLE(i)),
    );
  assert.ok(
    normalDrift < 0.00011,
    "rest normals retain their original directions",
  );
  assert.deepEqual(
    accessor(current, p.indices),
    accessor(old, q.indices),
    "triangles preserved",
  );
  const image = (a) => {
    const v = a.json.bufferViews[a.json.images[0].bufferView];
    return a.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
  };
  assert.deepEqual(image(current), image(old), "embedded paint preserved");
  console.log(
    "Original ocean topology, positions, UVs, skin weights and embedded paint are byte-identical. Rest normal component drift:",
    normalDrift,
  );
}
assert.equal(j.skins[0].joints.length, 1);
assert.equal(j.meshes[0].primitives[0].targets.length, 4);
assert.equal(j.accessors[j.meshes[0].primitives[0].indices].count / 3, 65024);
j.buffers[0].uri =
  "data:application/octet-stream;base64," + current.bin.toString("base64");
delete j.materials;
delete j.textures;
delete j.images;
for (const m of j.meshes) for (const p of m.primitives) delete p.material;
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(j), "");
const sea = gltf.scene.getObjectsByProperty("isSkinnedMesh", true)[0];
const clip = gltf.animations.find((c) => c.name === "OceanSwells");
assert.equal(clip.duration, 12);
const mixer = new T.AnimationMixer(gltf.scene);
mixer.clipAction(clip).play();
Object.assign(world, {
  ambientMixers: [mixer],
  reducedMotion: false,
  ambient: new T.HemisphereLight(),
  sun: new T.DirectionalLight(),
  clouds: [],
  sky: null,
  oceanMaterial: null,
});
const viewer = new T.Vector3(0, 1900, 180);
function pose(time) {
  world.tick(time, viewer);
  gltf.scene.updateMatrixWorld(true);
  sea.skeleton.update();
}
const count = sea.geometry.attributes.position.count;
const base = [],
  start = [],
  calm = [];
pose(0);
for (let i = 0; i < count; i++) {
  base.push(
    new T.Vector3().fromBufferAttribute(sea.geometry.attributes.position, i),
  );
  start.push(sea.getVertexPosition(i, new T.Vector3()));
  calm.push(
    sea.geometry.morphAttributes.position.every(
      (a) => new T.Vector3().fromBufferAttribute(a, i).length() < 0.00001,
    ),
  );
}
let coastalVertices = 0;
const localPoint = new T.Vector3();
for (let i = 0; i < count; i++) {
  const p = base[i].clone().applyMatrix4(sea.matrixWorld);
  for (const collider of world.colliders) {
    if (p.distanceTo(collider.center) > collider.radius + 89) continue;
    localPoint.copy(p).applyMatrix4(collider.inverse);
    const nearest = collider.mesh.geometry.boundsTree.closestPointToPoint(
      localPoint,
      undefined,
      0,
      89,
    );
    if (nearest && nearest.distance < 89) {
      assert.ok(
        calm[i],
        "Coastal vertex " +
          i +
          " at " +
          p.toArray().join(",") +
          " near " +
          collider.name,
      );
      coastalVertices++;
      break;
    }
  }
}
assert.ok(
  coastalVertices > 100,
  "coastal exclusion audit samples the authored islands",
);
let maxHeight = 0,
  loopError = 0,
  maxMotion = 0,
  calmMotion = 0,
  maxLoopStepDifference = 0;
const firstStep = [],
  penultimate = [];
const point = new T.Vector3();
for (let frame = 0; frame <= 360; frame++) {
  pose(frame / 30);
  for (let i = 0; i < count; i++) {
    sea.getVertexPosition(i, point);
    assert.ok(point.toArray().every(Number.isFinite));
    maxHeight = Math.max(maxHeight, point.distanceTo(base[i]));
    maxMotion = Math.max(maxMotion, point.distanceTo(start[i]));
    if (calm[i]) calmMotion = Math.max(calmMotion, point.distanceTo(base[i]));
    if (frame === 360)
      loopError = Math.max(loopError, point.distanceTo(start[i]));
    if (frame === 1) firstStep.push(point.clone().sub(start[i]));
    if (frame === 359) penultimate.push(point.clone());
    if (frame === 360)
      maxLoopStepDifference = Math.max(
        maxLoopStepDifference,
        point.clone().sub(penultimate[i]).distanceTo(firstStep[i]),
      );
  }
}
assert.ok(maxHeight > 2 && maxHeight < 3.151);
assert.ok(maxMotion > 4);
assert.ok(loopError < 0.00001);
assert.ok(
  maxLoopStepDifference < 0.003,
  "swell velocity remains smooth across the baked loop seam",
);
assert.ok(calmMotion < 0.00001);
assert.ok(
  calm.filter(Boolean).length > count * 0.6,
  "calm water retained between authored patches",
);
const index = calm.findIndex((x) => !x);
pose(3);
const held = sea.getVertexPosition(index, new T.Vector3());
pose(3);
assert.ok(sea.getVertexPosition(index, point).distanceTo(held) < 0.000001);
world.reducedMotion = true;
pose(7);
assert.ok(
  sea.getVertexPosition(index, point).distanceTo(start[index]) < 0.000001,
);
const report = {
  triangles: 65024,
  bones: 1,
  morphTargets: 4,
  duration: clip.duration,
  frames: 361,
  vertices: count,
  calmVertices: calm.filter(Boolean).length,
  coastalVertices,
  maxHeight,
  maxMotion,
  loopError,
  maxLoopStepDifference,
  calmMotion,
  runtimeClockVerified: true,
};
fs.writeFileSync(
  "output/verification/ocean.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
