import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, values) {
    super(type);
    Object.assign(this, values);
  }
};
async function load(path) {
  const bytes = fs.readFileSync(path),
    length = bytes.readUInt32LE(12);
  const source = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  const json = structuredClone(source);
  json.buffers[0].uri =
    "data:application/octet-stream;base64," +
    bytes.subarray(28 + length).toString("base64");
  delete json.materials;
  delete json.images;
  delete json.textures;
  for (const mesh of json.meshes)
    for (const p of mesh.primitives) delete p.material;
  return {
    gltf: await new GLTFLoader().parseAsync(JSON.stringify(json), ""),
    source,
    bin: bytes.subarray(28 + length),
  };
}
const loaded = await load(process.argv[2] ?? "public/models/markos.glb"),
  { gltf } = loaded;
if (process.argv[3]) {
  const old = await load(process.argv[3]);
  assert.equal(loaded.source.nodes.length, old.source.nodes.length);
  for (let index = 0; index < old.source.nodes.length; index++) {
    const previous = old.source.nodes[index],
      next = loaded.source.nodes[index];
    for (const key of new Set([
      ...Object.keys(previous),
      ...Object.keys(next),
    ])) {
      if (["translation", "rotation", "scale"].includes(key)) {
        assert.equal(previous[key].length, next[key].length);
        assert.ok(
          previous[key].every(
            (value, i) => Math.abs(value - next[key][i]) < 1e-6,
          ),
          "Rest transforms stay within export precision",
        );
      } else assert.deepEqual(next[key], previous[key]);
    }
  }
  assert.deepEqual(
    loaded.source.skins,
    old.source.skins,
    "Skin binding is unchanged",
  );
  assert.deepEqual(
    loaded.source.meshes,
    old.source.meshes,
    "Mesh layout is unchanged",
  );
  const accessors = new Set();
  for (const mesh of old.source.meshes)
    for (const p of mesh.primitives) {
      accessors.add(p.indices);
      for (const index of Object.values(p.attributes)) accessors.add(index);
    }
  for (const skin of old.source.skins) accessors.add(skin.inverseBindMatrices);
  const viewBytes = (asset, index) => {
    const view = asset.source.bufferViews[index];
    return asset.bin.subarray(
      view.byteOffset ?? 0,
      (view.byteOffset ?? 0) + view.byteLength,
    );
  };
  for (const index of accessors) {
    assert.deepEqual(
      loaded.source.accessors[index],
      old.source.accessors[index],
    );
    assert.deepEqual(
      viewBytes(loaded, loaded.source.accessors[index].bufferView),
      viewBytes(old, old.source.accessors[index].bufferView),
    );
  }
  for (const clip of old.gltf.animations) {
    const next = gltf.animations.find((c) => c.name === clip.name);
    assert.ok(next);
    assert.equal(next.tracks.length, clip.tracks.length);
    for (const track of clip.tracks) {
      const nextTrack = next.tracks.find((t) => t.name === track.name);
      assert.deepEqual(nextTrack.times, track.times);
      assert.deepEqual(nextTrack.values, track.values);
    }
  }
  for (let index = 0; index < old.source.images.length; index++)
    assert.deepEqual(
      viewBytes(loaded, loaded.source.images[index].bufferView),
      viewBytes(old, old.source.images[index].bufferView),
    );
  console.log(
    "Original geometry, skin, paint and both existing animation clips remain byte-identical; rest nodes stay within one micrometre of export precision.",
  );
}
fs.mkdirSync("output/verification", { recursive: true });
const { RobotControls } = await import("../src/robot-controls.ts");
const controls = new RobotControls(gltf.scene, gltf.animations),
  mixer = new T.AnimationMixer(gltf.scene);
const clip = gltf.animations.find((a) => a.name === "Transform"),
  action = mixer.clipAction(clip);
action.play();
action.paused = true;
const names = ["head", "arm_L", "arm_R", "forearm_L", "forearm_R"];
const joints = names.map((name) => gltf.scene.getObjectByName(name));
function pose(t, steering, dt = 1 / 60) {
  action.time = t * (clip.duration - 0.00001);
  mixer.update(0);
  controls.update(dt, steering, t);
  gltf.scene.updateMatrixWorld(true);
}
pose(1, 0);
const neutral = joints.map((b) => b.quaternion.clone());
for (const steering of [-1, 1]) {
  controls.reset();
  for (let i = 0; i < 180; i++) pose(1, steering);
  for (let i = 0; i < joints.length; i++)
    assert.ok(
      Math.abs(
        joints[i].quaternion.angleTo(neutral[i]) -
          ([8, 4, 4, 12, 12][i] * Math.PI) / 180,
      ) < 0.001,
      "Full steering reaches the authored joint deflection",
    );
  const settled = joints.map((b) => b.quaternion.clone());
  for (let i = 0; i < 600; i++) pose(1, steering);
  assert.ok(
    joints.every((b, i) => b.quaternion.angleTo(settled[i]) < 0.00001),
    "Repeated frames do not accumulate rotations",
  );
  pose(1, -steering);
  assert.ok(
    joints.every((b, i) => b.quaternion.angleTo(settled[i]) < 0.06),
    "Steering reverses through a damped pose",
  );
  for (let frame = 0; frame <= 144; frame++) {
    const t = (frame <= 72 ? frame : 144 - frame) / 72;
    pose(t, steering);
    if (t <= 0.65) {
      const expected = clip.tracks.filter((track) =>
        names.some((n) => track.name === n + ".quaternion"),
      );
      for (const track of expected) {
        const q = new T.Quaternion()
          .fromArray(
            new T.QuaternionLinearInterpolant(
              track.times,
              track.values,
              4,
            ).evaluate(t * (clip.duration - 0.00001)),
          )
          .normalize();
        assert.ok(
          gltf.scene
            .getObjectByName(track.name.split(".")[0])
            .quaternion.angleTo(q) < 0.00001,
          "Stow and early deployment retain the original pose",
        );
      }
    }
    gltf.scene.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.update();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i += 97)
        assert.ok(
          mesh
            .getVertexPosition(i, new T.Vector3())
            .toArray()
            .every(Number.isFinite),
        );
    });
  }
}
const rateResults = [];
for (const fps of [30, 60, 144]) {
  controls.reset();
  for (let i = 0; i < fps; i++) pose(1, 0.6, 1 / fps);
  rateResults.push(joints.map((b) => b.quaternion.clone()));
}
for (const result of rateResults)
  assert.ok(
    result.every((q, i) => q.angleTo(rateResults[0][i]) < 0.00001),
    "Bracing response is frame-rate independent",
  );
controls.reset();
pose(1, 0);
assert.ok(
  joints.every((b, i) => b.quaternion.angleTo(neutral[i]) < 0.00001),
  "Reset restores the neutral robot stance",
);
console.log(
  "Robot bracing verified: authored angles, no accumulation, damped reversal, stow preservation, finite deformation and frame-rate consistency.",
);

// Project every exported vertex with full bracing and its actual flight bank.
globalThis.matchMedia = () => ({ matches: false });
const { FlightCamera } = await import("../src/camera.ts");
const world = {
  terrainClearance: (p) => p.length() - 1800,
  cameraObstruction: () => null,
};
const input = { look: { x: 0, y: 0 }, down: () => false };
const position = new T.Vector3(0, 1910, 0),
  up = new T.Vector3(0, 1, 0),
  forward = new T.Vector3(0, 0, -1);
const point = new T.Vector3(),
  results = [];
let samples = 0;
for (const aspect of [16 / 9, 1, 9 / 16])
  for (let style = 0; style < 4; style++)
    for (const steering of [-1, 0, 1]) {
      controls.reset();
      for (let frame = 0; frame < 180; frame++) pose(1, steering);
      const bank = -steering * 0.85 * 0.45,
        rotation = new T.Quaternion().setFromAxisAngle(
          new T.Vector3(0, 0, 1),
          bank,
        );
      const camera = new T.PerspectiveCamera(55, aspect, 0.3, 14000),
        rig = new FlightCamera(camera);
      rig.select(style);
      camera.position.copy(position).add(new T.Vector3(0, 10, 27));
      for (let frame = 0; frame < 300; frame++)
        rig.update(
          1 / 60,
          input,
          world,
          position,
          forward,
          up,
          0,
          bank,
          28,
          false,
          1,
          1,
        );
      camera.updateMatrixWorld();
      let maxX = 0,
        maxY = 0;
      gltf.scene.traverse((mesh) => {
        if (!mesh.isSkinnedMesh) return;
        mesh.skeleton.update();
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          mesh
            .getVertexPosition(i, point)
            .applyMatrix4(mesh.matrixWorld)
            .multiplyScalar(1.35)
            .applyQuaternion(rotation)
            .add(position)
            .project(camera);
          samples++;
          maxX = Math.max(maxX, Math.abs(point.x));
          maxY = Math.max(maxY, Math.abs(point.y));
          assert.ok(
            Math.abs(point.x) < 0.9 &&
              Math.abs(point.y) < 0.9 &&
              point.z > -1 &&
              point.z < 1,
            "Full bracing stays within the settled camera frame",
          );
        }
      });
      results.push({
        aspect,
        style: FlightCamera.names[style],
        steering,
        maxX,
        maxY,
      });
    }
fs.writeFileSync(
  "output/verification/robot-framing.json",
  JSON.stringify({ samples, scenarios: results.length, results }, null, 2),
);
console.log(
  `Every-vertex robot framing verified: ${samples} samples in ${results.length} bracing/style/aspect combinations.`,
);
