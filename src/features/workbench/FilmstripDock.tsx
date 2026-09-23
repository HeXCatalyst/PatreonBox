import { Asset } from "../../types/db";
import { Image as ImageIcon } from "lucide-react";
import { memo, useEffect, useRef, type ReactNode } from "react";
import { ThumbWithFallback } from "../library/ThumbWithFallback";

/**
 * What a filmstrip cell actually reads (P1-5): an id to select by and a title to
 * show. The strip used to be handed full `Post` rows — every column of every
 * post — purely for these two fields; the root now sends the lightweight index
 * (`getPostIndex`) and the canvas fetches whichever post is opened.
 */
export interface FilmstripPost {
  id: string;
  title: string;
}

interface FilmstripDockProps {
  posts: FilmstripPost[];
  selectedPostId: string | null;
  onSelect: (post: FilmstripPost) => void;
  /** Returns the asset whose thumbnail should be shown for a post, or null. */
  thumbFor: (post: { id: string }) => Asset | null;
  imagesDir: string;
  title: string;
  hint?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  emptyText?: string;
}

/**
 * One cell of the strip.
 *
 * Memoized because the strip holds a cell per post — a creator with a few
 * thousand posts is a few thousand cells — and the strip re-renders as a whole
 * every time the selection moves. With the cell memoized, clicking a post
 * re-renders only the two cells whose `active` flag actually flipped; everything
 * else keeps its previous element. That also stops `thumbFor()` (and the asset
 * URL it builds) from running a few thousand times per selection.
 *
 * All five props are stable across a selection change: `post`, `onSelect`,
 * `thumbFor` and `imagesDir` keep their identity, and only `active` flips.
 */
const FilmstripCell = memo(function FilmstripCell({
  post,
  active,
  onSelect,
  thumbFor,
  imagesDir,
}: {
  post: FilmstripPost;
  active: boolean;
  onSelect: (post: FilmstripPost) => void;
  thumbFor: (post: { id: string }) => Asset | null;
  imagesDir: string;
}) {
  const asset = thumbFor(post);

  return (
    <button
      onClick={() => onSelect(post)}
      title={post.title}
      // Off-screen cells skip layout and paint: with a cell per post, a long
      // strip otherwise keeps thousands of boxes laid out at once.
      // `contain-intrinsic-size` stands in for the skipped box so the scroll
      // width stays put as cells come into range (96px = the cell's w-24; the
      // height is nominal, since the row's flex stretch decides it anyway).
      // Engines without content-visibility simply ignore both properties.
      style={{ contentVisibility: "auto", containIntrinsicSize: "96px 84px" }}
      className="w-24 flex-shrink-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
    >
      <div className={`h-[62px] rounded-md overflow-hidden border grid place-items-center bg-muted/40 ${active ? "ring-2 ring-primary border-transparent" : "border-border"}`}>
        {asset ? (
          <ThumbWithFallback
            imagesDir={imagesDir}
            asset={asset}
            alt={post.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>
      <div className={`text-[10.5px] mt-1 truncate ${active ? "text-foreground" : "text-muted-foreground"}`}>
        {post.title || "Untitled"}
      </div>
    </button>
  );
});

/**
 * The Workbench's bottom filmstrip: one thumbnail per post for the current
 * creator. Click to open in the canvas; the parent wires ← → to flip. Thumbs
 * lazy-load so a long strip doesn't fetch every image at once.
 *
 * Memoized so the strip survives re-renders of the workbench that don't touch
 * its own props (sync progress, download-status badges, creator reloads): the
 * post list and the callbacks below it are stable, so a re-render of the
 * workbench is not allowed to walk a few thousand cells.
 */
export const FilmstripDock = memo(function FilmstripDock({ posts, selectedPostId, onSelect, thumbFor, imagesDir, title, hint, leading, actions, emptyText }: FilmstripDockProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Turn a vertical wheel (mouse) into horizontal scroll across the strip, while
  // leaving native horizontal input (trackpad swipe) untouched. Registered as a
  // non-passive native listener because React's synthetic onWheel is passive and
  // can't call preventDefault.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // let real horizontal pass
      if (el.scrollWidth <= el.clientWidth) return;         // nothing to scroll
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="border-t bg-muted/20 flex-shrink-0">
      <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {leading}
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">{title}</span>
          {actions}
        </div>
        {hint && <span className="text-[11px] text-muted-foreground/70 flex-shrink-0">{hint}</span>}
      </div>
      {posts.length === 0 && emptyText && (
        <div className="px-4 pb-3 text-xs text-muted-foreground">{emptyText}</div>
      )}
      <div ref={scrollRef} className="flex gap-2.5 overflow-x-auto px-4 pb-3 media-scroll">
        {posts.map(post => (
          <FilmstripCell
            key={post.id}
            post={post}
            active={post.id === selectedPostId}
            onSelect={onSelect}
            thumbFor={thumbFor}
            imagesDir={imagesDir}
          />
        ))}
      </div>
    </div>
  );
});