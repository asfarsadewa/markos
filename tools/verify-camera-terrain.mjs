import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";
import * as T from "three";
import { world } from "./load-verification-world.mjs";

globalThis.matchMedia = () => ({ matches: false });
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
const arch = world.colliders.find((c) => c.name === "Sanctuary Arch");
const input = { look: { x: 0, y: 0 }, down: () => false };
const results = [];
let minimumMovingRadius = Infinity,
  blockedFrames = 0;
const sites = [-100, -60, -20, 20, 60, 100].map((z) => ({
  name: "Arch corridor " + z,
  pos: new T.Vector3(-30, 60, z).applyMatrix4(arch.mesh.matrixWorld),
}));
for (const collider of world.colliders.slice(0, 4)) {
  const attr = collider.mesh.geometry.attributes.position,
    index = collider.mesh.geometry.index;
  for (let i = 0; i < index.count; i += Math.ceil(index.count / 180 / 3) * 3) {
    const a = new T.Vector3()
      .fromBufferAttribute(attr, index.getX(i))
      .applyMatrix4(collider.mesh.matrixWorld);
    const b = new T.Vector3()
      .fromBufferAttribute(attr, index.getX(i + 1))
      .applyMatrix4(collider.mesh.matrixWorld);
    const c = new T.Vector3()
      .fromBufferAttribute(attr, index.getX(i + 2))
      .applyMatrix4(collider.mesh.matrixWorld);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const pos = a
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3)
      .addScaledVector(normal, 12);
    if (
      pos.length() < 1820 ||
      world.terrainClearance(pos) < 10 ||
      world.cameraObstruction(pos, pos.clone().addScaledVector(normal, 100)) !==
        null
    )
      continue;
    sites.push({ name: collider.name + " face " + i, pos });
  }
}
for (const { name, pos } of sites) {
  const up = pos.clone().normalize();
  const forward = new T.Vector3(0, 0, -1)
    .transformDirection(arch.mesh.matrixWorld)
    .projectOnPlane(up)
    .normalize();
  if (world.terrainClearance(pos) < 10) continue;
  for (let style = 0; style < 4; style++)
    for (let orbit = 0; orbit < 12; orbit++) {
      const camera = new T.PerspectiveCamera(55, 16 / 9, 0.3, 14000),
        rig = new FlightCamera(camera);
      rig.select(style);
      rig.autoReturn = false;
      rig.yaw = (orbit * Math.PI) / 6;
      camera.position
        .copy(pos)
        .addScaledVector(up, 10)
        .addScaledVector(forward, -27);
      for (let frame = 0; frame < 60; frame++) {
        rig.update(
          1 / 60,
          input,
          world,
          pos,
          forward,
          up,
          0,
          0,
          82,
          false,
          0,
          0,
        );
        minimumMovingRadius = Math.min(
          minimumMovingRadius,
          camera.position.distanceTo(pos),
        );
        if (world.cameraObstruction(pos, camera.position) !== null)
          blockedFrames++;
      }
      results.push({
        name,
        position: pos.toArray(),
        forward: forward.toArray(),
        style,
        orbit,
        radius: camera.position.distanceTo(pos),
        clearance: world.terrainClearance(camera.position),
        obstruction: world.cameraObstruction(pos, camera.position),
      });
    }
}
fs.writeFileSync(
  "output/verification/camera-terrain.json",
  JSON.stringify(results, null, 2),
);
console.log(
  JSON.stringify(
    {
      scenarios: results.length,
      minimumMovingRadius,
      blockedFrames,
      minRadius: Math.min(...results.map((r) => r.radius)),
      cramped: results.filter((r) => r.radius < 14),
      blocked: results.filter((r) => r.obstruction !== null),
    },
    null,
    2,
  ),
);

assert.ok(results.length > 10000);
assert.ok(
  results.every((r) => r.radius >= 18),
  "Cliff shots retain a working camera distance",
);
assert.ok(
  results.every((r) => r.obstruction === null),
  "Actual rock surfaces do not cover the aircraft origin",
);

assert.ok(
  minimumMovingRadius >= 18,
  "Interpolated camera paths keep working distance",
);
assert.equal(
  blockedFrames,
  0,
  "Interpolated camera paths keep a clear origin sightline",
);
