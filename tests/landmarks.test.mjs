import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { cycleLandmark, landmarkGuidance } from "../src/landmarks.mjs";
import { navigationMarker } from "../src/navigation.mjs";
const R = 1800;

test("destination cycling includes unmarked flight and wraps both ways", () => {
  assert.equal(cycleLandmark(15, 1, 16), -1);
  assert.equal(cycleLandmark(-1, 1, 16), 0);
  assert.equal(cycleLandmark(0, -1, 16), -1);
  assert.equal(cycleLandmark(-1, -1, 16), 15);
  assert.equal(cycleLandmark(-1, 1, 0), -1);
});

test("visible approach leads to its authored point and tracks the landmark", () => {
  const p = new Vector3(0, R + 200, 0);
  const destination = {
    approach: new Vector3(80, R + 210, -100),
    lookAt: new Vector3(0, R + 100, -500),
  };
  const g = landmarkGuidance(p, destination, new Vector3(0, 0, -1), R);
  assert.equal(g.point, destination.approach);
  assert.equal(g.focus, destination.lookAt);
  assert.equal(g.beyondHorizon, false);
  assert.equal(g.arrived, false);
  assert.equal(
    landmarkGuidance(
      destination.approach,
      destination,
      new Vector3(0, 0, -1),
      R,
    ).arrived,
    true,
  );
});

test("far-side guidance stays above the sea in every hemisphere, including antipodes", () => {
  for (const up of [
    new Vector3(0, 1, 0),
    new Vector3(1, 0, 0),
    new Vector3(0, -1, 0),
    new Vector3(0.3, 0.4, 0.5).normalize(),
  ]) {
    const forward = new Vector3(0, 0, -1).projectOnPlane(up).normalize();
    const p = up.clone().multiplyScalar(R + 80);
    for (const angle of [1.3, 2, Math.PI]) {
      const end = up
        .clone()
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(forward, Math.sin(angle))
        .multiplyScalar(R + 200);
      const g = landmarkGuidance(p, { approach: end, lookAt: end }, forward, R);
      assert.equal(g.beyondHorizon, true);
      assert.equal(g.arrived, false);
      assert.ok(g.point.clone().sub(p).dot(up) >= 0);
      assert.ok(g.point.clone().sub(p).dot(forward) > 0);
      assert.ok(Math.abs(g.distance - Math.hypot(angle * R, 120)) < 1e-4);
      for (let i = 0; i <= 20; i++)
        assert.ok(
          p
            .clone()
            .lerp(g.point, i / 20)
            .length() > R,
        );
    }
  }
});


test("a distant sortie beacon guides along the horizon instead of into the sea", () => {
  const position = new Vector3(0, R + 150, 0);
  const beacon = new Vector3(0, Math.cos(1.3), -Math.sin(1.3))
    .multiplyScalar(R + 125);
  const forward = new Vector3(0, 0, -1);
  const route = landmarkGuidance(position, { approach: beacon, lookAt: beacon }, forward, R);
  const chord = beacon.clone().sub(position);
  const direct = navigationMarker(chord, 55, 16 / 9);
  const guided = navigationMarker(route.point.clone().sub(position), 55, 16 / 9);
  assert.equal(route.beyondHorizon, true);
  assert.ok(direct.y < -0.6, "old direct chord points steeply down");
  assert.ok(guided.y >= 0, "route cue stays on or above the horizon");
  assert.ok(Math.abs(route.distance - Math.hypot(1.3 * R, 25)) < 1e-6, "distance follows the surface route");
  const near = beacon.clone().add(new Vector3(0, 30, 20));
  const approach = landmarkGuidance(near, { approach: beacon, lookAt: beacon }, forward, R);
  assert.equal(approach.beyondHorizon, false);
  assert.equal(approach.point, beacon, "final approach retains the actual rendezvous point");
});
