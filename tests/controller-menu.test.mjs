import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const { Input } = await import("../src/input.ts");
const { ControllerMenu } = await import("../src/controller-menu.ts");

function setup(markup) {
  const window = new Window();
  for (const name of [
    "window",
    "document",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "Event",
  ])
    globalThis[name] = name === "window" ? window : window[name];
  document.body.innerHTML = `<section id="menu">${markup}</section>`;
  // happy-dom has no layout engine; use the real DOM and emulate visibility only.
  window.HTMLElement.prototype.getClientRects = function () {
    return this.closest("[hidden]") ? [] : [{}];
  };
  const input = new Input();
  input.pad = {
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  const menu = new ControllerMenu();
  let root = document.getElementById("menu"),
    backs = 0;
  const frame = (dt = 1 / 60) => {
    const handled = menu.update(root, input, dt, () => backs++);
    input.end();
    return handled;
  };
  const press = (button) => {
    input.pad.buttons[button].pressed = true;
    const handled = frame();
    input.pad.buttons[button].pressed = false;
    frame();
    return handled;
  };
  frame();
  return {
    window,
    input,
    frame,
    press,
    setRoot: (next) => (root = next),
    get backs() {
      return backs;
    },
  };
}

test("landmark controls register a single step per D-pad press or bracket tap", () => {
  const t = setup("<button>Fly</button>");
  t.input.gameplay = true;
  for (const [button, code, direction] of [
    [14, "BracketLeft", -1],
    [15, "BracketRight", 1],
  ]) {
    t.input.pad.buttons[button].pressed = true;
    assert.equal(t.input.landmarkStep, direction);
    t.input.end();
    assert.equal(t.input.landmarkStep, 0);
    t.input.pad.buttons[button].pressed = false;
    t.input.end();
    window.dispatchEvent(new window.KeyboardEvent("keydown", { code }));
    window.dispatchEvent(new window.KeyboardEvent("keyup", { code }));
    assert.equal(t.input.landmarkStep, direction);
    t.input.end();
    assert.equal(t.input.landmarkStep, 0);
  }
});

test("target tracking follows controller hold and retains a brief keyboard tap for one frame", () => {
  const t = setup("<button>Fly</button>");
  t.input.gameplay = true;
  assert.equal(t.input.track, false);
  t.input.pad.buttons[2].pressed = true;
  assert.equal(t.input.track, true);
  t.input.end();
  assert.equal(t.input.track, true);
  t.input.pad.buttons[2].pressed = false;
  assert.equal(t.input.track, false);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { code: "KeyT" }));
  window.dispatchEvent(new window.KeyboardEvent("keyup", { code: "KeyT" }));
  assert.equal(t.input.track, true);
  t.input.end();
  assert.equal(t.input.track, false);
});

test("left trigger meters thrust continuously while keyboard boost remains full power", () => {
  const t = setup("<button>Fly</button>");
  t.input.pad.buttons[6].value = 0.07;
  assert.equal(t.input.boostAmount, 0);
  t.input.pad.buttons[6].value = 0.54;
  assert.ok(Math.abs(t.input.boostAmount - 0.5) < 1e-10);
  t.input.pad.buttons[6].value = 1;
  assert.equal(t.input.boostAmount, 1);
  t.input.pad.buttons[6].value = 0;
  window.dispatchEvent(
    new window.KeyboardEvent("keydown", { code: "ShiftLeft" }),
  );
  assert.equal(t.input.boostAmount, 1);
  t.input.end();
  window.dispatchEvent(
    new window.KeyboardEvent("keyup", { code: "ShiftLeft" }),
  );
  assert.equal(t.input.boostAmount, 0);
});

test("steering and camera gains are independent and preserve full stick travel", () => {
  const { input } = setup("<button>Fly</button>");
  input.pad.axes = [1, -1, 1, 0];
  const initial = input.axes;
  input.cameraSensitivity = 0.5;
  assert.deepEqual(input.axes, initial);
  assert.equal(input.look.x, 0.5);
  input.sensitivity = 1.7;
  assert.equal(input.look.x, 0.5);
  assert.ok(Math.abs(Math.hypot(input.axes.x, input.axes.y) - 1.7) < 1e-10);
  input.invert = true;
  assert.ok(input.axes.y < 0);
  input.invert = false;
  assert.ok(input.axes.y > 0);
  assert.equal(input.look.y, 0);
});

test("camera inversion independently reverses right-stick and keyboard look without changing horizontal orbit", () => {
  const { input, window } = setup("<button>Fly</button>");
  input.pad.axes = [0.3, -0.4, 0.6, -0.8];
  const flight = input.axes;
  const inverted = input.look;
  assert.ok(inverted.y > 0, "camera Y defaults to inverted");
  input.invertCamera = false;
  assert.equal(input.look.y, -inverted.y);
  assert.equal(input.look.x, inverted.x);
  assert.deepEqual(input.axes, flight);
  input.invert = false;
  assert.equal(
    input.look.y,
    -inverted.y,
    "flight inversion cannot change camera look",
  );
  input.pad.axes = [0, 0, 0, 0];
  window.dispatchEvent(new window.KeyboardEvent("keydown", { code: "KeyI" }));
  assert.equal(input.look.y, -1);
  input.invertCamera = true;
  assert.equal(input.look.y, 1);
});

test("adjustable radial dead zone removes diagonal drift without removing fine input", () => {
  const { input } = setup("<button>Fly</button>");
  input.deadZone = 0.2;
  input.pad.axes = [0.14, 0.14, 0.14, 0.14];
  assert.equal(Math.hypot(input.axes.x, input.axes.y), 0);
  assert.equal(Math.hypot(input.look.x, input.look.y), 0);
  input.pad.axes = [0.21, 0, 0.21, 0];
  assert.ok(input.axes.x > 0 && input.axes.x < 0.02);
  assert.equal(input.axes.x, input.look.x);
  input.precision = false;
  assert.ok(Math.abs(input.axes.x - 0.0125) < 1e-10);
});

test("gentle response preserves keyboard authority and produces frame-rate independent input", () => {
  const { input } = setup("<button>Fly</button>");
  input.keys.add("KeyD");
  input.keys.add("KeyQ");
  assert.equal(input.axes.x, 1);
  assert.equal(input.look.x, -1);
  input.keys.clear();
  input.pad.axes = [0.5, -0.25, 0.5, -0.25];
  const results = [];
  for (const fps of [30, 60, 144]) {
    let heading = 0,
      orbit = 0;
    for (let frame = 0; frame < fps * 2; frame++) {
      heading += (input.axes.x * 1.05) / fps;
      orbit += (input.look.x * 2.1) / fps;
    }
    results.push({ heading, orbit });
  }
  for (const result of results) {
    assert.ok(Math.abs(result.heading - results[0].heading) < 1e-10);
    assert.ok(Math.abs(result.orbit - results[0].orbit) < 1e-10);
  }
});

test("D-pad chooses a visible menu button and A activates once without leaking into the next mode", () => {
  const t = setup(
    '<button disabled>Loading</button><button id="sortie">Sortie</button><button id="free">Free flight</button><div hidden><button>Hidden</button></div>',
  );
  assert.equal(document.activeElement.id, "sortie");
  t.press(13);
  assert.equal(document.activeElement.id, "free");
  let starts = 0;
  document.getElementById("free").onclick = () => {
    starts++;
    t.setRoot(null);
  };
  t.input.pad.buttons[0].pressed = true;
  assert.equal(t.frame(), true);
  assert.equal(starts, 1);
  t.frame();
  assert.equal(t.input.padPressed(0), false);
  assert.equal(starts, 1);
});

test("stick repeat is delayed; controller can change camera, sensitivity, checkbox and go back", () => {
  const t = setup(
    '<button>Resume</button><select id="camera"><option>Chase</option><option>Wide</option><option>Close</option></select><input id="gain" type="range" min="0.5" max="1.7" step="0.1" value="1"><input id="invert" type="checkbox">',
  );
  t.input.pad.axes[1] = 0.8;
  t.frame();
  assert.equal(document.activeElement.id, "camera");
  t.frame(0.2);
  assert.equal(document.activeElement.id, "camera");
  t.input.pad.axes[1] = 0;
  t.frame();
  let changes = 0;
  document.getElementById("camera").onchange = () => changes++;
  t.press(15);
  assert.equal(document.getElementById("camera").selectedIndex, 1);
  assert.equal(changes, 1);
  t.press(13);
  let value;
  document.getElementById("gain").oninput = (e) =>
    (value = Number(e.target.value));
  t.press(15);
  assert.equal(value, 1.1);
  for (let n = 0; n < 12; n++) t.press(15);
  assert.equal(value, 1.7);
  t.press(13);
  t.press(0);
  assert.equal(document.getElementById("invert").checked, true);
  t.press(1);
  assert.equal(t.backs, 1);
});

test("native form keys remain usable while flight actions still latch brief key presses", () => {
  const t = setup(
    '<select id="camera"><option>Chase</option><option>Wide</option></select><button id="resume">Resume</button>',
  );
  const select = document.getElementById("camera");
  const arrow = new t.window.KeyboardEvent("keydown", {
    code: "ArrowDown",
    bubbles: true,
    cancelable: true,
  });
  select.dispatchEvent(arrow);
  assert.equal(arrow.defaultPrevented, false);
  assert.equal(t.input.down("ArrowDown"), false);
  const enter = new t.window.KeyboardEvent("keydown", {
    code: "Enter",
    bubbles: true,
    cancelable: true,
  });
  document.getElementById("resume").dispatchEvent(enter);
  assert.equal(t.input.pressed("Enter"), false);
  t.input.gameplay = true;
  const space = new t.window.KeyboardEvent("keydown", {
    code: "Space",
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(space);
  document.body.dispatchEvent(
    new t.window.KeyboardEvent("keyup", { code: "Space", bubbles: true }),
  );
  assert.equal(space.defaultPrevented, true);
  assert.equal(t.input.pressed("Space"), true);
  t.input.end();
  assert.equal(t.input.pressed("Space"), false);
});

test("sub-frame steering, look, fire and throttle taps register once without sticking", () => {
  const t = setup("<button>Fly</button>");
  t.input.gameplay = true;
  for (const code of [
    "KeyA",
    "KeyW",
    "KeyE",
    "KeyI",
    "Space",
    "ShiftLeft",
    "ControlLeft",
  ]) {
    document.body.dispatchEvent(
      new t.window.KeyboardEvent("keydown", { code, bubbles: true }),
    );
    document.body.dispatchEvent(
      new t.window.KeyboardEvent("keyup", { code, bubbles: true }),
    );
  }
  assert.deepEqual(t.input.axes, { x: -1, y: -1 });
  assert.equal(t.input.look.x, 1);
  assert.equal(t.input.look.y, 1);
  assert.equal(t.input.fire, true);
  assert.equal(t.input.boostAmount, 1);
  assert.equal(t.input.active("ControlLeft"), true);
  t.input.end();
  assert.deepEqual(t.input.axes, { x: 0, y: 0 });
  assert.equal(t.input.look.x, 0);
  assert.equal(t.input.look.y, 0);
  assert.equal(t.input.fire, false);
  assert.equal(t.input.boostAmount, 0);
  assert.equal(t.input.active("ControlLeft"), false);
});
