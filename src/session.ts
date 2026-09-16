export type Mode =
  "entry" | "title" | "flight" | "paused" | "crash" | "result" | "hangar";

/** Screen/flow state and its transition rules. Presentation reacts through `onChange`. */
export class GameSession {
  mode: Mode = "entry";
  private pausedFrom: "flight" | "crash" = "flight";
  private readonly onChange: (mode: Mode, previous: Mode) => void;
  constructor(onChange: (mode: Mode, previous: Mode) => void) {
    this.onChange = onChange;
  }
  set(next: Mode) {
    const previous = this.mode;
    this.mode = next;
    this.onChange(next, previous);
  }
  /** Flight or its crash sequence: the only states a pause can interrupt. */
  get inAction() {
    return this.mode === "flight" || this.mode === "crash";
  }
  /** The aircraft is shown on its display pedestal rather than in flight. */
  get onDisplay() {
    return (
      this.mode === "entry" || this.mode === "title" || this.mode === "hangar"
    );
  }
  pause() {
    if (!this.inAction) return false;
    this.pausedFrom = this.mode as "flight" | "crash";
    this.set("paused");
    return true;
  }
  resume() {
    if (this.mode === "paused") this.set(this.pausedFrom);
  }
}
