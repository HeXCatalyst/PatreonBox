import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { AppSettings, DEFAULT_SETTINGS } from "../../types/settings";
import { loadSettings, saveSettings } from "../../lib/settings";

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => {},
  refreshSettings: async () => {},
});

export function SettingsProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial: AppSettings;
}) {
  const [settings, setSettings] = useState<AppSettings>(initial);
  const settingsRef = useRef<AppSettings>(initial);

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const next = { ...settingsRef.current, ...partial };
    settingsRef.current = next;
    setSettings(next);
    await saveSettings(next);
  }, []);

  // Re-reads settings from the backend without writing anything back — for
  // syncing the client-side cache after a backend-initiated settings change
  // (e.g. migrate_images_dir writing custom_images_dir directly), where
  // updateSettings' merge-then-overwrite semantics would otherwise clobber
  // the backend's write with a stale client copy on the next updateSettings call.
  const refreshSettings = useCallback(async () => {
    const fresh = await loadSettings();
    settingsRef.current = fresh;
    setSettings(fresh);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
