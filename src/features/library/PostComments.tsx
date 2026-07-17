import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { MessageSquare, RefreshCw, Loader2 } from "lucide-react";
import { Comment } from "../../types/db";
import { getPostComments } from "../../lib/db";
import { useSettings } from "../settings/SettingsContext";
import { useTranslation } from "../../lib/i18n";

// Posts already fetched this session, so re-opening a post (esp. one with zero
// comments) doesn't re-hit the API every time.
const fetchedThisSession = new Set<string>();

interface PostCommentsProps {
  postId: string;
}

/**
 * A post's comments, fetched on-demand from Patreon and cached in the DB. Loads
 * the cached copy immediately, then fetches once per post per session (or on an
 * explicit refresh). Top-level comments with their replies nested underneath.
 */
export function PostComments({ postId }: PostCommentsProps) {
  const { settings } = useSettings();
  const t = useTranslation();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const load = async () => {
    try { setComments(await getPostComments(postId)); } catch { /* ignore */ }
  };

  const refresh = async () => {
    if (settings.demo_mode) return;
    setLoading(true);
    setError(null);
    try {
      await invoke<number>("fetch_post_comments", { postId });
      fetchedThisSession.add(postId);
      setFetched(true);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Show the cached copy on open. Fetching is explicit (the button) so browsing
  // never spawns a background webview per post.
  useEffect(() => {
    setError(null);
    setFetched(fetchedThisSession.has(postId));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const { topLevel, repliesByParent } = useMemo(() => {
    const top: Comment[] = [];
    const byParent = new Map<string, Comment[]>();
    for (const c of comments) {
      if (c.parent_id) {
        const arr = byParent.get(c.parent_id) ?? [];
        arr.push(c);
        byParent.set(c.parent_id, arr);
      } else {
        top.push(c);
      }
    }
    return { topLevel: top, repliesByParent: byParent };
  }, [comments]);

  const fmtDate = (d: string | null) => {
    if (!d) return "";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString();
  };

  const renderComment = (c: Comment, isReply = false) => (
    <div key={c.id} className={isReply ? "mt-3 pl-4 border-l-2 border-border/60" : "py-3 border-t first:border-t-0"}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm font-medium">{c.author_name || t.comments.unknownAuthor}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(c.published_at)}</span>
      </div>
      <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{c.body}</div>
      {(repliesByParent.get(c.id) ?? []).map(r => renderComment(r, true))}
    </div>
  );

  if (settings.demo_mode) return null;

  return (
    <div className="max-w-3xl mx-auto mt-10">
      <div className="flex items-center justify-between mb-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          {t.comments.heading(comments.length)}
        </h3>
        <button
          onClick={refresh}
          disabled={loading || settings.demo_mode}
          title={t.comments.refresh}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t.comments.refresh}
        </button>
      </div>

      {error ? (
        <div className="text-xs text-destructive py-2 break-words">{t.comments.error}: {error}</div>
      ) : comments.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">
          {loading ? t.comments.loading : fetched ? t.comments.empty : t.comments.notLoaded}
        </div>
      ) : (
        <div>{topLevel.map(c => renderComment(c))}</div>
      )}
    </div>
  );
}
