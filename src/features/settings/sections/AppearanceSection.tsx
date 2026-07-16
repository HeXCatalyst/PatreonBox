import { useEffect } from "react";
import { useSettings } from "../SettingsContext";
import { useTranslation } from "../../../lib/i18n";
import { applyTheme, COLOR_THEMES, type ColorTheme } from "../../../lib/theme";

// Ground + accent chips shown on each theme button.
const THEME_SWATCHES: Record<ColorTheme, string[]> = {
  'default':      ['#9ca3af', '#27272a'],
  'reading-room': ['#26201a', '#e8964a'],
  'dhole':        ['#33251a', '#eaa62f', '#b5522a'],
  'nightwolf':    ['#252a27', '#c3e84a', '#3f8291'],
  'azure-fox':    ['#23314f', '#f0c33a', '#4a9bd8'],
};

export function AppearanceSection() {
  const { settings, updateSettings } = useSettings();
  const t = useTranslation();

  useEffect(() => {
    applyTheme(settings.theme, settings.color_theme);
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system', settings.color_theme);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [settings.theme, settings.color_theme]);

  // Character themes are still experimental (Nightwolf especially needs polish),
  // so they only appear when developer mode is on. Default is always available,
  // and the currently-selected theme stays visible so nobody gets stuck on one.
  const visibleThemes = settings.developer_mode_enabled
    ? COLOR_THEMES
    : COLOR_THEMES.filter(ct => ct === 'default' || ct === settings.color_theme);

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
        <div className="text-sm font-medium mb-1">{t.settingsAppearance.colorThemeLabel}</div>
        <div className="text-xs text-muted-foreground mb-3">{t.settingsAppearance.colorThemeDesc}</div>
        <div className="flex flex-wrap gap-2">
          {visibleThemes.map(ct => (
            <button
              key={ct}
              onClick={() => updateSettings({ color_theme: ct })}
              className={`flex items-center gap-2 px-3 py-2 text-sm rounded border transition-colors ${
                settings.color_theme === ct
                  ? 'bg-secondary border-primary text-secondary-foreground font-medium'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="flex -space-x-1" aria-hidden>
                {THEME_SWATCHES[ct].map((c, i) => (
                  <span key={i} className="h-3.5 w-3.5 rounded-full ring-1 ring-black/20" style={{ backgroundColor: c }} />
                ))}
              </span>
              {t.settingsAppearance.themeName(ct)}
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
