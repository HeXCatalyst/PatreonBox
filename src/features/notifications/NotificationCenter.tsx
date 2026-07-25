import { useEffect, useRef } from "react";
import { BellOff, Trash2, X } from "lucide-react";
import { ScrollArea } from "../../components/ui/scroll-area";
import { ToolbarButton } from "../../components/ui/toolbar-button";
import { useTranslation } from "../../lib/i18n";
import { useNotifications } from "./NotificationContext";
import { NotificationIcon } from "./NotificationIcon";
import { actionLabel } from "./ToastStack";
import { AppNotification, NotifyAction, relativeBucket } from "./store";

function useRelativeLabel() {
  const t = useTranslation();
  return (at: number) => {
    const b = relativeBucket(at, Date.now());
    switch (b.unit) {
      case "now":
        return t.notifications.justNow;
      case "minute":
        return t.notifications.minutesAgo(b.value);
      case "hour":
        return t.notifications.hoursAgo(b.value);
      case "day":
        return t.notifications.daysAgo(b.value);
    }
  };
}

/**
 * The persistent log. Batch failures happen while the user is away from the
 * screen, so every entry survives its toast and stays actionable here.
 */
export function NotificationCenter({
  open,
  onClose,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  onAction?: (action: NotifyAction) => void;
}) {
  const { notifications, markAllRead, dismiss, clear, markRead } = useNotifications();
  const t = useTranslation();
  const relative = useRelativeLabel();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Opening the centre is the user seeing them; clear the badge on close so the
  // list doesn't reshuffle out from under them while it's open. Gated on having
  // actually been open — otherwise the initial open=false render would wipe the
  // badge for notifications restored from the last session.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    markAllRead();
  }, [open, markAllRead]);

  if (!open) return null;

  const handleAction = (n: AppNotification) => {
    markRead(n.id);
    if (n.action && onAction) onAction(n.action);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[80]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t.notifications.title}
        className="fixed bottom-4 left-4 z-[81] w-96 max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col rounded-lg border bg-popover text-popover-foreground shadow-xl"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <span className="text-sm font-semibold flex-1">{t.notifications.title}</span>
          {notifications.length > 0 && (
            <>
              <ToolbarButton onClick={markAllRead}>
                {t.notifications.markAllRead}
              </ToolbarButton>
              <ToolbarButton tone="danger" onClick={clear}>
                <Trash2 className="h-3.5 w-3.5" />
                {t.notifications.clearAll}
              </ToolbarButton>
            </>
          )}
          <button
            type="button"
            aria-label={t.notifications.close}
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-6 text-center">
            <BellOff className="h-6 w-6 text-muted-foreground opacity-60" />
            <div className="text-sm text-muted-foreground">{t.notifications.empty}</div>
            <div className="text-xs text-muted-foreground opacity-70">
              {t.notifications.emptyHint}
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div className="divide-y">
              {notifications.map(n => (
                <div
                  key={n.id}
                  className={`px-3 py-2.5 flex items-start gap-2.5 group ${
                    n.read ? "" : "bg-accent/40"
                  }`}
                >
                  <NotificationIcon severity={n.severity} className="h-4 w-4 mt-0.5" />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm leading-snug">{n.title}</span>
                      {n.count > 1 && (
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {t.notifications.repeat(n.count)}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">
                        {relative(n.lastAt)}
                      </span>
                    </div>

                    {n.source && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {n.source}
                      </div>
                    )}
                    {n.detail && (
                      <div className="text-xs text-muted-foreground/80 break-words mt-0.5">
                        {n.detail}
                      </div>
                    )}

                    {n.action && onAction && (
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline mt-1.5"
                        onClick={() => handleAction(n)}
                      >
                        {actionLabel(n.action.kind, t)}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    aria-label={t.notifications.dismiss}
                    className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={() => dismiss(n.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </>
  );
}
