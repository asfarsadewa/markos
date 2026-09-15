import test from "node:test";
import assert from "node:assert/strict";
import {
  deadzone,
  stickResponse,
  damp,
  advanceTransform,
  segmentDistance,
  segmentSphereImpact,
  firstProjectileImpact,
  flightProfile,
  advanceAfterburner,
  interceptTime,
} from "../src/flight.mjs";
test("projectiles resolve the earliest surface or target instead of passing through cover", () => {
  const start = { x: 0, y: 0, z: 0 },
    end = { x: 0, y: 0, z: 30 };
  assert.deepEqual(
    firstProjectileImpact(start, end, 10, [{ x: 0, y: 0, z: 20 }], 2),
    { distance: 10, targetIndex: -1 },
  );
  assert.deepEqual(
    firstProjectileImpact(
      start,
      end,
      10,
      [
        { x: 0, y: 0, z: 20 },
        { x: 0, y: 0, z: 5 },
      ],
      2,
    ),
    { distance: 3, targetIndex: 1 },
  );
  assert.deepEqual(
    firstProjectileImpact(
      start,
      end,
      null,
      [
        { x: 0, y: 0, z: 20 },
        { x: 0, y: 0, z: 5 },
      ],
      2,
    ),
    { distance: 3, targetIndex: 1 },
  );
  assert.deepEqual(
    firstProjectileImpact(start, end, 10, [{ x: 0, y: 0, z: 12 }], 2),
    { distance: 10, targetIndex: -1 },
  );
  assert.equal(
    firstProjectileImpact(start, end, null, [{ x: 5, y: 0, z: 12 }], 2),
    null,
  );
});
test("swept target entry catches fast shots, grazing hits and starts inside the volume", () => {
  const start = { x: 0, y: 0, z: 0 },
    end = { x: 0, y: 0, z: 100 };
  assert.equal(segmentSphereImpact({ x: 0, y: 0, z: 50 }, start, end, 4), 46);
  assert.equal(segmentSphereImpact({ x: 4, y: 0, z: 50 }, start, end, 4), 50);
  assert.equal(segmentSphereImpact({ x: 0, y: 0, z: 0 }, start, end, 4), 0);
  assert.equal(
    segmentSphereImpact({ x: 0, y: 0, z: -50 }, start, end, 4),
    null,
  );
  assert.equal(
    segmentSphereImpact({ x: 0, y: 0, z: 110 }, start, end, 4),
    null,
  );
  assert.equal(
    segmentSphereImpact({ x: 0, y: 0, z: 10 }, start, start, 4),
    null,
  );
});
test("radial precision response is continuous, monotone and direction preserving", () => {
  for (const zone of [0.05, 0.15, 0.3])
    for (const angle of [0, 0.4, Math.PI / 4, 2, 4]) {
      let previous = 0;
      for (let step = 0; step <= 1000; step++) {
        const magnitude = step / 1000,
          x = Math.cos(angle) * magnitude,
          y = Math.sin(angle) * magnitude;
        const [a, b] = stickResponse(x, y, zone, true);
        const output = Math.hypot(a, b),
          direct = Math.hypot(...deadzone(x, y, zone));
        assert.ok(output >= previous - 1e-10 && output <= direct + 1e-10);
        assert.ok(output - previous < 0.003);
        assert.ok(Math.abs(a * y - b * x) < 1e-10);
        if (magnitude <= zone) assert.ok(output < 1e-10);
        if (step === 1000) assert.ok(Math.abs(output - 1) < 1e-10);
        assert.deepEqual(
          stickResponse(x, y, zone, false),
          deadzone(x, y, zone),
        );
        previous = output;
      }
    }
});
test("lead targeting meets moving targets within projectile lifetime", () => {
  const relative = { x: 0, y: 0, z: 300 },
    velocity = { x: 35, y: 8, z: 0 };
  const time = interceptTime(relative, velocity, 370);
  assert.ok(time > 0 && time < 2.2);
  assert.ok(
    Math.abs(
      Math.hypot(
        relative.x + velocity.x * time,
        relative.y + velocity.y * time,
        relative.z + velocity.z * time,
      ) -
        370 * time,
    ) < 1e-8,
  );
  assert.equal(interceptTime(relative, { x: 0, y: 0, z: 500 }, 370), 0);
  assert.equal(
    interceptTime({ x: 0, y: 0, z: 1200 }, { x: 0, y: 0, z: 0 }, 370),
    0,
  );
  assert.ok(
    Number.isFinite(interceptTime(relative, { x: 0, y: 0, z: -370 }, 370)),
  );
});
test("handling blends continuously through transformation and honors partial thrust", () => {
  assert.equal(flightProfile(0, false, 0).speed, 82);
  assert.equal(flightProfile(1, false, 0).speed, 28);
  assert.equal(flightProfile(0, true, 1).speed, 32);
  assert.equal(flightProfile(1, true, 1).speed, 8);
  assert.equal(flightProfile(0, false, 0.5).speed, (82 + 185) / 2);
  const before = flightProfile(0.499, false, 1),
    after = flightProfile(0.501, false, 1);
  assert.ok(Math.abs(before.speed - after.speed) < 0.4);
  assert.ok(Math.abs(before.turnRate - after.turnRate) < 0.003);
  for (let step = 1; step <= 100; step++) {
    const previous = flightProfile((step - 1) / 100, false, 0),
      current = flightProfile(step / 100, false, 0);
    assert.ok(
      current.speed <= previous.speed && current.turnRate >= previous.turnRate,
    );
  }
});
test("held boost recharges between sustained bursts instead of flickering at depletion", () => {
  for (const fps of [30, 60, 144]) {
    let energy = 1,
      recovering = false,
      priorThrust = 1,
      lastSwitch = 0;
    const intervals = [];
    for (let frame = 0; frame < fps * 12; frame++) {
      const next = advanceAfterburner(energy, recovering, 1, 1 / fps);
      assert.ok(next.energy >= 0 && next.energy <= 1);
      if (next.thrust !== priorThrust) {
        intervals.push(frame / fps - lastSwitch);
        lastSwitch = frame / fps;
        if (next.thrust > 0)
          assert.ok(energy >= 0.3, "Rearmed with a usable energy reserve");
      }
      ({ energy, recovering } = next);
      priorThrust = next.thrust;
    }
    assert.ok(
      intervals.length >= 3,
      "Test covers depletion, recovery and another burst",
    );
    assert.ok(
      intervals.every((seconds) => seconds > 1),
      "No alternating-frame boost pulses",
    );
  }
  const half = advanceAfterburner(1, false, 0.5, 1);
  assert.equal(half.thrust, 0.5);
  assert.equal(half.energy, 0.89);
});
test("radial stick deadzone rejects drift and preserves diagonal magnitude", () => {
  assert.deepEqual(deadzone(0.09, -0.08), [0, 0]);
  const d = deadzone(1, 1);
  assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-10);
  assert.equal(d[0], d[1]);
  assert.deepEqual(deadzone(0, -1), [0, -1]);
});
test("flight smoothing gives the same response at 30 and 144 FPS", () => {
  function run(fps) {
    let x = 0;
    for (let i = 0; i < fps; i++) x = damp(x, 1, 3, 1 / fps);
    return x;
  }
  assert.ok(Math.abs(run(30) - run(144)) < 1e-10);
});
test("mechanical sequence reverses continuously and lands exactly on endpoints", () => {
  let x = 0;
  for (let i = 0; i < 72; i++) x = advanceTransform(x, 1, 1 / 30);
  assert.ok(x > 0.999);
  x = advanceTransform(x, 0, 0.1);
  assert.ok(x < 1 && x > 0.9);
  for (let i = 0; i < 100; i++) x = advanceTransform(x, 0, 0.1);
  assert.equal(x, 0);
});
test("swept projectile hits are detected even between frames", () => {
  assert.equal(
    segmentDistance(
      { x: 0, y: 2, z: 0 },
      { x: -20, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
    ),
    2,
  );
  assert.equal(
    segmentDistance(
      { x: 30, y: 0, z: 0 },
      { x: -20, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
    ),
    10,
  );
  assert.equal(
    segmentDistance(
      { x: 0, y: 0, z: 3 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ),
    3,
  );
});
