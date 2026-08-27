const SETTINGS_KEY = "pixelbatch-settings-v1";
const PRESETS_KEY = "pixelbatch-custom-presets-v1";

export function loadSettings(defaults) {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    return parsed ? { ...defaults, ...parsed } : defaults;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function clearSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}

export function loadCustomPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveCustomPresets(presets) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}
