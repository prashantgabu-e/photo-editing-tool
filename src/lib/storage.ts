import { defaultSettings } from "../config/presets";
import type { Settings, StoredPreset } from "../types";

const SETTINGS_KEY = "pixelbatch-settings-v2";
const PRESETS_KEY = "pixelbatch-custom-presets-v2";

export function loadSettings(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    return parsed ? { ...defaultSettings, ...parsed } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function clearSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}

export function loadCustomPresets(): StoredPreset[] {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveCustomPresets(presets: StoredPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}
