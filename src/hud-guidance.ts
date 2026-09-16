import { clearGuidancePosition } from "./navigation.ts";

/** Cache the layout only when HUD panels change size or visibility. */
export class HudGuidance {
  private dirty = true;
  private regions: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[] = [];
  private panels: HTMLElement[];
  private readonly observer: ResizeObserver;
  private readonly marker: HTMLElement;
  constructor(marker: HTMLElement, root: HTMLElement) {
    this.marker = marker;
    this.panels = Array.from(
      root.querySelectorAll<HTMLElement>(
        ".mission, .heading, .telemetry, .craft-status, .radar, .controls-bar, #radio, #transform-status, #notice, #terrain-cue",
      ),
    );
    this.observer = new ResizeObserver(() => {
      this.dirty = true;
    });
    for (const panel of this.panels) this.observer.observe(panel);
    window.addEventListener("resize", () => {
      this.dirty = true;
    });
  }
  place(projected: {
    x: number;
    y: number;
    offscreen: boolean;
    angle: number;
  }) {
    if (this.dirty) {
      this.regions = this.panels
        .map((panel) => panel.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
      this.dirty = false;
    }
    const position = clearGuidancePosition(
      projected,
      innerWidth,
      innerHeight,
      this.regions,
    );
    this.marker.style.left = `${position.x}px`;
    this.marker.style.top = `${position.y}px`;
    this.marker.classList.toggle(
      "offscreen",
      projected.offscreen || position.moved,
    );
    this.marker.classList.toggle("guidance-hidden", !position.visible);
    this.marker.classList.toggle("compact", position.compact);
    const angle =
      position.moved && !projected.offscreen
        ? Math.atan2(
            (-projected.y * 0.5 + 0.5) * innerHeight - position.y,
            (projected.x * 0.5 + 0.5) * innerWidth - position.x,
          )
        : projected.angle;
    this.marker.style.setProperty("--target-angle", `${angle}rad`);
    return position;
  }
}
