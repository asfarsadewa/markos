import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { Vector3, PerspectiveCamera } from "three";
import { world, RADIUS } from "./load-verification-world.mjs";
import { landmarkGuidance } from "../src/landmarks.mjs";
const layout = JSON.parse(
  fs.readFileSync("public/models/environment-layout.json", "utf8"),
);
const report = [];
fs.writeFileSync(
  "output/verification/landmark-camera.mjs",
  ts.transpile(
    fs
      .readFileSync("src/camera.ts", "utf8")
      .replace('"./flight.mjs"', '"../../src/flight.mjs"'),
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  ),
);
globalThis.matchMedia = () => ({ matches: false });
const { FlightCamera } =
  await import("../output/verification/landmark-camera.mjs");
let cameraViews = 0;
for (const item of layout.islands) {
  assert.ok(
    item.approach?.length === 3 && item.lookAt?.length === 3,
    `${item.name} has Blender anchors`,
  );
  const approach = new Vector3().fromArray(item.approach);
  const lookAt = new Vector3().fromArray(item.lookAt);
  assert.ok([...item.approach, ...item.lookAt].every(Number.isFinite));
  let minClearance = Infinity;
  // The complete 90 m arrival volume must fit an aircraft clear of real rock.
  for (let a = 0; a < 16; a++)
    for (let b = 0; b <= 8; b++) {
      const p = new Vector3(
        Math.sin((b * Math.PI) / 8) * Math.cos((a * Math.PI) / 8),
        Math.cos((b * Math.PI) / 8),
        Math.sin((b * Math.PI) / 8) * Math.sin((a * Math.PI) / 8),
      )
        .multiplyScalar(90)
        .add(approach);
      const clearance = Math.min(
        world.terrainClearance(p),
        p.length() - RADIUS,
      );
      minClearance = Math.min(minClearance, clearance);
      assert.ok(
        clearance > 30,
        `${item.name}: arrival volume clear (${clearance})`,
      );
    }
  const sightline = lookAt.clone().sub(approach);
  const hit = world.cameraObstruction(approach, lookAt);
  // The focal point can sit within the landmark itself; the first 65% must be open sky.
  assert.ok(
    hit === null || hit > sightline.length() * 0.65,
    `${item.name}: foreground obscures view`,
  );
  const g = landmarkGuidance(approach, { approach, lookAt }, sightline, RADIUS);
  assert.ok(g.arrived && !g.beyondHorizon);
  for (let style = 0; style < 4; style++)
    for (const form of [0, 1]) {
      const camera = new PerspectiveCamera(55, 16 / 9, 0.3, 14000);
      const rig = new FlightCamera(camera);
      rig.select(style);
      const up = approach.clone().normalize();
      // Acquire the landmark even when the aircraft is facing away from it.
      const forward = approach
        .clone()
        .sub(lookAt)
        .projectOnPlane(up)
        .normalize();
      camera.position
        .copy(approach)
        .addScaledVector(forward, -30)
        .addScaledVector(up, 10);
      const input = { look: { x: 0, y: 0 }, down: () => false };
      for (let frame = 0; frame < 240; frame++)
        rig.update(
          1 / 60,
          input,
          world,
          approach,
          forward,
          up,
          0,
          0,
          form ? 28 : 82,
          false,
          form,
          form,
          lookAt,
        );
      camera.updateMatrixWorld();
      const projected = lookAt.clone().project(camera);
      assert.ok(
        Math.abs(projected.x) < 0.1 &&
          Math.abs(projected.y) < 0.5 &&
          projected.z < 1,
        `${item.name}: landmark visible in ${style}/${form}`,
      );
      assert.ok(camera.position.distanceTo(approach) > 18);
      cameraViews++;
    }
  report.push({
    name: item.name,
    minArrivalClearance: minClearance,
    sightlineLength: sightline.length(),
    firstRock: hit,
  });
}
assert.equal(report.length, 16);
fs.writeFileSync(
  "output/verification/landmarks.json",
  JSON.stringify(report, null, 2),
);
console.log(
  `16 Blender scenic approaches verified against actual collision meshes; ${cameraViews} landmark camera acquisitions passed`,
);
