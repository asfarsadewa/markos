import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { World } from "./load-verification-world.mjs";
globalThis.matchMedia = () => ({ matches: false });
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, values) {
    super(type);
    Object.assign(this, values);
  }
};
const bytes = fs.readFileSync("public/models/markos.glb"),
  length = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
json.buffers[0].uri =
  "data:application/octet-stream;base64," +
  bytes.subarray(28 + length).toString("base64");
delete json.materials;
delete json.images;
delete json.textures;
for (const m of json.meshes) for (const p of m.primitives) delete p.material;
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
const armor = gltf.scene.getObjectsByProperty("isSkinnedMesh", true);
for (const mesh of armor) mesh.castShadow = mesh.receiveShadow = true;
const { addAirframeInk } = await import("../src/airframe-ink.ts");
addAirframeInk(gltf.scene);
const contours = gltf.scene
  .getObjectsByProperty("isSkinnedMesh", true)
  .filter((m) => !armor.includes(m));
assert.equal(contours.length, armor.length);
assert.ok(
  contours.every((m) => !m.castShadow && !m.receiveShadow),
  "ink shells never enter the shadow pass",
);
// Exercise the real light setup and tick, bypassing only asynchronous scenery
// loading. The animated caster below is the full current Blender export.
const originalLoad = World.prototype.load;
World.prototype.load = () => Promise.resolve();
const scene = new T.Scene(),
  world = new World(scene);
World.prototype.load = originalLoad;
await world.ready;
const hero = new T.Group();
hero.scale.setScalar(1.35);
hero.add(gltf.scene);
scene.add(hero);
const mixer = new T.AnimationMixer(gltf.scene),
  clip = gltf.animations.find((c) => c.name === "Transform"),
  action = mixer.clipAction(clip);
action.play();
action.paused = true;
const up = new T.Vector3(),
  forward = new T.Vector3(),
  right = new T.Vector3(),
  point = new T.Vector3();
let maxX = 0,
  maxY = 0,
  samples = 0;
for (const axis of [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
])
  for (const bank of [-0.85, 0, 0.85]) {
    up.fromArray(axis);
    forward.set(0, 0, -1).projectOnPlane(up);
    if (forward.lengthSq() < 0.01) forward.set(1, 0, 0);
    forward.normalize();
    right.crossVectors(forward, up).normalize();
    hero.position.copy(up).multiplyScalar(1825);
    hero.quaternion
      .setFromRotationMatrix(
        new T.Matrix4().makeBasis(right, up, forward.clone().negate()),
      )
      .multiply(
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), bank),
      );
    for (let frame = 0; frame <= 24; frame++) {
      action.time = (frame / 24) * (clip.duration - 0.00001);
      mixer.update(0);
      world.tick(0, hero.position);
      scene.updateMatrixWorld(true);
      world.sun.shadow.updateMatrices(world.sun);
      for (const mesh of armor) {
        mesh.skeleton.update();
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          mesh
            .getVertexPosition(i, point)
            .applyMatrix4(mesh.matrixWorld)
            .project(world.sun.shadow.camera);
          assert.ok(point.toArray().every(Number.isFinite));
          maxX = Math.max(maxX, Math.abs(point.x));
          maxY = Math.max(maxY, Math.abs(point.y));
          assert.ok(
            Math.abs(point.x) < 0.95 &&
              Math.abs(point.y) < 0.95 &&
              point.z > -1 &&
              point.z < 1,
            "shadow camera retains every animated vertex across the sphere",
          );
          samples++;
        }
      }
    }
  }
const fades = [];
for (const altitude of [10, 160, 240, 320, 400, 1000, 25]) {
  world.tick(0, new T.Vector3(0, 1800 + altitude, 0));
  fades.push({
    altitude,
    intensity: world.sun.shadow.intensity,
    updating: world.sun.shadow.autoUpdate,
  });
}
assert.equal(fades[0].intensity, 0.38);
assert.ok(
  fades[2].intensity < fades[1].intensity &&
    fades[3].intensity < fades[2].intensity,
);
assert.equal(fades[4].intensity, 0);
assert.equal(fades[4].updating, false);
assert.equal(fades[5].updating, false);
assert.equal(fades[6].updating, true);
assert.equal(
  fades[6].intensity,
  0.38,
  "shadow rendering resumes after descent",
);
const report = {
  samples,
  poses: 25,
  hemispheres: 6,
  banks: 3,
  maxX,
  maxY,
  casters: armor.length,
  excludedInkShells: contours.length,
  mapSize: world.sun.shadow.mapSize.toArray(),
  fades,
};
fs.writeFileSync(
  "output/verification/airframe-shadow.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
