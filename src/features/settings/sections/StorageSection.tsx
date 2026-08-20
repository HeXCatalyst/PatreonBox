import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useTranslation } from "../../../lib/i18n";
import { invalidateImagesDir, useImagesDir } from '../../../lib/assetUrl';
import { useSettings } from "../SettingsContext";

interface StorageUsage {
  db_bytes: number;
  images_bytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Real filesystem paths contain the real OS username — redact them for display
// while demo mode is on, so a screenshot never leaks it. Actual functionality
// (Open in Finder, Change Folder, migration) still operates on the real paths;
// only the on-screen text is swapped.
const FAKE_DATA_DIR = '/Users/demo/Library/Application Support/com.example.patreonbox';
const FAKE_IMAGES_DIR = `${FAKE_DATA_DIR}/images`;

interface LastMigration {
  id: number;
  started_at: string;
  finished_at: string | null;
  source_dir: string;
  target_dir: string;
  is_restore: boolean;
  file_count: number | null;
  total_bytes: number | null;
  copied_bytes: number | null;
  verify_mode: string;
  status: string;
  error: string | null;
}

function fmtMigrationBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function StorageSection({ onNavigate }: { onNavigate?: (s: 'account' | 'sync' | 'history' | 'network' | 'storage' | 'migration' | 'appearance' | 'language' | 'about' | 'developer') => void }) {
  const t = useTranslation();
  const [dataDir, setDataDir] = useState<string>('');
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const [finderError, setFinderError] = useState<string | null>(null);
  const { settings, updateSettings, refreshSettings } = useSettings();
  const imagesDir = useImagesDir();
  const [migrating, setMigrating] = useState(false);
  const migratingRef = useRef(false);
  const [migrationPhase, setMigrationPhase] = useState<'copying' | 'verifying' | 'done'>('copying');
  const [migrationCurrent, setMigrationCurrent] = useState(0);
  const [migrationTotal, setMigrationTotal] = useState(0);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [lastMigration, setLastMigration] = useState<LastMigration | null>(null);

  const loadLastMigration = useCallback(async () => {
    try {
      setLastMigration(await invoke<LastMigration | null>("get_last_migration"));
    } catch (e) {
      console.error("get_last_migration failed", e);
    }
  }, []);

  useEffect(() => {
    invoke<string>('resolve_app_data_dir').then(setDataDir).catch(console.error);
    invoke<StorageUsage>('get_storage_usage').then(setUsage).catch(console.error);
    loadLastMigration();
  }, [cleared, migrating, loadLastMigration]);

  // The backend emits this after record_migration_finish, so the last-migration
  // card refreshes the instant a migration completes — no manual refresh needed.
  useEffect(() => {
    const unlisten = listen("image-migrations-changed", () => { loadLastMigration(); });
    return () => { unlisten.then(f => f()); };
  }, [loadLastMigration]);

  useEffect(() => {
    if (!migrating) return;
    const unlisten = listen<{ current_bytes: number; total_bytes: number; phase: string }>(
      'image-migration-progress',
      (event) => {
        setMigrationCurrent(event.payload.current_bytes);
        setMigrationTotal(event.payload.total_bytes);
        if (event.payload.phase === 'verifying') setMigrationPhase('verifying');
        else if (event.payload.phase === 'done') setMigrationPhase('done');
        else setMigrationPhase('copying');
      }
    );
    return () => { unlisten.then(f => f()); };
  }, [migrating]);

  const handleClearAll = async () => {
    setClearing(true);
    setClearError(null);
    try {
      await invoke('clear_all_data');
      setConfirmOpen(false);
      setCleared(c => !c);
    } catch (e) {
      setClearError(String(e));
    } finally {
      setClearing(false);
    }
  };

  const runMigration = async (targetDir: string | null) => {
    if (migratingRef.current) return;
    migratingRef.current = true;
    setMigrationError(null);
    setMigrationCurrent(0);
    setMigrationTotal(0);
    setMigrationPhase('copying');
    setMigrating(true);
    await emit('image-migration-active', true);
    try {
      await invoke('migrate_images_dir', { targetDir });
      await refreshSettings();
      // The image store just moved, so every cached asset URL now points at the
      // old location. Re-resolve and push the new root to any mounted view.
      invalidateImagesDir();
      setCleared(c => !c); // reuse existing effect dependency to force a re-fetch of dataDir/usage/imagesDir
    } catch (e) {
      setMigrationError(String(e));
    } finally {
      setMigrating(false);
      migratingRef.current = false;
      await emit('image-migration-active', false);
    }
  };

  const handleChangeFolder = async () => {
    if (migratingRef.current) return;
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== 'string') return;
    await runMigration(selected);
  };

  const handleRestoreDefault = async () => {
    if (migratingRef.current) return;
    await runMigration(null);
  };

  const displayDataDir = settings.demo_mode ? FAKE_DATA_DIR : dataDir;
  const displayImagesDir = settings.demo_mode
    ? (settings.custom_images_dir ? `${FAKE_IMAGES_DIR}-custom` : `${FAKE_IMAGES_DIR} (${t.settingsStorage.imagesDirDefault})`)
    : (settings.custom_images_dir ?? `${imagesDir || '…'} (${t.settingsStorage.imagesDirDefault})`);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t.settingsStorage.heading}</h2>

      <div className="flex items-center justify-between py-4 border-b">
        <div>
          <div className="text-sm font-medium">{t.settingsStorage.dataDirLabel}</div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono break-all max-w-md">
            {displayDataDir || '—'}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!dataDir}
          onClick={() => {
            setFinderError(null);
            openPath(dataDir).catch(e => setFinderError(String(e)));
          }}
        >
          {t.settingsStorage.openInFinder}
        </Button>
      </div>
      {finderError && (
        <p className="text-xs text-destructive mt-1">{finderError}</p>
      )}

      <div className="flex items-center justify-between py-4 border-b">
        <div>
          <div className="text-sm font-medium">{t.settingsStorage.storageUsedLabel}</div>
          {usage ? (
            <div className="text-xs text-muted-foreground mt-0.5">
              {t.settingsStorage.database(formatBytes(usage.db_bytes))}
              {' · '}
              {t.settingsStorage.images(formatBytes(usage.images_bytes))}
              {' · '}
              {t.settingsStorage.total(formatBytes(usage.db_bytes + usage.images_bytes))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground mt-0.5">{t.settingsStorage.calculating}</div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between py-4 border-b gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t.settingsStorage.deleteModeLabel}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{t.settingsStorage.deleteModeDesc}</div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {(['trash', 'direct'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => updateSettings({ delete_mode: mode })}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                settings.delete_mode === mode
                  ? 'bg-secondary border-primary text-secondary-foreground font-medium'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {mode === 'trash' ? t.settingsStorage.deleteModeTrash : t.settingsStorage.deleteModeDirect}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between py-4 border-b">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{t.settingsStorage.imagesDirLabel}</div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono break-all max-w-md">
            {displayImagesDir}
          </div>
          {migrating && (
            <div className="mt-2 max-w-md">
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: migrationTotal > 0 ? `${Math.min(100, (migrationCurrent / migrationTotal) * 100)}%` : '0%' }}
                />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {migrationPhase === 'verifying' ? t.settingsStorage.migrationVerifying
                  : migrationPhase === 'done' ? t.settingsStorage.migrationDone
                  : t.settingsStorage.migrationCopying}
              </div>
            </div>
          )}
          {migrationError && (
            <p className="text-xs text-destructive mt-1">{t.settingsStorage.migrationFailed(migrationError)}</p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {settings.custom_images_dir && (
            <Button variant="outline" size="sm" disabled={migrating} onClick={handleRestoreDefault}>
              {migrating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.settingsStorage.restoreDefaultButton}
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={migrating} onClick={handleChangeFolder}>
            {migrating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t.settingsStorage.changeFolderButton}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between py-4 border-b">
        <div>
          <div className="text-sm font-medium">{t.settingsStorage.verifyModeLabel}</div>
        </div>
        <div className="flex gap-2">
          {(['size', 'hash'] as const).map(mode => (
            <button
              key={mode}
              disabled={migrating}
              onClick={() => updateSettings({ migration_verify_mode: mode })}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                settings.migration_verify_mode === mode
                  ? 'bg-secondary border-primary text-secondary-foreground font-medium'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {mode === 'size' ? t.settingsStorage.verifyModeSize : t.settingsStorage.verifyModeHash}
            </button>
          ))}
        </div>
      </div>

      {lastMigration && (
        <div className="mt-6 mb-2 p-4 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-sm font-medium">{t.settingsStorage.lastMigrationLabel}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              lastMigration.status === 'success' ? 'bg-green-500/15 text-green-500'
              : lastMigration.status === 'failed' ? 'bg-destructive/15 text-destructive'
              : 'bg-amber-500/15 text-amber-500'
            }`}>
              {lastMigration.status === 'success' ? t.migrationHistory.statusSuccess
               : lastMigration.status === 'failed' ? t.migrationHistory.statusFailed
               : lastMigration.status === 'rolled_back' ? t.migrationHistory.statusRolledBack
               : t.migrationHistory.statusRunning}
            </span>
            <span className="text-xs text-muted-foreground ml-auto tabular-nums">
              {new Date(lastMigration.started_at).toLocaleString()}
            </span>
          </div>
          <div className="text-xs font-mono text-muted-foreground break-all">
            {settings.demo_mode ? FAKE_IMAGES_DIR : lastMigration.source_dir}
            <span className="mx-1">→</span>
            {settings.demo_mode ? `${FAKE_IMAGES_DIR}-custom` : lastMigration.target_dir}
          </div>
          <div className="text-xs text-muted-foreground mt-1 tabular-nums">
            {lastMigration.file_count ?? 0} {t.settingsStorage.migrationFilesUnit}
            {' · '}
            {fmtMigrationBytes(lastMigration.copied_bytes)} / {fmtMigrationBytes(lastMigration.total_bytes)}
            {' · '}
            {lastMigration.verify_mode}
          </div>
          {onNavigate && (
            <button
              className="text-xs text-primary mt-2 hover:underline"
              onClick={() => onNavigate('migration')}
            >
              {t.settingsStorage.viewAllMigrations} →
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between py-4">
        <div>
          <div className="text-sm font-medium text-destructive">{t.settingsStorage.clearAllLabel}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {t.settingsStorage.clearAllDesc}
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => { setClearError(null); setConfirmOpen(true); }}
        >
          {t.settingsStorage.clearButton}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={open => { setConfirmOpen(open); if (!open) setClearError(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t.settingsStorage.clearDialogTitle}</DialogTitle>
            <DialogDescription>
              {t.settingsStorage.clearDialogDesc}
            </DialogDescription>
          </DialogHeader>
          {clearError && <p className="text-sm text-destructive">{clearError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={clearing}>
              {t.settingsStorage.cancel}
            </Button>
            <Button variant="destructive" onClick={handleClearAll} disabled={clearing}>
              {clearing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.settingsStorage.clearAll}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
