import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  loadPreferences,
  savePreferences,
  normalizePreferences,
} from "../src/preferences.ts";

test("controller and camera choices round-trip without retaining unrelated data", () => {
  let saved = null;
  const storage = () => ({
    getItem: () => saved,
    setItem: (_, value) => {
      saved = value;
    },
  });
  assert.deepEqual(loadPreferences(storage), defaults);
  const choices = {
    ...defaults,
    sensitivity: 1.3,
    cameraSensitivity: 0.7,
    deadZone: 0.22,
    precision: false,
    invert: false,
    invertCamera: false,
    autoReturn: false,
    cameraStyle: 3,
    music: 0.2,
    analog: 0.85,
  };
  savePreferences({ ...choices, unrelated: "discard" }, storage);
  assert.deepEqual(loadPreferences(storage), choices);
  assert.equal("unrelated" in JSON.parse(saved), false);
});
test("invalid saved values are bounded or replaced with usable defaults", () => {
  const value = normalizePreferences({
    sensitivity: 500,
    cameraSensitivity: -4,
    deadZone: "0.2",
    precision: "false",
    invert: true,
    autoReturn: 0,
    cameraStyle: 2.6,
    music: Infinity,
    analog: -4,
  });
  assert.deepEqual(value, {
    ...defaults,
    sensitivity: 1.7,
    cameraSensitivity: 0.5,
    invert: true,
    cameraStyle: 3,
    analog: 0,
  });
  for (const saved of ["{broken", "null", "42", '"text"'])
    assert.deepEqual(
      loadPreferences(() => ({ getItem: () => saved })),
      defaults,
    );
});
test("unavailable browser storage does not prevent flight settings from working", () => {
  const denied = () => {
    throw new Error("Storage denied");
  };
  assert.deepEqual(loadPreferences(denied), defaults);
  assert.doesNotThrow(() =>
    savePreferences({ ...defaults, precision: false }, denied),
  );
});
