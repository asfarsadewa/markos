export const $ = <E extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as E;
export const show = (id: string, value = true) =>
  $(id).classList.toggle("hidden", !value);
const lastText = new WeakMap<Element, string>();
/** Assign textContent only when it changes; the instruments call this every frame. */
export function setText(element: HTMLElement, value: string) {
  if (lastText.get(element) === value) return;
  lastText.set(element, value);
  element.textContent = value;
}
