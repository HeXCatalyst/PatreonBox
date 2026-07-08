import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { Image as ImageIcon, Download, ArrowDownWideNarrow, ArrowUpWideNarrow, FileText } from "lucide-react";
import { Asset } from "../../types/db";
import { getCreatorMedia } from "../../lib/db";
import { getDemoPosts, getDemoAssets } from "../../lib/demoData";
import { ImageLightbox } from "./ImageLightbox";
import { useTranslation } from "../../lib/i18n";

const IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;
const SIZE_KEY = "patreonbox-media-size";
const DEFAULT_SIZE = 140;

type Order = "desc" | "asc";

interface MediaViewProps {
  creatorId: string;
  creatorName: string;
  order: Order;
  onOrderChange: (order: Order) => void;
  onShowPosts: () => void;
  demoMode: boolean;
}

/** Aggregate a demo creator's downloaded images across all posts, date-ordered. */
function loadDemoMedia(creatorId: string, order: Order): Asset[] {
  const posts = [...getDemoPosts(creatorId)].sort((a, b) => {
    const cmp = (a.published_at ?? "").localeCompare(b.published_at ?? "");
    return order === "asc" ? cmp : -cmp;
  });
  return posts
    .flatMap(p => getDemoAssets(p.id))
    .filter(a => a.downloaded_at !== null && IMAGE_RE.test(a.file_name));
}

export function MediaView({ creatorId, creatorName, order, onOrderChange, onShowPosts, demoMode }: MediaViewProps) {
  const t = useTranslation();
  const [media, setMedia] = useState<Asset[]>([]);
  const [imagesDir, setImagesDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [size, setSize] = useState<number>(() => {
    const stored = localStorage.getItem(SIZE_KEY);
    return stored ? parseInt(stored, 10) : DEFAULT_SIZE;
  });

  useEffect(() => {
    invoke<string>("resolve_images_dir").then(setImagesDir).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const items = demoMode ? loadDemoMedia(creatorId, order) : await getCreatorMedia(creatorId, order);
        if (!cancelled) setMedia(items);
      } catch (e) {
        console.error("Failed to load creator media", e);
        if (!cancelled) setMedia([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [creatorId, order, demoMode]);

  const getUrl = useCallback((asset: Asset) => {
    if (!imagesDir) return "";
    return convertFileSrc(`${imagesDir}/${asset.local_path.replace(/^images\//, "")}`);
  }, [imagesDir]);

  const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSize(val);
    localStorage.setItem(SIZE_KEY, String(val));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
      {/* Header: tab toggle + count (left), sort + size (right) */}
      <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap bg-background">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-7 flex items-center border rounded text-xs bg-background overflow-hidden flex-shrink-0">
            <button
              onClick={onShowPosts}
              className="px-3 h-full flex items-center gap-1 text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              {t.mediaView.postsTab}
            </button>
            <button
              className="px-3 h-full flex items-center gap-1 bg-secondary text-secondary-foreground font-medium"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {t.mediaView.mediaTab}
            </button>
          </div>
          <h2 className="font-semibold truncate min-w-0">{creatorName}</h2>
          {!loading && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {t.mediaView.count(media.length)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => onOrderChange(order === "desc" ? "asc" : "desc")}
            className="h-7 px-2.5 flex items-center gap-1.5 border rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title={order === "desc" ? t.mediaView.newestFirst : t.mediaView.oldestFirst}
          >
            {order === "desc"
              ? <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              : <ArrowUpWideNarrow className="h-3.5 w-3.5" />}
            {order === "desc" ? t.mediaView.newestFirst : t.mediaView.oldestFirst}
          </button>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t.imageGallery.small}</span>
            <input
              type="range" min="80" max="400" step="8"
              value={size}
              onChange={handleSizeChange}
              className="w-20 h-1 accent-primary cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">{t.imageGallery.large}</span>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t.mediaView.loading}</div>
        ) : media.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t.mediaView.empty}</div>
        ) : (
          <div
            className="p-3"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(min(${size}px, 100%), 1fr))`,
              gap: "4px",
            }}
          >
            {media.map((asset, idx) => (
              <div key={asset.id} className="relative group" style={{ aspectRatio: "1" }}>
                <img
                  src={getUrl(asset)}
                  alt={asset.file_name}
                  className="w-full h-full object-cover rounded cursor-pointer"
                  loading="lazy"
                  onClick={() => setLightboxIndex(idx)}
                />
                <button
                  className="absolute bottom-1.5 right-1.5 bg-black/50 hover:bg-black/70 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t.imageGallery.saveToDownloads}
                  onClick={e => { e.stopPropagation(); invoke("save_asset_to_downloads", { localPath: asset.local_path }).catch(console.error); }}
                >
                  <Download className="h-3 w-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          images={media}
          initialIndex={lightboxIndex}
          imagesDir={imagesDir}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
