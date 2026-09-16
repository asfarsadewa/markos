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
const bytes = fs.readFileSync(process.argv[2] ?? "public/models/markos.glb"),
  length = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
json.buffers[0].uri =
  "data:application/octet-stream;base64," +
  bytes.subarray(28 + length).toString("base64");
delete json.materials;
delete json.images;
delete json.textures;
for (const mesh of json.meshes)
  for (const primitive of mesh.primitives) delete primitive.material;
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
fs.mkdirSync("output/verification", { recursive: true });
const { AileronControls } = await import("../src/aileron-controls.ts");
const controls = new AileronControls(gltf.scene, gltf.animations),
  mixer = new T.AnimationMixer(gltf.scene);
const clip = gltf.animations.find((a) => a.name === "Transform"),
  action = mixer.clipAction(clip);
action.play();
action.paused = true;
const left = gltf.scene.getObjectByName("aileron_L"),
  right = gltf.scene.getObjectByName("aileron_R");
assert.equal(left.parent.name, "wing_L");
assert.equal(right.parent.name, "wing_R");
function pose(transform, steering, dt = 1 / 60) {
  action.time = transform * (clip.duration - 0.00001);
  mixer.update(0);
  controls.update(dt, steering, transform);
  gltf.scene.updateMatrixWorld(true);
}
for (const steering of [-1, 1]) {
  controls.reset();
  for (let i = 0; i < 120; i++) pose(0, steering);
  assert.ok(
    left.quaternion.x * steering > 0 && right.quaternion.x * steering < 0,
    "Steering deflects left and right trailing edges in opposing directions",
  );
  for (const bone of [left, right])
    assert.ok(
      Math.abs(
        bone.quaternion.angleTo(new T.Quaternion()) - (14 * Math.PI) / 180,
      ) < 0.001,
      "Full input reaches the Blender-baked 14-degree pose",
    );
  const previous = left.quaternion.clone();
  pose(0, -steering);
  assert.ok(
    left.quaternion.angleTo(previous) < 0.09,
    "Steering reversal is damped rather than snapping",
  );
  for (let frame = 0; frame <= 144; frame++) {
    const transform = (frame <= 72 ? frame : 144 - frame) / 72;
    pose(transform, steering);
    if (transform >= 0.25)
      for (const bone of [left, right])
        assert.ok(
          bone.quaternion.angleTo(new T.Quaternion()) < 0.00001,
          "Control surfaces are neutral while the wings are folded",
        );
    gltf.scene.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.update();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i += 149) {
        const point = new T.Vector3().fromBufferAttribute(
          mesh.geometry.attributes.position,
          i,
        );
        mesh.applyBoneTransform(i, point);
        assert.ok(point.toArray().every(Number.isFinite));
      }
    });
  }
}
const results = [];
for (const fps of [30, 60, 144]) {
  controls.reset();
  for (let i = 0; i < fps; i++) pose(0, 0.6, 1 / fps);
  results.push(left.quaternion.clone());
}
assert.ok(
  results.every((q) => q.angleTo(results[0]) < 0.00001),
  "Response is consistent across frame rates",
);
controls.reset();
assert.ok(left.quaternion.angleTo(new T.Quaternion()) < 0.00001);
console.log(
  "Baked ailerons verified: opposing deflection, damped reversal, reset, frame-rate consistency and neutral folded wings through transformation/reversal.",
);
