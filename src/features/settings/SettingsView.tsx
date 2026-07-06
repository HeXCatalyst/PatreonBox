import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { SyncSection } from "./sections/SyncSection";
import { NetworkSection } from "./sections/NetworkSection";
import { StorageSection } from "./sections/StorageSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { LanguageSection } from "./sections/LanguageSection";
import { AboutSection } from "./sections/AboutSection";
import { AccountSection } from "./sections/AccountSection";
import { DeveloperModeSection } from "./sections/DeveloperModeSection";
import { useTranslation } from "../../lib/i18n";
import { useSettings } from "./SettingsContext";

type Section = 'account' | 'sync' | 'network' | 'storage' | 'appearance' | 'language' | 'about' | 'developer';

const SECTION_MAP: Record<Section, React.ComponentType> = {
  account:    AccountSection,
  sync:       SyncSection,
  network:    NetworkSection,
  storage:    StorageSection,
  appearance: AppearanceSection,
  language:   LanguageSection,
  about:      AboutSection,
  developer:  DeveloperModeSection,
};

interface SettingsViewProps {
  onClose: () => void;
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const t = useTranslation();
  const { settings } = useSettings();
  const [activeSection, setActiveSection] = useState<Section>('account');
  const ActiveComponent = SECTION_MAP[activeSection];
  const developerModeEnabled = settings.developer_mode_enabled;

  // If developer mode gets turned off while it's the active section, its own
  // nav item just vanished — fall back to About rather than leaving an
  // orphaned page. (The enable toggle lives on the About page, so in practice
  // this is a safety net; picking a debug-output mode no longer disables it.)
  useEffect(() => {
    if (activeSection === 'developer' && !developerModeEnabled) {
      setActiveSection('about');
    }
  }, [activeSection, developerModeEnabled]);

  const NAV_ITEMS: { key: Section; label: string; icon: string }[] = [
    { key: 'account',    label: t.settingsNav.account,    icon: '👤' },
    { key: 'sync',       label: t.settingsNav.sync,       icon: '⬇' },
    { key: 'network',    label: t.settingsNav.network,    icon: '🌐' },
    { key: 'storage',    label: t.settingsNav.storage,    icon: '💾' },
    { key: 'appearance', label: t.settingsNav.appearance, icon: '🎨' },
    { key: 'language',   label: t.settingsNav.language,   icon: '🔤' },
    { key: 'about',      label: t.settingsNav.about,      icon: 'ℹ' },
    ...(developerModeEnabled
      ? [{ key: 'developer' as Section, label: t.settingsNav.developer, icon: '🛠' }]
      : []),
  ];

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Left nav */}
      <div className="w-52 border-r bg-muted/30 flex flex-col flex-shrink-0">
        <div className="p-4 border-b">
          <button
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <ChevronLeft className="h-4 w-4" />
            {t.settingsNav.backToLibrary}
          </button>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors ${
                activeSection === item.key
                  ? 'bg-secondary text-secondary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-8">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}
