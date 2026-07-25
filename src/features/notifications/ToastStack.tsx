import { X } from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import { useNotifications } from "./NotificationContext";
import { NotificationIcon } from "./NotificationIcon";
import { NotifyAction } from "./store";

/**
 * The transient layer, bottom-right. Errors and warnings stay until closed;
 * successes fade. Pinned above everything but click-through where there is no
 * card, so it never blocks the UI underneath.
 */
export function ToastStack({
  onAction,
}: {
  onAction?: (action: NotifyAction) => void;
}) {
  const { toasts, closeToast, markRead } = useNotifications();
  const t = useTranslation();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[70] flex flex-col-reverse gap-2 pointer-events-none w-80 max-w-[calc(100vw-2rem)]"
      role="status"
      aria-live="polite"
    >
      {toasts.map(n => (
        <div
          key={n.id}
          className="pointer-events-auto rounded-lg border bg-popover text-popover-foreground shadow-lg px-3 py-2.5 flex items-start gap-2.5"
        >
          <NotificationIcon severity={n.severity} className="h-4 w-4 mt-0.5" />

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-medium leading-snug">{n.title}</span>
              {n.count > 1 && (
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {t.notifications.repeat(n.count)}
                </span>
              )}
            </div>

            {(n.source || n.detail) && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {[n.source, n.detail].filter(Boolean).join(" · ")}
              </div>
            )}

            {n.action && onAction && (
              <button
                type="button"
                className="text-xs text-primary hover:underline mt-1.5"
                onClick={() => {
                  markRead(n.id);
                  closeToast(n.id);
                  onAction(n.action!);
                }}
              >
                {actionLabel(n.action.kind, t)}
              </button>
            )}
          </div>

          <button
            type="button"
            aria-label={t.notifications.close}
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => closeToast(n.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function actionLabel(
  kind: string,
  t: ReturnType<typeof useTranslation>,
): string {
  switch (kind) {
    case "open-downloads":
      return t.notifications.actionOpenDownloads;
    case "open-creator":
      return t.notifications.actionOpenCreator;
    case "open-settings":
      return t.notifications.actionOpenSettings;
    default:
      return t.notifications.actionRetry;
  }
}
