import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTauriEvents } from "../../library/hooks/useTauriEvents";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, User } from "lucide-react";
import { useTranslation } from "../../../lib/i18n";
import { getCreators } from "../../../lib/db";
import type { Creator } from "../../../types/db";
import { formatPostDate } from "../../../lib/formatDate";
import { useSettings } from "../SettingsContext";

interface PatreonUser {
  full_name: string;
  email: string;
  image_url: string;
  is_creator: boolean;
}

export function AccountSection() {
  const t = useTranslation();
  const { settings } = useSettings();
  const [user, setUser] = useState<PatreonUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [creators, setCreators] = useState<(Creator & { post_count: number })[]>([]);

  const loadCreators = () => {
    if (settings.demo_mode) return;
    getCreators().then(setCreators).catch(console.error);
  };

  useEffect(() => {
    if (settings.demo_mode) {
      setLoading(false);
      return;
    }
    invoke<PatreonUser | null>('get_account_info')
      .then(u => setUser(u ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    loadCreators();
  }, [settings.demo_mode]);

  useTauriEvents({
    'patreon-logged-in': () => {
      if (settings.demo_mode) return;
      invoke<PatreonUser | null>('get_account_info')
        .then(u => setUser(u ?? null))
        .catch(() => setUser(null));
      loadCreators();
    },
    'subscriptions-synced': () => {
      loadCreators();
    },
  });

  if (settings.demo_mode) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-6">{t.settingsAccount.heading}</h2>
        <p className="text-sm text-muted-foreground">{t.settingsAccount.demoModeHidden}</p>
      </div>
    );
  }

  const handleLogin = async () => {
    setLoggingIn(true);
    try {
      await invoke('open_auth_webview');
    } catch (e) {
      console.error('Failed to open login window', e);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await invoke('logout');
      setUser(null);
    } catch (e) {
      console.error('Logout failed', e);
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-6">{t.settingsAccount.heading}</h2>
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t.settingsAccount.heading}</h2>

      {user ? (
        <div className="flex items-center justify-between py-4 border-b">
          <div className="flex items-center gap-3">
            {user.image_url ? (
              <img
                src={user.image_url}
                alt={user.full_name}
                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <User className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <div className="text-sm font-medium">{user.full_name}</div>
              <div className="text-xs text-muted-foreground">{user.email}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {user.is_creator ? t.settingsAccount.creator : t.settingsAccount.patron}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t.settingsAccount.logout}
          </Button>
        </div>
      ) : (
        <div className="py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t.settingsAccount.notLoggedIn}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t.settingsAccount.connectHint}
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleLogin}
              disabled={loggingIn}
            >
              {loggingIn && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.settingsAccount.loginButton}
            </Button>
          </div>
        </div>
      )}

      {user && (() => {
        const subscribed = creators.filter(c => Boolean(c.is_subscribed));
        if (subscribed.length === 0) return null;
        const paidCount = subscribed.filter(c => c.subscription_type === 'paid').length;
        const lastSyncedAt = subscribed.reduce<string | null>(
          (latest, c) => (!latest || (c.last_synced_at && c.last_synced_at > latest)) ? c.last_synced_at : latest,
          null
        );
        return (
          <div className="py-4">
            <div className="text-sm font-medium mb-1">
              {t.settingsAccount.followedHeading(subscribed.length, paidCount)}
            </div>
            <div className="divide-y border rounded-md mt-2 max-h-80 overflow-y-auto">
              {subscribed.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="h-6 w-6 flex-shrink-0">
                      <AvatarImage src={c.avatar_path || undefined} />
                      <AvatarFallback>{c.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm truncate">{c.name}</span>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                    c.subscription_type === 'paid' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
                  }`}>
                    {c.subscription_type === 'paid' ? t.sidebar.filterPaid : t.sidebar.filterFree}
                  </span>
                </div>
              ))}
            </div>
            {lastSyncedAt && (
              <div className="text-xs text-muted-foreground mt-2">
                {t.settingsAccount.lastSynced(formatPostDate(lastSyncedAt, t.common.unknownDate))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
