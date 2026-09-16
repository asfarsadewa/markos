import type { Input } from "./input.ts";

/** Navigate the same visible controls used by mouse and keyboard. */
export class ControllerMenu {
  private root: HTMLElement | null = null;
  private direction = "";
  private repeat = 0;
  private focused: HTMLElement | null = null;

  update(root: HTMLElement | null, input: Input, dt: number, back: () => void) {
    if (!root || !input.pad) {
      this.focused?.classList.remove("controller-focus");
      this.root = null;
      this.direction = "";
      return false;
    }
    const controls = Array.from(
      root.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
      ),
    ).filter((element) => element.getClientRects().length > 0);
    if (!controls.length) return false;
    const focus = (element: HTMLElement) => {
      this.focused?.classList.remove("controller-focus");
      this.focused = element;
      element.classList.add("controller-focus");
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "nearest" });
    };
    if (this.root !== root) {
      this.root = root;
      this.direction = "";
      focus(controls[0]);
    }
    const buttons = input.pad.buttons;
    const x =
      Number(buttons[15]?.pressed) - Number(buttons[14]?.pressed) ||
      input.pad.axes[0] ||
      0;
    const y =
      Number(buttons[13]?.pressed) - Number(buttons[12]?.pressed) ||
      input.pad.axes[1] ||
      0;
    const direction =
      Math.abs(y) > 0.55
        ? y > 0
          ? "down"
          : "up"
        : Math.abs(x) > 0.55
          ? x > 0
            ? "right"
            : "left"
          : "";
    this.repeat -= dt;
    if (direction && (direction !== this.direction || this.repeat <= 0)) {
      this.repeat = direction !== this.direction ? 0.4 : 0.15;
      let index = controls.indexOf(document.activeElement as HTMLElement);
      if (index < 0) index = 0;
      if (direction === "up" || direction === "down") {
        index =
          (index + (direction === "down" ? 1 : -1) + controls.length) %
          controls.length;
        focus(controls[index]);
      } else {
        const element = controls[index];
        const step = direction === "right" ? 1 : -1;
        focus(element);
        if (element instanceof HTMLSelectElement) {
          element.selectedIndex = Math.max(
            0,
            Math.min(element.options.length - 1, element.selectedIndex + step),
          );
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (
          element instanceof HTMLInputElement &&
          element.type === "range"
        ) {
          const amount = Number(element.step) || 1;
          element.value = String(
            Math.max(
              Number(element.min),
              Math.min(
                Number(element.max),
                Number(element.value) + amount * step,
              ),
            ),
          );
          element.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    }
    this.direction = direction;
    if (input.padPressed(1)) {
      back();
      return true;
    }
    if (input.padPressed(0)) {
      const element = controls.includes(document.activeElement as HTMLElement)
        ? (document.activeElement as HTMLElement)
        : controls[0];
      if (element instanceof HTMLSelectElement) {
        element.selectedIndex =
          (element.selectedIndex + 1) % element.options.length;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (!(
        element instanceof HTMLInputElement && element.type === "range"
      ))
        element.click();
      return true;
    }
    return false;
  }
}
