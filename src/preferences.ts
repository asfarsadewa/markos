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
export type Preferences = typeof defaults;
export type NumericPreference = {
  [K in keyof Preferences]: Preferences[K] extends number ? K : never;
}[keyof Preferences];
export type BooleanPreference = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];
const ranges: [NumericPreference, number, number][] = [
  ["sensitivity", 0.5, 1.7],
  ["cameraSensitivity", 0.5, 1.7],
  ["deadZone", 0.05, 0.3],
  ["cameraStyle", 0, 3],
  ["music", 0, 1],
  ["analog", 0, 1],
];
const flags: BooleanPreference[] = [
  "precision",
  "invert",
  "invertCamera",
  "autoReturn",
];
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const localStorageProvider = () => globalThis.localStorage;

export function normalizePreferences(value: unknown): Preferences {
  const source: Record<string, unknown> =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const result = { ...defaults };
  for (const [key, min, max] of ranges) {
    const candidate = source[key];
    if (typeof candidate === "number" && Number.isFinite(candidate))
      result[key] = Math.max(min, Math.min(max, candidate));
  }
  result.cameraStyle = Math.round(result.cameraStyle);
  for (const key of flags) {
    const candidate = source[key];
    if (typeof candidate === "boolean") result[key] = candidate;
  }
  return result;
}
export function loadPreferences(
  getStorage: () => StorageLike = localStorageProvider,
): Preferences {
  try {
    return normalizePreferences(
      JSON.parse(getStorage().getItem(KEY) ?? "null"),
    );
  } catch {
    return { ...defaults };
  }
}
export function savePreferences(
  value: Preferences,
  getStorage: () => StorageLike = localStorageProvider,
) {
  try {
    getStorage().setItem(KEY, JSON.stringify(normalizePreferences(value)));
  } catch {
    /* Preferences still work for this visit when storage is unavailable. */
  }
}
