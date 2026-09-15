import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import ts from "typescript";
import * as T from "three";
fs.mkdirSync("output/verification", { recursive: true });
let source = fs
  .readFileSync("src/camera.ts", "utf8")
  .replace("./flight.mjs", "../../src/flight.mjs");
fs.writeFileSync(
  "output/verification/camera.mjs",
  ts.transpile(source, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  }),
);
globalThis.matchMedia = () => ({ matches: false });
const { FlightCamera } = await import(
  pathToFileURL(path.resolve("output/verification/camera.mjs"))
);
const camera = new T.PerspectiveCamera(55, 16 / 9, 0.3, 14000),
  rig = new FlightCamera(camera);
let look = { x: 0, y: 0 };
const input = {
  get look() {
    return look;
  },
  down: () => false,
};
const world = {
  terrainClearance: (p) => p.length() - 1800,
  cameraObstruction: () => null,
};
const pos = new T.Vector3(0, 1910, 0),
  forward = new T.Vector3(0, 0, -1),
  up = new T.Vector3(0, 1, 0);
camera.position.copy(pos).add(new T.Vector3(0, 8, 27));
camera.up.copy(up);
for (let i = 0; i < 720; i++) {
  const pitch = (i / 720) * Math.PI * 2;
  rig.update(
    1 / 120,
    input,
    world,
    pos,
    forward,
    up,
    pitch,
    0.8,
    150,
    true,
    0,
    0,
  );
  assert.ok(camera.matrixWorld.elements.every(Number.isFinite));
  assert.ok(Math.abs(camera.up.length() - 1) < 1e-5);
  assert.ok(camera.position.distanceTo(pos) < 70);
}
look = { x: 1, y: 0 };
for (let i = 0; i < 400; i++)
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 80, false, 0, 0);
assert.ok(rig.yaw > Math.PI * 2, "Controller orbit must exceed a full circle");
look = { x: 0, y: 0 };
for (let i = 0; i < 600; i++)
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 80, false, 0, 0);
assert.ok(Math.abs(rig.yaw) < 0.02, "Free look smoothly recenters");
assert.equal(rig.cycle(), "WIDE");
assert.equal(rig.cycle(), "CLOSE");
assert.equal(rig.cycle(), "WINGMAN");
assert.equal(rig.cycle(), "CHASE");
console.log(
  "Camera verified: full vertical loop, finite orientation, 360-degree controller orbit, spring recenter, four styles.",
);
rig.reset();
for (let i = 0; i < 300; i++) {
  pos.x += 185 / 120;
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 185, true, 0, 0);
}
assert.ok(
  camera.position.distanceTo(pos) < 42,
  "Chase camera must not drag far behind at boost speed",
);
console.log("Boost translation follows without accumulating spring lag.");
pos.set(0, 1910, 0);
for (let style = 0; style < 4; style++) {
  rig.select(style);
  rig.reset();
  for (let i = 0; i < 600; i++)
    rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 80, false, 0, 0);
  camera.updateMatrixWorld();
  const screen = pos.clone().project(camera);
  assert.ok(
    Math.abs(screen.x) < 0.55 && Math.abs(screen.y) < 0.6,
    `${FlightCamera.names[style]} keeps the aircraft in the safe frame`,
  );
}
rig.select(0);
rig.reset();
rig.yaw = Math.PI / 2;
look = { x: 0, y: 0.05 };
for (let i = 0; i < 240; i++)
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 80, false, 0, 0);
const initialHeight = camera.position.y;
look = { x: 0, y: 0.7 };
for (let i = 0; i < 120; i++)
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 80, false, 0, 0);
assert.ok(
  Math.abs(camera.position.y - initialHeight) > 10,
  "Vertical orbit works at side angles",
);
look = { x: 0, y: 0 };
pos.set(0, 1806, 0);
camera.position.set(0, 1780, 20);
rig.reset();
rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 80, false, 0, 0);
assert.ok(
  world.terrainClearance(camera.position) >= 4.999,
  "The smoothed camera clears terrain",
);
console.log(
  "Four safe framings, side-angle vertical orbit, and terrain clearance verified.",
);
pos.set(0, 1910, 0);
camera.position.copy(pos).add(new T.Vector3(0, 15, 35));
rig.reset();
world.cameraObstruction = (from, to) =>
  to.z > 12 ? (from.distanceTo(to) * (12 - from.z)) / (to.z - from.z) : null;
for (let frame = 0; frame < 120; frame++) {
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 80, false, 0, 0);
  assert.ok(
    camera.position.z < 12,
    "Camera pulls in front of an occluding cliff, including on its first frame",
  );
  camera.updateMatrixWorld();
  const aircraftScreen = pos.clone().project(camera);
  assert.ok(
    Math.abs(aircraftScreen.y) < 0.8,
    "Pulled-in framing continues to aim at the aircraft",
  );
}
world.cameraObstruction = () => null;
for (let frame = 0; frame < 300; frame++)
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 80, false, 0, 0);
assert.ok(
  camera.position.distanceTo(pos) > 25,
  "The normal framing returns after the cliff clears",
);
console.log("Camera rock occlusion and recovery verified.");

// Inspect the full airframe envelope throughout the moving transformation shot,
// not just the projected aircraft origin at a settled endpoint.
pos.set(0, 1910, 0);
for (const style of [0, 1, 2, 3]) {
  rig.select(style);
  rig.reset();
  for (let frame = 0; frame < 600; frame++)
    rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
  for (let frame = 0; frame < 480; frame++) {
    const transform = Math.min(1, frame / (2.4 * 120));
    rig.update(
      1 / 120,
      input,
      world,
      pos,
      forward,
      up,
      0,
      0,
      82 - 54 * transform,
      false,
      1,
      transform,
    );
    camera.updateMatrixWorld();
    const halfHeight = 1.8 + 3 * transform,
      halfLength = 6.3 - 3 * transform;
    for (const x of [-6.3, 6.3])
      for (const y of [-halfHeight, halfHeight])
        for (const z of [-halfLength, halfLength]) {
          const screen = pos
            .clone()
            .add(new T.Vector3(x, y, z))
            .project(camera);
          assert.ok(
            Math.abs(screen.x) < 0.96 &&
              Math.abs(screen.y) < 0.96 &&
              screen.z < 1,
            `${FlightCamera.names[style]} retains the airframe envelope at transform frame ${frame}`,
          );
        }
  }
}
rig.select(0);
rig.reset();
for (let frame = 0; frame < 600; frame++)
  rig.update(
    1 / 120,
    input,
    world,
    pos,
    forward,
    up,
    0,
    -0.85,
    82,
    false,
    0,
    0,
  );
assert.ok(
  rig.aimSide > 0 && rig.aimSide < 3,
  "Right bank receives restrained right-hand leading room",
);
const cruiseFov = camera.fov;
for (let frame = 0; frame < 600; frame++)
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 185, false, 0, 0);
assert.ok(
  camera.fov > cruiseFov + 10,
  "Lens reflects actual airspeed even after releasing boost",
);
for (let frame = 0; frame < 600; frame++)
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 32, false, 0, 0);
assert.ok(
  Math.abs(camera.fov - cruiseFov) < 0.1,
  "Braking returns the composed cruise lens",
);
console.log(
  "Moving transformation envelopes, turn lead and airspeed-driven lens verified.",
);

// A requested return must orbit back smoothly, without teleporting through the
// aircraft, changing camera style, or accumulating flight-translation lag.
for (const style of [0, 1, 2, 3]) {
  rig.select(style);
  rig.reset();
  look = { x: 1, y: 0.4 };
  for (let frame = 0; frame < 175; frame++)
    rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
  look = { x: 0, y: 0 };
  const beforeReturn = camera.position.clone();
  rig.recenter();
  assert.ok(
    camera.position.equals(beforeReturn),
    "Return request never teleports the camera",
  );
  for (let frame = 0; frame < 160; frame++) {
    rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
    assert.ok(
      camera.position.distanceTo(pos) > 14,
      "Return path stays outside the aircraft",
    );
    assert.ok(
      camera.position.distanceTo(pos) < 60,
      "Return retains useful framing distance",
    );
  }
  assert.equal(rig.distanceMode, style, "Return preserves the selected camera");
  assert.ok(
    Math.abs(rig.yaw) < 0.005 && Math.abs(rig.pitch) < 0.005,
    "Requested return settles promptly",
  );
  rig.recenter();
  look = { x: -0.8, y: 0 };
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
  assert.equal(
    rig.centering,
    false,
    "Manual stick input immediately takes control back",
  );
}
console.log(
  "Requested camera return: smooth orbit, aircraft clearance, mode preservation and manual override verified.",
);

rig.select(0);
rig.reset();
look = { x: 1, y: 0 };
for (let frame = 0; frame < 90; frame++)
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
look = { x: 0, y: 0 };
for (let frame = 0; frame < 70; frame++) {
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
  camera.updateMatrixWorld();
  const actor = pos.clone().project(camera);
  assert.ok(
    Math.abs(actor.x) < 0.015 && Math.abs(actor.y) < 0.015,
    "Releasing the look stick keeps focus on the aircraft during the orbit hold",
  );
}
console.log("Released-stick orbit hold retains aircraft focus.");

// Optional orbit hold lets a player keep a composed shot while steering and
// transforming. Explicit return remains available in every selected view.
rig.autoReturn = false;
for (const style of [0, 1, 2, 3]) {
  rig.select(style);
  rig.reset();
  assert.equal(
    rig.autoReturn,
    false,
    "Flight reset retains the camera preference",
  );
  look = { x: 0.7, y: -0.35 };
  for (let frame = 0; frame < 120; frame++)
    rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
  const heldYaw = rig.yaw,
    heldPitch = rig.pitch;
  look = { x: 0, y: 0 };
  for (let frame = 0; frame < 600; frame++) {
    const transform = Math.min(1, frame / 288);
    rig.update(
      1 / 120,
      input,
      world,
      pos,
      forward,
      up,
      0.2,
      -0.6,
      82 - transform * 54,
      false,
      1,
      transform,
    );
    assert.equal(rig.yaw, heldYaw, "Released horizontal angle stays chosen");
    assert.equal(rig.pitch, heldPitch, "Released vertical angle stays chosen");
    camera.updateMatrixWorld();
    const actor = pos.clone().project(camera);
    assert.ok(
      Math.abs(actor.x) < 0.02 && Math.abs(actor.y) < 0.02,
      "Held camera keeps focus during a bank and transformation",
    );
  }
  rig.recenter();
  for (let frame = 0; frame < 240; frame++)
    rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 28, false, 1, 1);
  assert.ok(
    Math.abs(rig.yaw) + Math.abs(rig.pitch) < 0.005,
    "Explicit return works with automatic return disabled",
  );
  assert.equal(rig.distanceMode, style);
}
rig.yaw = 1;
rig.pitch = -0.4;
rig.autoReturn = true;
for (let frame = 0; frame < 600; frame++)
  rig.update(1 / 120, input, world, pos, forward, up, 0, 0, 28, false, 1, 1);
assert.ok(
  Math.abs(rig.yaw) + Math.abs(rig.pitch) < 0.005,
  "Re-enabling automatic return releases the held angle",
);
console.log(
  "Optional orbit hold: chosen angles, transformation focus and explicit return verified in all four views.",
);

rig.reset();
look = { x: 0.01, y: 0 };
rig.recenter();
rig.update(1 / 60, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
assert.ok(
  rig.yaw > 0,
  "Fine stick input moves the orbit immediately after its radial dead zone",
);
assert.equal(
  rig.centering,
  false,
  "Fine input takes control back from requested return",
);

// A held target view must not erase a deliberately composed orbit, steer the
// airframe, or pass through it while acquiring a contact behind the player.
world.cameraObstruction = () => null;
pos.set(0, 1910, 0);
forward.set(0, 0, -1);
look = { x: 0, y: 0 };
for (let style = 0; style < 4; style++) {
  rig.select(style);
  rig.reset();
  rig.autoReturn = false;
  rig.yaw = 0.6;
  rig.pitch = -0.2;
  camera.position.copy(pos).add(new T.Vector3(0, 10, 27));
  for (let frame = 0; frame < 360; frame++)
    rig.update(1 / 60, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
  const before = camera.position.clone();
  for (let frame = 0; frame < 720; frame++) {
    const angle = frame / 60;
    const focus = new T.Vector3(
      Math.sin(angle) * 650,
      Math.sin(angle * 0.7) * 450,
      Math.cos(angle) * 650,
    ).add(pos);
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
      focus,
    );
    assert.equal(rig.tracking, true);
    assert.ok(
      camera.position.distanceTo(pos) > 18,
      "Tracking orbit stays outside the airframe",
    );
    assert.ok(camera.matrixWorld.elements.every(Number.isFinite));
    assert.equal(rig.yaw, 0.6);
    assert.equal(rig.pitch, -0.2);
  }
  for (let frame = 0; frame < 360; frame++)
    rig.update(1 / 60, input, world, pos, forward, up, 0, 0, 82, false, 0, 0);
  assert.equal(rig.tracking, false);
  assert.ok(
    camera.position.distanceTo(before) < 0.001,
    "Release restores the chosen view",
  );
  const focus = pos.clone().add(new T.Vector3(400, 0, 0));
  look = { x: 0.2, y: 0 };
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
    focus,
  );
  assert.equal(
    rig.tracking,
    false,
    "Manual look takes priority over target tracking",
  );
  look = { x: 0, y: 0 };
  for (let frame = 0; frame < 360; frame++)
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
      focus,
    );
  camera.updateMatrixWorld();
  const contact = focus.clone().project(camera);
  assert.ok(
    Math.abs(contact.x) < 0.1 && Math.abs(contact.y) < 0.5,
    "A level target remains visible after acquisition",
  );
  rig.reset();
  assert.equal(rig.tracking, false);
}
console.log(
  "Target camera: moving contacts, safe acquisition, manual priority, preserved orbit, visible target and release verified in all four views.",
);
