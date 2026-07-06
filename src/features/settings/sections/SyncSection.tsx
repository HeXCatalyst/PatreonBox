import { useSettings } from "../SettingsContext";
import { useTranslation } from "../../../lib/i18n";

function SettingRow({ label, description, children }: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b last:border-0">
      <div className="flex-1 pr-8">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      {children}
    </div>
  );
}

export function SyncSection() {
  const { settings, updateSettings } = useSettings();
  const t = useTranslation();

  const commitMaxPosts = (raw: string) => {
    const val = parseInt(raw);
    if (!isNaN(val) && val >= 1) updateSettings({ default_max_posts: val });
  };

  const commitTimeout = (raw: string) => {
    const val = parseInt(raw);
    if (!isNaN(val) && val >= 5) updateSettings({ download_timeout_secs: val });
  };

  const commitDelay = (raw: string) => {
    const val = parseInt(raw);
    if (!isNaN(val)) updateSettings({ image_download_delay_ms: Math.min(5000, Math.max(50, val)) });
  };

  const commitJitter = (raw: string) => {
    const val = parseInt(raw);
    if (!isNaN(val)) updateSettings({ image_download_jitter_ms: Math.min(2000, Math.max(50, val)) });
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t.settingsSync.heading}</h2>

      <SettingRow
        label={t.settingsSync.maxPostsLabel}
        description={t.settingsSync.maxPostsDesc}
      >
        <input
          type="number"
          min={1}
          defaultValue={settings.default_max_posts}
          onBlur={e => commitMaxPosts(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && commitMaxPosts((e.target as HTMLInputElement).value)}
          className="h-8 w-20 text-sm px-2 border rounded bg-background text-center"
        />
      </SettingRow>

      <SettingRow
        label={t.settingsSync.defaultModeLabel}
        description={t.settingsSync.defaultModeDesc}
      >
        <select
          value={settings.default_sync_mode}
          onChange={e => updateSettings({ default_sync_mode: e.target.value as 'normal' | 'full' })}
          className="h-8 text-sm px-2 border rounded bg-background"
        >
          <option value="normal">{t.settingsSync.modeNormal}</option>
          <option value="full">{t.settingsSync.modeFull}</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t.settingsSync.timeoutLabel}
        description={t.settingsSync.timeoutDesc}
      >
        <input
          type="number"
          min={5}
          max={300}
          defaultValue={settings.download_timeout_secs}
          onBlur={e => commitTimeout(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && commitTimeout((e.target as HTMLInputElement).value)}
          className="h-8 w-20 text-sm px-2 border rounded bg-background text-center"
        />
      </SettingRow>

      <SettingRow
        label={t.settingsSync.delayLabel}
        description={t.settingsSync.delayDesc}
      >
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.image_download_delay_enabled}
            onChange={e => updateSettings({ image_download_delay_enabled: e.target.checked })}
            className="h-4 w-4 cursor-pointer"
          />
          {settings.image_download_delay_enabled && (
            <>
              <input
                type="number"
                min={50}
                max={5000}
                defaultValue={settings.image_download_delay_ms}
                onBlur={e => commitDelay(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && commitDelay((e.target as HTMLInputElement).value)}
                className="h-8 w-20 text-sm px-2 border rounded bg-background text-center"
              />
              <span className="text-xs text-muted-foreground">{t.settingsSync.msUnit}</span>
            </>
          )}
        </div>
      </SettingRow>

      {settings.image_download_delay_enabled && (
        <SettingRow
          label={t.settingsSync.jitterLabel}
          description={t.settingsSync.jitterDesc}
        >
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.image_download_jitter_enabled}
              onChange={e => updateSettings({ image_download_jitter_enabled: e.target.checked })}
              className="h-4 w-4 cursor-pointer"
            />
            {settings.image_download_jitter_enabled && (
              <>
                <input
                  type="number"
                  min={50}
                  max={2000}
                  defaultValue={settings.image_download_jitter_ms}
                  onBlur={e => commitJitter(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && commitJitter((e.target as HTMLInputElement).value)}
                  className="h-8 w-20 text-sm px-2 border rounded bg-background text-center"
                />
                <span className="text-xs text-muted-foreground">{t.settingsSync.msCapUnit}</span>
              </>
            )}
          </div>
        </SettingRow>
      )}

      <div className="pt-6 pb-2">
        <div className="text-sm font-semibold">{t.settingsSync.assetDownloadHeading}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{t.settingsSync.assetDownloadDesc}</div>
      </div>

      <SettingRow
        label={t.settingsSync.imagesLabel}
        description={t.settingsSync.imagesDesc}
      >
        <input
          type="checkbox"
          checked={settings.downloadAssetTypes?.images ?? true}
          onChange={e => updateSettings({
            downloadAssetTypes: { ...settings.downloadAssetTypes, images: e.target.checked }
          })}
          className="h-4 w-4 cursor-pointer"
        />
      </SettingRow>

      <SettingRow
        label={t.settingsSync.audioLabel}
        description={t.settingsSync.audioDesc}
      >
        <input
          type="checkbox"
          checked={settings.downloadAssetTypes?.audio ?? true}
          onChange={e => updateSettings({
            downloadAssetTypes: { ...settings.downloadAssetTypes, audio: e.target.checked }
          })}
          className="h-4 w-4 cursor-pointer"
        />
      </SettingRow>

      <SettingRow
        label={t.settingsSync.attachmentsLabel}
        description={t.settingsSync.attachmentsDesc}
      >
        <input
          type="checkbox"
          checked={settings.downloadAssetTypes?.attachments ?? true}
          onChange={e => updateSettings({
            downloadAssetTypes: { ...settings.downloadAssetTypes, attachments: e.target.checked }
          })}
          className="h-4 w-4 cursor-pointer"
        />
      </SettingRow>
    </div>
  );
}
