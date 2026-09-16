import assert from "node:assert/strict";
import * as T from "three";
import { world, RADIUS } from "./load-verification-world.mjs";
import { firstProjectileImpact } from "../src/flight.ts";
const World = world.constructor;
let samples = 0;
for (const collider of world.colliders) {
  const points = collider.mesh.geometry.attributes.position;
  for (let i = 0; i < points.count; i += 173) {
    const point = new T.Vector3()
      .fromBufferAttribute(points, i)
      .applyMatrix4(collider.mesh.matrixWorld);
    if (point.length() < RADIUS + 2) continue;
    assert.ok(
      world.terrainClearance(point) < 0.02,
      "Real exported rock faces must be detected",
    );
    samples++;
  }
}
assert.ok(samples > 300);
for (const collider of world.colliders) {
  const points = collider.mesh.geometry.attributes.position;
  const indices = collider.mesh.geometry.index;
  const top = new T.Vector3();
  for (let i = 0; i < indices.count; i += 3) {
    const point = new T.Vector3();
    for (let corner = 0; corner < 3; corner++)
      point.add(
        new T.Vector3().fromBufferAttribute(points, indices.getX(i + corner)),
      );
    point.multiplyScalar(1 / 3).applyMatrix4(collider.mesh.matrixWorld);
    if (point.lengthSq() > top.lengthSq()) top.copy(point);
  }
  const up = top.clone().normalize();
  const from = top.clone().addScaledVector(up, 40);
  const to = top.clone().addScaledVector(up, -5);
  const hit = world.cameraObstruction(from, to);
  const weaponHit = world.weaponObstruction(from, to);
  assert.equal(
    weaponHit,
    hit,
    `${collider.name} stops weapon rays at its actual surface`,
  );
  const behind = top.clone().addScaledVector(up, -4);
  const visible = top.clone().addScaledVector(up, 15);
  assert.equal(
    firstProjectileImpact(from, to, weaponHit, [behind], 1).targetIndex,
    -1,
    `${collider.name} shields a target behind the surface`,
  );
  assert.equal(
    firstProjectileImpact(from, to, weaponHit, [behind, visible], 1)
      .targetIndex,
    1,
    `${collider.name} still permits a nearer exposed target to be hit`,
  );
  assert.ok(
    hit !== null && hit > 0 && hit < 45,
    `${collider.name} blocks the camera across its real surface`,
  );
  const approach = world.terrainAhead(from, up.clone().negate(), 80);
  assert.ok(
    approach !== null && approach > 0 && approach < 45,
    `${collider.name} warns before reaching the actual rock surface`,
  );
  assert.equal(
    world.terrainAhead(from, up, 80),
    null,
    `${collider.name} clears the warning when climbing away`,
  );
}
// A true open corridor below the sanctuary arch must remain flyable, not treated as a heightfield.
const arch = world.colliders.find((c) => c.name === "Sanctuary Arch");
let corridor = null;
for (let x = -100; x <= 100 && !corridor; x += 10)
  for (let y = 30; y <= 110 && !corridor; y += 10) {
    const points = Array.from({ length: 61 }, (_, i) =>
      new T.Vector3(x, y, -150 + i * 5).applyMatrix4(arch.mesh.matrixWorld),
    );
    if (points.every((p) => world.terrainClearance(p) > 10))
      corridor = { x, y };
  }
assert.ok(
  corridor,
  "The sanctuary needs a clear aircraft-width passage through its opening",
);
assert.equal(
  world.cameraObstruction(
    new T.Vector3(corridor.x, corridor.y, -150).applyMatrix4(
      arch.mesh.matrixWorld,
    ),
    new T.Vector3(corridor.x, corridor.y, 150).applyMatrix4(
      arch.mesh.matrixWorld,
    ),
  ),
  null,
  "Camera rays pass freely through the actual arch opening",
);
assert.equal(
  world.weaponObstruction(
    new T.Vector3(corridor.x, corridor.y, -150).applyMatrix4(
      arch.mesh.matrixWorld,
    ),
    new T.Vector3(corridor.x, corridor.y, 150).applyMatrix4(
      arch.mesh.matrixWorld,
    ),
  ),
  null,
  "Weapons pass through the real arch opening",
);
const seaStart = new T.Vector3(0, -RADIUS - 20, 0),
  seaEnd = new T.Vector3(0, -RADIUS + 20, 0);
assert.ok(
  Math.abs(world.weaponObstruction(seaStart, seaEnd) - 20) < 1e-6,
  "Shots stop at the spherical water surface",
);
assert.equal(
  world.weaponObstruction(seaStart, new T.Vector3(100, -RADIUS - 20, 0)),
  null,
  "Level fire stays above the spherical sea",
);
console.log(
  "Weapon cover verified: all 16 real island placements, exposed target ordering, open arch and spherical sea.",
);
console.log(
  `Verified ${samples} real rock-surface samples across ${world.colliders.length} Blender placements; sanctuary corridor ${JSON.stringify(corridor)} stays clear.`,
);
const corridorStart = new T.Vector3(corridor.x, corridor.y, -150).applyMatrix4(
  arch.mesh.matrixWorld,
);
const corridorEnd = new T.Vector3(corridor.x, corridor.y, 150).applyMatrix4(
  arch.mesh.matrixWorld,
);
assert.equal(
  world.terrainAhead(
    corridorStart,
    corridorEnd.clone().sub(corridorStart).normalize(),
    corridorStart.distanceTo(corridorEnd),
  ),
  null,
  "Terrain guidance preserves the real sanctuary passage, including wing clearance",
);
const seaOnly = Object.create(World.prototype);
seaOnly.colliders = [];
seaOnly.ray = new T.Raycaster();
assert.equal(
  seaOnly.terrainAhead(new T.Vector3(0, 2100, 0), new T.Vector3(0, -1, 0), 400),
  292,
  "A descent warns at the spherical sea safety margin",
);
assert.equal(
  seaOnly.terrainAhead(new T.Vector3(0, 2100, 0), new T.Vector3(0, -1, 0), 100),
  null,
  "Sea beyond the look-ahead range does not warn",
);
assert.equal(
  seaOnly.terrainAhead(new T.Vector3(0, 1825, 0), new T.Vector3(0, 0, -1), 500),
  null,
  "Safe level flight over curved water stays clear",
);
assert.equal(
  seaOnly.terrainAhead(new T.Vector3(2100, 0, 0), new T.Vector3(-1, 0, 0), 400),
  292,
  "Vertical probes remain valid around the side of the spherical world",
);
console.log(
  "Terrain guidance verified against real islands, open arch, escape direction and spherical sea.",
);

// Compare the forecast endpoint with the runtime's neutral-input integration,
// using much finer time steps as an independent reference.
for (const speed of [8, 82, 185])
  for (const initialPitch of [-1.2, 0.25, 1.2]) {
    const forecast = Object.create(World.prototype);
    let endpoint;
    forecast.terrainAhead = (from, direction, range) => {
      endpoint = from.clone().addScaledVector(direction, range);
      return null;
    };
    const from = new T.Vector3(0, 1910, 0),
      tangent = new T.Vector3(0, 0, -1);
    forecast.flightTerrainAhead(from, tangent, initialPitch, speed);
    const duration = Math.max(2.4, 60 / speed),
      steps = Math.ceil(duration * 240),
      dt = duration / steps;
    const reference = from.clone(),
      forward = tangent.clone();
    let altitude = 110,
      pitch = initialPitch;
    for (let i = 0; i < steps; i++) {
      pitch *= Math.exp(-0.18 * dt);
      altitude += Math.sin(pitch) * speed * dt;
      reference
        .addScaledVector(forward, Math.cos(pitch) * speed * dt)
        .normalize()
        .multiplyScalar(RADIUS + altitude);
      forward.projectOnPlane(reference.clone().normalize()).normalize();
    }
    assert.ok(
      endpoint.distanceTo(reference) < 2,
      `Forecast follows neutral flight at speed ${speed}, pitch ${initialPitch}: error ${endpoint.distanceTo(reference)}`,
    );
  }
// A ridge can be clear on the current climb ray but intersect the leveling path.
const ridge = Object.create(World.prototype);
ridge.terrainAhead = (from, direction, range) => {
  if (direction.z >= 0) return null;
  const distance = (-180 - from.z) / direction.z;
  return distance >= 0 &&
    distance <= range &&
    from.y + direction.y * distance < 1950
    ? distance
    : null;
};
const ridgeApproach = new T.Vector3(0, 1910, 0);
assert.equal(
  ridge.terrainAhead(
    ridgeApproach,
    new T.Vector3(0, Math.sin(0.25), -Math.cos(0.25)),
    200,
  ),
  null,
);
assert.ok(
  ridge.flightTerrainAhead(ridgeApproach, new T.Vector3(0, 0, -1), 0.25, 82) !==
    null,
  "The curved forecast retains a ridge warning that a straight climb ray misses",
);
console.log(
  "Curved terrain forecast matches flight integration and retains leveling-path hazards.",
);
