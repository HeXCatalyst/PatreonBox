import { useEffect } from "react";
import { useSettings } from "../SettingsContext";
import { useTranslation } from "../../../lib/i18n";

function applyTheme(theme: 'dark' | 'light' | 'system') {
  const html = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  html.classList.toggle('dark', isDark);
}

export function AppearanceSection() {
  const { settings, updateSettings } = useSettings();
  const t = useTranslation();

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [settings.theme]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t.settingsAppearance.heading}</h2>

      <div className="py-4 border-b">
        <div className="text-sm font-medium mb-1">{t.settingsAppearance.themeLabel}</div>
        <div className="text-xs text-muted-foreground mb-3">{t.settingsAppearance.themeDesc}</div>
        <div className="flex gap-2">
          {(['dark', 'light', 'system'] as const).map(theme => (
            <button
              key={theme}
              onClick={() => updateSettings({ theme })}
              className={`px-4 py-2 text-sm rounded border transition-colors ${
                settings.theme === theme
                  ? 'bg-secondary border-primary text-secondary-foreground font-medium'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {theme === 'dark' ? t.settingsAppearance.dark : theme === 'light' ? t.settingsAppearance.light : t.settingsAppearance.system}
            </button>
          ))}
        </div>
      </div>

      <div className="py-4 border-b">
        <div className="text-sm font-medium mb-1">{t.settingsAppearance.layoutLabel}</div>
        <div className="text-xs text-muted-foreground mb-3">{t.settingsAppearance.layoutDesc}</div>
        <div className="flex gap-2">
          {(['classic', 'workbench'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => updateSettings({ layout_mode: mode })}
              className={`px-4 py-2 text-sm rounded border transition-colors ${
                settings.layout_mode === mode
                  ? 'bg-secondary border-primary text-secondary-foreground font-medium'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {mode === 'classic' ? t.settingsAppearance.layoutClassic : t.settingsAppearance.layoutWorkbench}
            </button>
          ))}
        </div>
      </div>

      <div className="py-4">
        <div className="text-sm font-medium mb-1">{t.settingsAppearance.panelWidthLabel}</div>
        <div className="text-xs text-muted-foreground mb-3">
          {t.settingsAppearance.panelWidthValue(settings.sidebar_width, settings.post_list_width)}
        </div>
        <button
          onClick={() => updateSettings({ sidebar_width: 256, post_list_width: 320 })}
          className="px-4 py-2 text-sm rounded border border-border bg-background text-muted-foreground hover:text-foreground transition-colors"
        >
          {t.settingsAppearance.restoreDefault}
        </button>
      </div>
    </div>
  );
}
