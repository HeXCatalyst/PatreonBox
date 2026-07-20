import { Asset } from "../../types/db";
import { Image as ImageIcon, Download } from "lucide-react";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../../lib/i18n";
import { assetUrl, useImagesDir } from "../../lib/assetUrl";

const STORAGE_KEY = "patreonbox-gallery-rowh";
const DEFAULT_ROW_H = 220;
const GAP = 4;   // px between images
const PAD = 12;  // container padding (p-3)

interface ImageGalleryProps {
  assets: Asset[];           // image assets only
  downloadedImages: Asset[]; // assets with downloaded_at !== null, for lightbox index lookup
  totalCount: number;
  onOpenLightbox: (index: number) => void;
  onSave: (localPath: string) => void;
}

/**
 * A justified image gallery (Flickr / Google Photos style): every image keeps its
 * true aspect ratio, and each row is scaled to fill the width at a common height —
 * so tall sticker-sheets and wide comics show whole, with no square-crop letterbox.
 * Aspect ratios are measured on load (galleries are small); the slider tunes the
 * target row height (density).
 */
export function ImageGallery({ assets, downloadedImages, totalCount, onOpenLightbox, onSave }: ImageGalleryProps) {
  const t = useTranslation();
  const imagesDir = useImagesDir();
  const [rowH, setRowH] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const n = stored ? parseInt(stored, 10) : DEFAULT_ROW_H;
    return isNaN(n) ? DEFAULT_ROW_H : n;
  });
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.clientWidth - PAD * 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const getAssetUrl = useCallback((asset: Asset) => assetUrl(imagesDir, asset), [imagesDir]);

  const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setRowH(val);
    localStorage.setItem(STORAGE_KEY, String(val));
  };

  // Aspect (w/h) for an asset: measured once loaded; a gentle default until then
  // (portrait-ish for not-yet-downloaded placeholders so the row heights settle).
  const aspectOf = (a: Asset) => aspects[a.id] ?? (a.downloaded_at ? 1 : 0.82);

  // Greedy justified row packing: fill a row until it overflows the width, then
  // scale that row to fit exactly. The final row keeps the target height.
  const rows = useMemo(() => {
    const out: { items: { a: Asset; asp: number }[]; sum: number; last: boolean }[] = [];
    let row: { a: Asset; asp: number }[] = [];
    let sum = 0;
    for (const a of assets) {
      const asp = Math.max(0.2, Math.min(4, aspectOf(a)));
      row.push({ a, asp });
      sum += asp;
      if (containerW > 0 && sum * rowH + GAP * (row.length - 1) >= containerW) {
        out.push({ items: row, sum, last: false });
        row = []; sum = 0;
      }
    }
    if (row.length) out.push({ items: row, sum, last: true });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, aspects, rowH, containerW]);

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
            min="120"
            max="380"
            step="10"
            value={rowH}
            onChange={handleSizeChange}
            className="w-24 h-1 accent-primary cursor-pointer"
          />
          <span className="text-xs text-muted-foreground">{t.imageGallery.large}</span>
        </div>
      </div>
      <div ref={containerRef} className="p-3 flex flex-col" style={{ gap: `${GAP}px` }}>
        {rows.map((r, ri) => {
          const h = r.last
            ? rowH
            : (containerW - GAP * (r.items.length - 1)) / r.sum;
          return (
            <div key={ri} className="flex" style={{ gap: `${GAP}px`, height: h }}>
              {r.items.map(({ a: asset, asp }) => {
                const downloaded = asset.downloaded_at !== null;
                const lightboxIdx = downloaded ? downloadedImages.findIndex(x => x.id === asset.id) : -1;
                const w = h * asp;
                if (downloaded) {
                  return (
                    <div key={asset.id} className="relative group flex-shrink-0 overflow-hidden rounded" style={{ width: w, height: h }}>
                      <img
                        src={getAssetUrl(asset) ?? undefined}
                        alt={asset.file_name}
                        className="w-full h-full object-cover cursor-pointer"
                        decoding="async"
                        onLoad={e => {
                          const el = e.currentTarget;
                          if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                            const ratio = el.naturalWidth / el.naturalHeight;
                            setAspects(prev => (Math.abs((prev[asset.id] ?? 0) - ratio) < 0.001 ? prev : { ...prev, [asset.id]: ratio }));
                          }
                        }}
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
                    className="rounded bg-muted/30 border border-dashed flex items-center justify-center flex-shrink-0"
                    style={{ width: w, height: h }}
                  >
                    <ImageIcon className="h-6 w-6 text-muted-foreground opacity-30" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
