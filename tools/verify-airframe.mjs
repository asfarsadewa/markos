import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Exercise the real exported skin and animation in Three.js. Only image and
// material dependencies are removed for this geometry-only Node verification.
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, values) {
    super(type);
    Object.assign(this, values);
  }
};
globalThis.matchMedia = () => ({ matches: false });
async function loadGeometry(filename) {
  const bytes = fs.readFileSync(filename),
    jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const binStart = 20 + jsonLength + 8;
  json.buffers[0].uri =
    "data:application/octet-stream;base64," +
    bytes.subarray(binStart).toString("base64");
  delete json.materials;
  delete json.images;
  delete json.textures;
  for (const mesh of json.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
  return new GLTFLoader().parseAsync(JSON.stringify(json), "");
}

const filename = process.argv[2] ?? "public/models/markos.glb";
const gltf = await loadGeometry(filename),
  meshes = [];
gltf.scene.traverse((o) => {
  if (o.isSkinnedMesh) meshes.push(o);
});
assert.ok(meshes.length > 0);
const clip = gltf.animations.find((a) => a.name === "Transform");
fs.mkdirSync("output/verification", { recursive: true });
fs.writeFileSync(
  "output/verification/airframe-ink.mjs",
  ts.transpile(fs.readFileSync("src/airframe-ink.ts", "utf8"), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  }),
);
const { addAirframeInk } =
  await import("../output/verification/airframe-ink.mjs");
addAirframeInk(gltf.scene);
for (const mesh of meshes) {
  const contour = gltf.scene.getObjectByName(`${mesh.name} ink contour`);
  assert.ok(contour?.isSkinnedMesh, "Each armor mesh has its ink pass");
  assert.equal(
    contour.geometry,
    mesh.geometry,
    "Ink reuses the Blender geometry",
  );
  assert.equal(
    contour.skeleton,
    mesh.skeleton,
    "Ink follows the same animated skeleton",
  );
  assert.ok(
    contour.bindMatrix.equals(mesh.bindMatrix),
    "Ink retains the original skin binding",
  );
}
assert.ok(Math.abs(clip.duration - 2.4) < 0.001);
const mixer = new T.AnimationMixer(gltf.scene),
  action = mixer.clipAction(clip);
action.play();
action.paused = true;
function pose(t) {
  action.time = Math.min(t, clip.duration - 0.00001);
  mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.skeleton.update();
}
pose(0);
for (const side of ["L", "R"]) {
  const bone = gltf.scene.getObjectByName("forearm_" + side);
  assert.ok(bone?.isBone, "Export includes both elbow joints");
  assert.equal(
    bone.parent.name,
    "arm_" + side,
    "Elbow inherits the shoulder motion",
  );
  assert.ok(
    bone.quaternion.angleTo(new T.Quaternion()) < 0.001,
    "Elbow fits the fighter stow",
  );
}
pose(clip.duration);
for (const side of ["L", "R"]) {
  const angle = gltf.scene
    .getObjectByName("forearm_" + side)
    .quaternion.angleTo(new T.Quaternion());
  assert.ok(
    angle > 0.75 && angle < 1,
    "Both deployed forearms flex into the ready stance",
  );
}
for (const mesh of meshes) {
  const weights = mesh.geometry.attributes.skinWeight;
  for (let i = 0; i < weights.count; i++) {
    const sum =
      weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
    assert.ok(
      Math.abs(sum - 1) < 0.00001,
      "Each armor vertex has normalized skin weights",
    );
    assert.ok(
      weights.getX(i) === 1,
      "Armor stays rigid rather than stretching across a joint",
    );
  }
}
fs.mkdirSync("output/verification", { recursive: true });
fs.writeFileSync(
  "output/verification/camera.mjs",
  ts.transpile(
    fs
      .readFileSync("src/camera.ts", "utf8")
      .replace("./flight.mjs", "../../src/flight.mjs"),
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  ),
);
const { FlightCamera } = await import("../output/verification/camera.mjs");
const position = new T.Vector3(0, 1910, 0),
  forward = new T.Vector3(0, 0, -1),
  up = new T.Vector3(0, 1, 0);
const input = { look: { x: 0, y: 0 }, down: () => false };
const world = {
  terrainClearance: (p) => p.length() - 1800,
  cameraObstruction: () => null,
};
const cameras = [0, 1, 2, 3].map((style) => {
  const camera = new T.PerspectiveCamera(55, 16 / 9, 0.3, 14000),
    rig = new FlightCamera(camera);
  rig.select(style);
  rig.reset();
  for (let i = 0; i < 300; i++)
    rig.update(
      1 / 60,
      input,
      world,
      position,
      forward,
      up,
      0,
      0,
      82,
      false,
      0,
      0,
    );
  return { camera, rig, name: FlightCamera.names[style], maxX: 0, maxY: 0 };
});
const point = new T.Vector3(),
  screen = new T.Vector3();
let samples = 0,
  initialBounds;
for (const direction of [1, -1])
  for (let frame = 0; frame <= 72; frame++) {
    const transform = direction === 1 ? frame / 72 : 1 - frame / 72;
    pose(transform * clip.duration);
    for (const { camera, rig } of cameras) {
      rig.update(
        1 / 30,
        input,
        world,
        position,
        forward,
        up,
        0,
        0,
        82 - 54 * transform,
        false,
        direction === 1 ? 1 : 0,
        transform,
      );
      camera.updateMatrixWorld();
    }
    const bounds = new T.Box3();
    for (const mesh of meshes)
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, point);
        point.applyMatrix4(mesh.matrixWorld);
        assert.ok(
          Number.isFinite(point.x + point.y + point.z),
          "Baked deformation remains finite",
        );
        bounds.expandByPoint(point);
        point.multiplyScalar(1.35).add(position);
        for (const shot of cameras) {
          screen.copy(point).project(shot.camera);
          shot.maxX = Math.max(shot.maxX, Math.abs(screen.x));
          shot.maxY = Math.max(shot.maxY, Math.abs(screen.y));
          assert.ok(
            Math.abs(screen.x) < 0.88 &&
              Math.abs(screen.y) < 0.88 &&
              screen.z < 1,
            `${shot.name} clips actual armor at ${direction}:${frame}`,
          );
        }
        samples++;
      }
    if (direction === 1 && frame === 0) initialBounds = bounds.clone();
    if (direction === -1 && frame === 72) {
      assert.ok(
        initialBounds.min.distanceTo(bounds.min) < 0.00001 &&
          initialBounds.max.distanceTo(bounds.max) < 0.00001,
        "Reversing the clip returns exactly to the fighter configuration",
      );
    }
  }
const report = {
  file: filename,
  verticesSampled: samples,
  poses: 146,
  duration: clip.duration,
  cameras: cameras.map((c, i) => ({
    name: FlightCamera.names[i],
    maxProjectedX: c.maxX,
    maxProjectedY: c.maxY,
  })),
};
fs.writeFileSync(
  "output/verification/airframe-animation.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
