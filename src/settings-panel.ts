import { $ } from "./dom.ts";
import {
  defaults,
  type BooleanPreference,
  type NumericPreference,
  type Preferences,
} from "./preferences.ts";

type Slider = [
  id: string,
  key: NumericPreference,
  format: (v: number) => string,
];
type Toggle = [id: string, key: BooleanPreference];
const percent = (v: number) => Math.round(v * 100) + "%";
const times = (v: number) => v.toFixed(1) + "×";
const sliders: Slider[] = [
  ["sensitivity", "sensitivity", times],
  ["camera-sensitivity", "cameraSensitivity", times],
  ["stick-deadzone", "deadZone", percent],
  ["music-volume", "music", percent],
  ["analog-finish", "analog", (v) => (v === 0 ? "Off" : percent(v))],
];
const toggles: Toggle[] = [
  ["invert", "invert"],
  ["invert-camera", "invertCamera"],
  ["camera-auto-return", "autoReturn"],
  ["precision", "precision"],
];

/** Bind the pause-menu controls to the preference object; `onChange` applies and saves. */
export function bindSettingsPanel(
  preferences: Preferences,
  onChange: () => void,
) {
  const syncs: Array<() => void> = [];
  for (const [id, key, format] of sliders) {
    const control = $<HTMLInputElement>(id);
    const sync = () => {
      control.value = String(preferences[key]);
      $(id + "-value").textContent = format(preferences[key]);
    };
    syncs.push(sync);
    sync();
    control.oninput = () => {
      preferences[key] = Number(control.value);
      sync();
      onChange();
    };
  }
  for (const [id, key] of toggles) {
    const control = $<HTMLInputElement>(id);
    const sync = () => {
      control.checked = preferences[key];
    };
    syncs.push(sync);
    sync();
    control.onchange = () => {
      preferences[key] = control.checked;
      onChange();
    };
  }
  const sync = () => {
    for (const each of syncs) each();
  };
  $("reset-settings").onclick = () => {
    Object.assign(preferences, defaults);
    sync();
    onChange();
  };
  return { sync };
}
