import test from "node:test";
import assert from "node:assert/strict";
import { navigationMarker, clearGuidancePosition } from "../src/navigation.ts";
test("fisheye marker projection matches the rendered lens sampling", () => {
  for (const fov of [50, 55, 67])
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      const point = { x: 15, y: 9, z: -100 };
      const marker = navigationMarker(point, fov, aspect, 0.09);
      assert.equal(marker.offscreen, false);
      const radius2 = marker.x ** 2 + marker.y ** 2;
      const lensScale = (1 + 0.09 * radius2) / (1 + 0.09 * 1.65);
      const focal = 1 / Math.tan((fov * Math.PI) / 360);
      assert.ok(
        Math.abs(marker.x * lensScale - (point.x * focal) / (100 * aspect)) <
          1e-8,
      );
      assert.ok(
        Math.abs(marker.y * lensScale - (point.y * focal) / 100) < 1e-8,
      );
    }
});
test("rear and edge objectives retain their real turn direction", () => {
  const right = navigationMarker({ x: 100, y: 0, z: 100 }, 55, 16 / 9);
  const left = navigationMarker({ x: -100, y: 0, z: 100 }, 55, 16 / 9);
  assert.equal(right.behind, true);
  assert.equal(right.offscreen, true);
  assert.ok(
    right.x > 0 && left.x < 0,
    "Rear targets must not mirror to the opposite side",
  );
  assert.equal(right.y, 0);
  assert.ok(
    Math.abs(left.x) <= 0.72,
    "Left cue stays outside the airspeed column",
  );
  const belowHorizon = navigationMarker(
    { x: -50, y: -900, z: 500 },
    55,
    16 / 9,
  );
  assert.ok(
    belowHorizon.x < 0 && belowHorizon.y === 0,
    "Rear guidance turns around the sphere instead of pointing through the ocean",
  );
  const corner = navigationMarker({ x: 100, y: 100, z: -10 }, 55, 16 / 9);
  assert.equal(corner.offscreen, true);
  assert.ok(
    Math.abs(corner.x / corner.y - 9 / 16) < 1e-8,
    "Edge clamp preserves the bearing",
  );
  assert.ok(Math.abs(corner.x) <= 0.84 && Math.abs(corner.y) <= 0.65);
});
test("directly rearward and camera-plane targets stay finite and actionable", () => {
  for (const point of [
    { x: 0, y: 0, z: 10 },
    { x: 10000, y: -10000, z: 0 },
    { x: 0, y: 0, z: -0.00001 },
  ]) {
    const marker = navigationMarker(point, 55, 16 / 9);
    assert.ok([marker.x, marker.y, marker.angle].every(Number.isFinite));
    assert.ok(
      Math.abs(marker.x) <= 0.84 + 1e-8 && Math.abs(marker.y) <= 0.65 + 1e-8,
    );
  }
  assert.equal(
    navigationMarker({ x: 0, y: 0, z: 10 }, 55, 16 / 9).offscreen,
    true,
  );
});

test("guidance preserves clear targets and moves obstructed ones along their bearing", () => {
  const clear = { x: 0.25, y: -0.2, offscreen: false };
  const at = clearGuidancePosition(clear, 1280, 720, []);
  assert.equal(at.x, 800);
  assert.equal(at.y, 432);
  assert.equal(at.moved, false);
  assert.equal(at.visible, true);
  const panels = [
    { left: 20, top: 90, right: 300, bottom: 240 },
    { left: 20, top: 325, right: 110, bottom: 445 },
  ];
  for (let angle = 0; angle < Math.PI * 2; angle += 0.03) {
    const target = {
      x: Math.cos(angle) * 0.72,
      y: Math.sin(angle) * 0.65,
      offscreen: true,
    };
    const p = clearGuidancePosition(target, 1280, 720, panels);
    assert.ok(p.visible);
    const dx = p.x - 640,
      dy = p.y - 360;
    assert.ok(
      Math.abs(dx * (-target.y * 360) - dy * (target.x * 640)) < 1e-7,
      "Moving a cue must retain its true turn bearing",
    );
    for (const r of panels)
      assert.ok(
        p.x + 68 <= r.left ||
          p.x - 68 >= r.right ||
          p.y + 54 <= r.top ||
          p.y - 54 >= r.bottom,
      );
  }
});
test("compact guidance keeps a cue visible when a full card cannot fit", () => {
  const panels = [
    { left: 0, top: 0, right: 844, bottom: 145 },
    { left: 0, top: 245, right: 844, bottom: 390 },
  ];
  const p = clearGuidancePosition(
    { x: 0.72, y: 0, offscreen: true },
    844,
    390,
    panels,
  );
  assert.ok(p.visible && p.compact && p.moved);
  assert.ok(p.x > 422, "Right-hand guidance stays on the right");
  assert.ok(p.y - 24 >= 145 && p.y + 24 <= 245);
});
