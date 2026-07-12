import { Asset } from "../../types/db";
import { Image as ImageIcon, Download } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useState, useCallback } from "react";
import { useTranslation } from "../../lib/i18n";

const STORAGE_KEY = "patreonbox-gallery-size";
const DEFAULT_SIZE = 150;

interface ImageGalleryProps {
  assets: Asset[];           // image assets only
  downloadedImages: Asset[]; // assets with downloaded_at !== null, for lightbox index lookup
  imagesDir: string;
  totalCount: number;
  onOpenLightbox: (index: number) => void;
  onSave: (localPath: string) => void;
}

export function ImageGallery({ assets, downloadedImages, imagesDir, totalCount, onOpenLightbox, onSave }: ImageGalleryProps) {
  const t = useTranslation();
  const [size, setSize] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : DEFAULT_SIZE;
  });

  const getAssetUrl = useCallback((asset: Asset) => {
    if (!imagesDir) return "";
    const base = convertFileSrc(`${imagesDir}/${asset.local_path.replace(/^images\//, "")}`);
    // Cache-bust by download time so a re-downloaded file (e.g. a de-blurred
    // full-res replacement at the same path) isn't served from WebKit's cache.
    return asset.downloaded_at ? `${base}?v=${encodeURIComponent(asset.downloaded_at)}` : base;
  }, [imagesDir]);

  const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSize(val);
    localStorage.setItem(STORAGE_KEY, String(val));
  };

  return (
    <div>
      <div className="bg-muted px-4 py-3 font-medium flex items-center justify-between">
        <div className="flex items-center">
          <ImageIcon className="h-4 w-4 mr-2" />
          {t.imageGallery.imagesHeading(totalCount)}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t.imageGallery.small}</span>
          <input
            type="range"
            min="80"
            max="800"
            step="8"
            value={size}
            onChange={handleSizeChange}
            className="w-24 h-1 accent-primary cursor-pointer"
          />
          <span className="text-xs text-muted-foreground">{t.imageGallery.large}</span>
        </div>
      </div>
      <div
        className="p-3"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(min(${size}px, 100%), 1fr))`,
          gap: "4px",
        }}
      >
        {assets.map(asset => {
          const downloaded = asset.downloaded_at !== null;
          const lightboxIdx = downloaded ? downloadedImages.findIndex(a => a.id === asset.id) : -1;

          if (downloaded) {
            return (
              <div key={asset.id} className="relative group" style={{ aspectRatio: "1" }}>
                <img
                  src={getAssetUrl(asset)}
                  alt={asset.file_name}
                  className="w-full h-full object-cover rounded cursor-pointer"
                  loading="lazy"
                  onClick={() => { if (lightboxIdx >= 0) onOpenLightbox(lightboxIdx); }}
                />
                <button
                  className="absolute bottom-1.5 right-1.5 bg-black/50 hover:bg-black/70 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t.imageGallery.saveToDownloads}
                  onClick={e => { e.stopPropagation(); onSave(asset.local_path); }}
                >
                  <Download className="h-3 w-3 text-white" />
                </button>
              </div>
            );
          }

          return (
            <div
              key={asset.id}
              className="rounded bg-muted/30 border border-dashed flex items-center justify-center"
              style={{ aspectRatio: "1" }}
            >
              <ImageIcon className="h-6 w-6 text-muted-foreground opacity-30" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
