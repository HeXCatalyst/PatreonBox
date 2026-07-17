import { Post, Asset } from "../../types/db";
import { formatPostDate } from "../../lib/formatDate";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, ExternalLink, Image as ImageIcon, Star } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { ImageLightbox } from "./ImageLightbox";
import { ImageGallery } from "./ImageGallery";
import { useTranslation } from "../../lib/i18n";

interface ReadingViewProps {
  post: Post | null;
  assets: Asset[];
  onToggleStar?: (post: Post, newStarred: boolean) => void;
}

export function ReadingView({ post, assets, onToggleStar }: ReadingViewProps) {
  const t = useTranslation();
  const [imagesDir, setImagesDir] = useState<string>("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLightboxClose = useCallback(() => setLightboxIndex(null), []);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }, []);

  useEffect(() => {
    invoke<string>("resolve_images_dir").then(setImagesDir).catch(console.error);
  }, []);

  const assetUrl = (path: string, version?: string | null) => {
    const base = convertFileSrc(`${imagesDir}/${path.replace(/^images\//, "")}`);
    // Cache-bust by download time so a re-downloaded file (e.g. a de-blurred
    // full-res replacement at the same path) isn't served from WebKit's cache.
    return version ? `${base}?v=${encodeURIComponent(version)}` : base;
  };

  if (!post) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-card text-muted-foreground text-center">
        <div className="bg-muted h-16 w-16 min-h-16 min-w-16 rounded-full flex items-center justify-center mb-4">
          <ImageIcon className="h-8 w-8 opacity-50" />
        </div>
        <h2 className="text-xl font-semibold mb-2 text-foreground">{t.readingView.noSelection}</h2>
        <p className="max-w-sm">
          {t.readingView.selectPostHint}
        </p>
      </div>
    );
  }

  const isImage = (filename: string) => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(filename);
  // Classify by extension — Patreon sometimes mis-declares a video's mimetype.
  const isVideo = (filename: string) => /\.(mp4|webm|mov|m4v|mkv)$/i.test(filename);

  const formatSize = (bytes: number | null) => {
    if (!bytes) return null;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getAssetIcon = (mimeType: string | null): string => {
    if (!mimeType) return "📎";
    if (mimeType === "application/pdf") return "📄";
    if (mimeType.includes("zip") || mimeType.includes("compressed") || mimeType.includes("x-tar")) return "📦";
    if (mimeType.includes("photoshop") || mimeType.endsWith("psd")) return "🎨";
    if (mimeType.startsWith("audio/")) return "🎵";
    return "📎";
  };

  const safeDateString = formatPostDate(post.published_at, t.common.unknownDate);
  const videoAssets  = assets.filter(a => isVideo(a.file_name));
  const imageAssets  = assets.filter(a => isImage(a.file_name));
  const audioAssets  = assets.filter(a => (a.mime_type?.startsWith("audio/") ?? false) && !isVideo(a.file_name));
  const fileAssets   = assets.filter(a => !isImage(a.file_name) && !isVideo(a.file_name) && !(a.mime_type?.startsWith("audio/") ?? false));
  // Carry the post's publish time onto each image so the lightbox can show when
  // the creator originally posted it (not just when we downloaded the file).
  const downloadedImages = imageAssets
    .filter(a => a.downloaded_at !== null)
    .map(a => ({ ...a, published_at: post.published_at }));

  return (
    <div className="flex-1 flex flex-col h-full bg-card overflow-hidden relative reading-glow">
      <ScrollArea className="flex-1">
        <div className="p-8 w-full">
          {/* Text keeps a comfortable reading measure; the media panel below
              breaks out wider (esp. in the roomy Workbench canvas). */}
          <div className="max-w-3xl mx-auto">
          <div className="mb-8">
            <h1 className="font-serif text-3xl font-bold mb-4 leading-tight break-words [text-wrap:balance]">{post.title}</h1>
            
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground post-byline">{post.creator_name}</span>
              
              <div className="flex items-center">
                <Calendar className="h-4 w-4 mr-1.5" />
                {safeDateString}
              </div>
              
              {post.source_url && (
                <a href={post.source_url} target="_blank" rel="noreferrer" className="flex items-center hover:text-foreground">
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  {t.readingView.original}
                </a>
              )}

              {onToggleStar && (
                <button
                  type="button"
                  aria-label={post.is_starred ? t.readingView.removeFromStarred : t.readingView.addToStarred}
                  aria-pressed={!!post.is_starred}
                  className="flex items-center hover:text-foreground"
                  onClick={() => onToggleStar(post, post.is_starred === 0)}
                >
                  <Star
                    className={`h-4 w-4 ${
                      post.is_starred
                        ? "fill-star text-star"
                        : "text-muted-foreground opacity-50"
                    }`}
                  />
                </button>
              )}
            </div>
          </div>
          
          <Separator className="mb-8" />
          
          {(post.content_rendered_html || post.content_raw) ? (
            <div className="prose prose-base dark:prose-invert max-w-none mb-12 font-serif leading-relaxed [--tw-prose-links:var(--link)] [--tw-prose-invert-links:var(--link)]"
              dangerouslySetInnerHTML={{ __html: post.content_rendered_html || post.content_raw! }}
            />
          ) : (
            <div className="mb-12 text-sm text-muted-foreground italic">
              {post.has_assets > 0 ? t.readingView.imagePostHint : t.readingView.noTextContent}
            </div>
          )}
          </div>

          {assets.length > 0 && (
            <div className="max-w-5xl mx-auto mt-8 border rounded-lg overflow-hidden bg-muted/20">
              {imageAssets.length > 0 && (
                <ImageGallery
                  assets={imageAssets}
                  downloadedImages={downloadedImages}
                  imagesDir={imagesDir}
                  totalCount={imageAssets.length}
                  onOpenLightbox={setLightboxIndex}
                  onSave={async (localPath) => {
                    await invoke("save_asset_to_downloads", { localPath });
                    showToast(t.readingView.savedToDownloads);
                  }}
                />
              )}
              {videoAssets.length > 0 && (
                <>
                  <div className="bg-muted px-4 py-3 font-medium flex items-center text-sm border-t first:border-t-0">
                    {t.readingView.videoHeading(videoAssets.length)}
                  </div>
                  <ul className="divide-y text-sm">
                    {videoAssets.map(asset => (
                      <li key={asset.id} className="p-4">
                        {asset.downloaded_at !== null ? (
                          <>
                            <div className="font-medium text-sm mb-2 truncate">{asset.file_name}</div>
                            <video
                              controls
                              playsInline
                              preload="metadata"
                              src={assetUrl(asset.local_path, asset.downloaded_at)}
                              onDoubleClick={e => { void e.currentTarget.requestFullscreen?.().catch(() => {}); }}
                              className="w-full max-h-[70vh] rounded bg-black mb-2"
                            />
                            <div className="flex gap-2 justify-end">
                              <button
                                className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted/50 transition-colors"
                                onClick={() => invoke("open_asset_in_system", { localPath: asset.local_path })}
                              >
                                {t.readingView.openInSystem}
                              </button>
                              <button
                                className="text-xs px-3 py-1.5 rounded border border-border bg-primary/10 hover:bg-primary/20 transition-colors"
                                onClick={async () => {
                                  await invoke("save_asset_to_downloads", { localPath: asset.local_path });
                                  showToast(t.readingView.savedToDownloads);
                                }}
                              >
                                {t.readingView.saveToDownloads}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-3 text-muted-foreground">
                            <span>🎬</span>
                            <span className="truncate text-sm">{asset.file_name}</span>
                            <span className="text-xs ml-auto">{t.readingView.notDownloaded}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {audioAssets.length > 0 && (
                <>
                  <div className="bg-muted px-4 py-3 font-medium flex items-center text-sm border-t first:border-t-0">
                    {t.readingView.audioHeading(audioAssets.length)}
                  </div>
                  <ul className="divide-y text-sm">
                    {audioAssets.map(asset => (
                      <li key={asset.id} className="p-4">
                        {asset.downloaded_at !== null ? (
                          <>
                            <div className="font-medium text-sm mb-2 truncate">{asset.file_name}</div>
                            <audio
                              controls
                              src={assetUrl(asset.local_path, asset.downloaded_at)}
                              className="w-full h-9 mb-2"
                            />
                            <div className="flex gap-2 justify-end">
                              <button
                                className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted/50 transition-colors"
                                onClick={() => invoke("open_asset_in_system", { localPath: asset.local_path })}
                              >
                                {t.readingView.openInSystem}
                              </button>
                              <button
                                className="text-xs px-3 py-1.5 rounded border border-border bg-primary/10 hover:bg-primary/20 transition-colors"
                                onClick={async () => {
                                  await invoke("save_asset_to_downloads", { localPath: asset.local_path });
                                  showToast(t.readingView.savedToDownloads);
                                }}
                              >
                                {t.readingView.saveToDownloads}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-3 text-muted-foreground">
                            <span>🎵</span>
                            <span className="truncate text-sm">{asset.file_name}</span>
                            <span className="text-xs ml-auto">{t.readingView.notDownloaded}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {fileAssets.length > 0 && (
                <>
                  <div className="bg-muted px-4 py-3 font-medium flex items-center text-sm border-t first:border-t-0">
                    {t.readingView.attachmentsHeading(fileAssets.length)}
                  </div>
                  <ul className="divide-y text-sm">
                    {fileAssets.map(asset => (
                      <li key={asset.id} className="p-4 flex items-center gap-3 hover:bg-muted/50 transition-colors">
                        <div className="bg-background border rounded h-10 w-10 min-h-10 min-w-10 flex items-center justify-center text-base flex-shrink-0">
                          {getAssetIcon(asset.mime_type)}
                        </div>
                        <div className="truncate flex-1 min-w-0">
                          <div className="font-medium truncate">{asset.file_name}</div>
                          <div className="text-muted-foreground text-xs mt-0.5">
                            {asset.mime_type || "file"}{formatSize(asset.byte_size) ? ` • ${formatSize(asset.byte_size)}` : ""}
                          </div>
                        </div>
                        {asset.downloaded_at !== null ? (
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted/50 transition-colors whitespace-nowrap"
                              onClick={() => invoke("open_asset_in_system", { localPath: asset.local_path })}
                            >
                              {t.readingView.openInSystem}
                            </button>
                            <button
                              className="text-xs px-3 py-1.5 rounded border border-border bg-primary/10 hover:bg-primary/20 transition-colors whitespace-nowrap"
                              onClick={async () => {
                                await invoke("save_asset_to_downloads", { localPath: asset.local_path });
                                showToast(t.readingView.savedToDownloads);
                              }}
                            >
                              {t.readingView.save}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground flex-shrink-0">{t.readingView.notDownloaded}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
      {lightboxIndex !== null && (
        <ImageLightbox
          images={downloadedImages}
          initialIndex={lightboxIndex}
          imagesDir={imagesDir}
          onClose={handleLightboxClose}
          onSaveSuccess={() => showToast(t.readingView.savedToDownloads)}
        />
      )}

      {/* Download success toast */}
      {toast && (
        <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center">
          <div className="bg-black/80 text-white rounded-lg px-6 py-3 text-sm font-medium shadow-xl border border-white/10">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
