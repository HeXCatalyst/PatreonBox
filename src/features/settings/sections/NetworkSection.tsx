import { useSettings } from "../SettingsContext";
import { useTranslation } from "../../../lib/i18n";

export function NetworkSection() {
  const { settings, updateSettings } = useSettings();
  const t = useTranslation();
  const isManual = settings.proxy_mode === 'manual';

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t.settingsNetwork.heading}</h2>

      <div className="py-4 border-b">
        <div className="text-sm font-medium mb-1">{t.settingsNetwork.proxyModeLabel}</div>
        <div className="text-xs text-muted-foreground mb-3">
          {t.settingsNetwork.proxyModeDesc}
        </div>
        <div className="flex gap-2">
          {(['auto', 'manual', 'off'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => updateSettings({ proxy_mode: mode })}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                settings.proxy_mode === mode
                  ? 'bg-secondary border-primary text-secondary-foreground font-medium'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {mode === 'auto' ? t.settingsNetwork.auto : mode === 'manual' ? t.settingsNetwork.manual : t.settingsNetwork.off}
            </button>
          ))}
        </div>
      </div>

      <div className={`py-4 ${isManual ? '' : 'opacity-40 pointer-events-none'}`}>
        <div className="text-sm font-medium mb-1">{t.settingsNetwork.manualAddrLabel}</div>
        <div className="text-xs text-muted-foreground mb-3">
          {t.settingsNetwork.manualAddrFormat}
        </div>
        <input
          type="text"
          disabled={!isManual}
          defaultValue={settings.proxy_url ?? ''}
          placeholder="http://127.0.0.1:7890"
          onBlur={e => {
            const val = e.target.value.trim();
            updateSettings({ proxy_url: val.length > 0 ? val : null });
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const val = (e.target as HTMLInputElement).value.trim();
              updateSettings({ proxy_url: val.length > 0 ? val : null });
            }
          }}
          className="h-8 w-72 text-sm px-2 border rounded bg-background disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}
