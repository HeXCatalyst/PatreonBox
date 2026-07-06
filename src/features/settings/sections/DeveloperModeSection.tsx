import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useTranslation } from "../../../lib/i18n";
import { useSettings } from "../SettingsContext";
import { Switch } from "@/components/ui/switch";
import { SelfCheckPanel } from "./SelfCheckPanel";

export function DeveloperModeSection() {
  const t = useTranslation();
  const { settings, updateSettings } = useSettings();

  const handleDemoModeChange = async (checked: boolean) => {
    await updateSettings({ demo_mode: checked });
    if (checked) {
      // Wait for the demo images to actually land on disk before announcing
      // demo mode is active — otherwise a listener (LibraryView) could switch
      // to demo data and try to render an asset before its file exists.
      await invoke('ensure_demo_assets_on_disk').catch(console.error);
    }
    await emit('demo-mode-changed', checked);
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t.settingsAbout.debugMode}</h2>

      <div className="divide-y">
        <div className="flex justify-between items-center py-3 text-sm">
          <span className="text-muted-foreground">{t.settingsAbout.debugOutputLabel}</span>
          <div className="flex gap-2">
            {(['terminal', 'inherit', 'none'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => updateSettings({ debug_output_mode: mode })}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  settings.debug_output_mode === mode
                    ? 'bg-secondary border-primary text-secondary-foreground font-medium'
                    : 'bg-background border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {mode === 'terminal' ? t.settingsAbout.debugModeTerminal : mode === 'inherit' ? t.settingsAbout.debugModeInherit : t.settingsAbout.debugModeNone}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-between items-center py-3 text-sm">
          <span className="text-muted-foreground">{t.settingsAbout.demoMode}</span>
          <Switch
            checked={settings.demo_mode}
            onCheckedChange={handleDemoModeChange}
          />
        </div>
        <SelfCheckPanel />
      </div>
    </div>
  );
}
