import { Post } from "../../types/db";
import { Image as ImageIcon } from "lucide-react";

interface FilmstripDockProps {
  posts: Post[];
  selectedPostId: string | null;
  onSelect: (post: Post) => void;
  thumbFor: (post: Post) => string | null;
  title: string;
  hint?: string;
}

/**
 * The Workbench's bottom filmstrip: one thumbnail per post for the current
 * creator. Click to open in the canvas; the parent wires ← → to flip. Thumbs
 * lazy-load so a long strip doesn't fetch every image at once.
 */
export function FilmstripDock({ posts, selectedPostId, onSelect, thumbFor, title, hint }: FilmstripDockProps) {
  return (
    <div className="border-t bg-muted/20 flex-shrink-0">
      <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      <div className="flex gap-2.5 overflow-x-auto px-4 pb-3 media-scroll">
        {posts.map(post => {
          const active = post.id === selectedPostId;
          const thumb = thumbFor(post);
          return (
            <button
              key={post.id}
              onClick={() => onSelect(post)}
              title={post.title}
              className="w-24 flex-shrink-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              <div className={`h-[62px] rounded-md overflow-hidden border grid place-items-center bg-muted/40 ${active ? "ring-2 ring-primary border-transparent" : "border-border"}`}>
                {thumb ? (
                  <img src={thumb} loading="lazy" alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
                )}
              </div>
              <div className={`text-[10.5px] mt-1 truncate ${active ? "text-foreground" : "text-muted-foreground"}`}>
                {post.title || "Untitled"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
