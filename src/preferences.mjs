const KEY = "markos.preferences.v1";
export const defaults = {
  sensitivity: 1,
  cameraSensitivity: 1,
  deadZone: 0.15,
  precision: true,
  invert: true,
  invertCamera: true,
  autoReturn: true,
  cameraStyle: 0,
  music: 0.45,
  analog: 0.75,
};
export function normalizePreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = { ...defaults };
  for (const [key, min, max] of [
    ["sensitivity", 0.5, 1.7],
    ["cameraSensitivity", 0.5, 1.7],
    ["deadZone", 0.05, 0.3],
    ["cameraStyle", 0, 3],
    ["music", 0, 1],
    ["analog", 0, 1],
  ]) {
    if (typeof source[key] === "number" && Number.isFinite(source[key]))
      result[key] = Math.max(min, Math.min(max, source[key]));
  }
  result.cameraStyle = Math.round(result.cameraStyle);
  for (const key of ["precision", "invert", "invertCamera", "autoReturn"])
    if (typeof source[key] === "boolean") result[key] = source[key];
  return result;
}
export function loadPreferences(getStorage = () => globalThis.localStorage) {
  try {
    return normalizePreferences(JSON.parse(getStorage().getItem(KEY)));
  } catch {
    return { ...defaults };
  }
}
export function savePreferences(
  value,
  getStorage = () => globalThis.localStorage,
) {
  try {
    getStorage().setItem(KEY, JSON.stringify(normalizePreferences(value)));
  } catch {
    /* Preferences still work for this visit when storage is unavailable. */
  }
}
