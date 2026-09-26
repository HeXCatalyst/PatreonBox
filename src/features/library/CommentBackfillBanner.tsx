import { useTranslation } from "../../lib/i18n";
import { useCommentBackfillProgress } from "./progress";

/**
 * The thin "fetching comments…" strip above the panes.
 *
 * A component of its own so that the progress it draws stays here: the counter
 * lives in an external store (see progress.ts), and this is the only subscriber,
 * so a backfill that runs for tens of minutes repaints this one line instead of
 * the whole library tree.
 *
 * It sits inside SettingsProvider, so it can read the live language like the
 * rest of the notification chrome.
 */
export function CommentBackfillBanner() {
  const progress = useCommentBackfillProgress();
  const t = useTranslation();

  if (!progress) return null;

  return (
    <div className="w-full bg-secondary text-secondary-foreground text-xs text-center py-1 flex-shrink-0 tabular-nums">
      {t.comments.backfillProgress(progress.done, progress.total)}
    </div>
  );
}