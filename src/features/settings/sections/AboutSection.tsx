import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "../../../lib/i18n";
import { useSettings } from "../SettingsContext";
import { Switch } from "@/components/ui/switch";

export function AboutSection() {
  const t = useTranslation();
  const { settings, updateSettings } = useSettings();
  const [version, setVersion] = useState<string>('—');

  useEffect(() => {
    invoke<string>('get_app_version').then(setVersion).catch(console.error);
  }, []);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t.settingsAbout.heading}</h2>

      <div className="divide-y">
        <div className="flex justify-between py-3 text-sm">
          <span className="text-muted-foreground">{t.settingsAbout.appVersion}</span>
          <span className="font-mono">{version}</span>
        </div>
        <div className="flex justify-between py-3 text-sm">
          <span className="text-muted-foreground">{t.settingsAbout.database}</span>
          <span className="font-mono">SQLite (tauri-plugin-sql)</span>
        </div>
        <div className="flex justify-between items-center py-3 text-sm">
          <span className="text-muted-foreground">{t.settingsAbout.debugMode}</span>
          <Switch
            checked={settings.developer_mode_enabled}
            onCheckedChange={(checked) => {
              updateSettings({ developer_mode_enabled: checked });
            }}
          />
        </div>
      </div>
    </div>
  );
}
