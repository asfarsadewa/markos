import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { advanceTransform } from "../src/flight.ts";

fs.mkdirSync("output/verification", { recursive: true });
globalThis.matchMedia = () => ({ matches: false });
const { FlightCamera } = await import("../src/camera.ts");
const pos = new T.Vector3(0, 1910, 0),
  up = new T.Vector3(0, 1, 0),
  forward = new T.Vector3(0, 0, -1);
const world = {
  terrainClearance: (p) => p.length() - 1800,
  cameraObstruction: () => null,
};
const input = { look: { x: 0, y: 0 }, down: () => false };
const results = [];
for (const fps of [30, 60, 120])
  for (let style = 0; style < 4; style++) {
    const camera = new T.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
    const rig = new FlightCamera(camera);
    rig.select(style);
    camera.position.copy(pos).add(new T.Vector3(0, 10, 27));
    for (let i = 0; i < fps * 6; i++)
      rig.update(
        1 / fps,
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
    const rest = camera.position.clone();
    let transform = 0;
    for (let i = 0; i < fps * 1.2; i++) {
      const target = i < fps * 0.2 ? 1 : 0;
      transform = advanceTransform(transform, target, 1 / fps);
      rig.update(
        1 / fps,
        input,
        world,
        pos,
        forward,
        up,
        0,
        0,
        82 - transform * 54,
        false,
        target,
        transform,
      );
    }
    results.push({
      fps,
      style: FlightCamera.names[style],
      transform,
      returnError: camera.position.distanceTo(rest),
    });
  }
fs.writeFileSync(
  "output/verification/transform-camera.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
if (!process.argv.includes("--report-only")) {
  for (const result of results) {
    assert.equal(result.transform, 0);
    assert.ok(
      result.returnError < 1,
      `${result.style} at ${result.fps} FPS should settle within one metre after a brief reversed transform`,
    );
  }
}

// Hold one mechanical pose to isolate whether an explicit camera override
// remains respected after release, rather than waiting for a timer to expire.
for (const override of ["manual", "recenter", "tracking", "rear"]) {
  const camera = new T.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
  const rig = new FlightCamera(camera);
  const referenceCamera = camera.clone();
  globalThis.matchMedia = () => ({ matches: true });
  const reference = new FlightCamera(referenceCamera);
  globalThis.matchMedia = () => ({ matches: false });
  let rear = false;
  const control = {
    look: { x: 0, y: 0 },
    down: (code) => code === "KeyC" && rear,
  };
  function update(target = 1, focus = null) {
    for (const r of [rig, reference])
      r.update(
        1 / 60,
        control,
        world,
        pos,
        forward,
        up,
        0,
        0,
        55,
        false,
        target,
        0.5,
        focus,
      );
  }
  for (const c of [camera, referenceCamera])
    c.position.copy(pos).add(new T.Vector3(0, 10, 27));
  for (let i = 0; i < 240; i++) update();
  if (override === "recenter") {
    rig.recenter();
    reference.recenter();
  }
  if (override === "manual") control.look.x = 0.5;
  rear = override === "rear";
  const focus =
    override === "tracking" ? pos.clone().add(new T.Vector3(400, 0, 0)) : null;
  for (let i = 0; i < 60; i++) update(1, focus);
  control.look.x = 0;
  rear = false;
  for (let i = 0; i < 360; i++) update();
  assert.ok(
    camera.position.distanceTo(referenceCamera.position) < 0.02,
    `${override} keeps automatic transformation motion cancelled after release`,
  );
  for (let i = 0; i < 90; i++) update(0);
  assert.ok(
    camera.position.distanceTo(referenceCamera.position) > 15,
    `a new transformation can start its own shot after ${override}`,
  );
}
console.log(
  "Transformation shots respect manual orbit, recenter, target tracking, rear view and reduced motion; new transformations can start a new shot.",
);
