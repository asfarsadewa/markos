import { stickResponse, clamp } from "./flight.ts";
export class Input {
  keys = new Set<string>();
  previous = new Set<string>();
  pending = new Set<string>();
  pad: Gamepad | null = null;
  padPrevious: boolean[] = [];
  sensitivity = 1;
  cameraSensitivity = 1;
  deadZone = 0.15;
  precision = true;
  invert = true;
  invertCamera = true;
  wasConnected = false;
  gameplay = false;
  constructor() {
    window.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement;
      if (
        e.code !== "Escape" &&
        target.closest?.("input, select, textarea, [contenteditable=true]")
      )
        return;
      if (
        !this.gameplay &&
        target.closest?.("button, a") &&
        ["Enter", "Space"].includes(e.code)
      )
        return;
      if (
        this.gameplay &&
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      )
        e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat) this.pending.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.pending.clear();
    });
  }
  poll() {
    this.pad =
      Array.from(navigator.getGamepads?.() ?? []).find(
        (p) => p?.connected && p.mapping === "standard",
      ) ?? null;
  }
  down(code: string) {
    return this.keys.has(code);
  }
  active(code: string) {
    // A complete down/up tap between two rendered frames still gets one sample.
    return this.down(code) || this.pending.has(code);
  }
  pressed(code: string, button = -1) {
    return (
      this.pending.has(code) ||
      (this.keys.has(code) && !this.previous.has(code)) ||
      this.padPressed(button)
    );
  }
  padPressed(button: number) {
    return (
      button >= 0 &&
      !!this.pad?.buttons[button]?.pressed &&
      !this.padPrevious[button]
    );
  }
  get axes() {
    const [px, py] = stickResponse(
      this.pad?.axes[0] ?? 0,
      this.pad?.axes[1] ?? 0,
      this.deadZone,
      this.precision,
    );
    return {
      x:
        (px ||
          Number(this.active("KeyD") || this.active("ArrowRight")) -
            Number(this.active("KeyA") || this.active("ArrowLeft"))) *
        this.sensitivity,
      y:
        (-py ||
          Number(this.active("KeyW") || this.active("ArrowUp")) -
            Number(this.active("KeyS") || this.active("ArrowDown"))) *
          (this.invert ? -1 : 1) *
          this.sensitivity || 0,
    };
  }
  get look() {
    const [x, y] = stickResponse(
      this.pad?.axes[2] ?? 0,
      this.pad?.axes[3] ?? 0,
      this.deadZone,
      this.precision,
    );
    return {
      x:
        (x || Number(this.active("KeyE")) - Number(this.active("KeyQ"))) *
        this.cameraSensitivity,
      y:
        (y || Number(this.active("KeyK")) - Number(this.active("KeyI"))) *
          (this.invertCamera ? -1 : 1) *
          this.cameraSensitivity || 0,
    };
  }
  get boost() {
    return this.boostAmount > 0;
  }
  get boostAmount() {
    if (this.active("ShiftLeft") || this.active("ShiftRight")) return 1;
    return clamp(((this.pad?.buttons[6]?.value ?? 0) - 0.08) / 0.92, 0, 1);
  }
  get fire() {
    return this.active("Space") || (this.pad?.buttons[7]?.value ?? 0) > 0.2;
  }
  get track() {
    return this.active("KeyT") || !!this.pad?.buttons[2]?.pressed;
  }
  get landmarkStep() {
    return (
      Number(this.pressed("BracketRight", 15)) -
      Number(this.pressed("BracketLeft", 14))
    );
  }
  rumble(strength = 0.3, duration = 120) {
    const p = this.pad as
      | (Gamepad & {
          vibrationActuator?: {
            playEffect: (type: string, params: object) => Promise<unknown>;
          };
        })
      | null;
    try {
      p?.vibrationActuator
        ?.playEffect("dual-rumble", {
          duration,
          strongMagnitude: strength,
          weakMagnitude: strength * 0.65,
        })
        .catch(() => {});
    } catch {}
  }
  end() {
    this.pending.clear();
    this.previous = new Set(this.keys);
    this.padPrevious = this.pad?.buttons.map((b) => b.pressed) ?? [];
    this.wasConnected = !!this.pad;
  }
}
