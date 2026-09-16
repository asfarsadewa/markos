import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ConvexHull } from "three/addons/math/ConvexHull.js";

globalThis.ProgressEvent ??= class extends Event {
  constructor(type, values) {
    super(type);
    Object.assign(this, values);
  }
};
globalThis.matchMedia = () => ({ matches: false });
const bytes = fs.readFileSync("public/models/markos.glb");
const length = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
json.buffers[0].uri =
  "data:application/octet-stream;base64," +
  bytes.subarray(28 + length).toString("base64");
delete json.materials;
delete json.images;
delete json.textures;
for (const mesh of json.meshes)
  for (const p of mesh.primitives) delete p.material;
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
const meshes = [];
gltf.scene.traverse((o) => {
  if (o.isSkinnedMesh) meshes.push(o);
});
const clip = gltf.animations.find((a) => a.name === "Transform");
const mixer = new T.AnimationMixer(gltf.scene),
  action = mixer.clipAction(clip);
action.play();
action.paused = true;

// Convex hull vertices retain the exact projected silhouette of every posed
// mesh vertex. Nothing from this verification is exported into the game.
const hulls = [];
let sourceVertices = 0;
for (let pose = 0; pose <= 24; pose++) {
  action.time = Math.min(clip.duration - 0.00001, (clip.duration * pose) / 24);
  mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  const points = [];
  for (const mesh of meshes) {
    mesh.skeleton.update();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      const point = mesh
        .getVertexPosition(i, new T.Vector3())
        .applyMatrix4(mesh.matrixWorld)
        .multiplyScalar(1.35);
      points.push(point);
    }
  }
  sourceVertices += points.length;
  const hull = new ConvexHull().setFromPoints(points),
    vertices = new Set();
  for (const face of hull.faces) {
    let edge = face.edge;
    do {
      vertices.add(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
  }
  hulls.push([...vertices]);
}
fs.mkdirSync("output/verification", { recursive: true });

const { FlightCamera } = await import("../src/camera.ts");
const position = new T.Vector3(0, 1910, 0),
  up = new T.Vector3(0, 1, 0);
const world = {
  terrainClearance: (p) => p.length() - 1800,
  cameraObstruction: () => null,
};
const input = { look: { x: 0, y: 0 }, down: () => false };
const point = new T.Vector3(),
  hero = new T.Quaternion();
const xAxis = new T.Vector3(1, 0, 0),
  zAxis = new T.Vector3(0, 0, 1);
const results = [];
for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16])
  for (let style = 0; style < 4; style++) {
    for (const maneuver of ["bank", "loop", "roll", "orbit", "tracking"]) {
      const camera = new T.PerspectiveCamera(55, aspect, 0.3, 14000),
        rig = new FlightCamera(camera);
      rig.select(style);
      rig.autoReturn = false;
      const forward = new T.Vector3(0, 0, -1);
      camera.position.copy(position).add(new T.Vector3(0, 10, 27));
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
      let maxX = 0,
        maxY = 0,
        firstOutside = null;
      for (let frame = 0; frame <= 480; frame++) {
        const time = frame / 60;
        const transform =
          time < 2
            ? 0
            : time < 4.4
              ? (time - 2) / 2.4
              : time < 5.6
                ? 1
                : Math.max(0, 1 - (time - 5.6) / 2.4);
        const bank =
          maneuver === "bank" || maneuver === "tracking"
            ? 0.85 * Math.sin(time * 1.2)
            : 0;
        const pitch = maneuver === "loop" ? time * 1.15 : 0;
        const roll =
          maneuver === "roll"
            ? Math.PI *
              2 *
              (time % 2 < 1.05
                ? ((time % 2) / 1.05) ** 2 * (3 - (2 * (time % 2)) / 1.05)
                : 0)
            : 0;
        if (maneuver === "orbit") {
          rig.yaw = time * 0.8;
          rig.pitch = 1.15 * Math.sin(time * 0.65);
        }
        forward
          .set(0, 0, -1)
          .applyAxisAngle(up, maneuver === "bank" ? time * 0.6 : 0);
        hero
          .setFromAxisAngle(up, maneuver === "bank" ? time * 0.6 : 0)
          .multiply(new T.Quaternion().setFromAxisAngle(xAxis, pitch))
          .multiply(new T.Quaternion().setFromAxisAngle(zAxis, bank + roll));
        const focus =
          maneuver === "tracking" && time > 0.4 && time < 6.4
            ? new T.Vector3(
                600 * Math.sin(time * 1.1),
                300 * Math.sin(time * 0.9),
                -600 * Math.cos(time * 1.1),
              ).add(position)
            : null;
        rig.update(
          1 / 60,
          input,
          world,
          position,
          forward,
          up,
          pitch,
          bank,
          82 - 54 * transform,
          false,
          time >= 2 && time < 5.6 ? 1 : 0,
          transform,
          focus,
        );
        camera.updateMatrixWorld();
        for (const vertex of hulls[Math.round(transform * 24)]) {
          point
            .copy(vertex)
            .applyQuaternion(hero)
            .add(position)
            .project(camera);
          maxX = Math.max(maxX, Math.abs(point.x));
          maxY = Math.max(maxY, Math.abs(point.y));
          if (
            (Math.abs(point.x) > 0.9 ||
              Math.abs(point.y) > 0.9 ||
              point.z >= 1 ||
              point.z <= -1) &&
            firstOutside === null
          )
            firstOutside = { frame, x: point.x, y: point.y };
        }
      }
      results.push({
        aspect,
        style: FlightCamera.names[style],
        maneuver,
        maxX,
        maxY,
        firstOutside,
      });
    }
  }
// Test every style transition while the aircraft accelerates through a turn.
for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16])
  for (const from of [0, 1, 2, 3])
    for (const to of [0, 1, 2, 3]) {
      if (from === to) continue;
      for (const transform of [0, 0.5, 1])
        for (const maneuver of ["level", "turn"]) {
          const camera = new T.PerspectiveCamera(55, aspect, 0.3, 14000),
            rig = new FlightCamera(camera);
          const forward = new T.Vector3(0, 0, -1);
          rig.select(from);
          camera.position.copy(position).add(new T.Vector3(0, 10, 27));
          for (let i = 0; i < 600; i++)
            rig.update(
              1 / 120,
              input,
              world,
              position,
              forward,
              up,
              0,
              0,
              82 - 54 * transform,
              false,
              transform,
              transform,
            );
          rig.select(to);
          let maxX = 0,
            maxY = 0,
            firstOutside = null;
          for (let frame = 0; frame <= 240; frame++) {
            const t = frame / 120,
              bank = maneuver === "turn" ? 0.8 * Math.sin(t * 2) : 0,
              pitch = maneuver === "turn" ? 0.8 * Math.sin(t) : 0;
            forward
              .set(0, 0, -1)
              .applyAxisAngle(up, maneuver === "turn" ? t * 0.6 : 0);
            hero
              .setFromAxisAngle(up, maneuver === "turn" ? t * 0.6 : 0)
              .multiply(new T.Quaternion().setFromAxisAngle(xAxis, pitch))
              .multiply(new T.Quaternion().setFromAxisAngle(zAxis, bank));
            rig.update(
              1 / 120,
              input,
              world,
              position,
              forward,
              up,
              pitch,
              bank,
              82 - 54 * transform + (103 - transform * 46) * Math.min(t, 1),
              true,
              transform,
              transform,
            );
            camera.updateMatrixWorld();
            for (const vertex of hulls[Math.round(transform * 24)]) {
              point
                .copy(vertex)
                .applyQuaternion(hero)
                .add(position)
                .project(camera);
              maxX = Math.max(maxX, Math.abs(point.x));
              maxY = Math.max(maxY, Math.abs(point.y));
              if (
                (Math.abs(point.x) > 0.9 ||
                  Math.abs(point.y) > 0.9 ||
                  point.z >= 1 ||
                  point.z <= -1) &&
                firstOutside === null
              )
                firstOutside = { frame, x: point.x, y: point.y };
            }
          }
          results.push({
            aspect,
            from: FlightCamera.names[from],
            to: FlightCamera.names[to],
            transform,
            maneuver,
            maxX,
            maxY,
            firstOutside,
          });
        }
    }
const failures = results.filter((r) => r.firstOutside);
for (let style = 0; style < 4; style++) {
  const camera = new T.PerspectiveCamera(55, 16 / 9, 0.3, 14000),
    rig = new FlightCamera(camera);
  const forward = new T.Vector3(0, 0, -1);
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
      0,
      82,
      false,
      0,
      0,
    );
  const landscapeFov = camera.fov;
  camera.aspect = 9 / 16;
  rig.update(0, input, world, position, forward, up, 0, 0, 82, false, 0, 0);
  camera.updateMatrixWorld();
  for (const vertex of hulls[0]) {
    point.copy(vertex).add(position).project(camera);
    assert.ok(
      Math.abs(point.x) < 0.9 && Math.abs(point.y) < 0.9,
      "Resize retains the airframe on its first frame",
    );
  }
  camera.aspect = 16 / 9;
  rig.update(0, input, world, position, forward, up, 0, 0, 82, false, 0, 0);
  assert.ok(
    Math.abs(camera.fov - landscapeFov) < 1e-10,
    "Returning to landscape restores the original lens immediately",
  );
}
const report = {
  sourceVertices,
  poses: hulls.length,
  scenarios: results.length,
  failures,
  results,
};
fs.writeFileSync(
  "output/verification/framing.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      sourceVertices,
      poses: hulls.length,
      scenarios: results.length,
      failures,
    },
    null,
    2,
  ),
);
if (!process.argv.includes("--report-only"))
  assert.equal(
    failures.length,
    0,
    "Aircraft remains inside the safe frame through the tested maneuvers and aspect ratios",
  );
