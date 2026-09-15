import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as T from "three";
import { world, RADIUS } from "./load-verification-world.mjs";
for (const name of ["terrain-contact", "crash-effects"])
  fs.writeFileSync(
    `output/verification/${name}.mjs`,
    ts.transpile(fs.readFileSync(`src/${name}.ts`, "utf8"), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    }),
  );
const { sweepTerrain, gentleRobotContact } =
  await import("../output/verification/terrain-contact.mjs");
const { CrashEffects } =
  await import("../output/verification/crash-effects.mjs");
let surfaces = 0,
  gentle = 0;
for (const collider of world.colliders) {
  const geometry = collider.mesh.geometry,
    indices = geometry.index,
    vertices = geometry.attributes.position;
  for (let i = 0; i < indices.count; i += 177) {
    const a = new T.Vector3()
      .fromBufferAttribute(vertices, indices.getX(i))
      .applyMatrix4(collider.mesh.matrixWorld);
    const b = new T.Vector3()
      .fromBufferAttribute(vertices, indices.getX(i + 1))
      .applyMatrix4(collider.mesh.matrixWorld);
    const c = new T.Vector3()
      .fromBufferAttribute(vertices, indices.getX(i + 2))
      .applyMatrix4(collider.mesh.matrixWorld);
    const point = a.clone().add(b).add(c).divideScalar(3);
    if (point.length() < RADIUS + 12) continue;
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const from = point.clone().addScaledVector(normal, 35),
      to = point.clone().addScaledVector(normal, -35);
    const hit = sweepTerrain([collider], from, to, 0);
    assert.ok(
      hit && hit.fraction <= 0.501,
      "Fast motion cannot tunnel through an exported triangle",
    );
    assert.ok(
      hit.normal.dot(normal) > -1e-5,
      "Impact normal faces the incoming aircraft",
    );
    assert.ok(
      !gentleRobotContact(
        hit,
        normal.clone().multiplyScalar(-82),
        0,
        normal,
        normal,
      ),
    );
    assert.ok(
      !gentleRobotContact(
        hit,
        normal.clone().multiplyScalar(-85),
        1,
        normal,
        normal,
      ),
    );
    surfaces++;
  }
  // Highest face is exposed ground, suitable for a controlled descent.
  let top = new T.Vector3();
  for (let i = 0; i < indices.count; i += 3) {
    const p = new T.Vector3();
    for (let j = 0; j < 3; j++)
      p.add(new T.Vector3().fromBufferAttribute(vertices, indices.getX(i + j)));
    p.divideScalar(3).applyMatrix4(collider.mesh.matrixWorld);
    if (p.lengthSq() > top.lengthSq()) top.copy(p);
  }
  const up = top.clone().normalize(),
    from = top.clone().addScaledVector(up, 20),
    to = top.clone().addScaledVector(up, -5);
  const hit = sweepTerrain(world.colliders, from, to, RADIUS);
  assert.ok(hit && !hit.water);
  assert.ok(hit.fraction > 0 && hit.fraction < 0.6);
  const slow = up.clone().multiplyScalar(-3);
  if (hit.normal.dot(up) >= 0.75) {
    assert.ok(gentleRobotContact(hit, slow, 1, up, up));
    gentle++;
    assert.ok(!gentleRobotContact(hit, slow, 0.8, up, up));
    assert.ok(!gentleRobotContact(hit, slow, 1, up.clone().negate(), up));
    assert.ok(
      !gentleRobotContact(hit, up.clone().multiplyScalar(-8), 1, up, up),
    );
    const tangent = new T.Vector3(1, 0, 0).projectOnPlane(up).normalize();
    assert.ok(!gentleRobotContact(hit, tangent.multiplyScalar(28), 1, up, up));
  }
  const settled = hit.center.clone().addScaledVector(hit.normal, 0.12);
  assert.equal(
    sweepTerrain(
      world.colliders,
      settled,
      settled.clone().addScaledVector(hit.normal, 10),
      RADIUS,
    ),
    null,
    "Lift-off is not trapped by resting contact",
  );
}
assert.ok(surfaces > 300 && gentle > 5);
for (const axis of [
  new T.Vector3(0, 1, 0),
  new T.Vector3(1, 0, 0),
  new T.Vector3(0, 0, -1),
]) {
  const hit = sweepTerrain(
    [],
    axis.clone().multiplyScalar(RADIUS + 25),
    axis.clone().multiplyScalar(RADIUS - 15),
    RADIUS,
  );
  assert.ok(hit.water);
  assert.ok(Math.abs(hit.center.length() - (RADIUS + 6)) < 1e-6);
  assert.ok(
    !gentleRobotContact(hit, axis.clone().multiplyScalar(-2), 1, axis, axis),
  );
}
// Exercise effect lifetime/restart using an existing exported mesh, never a test primitive.
const geometry = world.colliders[0].mesh.geometry,
  effects = new CrashEffects({ geometry: { spark: geometry }, cloud: null });
const camera = new T.PerspectiveCamera();
effects.start(new T.Vector3(), new T.Vector3(0, 1, 0), false);
assert.equal(effects.group.children.length, 46);
effects.update(0.3, camera);
assert.ok(effects.group.children.some((p) => p.visible));
effects.update(4, camera);
assert.ok(effects.group.children.every((p) => !p.visible));
effects.clear();
assert.equal(effects.group.children.length, 0);
effects.start(new T.Vector3(), new T.Vector3(0, 1, 0), true);
assert.equal(effects.age, 0);
assert.equal(effects.group.children.length, 46);
effects.clear();
console.log(
  JSON.stringify({
    exportedFaceSweeps: surfaces,
    gentleLandings: gentle,
    seaAxes: 3,
    effectRestart: "passed",
  }),
);
