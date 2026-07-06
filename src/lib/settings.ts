import { invoke } from "@tauri-apps/api/core";
import { AppSettings, DEFAULT_SETTINGS } from "../types/settings";

export async function loadSettings(): Promise<AppSettings> {
  try {
    return await invoke<AppSettings>("read_settings");
  } catch (e) {
    console.error("Failed to load settings, using defaults:", e);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await invoke("write_settings", { settings });
}
