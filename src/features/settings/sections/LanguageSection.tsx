import { useSettings } from "../SettingsContext";
import { useTranslation } from "../../../lib/i18n";

export function LanguageSection() {
  const { settings, updateSettings } = useSettings();
  const t = useTranslation();

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t.settingsNav.language}</h2>

      <div className="py-4">
        <div className="text-sm font-medium mb-1">{t.settingsLanguage.heading}</div>
        <div className="text-xs text-muted-foreground mb-3">{t.settingsLanguage.description}</div>
        <div className="flex gap-2">
          {(['zh', 'en'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => updateSettings({ language: lang })}
              className={`px-4 py-2 text-sm rounded border transition-colors ${
                settings.language === lang
                  ? 'bg-secondary border-primary text-secondary-foreground font-medium'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {lang === 'zh' ? t.settingsLanguage.chinese : t.settingsLanguage.english}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
