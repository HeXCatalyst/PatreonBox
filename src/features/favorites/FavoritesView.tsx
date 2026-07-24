import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Star, Image as ImageIcon, FileText, ArrowDownWideNarrow, ArrowUpWideNarrow } from "lucide-react";
import { FavoriteAsset, Post } from "../../types/db";
import { getFavoriteMedia, getPosts, toggleFavoriteAsset, type FavoriteSort } from "../../lib/db";
import { ImageLightbox } from "../library/ImageLightbox";
import { useTranslation } from "../../lib/i18n";
import { assetUrl, useImagesDir } from "../../lib/assetUrl";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useSettings } from "../settings/SettingsContext";

interface FavoritesViewProps {
  onClose: () => void;
  onOpenPost: (creatorId: string, postId: string) => void;
}

const SORTS: FavoriteSort[] = ["favorited", "published", "added", "name", "size"];

// Own key, separate from the per-creator Media wall's — the favourites grid and
// a creator's grid are browsed at different densities, so their zoom shouldn't
// track each other.
const SIZE_KEY = "patreonbox-favorites-size";
const DEFAULT_SIZE = 150; // matches the grid's previous fixed minmax
const MIN_SIZE = 80;
const MAX_SIZE = 400;

/**
 * Favourites: starred posts and favourited images in one place. Media is global
 * across every creator by default, with a creator filter and sorting; images are
 * shown as a uniform square grid.
 */
export function FavoritesView({ onClose, onOpenPost }: FavoritesViewProps) {
  const t = useTranslation();
  const { settings } = useSettings();
  const [tab, setTab] = useState<"media" | "posts">("media");
  const [media, setMedia] = useState<FavoriteAsset[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const imagesDir = useImagesDir();
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<FavoriteSort>("favorited");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState<number>(() => {
    const stored = localStorage.getItem(SIZE_KEY);
    const n = stored ? parseInt(stored, 10) : DEFAULT_SIZE;
    return isNaN(n) ? DEFAULT_SIZE : n;
  });

  const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSize(val);
    localStorage.setItem(SIZE_KEY, String(val));
  };


  const loadMedia = useCallback(async () => {
    setLoading(true);
    try { setMedia(await getFavoriteMedia(creatorFilter, sort, dir)); }
    catch (e) { console.error("favorites load failed", e); setMedia([]); }
    finally { setLoading(false); }
  }, [creatorFilter, sort, dir]);

  useEffect(() => { if (!settings.demo_mode) loadMedia(); else { setMedia([]); setLoading(false); } }, [loadMedia, settings.demo_mode]);

  useEffect(() => {
    if (tab !== "posts" || settings.demo_mode) return;
    getPosts(undefined, "", true).then(setPosts).catch(console.error);
  }, [tab, settings.demo_mode]);

  // Creators present in the favourites set — drives the filter dropdown.
  const creators = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of media) m.set(a.creator_id, a.creator_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [media]);

  const urlFor = (a: FavoriteAsset) => assetUrl(imagesDir, a);

  const unfavorite = async (a: FavoriteAsset) => {
    setMedia(prev => prev.filter(m => m.id !== a.id));   // drop it from this view
    try { await toggleFavoriteAsset(a.id, null); }
    catch (e) { console.error("unfavorite failed", e); loadMedia(); }
  };

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
      {/* Header: back, tabs, filter + sort */}
      <div className="p-4 border-b flex items-center gap-3 flex-wrap bg-background">
        <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={onClose}>
          <ChevronLeft className="h-4 w-4" /> {t.settingsNav.backToLibrary}
        </button>

        <div className="h-7 flex items-center border rounded text-xs overflow-hidden flex-shrink-0 ml-1">
          <button
            onClick={() => setTab("media")}
            className={`px-3 h-full flex items-center gap-1 transition-colors ${tab === "media" ? "bg-secondary text-secondary-foreground font-medium" : "text-muted-foreground hover:bg-muted/50"}`}
          >
            <ImageIcon className="h-3.5 w-3.5" /> {t.favorites.mediaTab}
          </button>
          <button
            onClick={() => setTab("posts")}
            className={`px-3 h-full flex items-center gap-1 transition-colors ${tab === "posts" ? "bg-secondary text-secondary-foreground font-medium" : "text-muted-foreground hover:bg-muted/50"}`}
          >
            <FileText className="h-3.5 w-3.5" /> {t.favorites.postsTab}
          </button>
        </div>

        <span className="text-xs text-muted-foreground flex-shrink-0">
          {tab === "media" ? t.favorites.countMedia(media.length) : t.favorites.countPosts(posts.length)}
        </span>

        {tab === "media" && (
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <select
              value={creatorFilter ?? ""}
              onChange={e => setCreatorFilter(e.target.value || null)}
              className="h-7 text-xs px-2 border rounded bg-background text-foreground"
              title={t.favorites.filterCreator}
            >
              <option value="">{t.favorites.allCreators}</option>
              {creators.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>

            <select
              value={sort}
              onChange={e => setSort(e.target.value as FavoriteSort)}
              className="h-7 text-xs px-2 border rounded bg-background text-foreground"
              title={t.favorites.sortBy}
            >
              {SORTS.map(s => <option key={s} value={s}>{t.favorites.sortName(s)}</option>)}
            </select>

            <ToolbarButton
              onClick={() => setDir(d => (d === "desc" ? "asc" : "desc"))}
              title={dir === "desc" ? t.favorites.desc : t.favorites.asc}
            >
              {dir === "desc" ? <ArrowDownWideNarrow className="h-3.5 w-3.5" /> : <ArrowUpWideNarrow className="h-3.5 w-3.5" />}
              {dir === "desc" ? t.favorites.desc : t.favorites.asc}
            </ToolbarButton>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t.imageGallery.small}</span>
              <input
                type="range" min={MIN_SIZE} max={MAX_SIZE} step="8"
                value={size}
                onChange={handleSizeChange}
                className="w-20 h-1 accent-primary cursor-pointer"
                title={t.favorites.thumbnailSize}
              />
              <span className="text-xs text-muted-foreground">{t.imageGallery.large}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto media-scroll">
        {tab === "media" ? (
          loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{t.mediaView.loading}</div>
          ) : media.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{t.favorites.emptyMedia}</div>
          ) : (
            <div className="p-3 grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
              {media.map((a, i) => (
                <div key={a.id} className="relative group rounded overflow-hidden bg-muted/20" style={{ aspectRatio: "1" }}>
                  <img
                    src={urlFor(a) ?? undefined}
                    alt={a.file_name}
                    className="w-full h-full object-cover cursor-pointer"
                    decoding="async"
                    draggable={false}
                    onClick={() => setLightboxIndex(i)}
                  />
                  <button
                    className="absolute top-1.5 right-1.5 rounded-full p-1 bg-black/50 hover:bg-black/70 transition-colors"
                    title={t.mediaView.unfavorite}
                    onClick={e => { e.stopPropagation(); void unfavorite(a); }}
                  >
                    <Star className="h-3 w-3 fill-star text-star" />
                  </button>
                  {/* Creator + date caption on hover — matters in the global view */}
                  <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/75 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="text-[10px] text-white truncate">{a.creator_name}</div>
                    <div className="text-[9px] text-white/60 truncate tabular-nums">{fmtDate(a.favorited_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : posts.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t.favorites.emptyPosts}</div>
        ) : (
          <ul className="divide-y">
            {posts.map(p => (
              <li key={p.id}>
                <button
                  onClick={() => onOpenPost(p.creator_id, p.id)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Star className="h-3.5 w-3.5 fill-star text-star flex-shrink-0" />
                    <span className="font-medium truncate">{p.title || "Untitled"}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground flex gap-3">
                    <span className="truncate">{p.creator_name}</span>
                    <span className="tabular-nums flex-shrink-0">{fmtDate(p.published_at)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lightboxIndex !== null && media.length > 0 && (
        <ImageLightbox
          images={media}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
