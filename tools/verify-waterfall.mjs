import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import ts from "typescript";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, values) {
    super(type);
    Object.assign(this, values);
  }
};
function glb(path) {
  const bytes = fs.readFileSync(path),
    length = bytes.readUInt32LE(12);
  return {
    json: JSON.parse(bytes.toString("utf8", 20, 20 + length)),
    bin: bytes.subarray(28 + length),
  };
}
const file = process.argv[2] ?? "public/models/island-waterfall.glb";
const current = glb(file),
  json = current.json;
if (process.argv[3]) {
  const previous = glb(process.argv[3]);
  const data = (asset, index) => {
    const a = asset.json.accessors[index],
      view = asset.json.bufferViews[a.bufferView];
    return asset.bin.subarray(
      (view.byteOffset ?? 0) + (a.byteOffset ?? 0),
      (view.byteOffset ?? 0) + view.byteLength,
    );
  };
  assert.equal(json.meshes.length, previous.json.meshes.length);
  for (let i = 0; i < json.meshes.length; i++)
    for (let j = 0; j < json.meshes[i].primitives.length; j++) {
      const a = json.meshes[i].primitives[j],
        b = previous.json.meshes[i].primitives[j];
      for (const name of ["POSITION", "NORMAL", "TEXCOORD_0"])
        assert.deepEqual(
          data(current, a.attributes[name]),
          data(previous, b.attributes[name]),
          name + " unchanged",
        );
      assert.deepEqual(
        data(current, a.indices),
        data(previous, b.indices),
        "Triangle indices unchanged",
      );
    }
  for (let i = 0; i < json.images.length; i++) {
    const a = json.bufferViews[json.images[i].bufferView],
      b = previous.json.bufferViews[previous.json.images[i].bufferView];
    assert.deepEqual(
      current.bin.subarray(a.byteOffset, a.byteOffset + a.byteLength),
      previous.bin.subarray(b.byteOffset, b.byteOffset + b.byteLength),
      "Original paint unchanged",
    );
  }
  console.log(
    "Waterfall positions, normals, UVs, triangles and embedded paint remain byte-identical.",
  );
}
const triangles = json.meshes
  .flatMap((m) => m.primitives)
  .reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
assert.equal(triangles, 150000);
assert.equal(json.skins[0].joints.length, 19);
json.buffers[0].uri =
  "data:application/octet-stream;base64," + current.bin.toString("base64");
delete json.materials;
delete json.textures;
delete json.images;
for (const m of json.meshes) for (const p of m.primitives) delete p.material;
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
const mesh = [];
gltf.scene.traverse((o) => {
  if (o.isSkinnedMesh) mesh.push(o);
});
const clip = gltf.animations.find((a) => a.name === "WaterFlow");
assert.ok(clip);
assert.ok(Math.abs(clip.duration - 2.4) < 0.00001);
const mixer = new T.AnimationMixer(gltf.scene),
  action = mixer.clipAction(clip);
action.play();
action.paused = true;
function pose(t) {
  action.time = Math.min(t, clip.duration - 0.0000001);
  mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  for (const m of mesh) m.skeleton.update();
}
const records = [];
pose(0);
for (const m of mesh)
  for (let i = 0; i < m.geometry.attributes.position.count; i++) {
    const weights = m.geometry.attributes.skinWeight,
      indices = m.geometry.attributes.skinIndex;
    let waterWeight = 0;
    for (let k = 0; k < 4; k++)
      if (
        m.skeleton.bones[indices.getComponent(i, k)].name.startsWith("water_")
      )
        waterWeight += weights.getComponent(i, k);
    records.push({
      mesh: m,
      index: i,
      base: m.getVertexPosition(i, new T.Vector3()).applyMatrix4(m.matrixWorld),
      water: waterWeight > 0.00001,
    });
  }
let maxMotion = 0,
  maxRockMotion = 0,
  loopError = 0,
  maxSeamStepDifference = 0;
const point = new T.Vector3();
for (let frame = 0; frame <= 72; frame++) {
  pose(frame / 30);
  for (const r of records) {
    r.mesh.getVertexPosition(r.index, point).applyMatrix4(r.mesh.matrixWorld);
    assert.ok(point.toArray().every(Number.isFinite));
    const d = point.distanceTo(r.base);
    if (r.water) maxMotion = Math.max(maxMotion, d);
    else maxRockMotion = Math.max(maxRockMotion, d);
    if (frame === 72) loopError = Math.max(loopError, d);
    if (r.water && frame === 1) r.firstStep = point.clone().sub(r.base);
    if (r.water && frame === 71) r.penultimate = point.clone();
    if (r.water && frame === 72)
      maxSeamStepDifference = Math.max(
        maxSeamStepDifference,
        point.clone().sub(r.penultimate).distanceTo(r.firstStep),
      );
  }
}
assert.ok(
  maxMotion > 0.25 && maxMotion < 2,
  "Visible ripple stays within a two-metre envelope",
);
assert.ok(maxRockMotion < 0.0001, "Rock and architecture remain stationary");
assert.ok(loopError < 0.0001, "The animation closes at its original rest pose");
assert.ok(
  maxSeamStepDifference < 0.025,
  "Loop boundary velocity stays continuous within the baked frame spacing",
);
const report = {
  triangles,
  bones: 19,
  clip: clip.name,
  duration: clip.duration,
  frames: 73,
  vertices: records.length,
  waterVertices: records.filter((r) => r.water).length,
  maxMotion,
  maxRockMotion,
  loopError,
  maxSeamStepDifference,
};
fs.mkdirSync("output/verification", { recursive: true });
fs.writeFileSync(
  "output/verification/cloud-paint.mjs",
  ts.transpile(fs.readFileSync("src/cloud-paint.ts", "utf8"), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  }),
);
fs.writeFileSync(
  "output/verification/water-flow-world.mjs",
  ts
    .transpile(fs.readFileSync("src/asset-world.ts", "utf8"), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    })
    .replace('"./cloud-paint"', '"./cloud-paint.mjs"'),
);
const { World } = await import("../output/verification/water-flow-world.mjs");
const world = Object.create(World.prototype);
Object.assign(world, {
  ambientMixers: [mixer],
  reducedMotion: false,
  ambient: new T.HemisphereLight(),
  sun: new T.DirectionalLight(),
  clouds: [],
  sky: null,
  oceanMaterial: null,
});
action.paused = false;
const sample = records.find((r) => r.water);
function currentPoint() {
  gltf.scene.updateMatrixWorld(true);
  sample.mesh.skeleton.update();
  return sample.mesh
    .getVertexPosition(sample.index, new T.Vector3())
    .applyMatrix4(sample.mesh.matrixWorld);
}
world.tick(0, new T.Vector3(0, 1910, 0));
const beginning = currentPoint();
world.tick(1.2, new T.Vector3(0, 1910, 0));
const playing = currentPoint();
assert.ok(
  playing.distanceTo(beginning) > 0.0001,
  "World clock advances the baked water clip",
);
world.tick(1.2, new T.Vector3(0, 1910, 0));
assert.ok(
  currentPoint().distanceTo(playing) < 0.000001,
  "A paused clock holds the water pose",
);
world.reducedMotion = true;
world.tick(4.1, new T.Vector3(0, 1910, 0));
assert.ok(
  currentPoint().distanceTo(beginning) < 0.000001,
  "Reduced motion retains the neutral water pose",
);
report.runtimeClockVerified = true;
fs.writeFileSync(
  "output/verification/waterfall.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
