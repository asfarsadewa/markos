import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { cameraContact } from "../src/targeting.ts";
const origin = new Vector3();
const contact = (distance, hp = 3) => ({
  hp,
  mesh: { position: new Vector3(distance, 0, 0) },
});
test("held camera contact survives nearer contacts and a different weapon lock", () => {
  const held = contact(400),
    near = contact(50),
    locked = contact(200);
  assert.equal(cameraContact([near, locked, held], locked, held, origin), held);
  assert.equal(
    cameraContact([near, locked, held], locked, null, origin),
    locked,
  );
});
test("destroyed or removed contacts reacquire a live lock, then the nearest survivor", () => {
  const held = contact(400, 0),
    near = contact(50),
    far = contact(200),
    removed = contact(10);
  assert.equal(cameraContact([held, near, far], far, held, origin), far);
  assert.equal(cameraContact([held, far, near], held, removed, origin), near);
  assert.equal(cameraContact([held], held, removed, origin), null);
});
test("empty airspace gives no camera contact", () => {
  assert.equal(cameraContact([], null, null, origin), null);
});
