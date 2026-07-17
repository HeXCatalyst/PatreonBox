import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronsUp, ChevronsDown } from "lucide-react";
import { Asset } from "../../types/db";
import { useSettings } from "../settings/SettingsContext";
import { useTranslation } from "../../lib/i18n";

interface MediaTimeScrubberProps {
  media: Asset[];                          // date-descending; each carries published_at
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollTop: number;                       // parent's live scrollTop → drives pill
  rowH: number;                            // one grid row's height in px
  cols: number;                            // columns in the grid
  canScrub: boolean;                       // enough content to be worth scrubbing
  wheelOpen: boolean;                      // the month wheel is showing
  onCloseWheel: () => void;
}

// Drum geometry — a UIDatePicker-style cylinder.
const ANGLE = 18;                          // degrees between adjacent items
const ITEM_H = 34;                         // px height of one wheel row
const RADIUS = (ITEM_H / 2) / Math.tan((ANGLE / 2) * Math.PI / 180);
const PAD = 34;                            // pill track padding — leaves room for the top/bottom jump buttons

interface MonthMark { y: number; m: number; startIdx: number; }

/**
 * The Media view's time browser: a frosted date pill (iOS Photos-style) that
 * floats at the right edge — draggable up/down to fast-scroll — plus a month
 * wheel (UIDatePicker-style drum) for jumping across the whole timeline. Both
 * read the assets' `published_at`, so what you see is the creator's original
 * post date, not the download time.
 */
export function MediaTimeScrubber({
  media, scrollRef, scrollTop, rowH, cols, canScrub, wheelOpen, onCloseWheel,
}: MediaTimeScrubberProps) {
  const { settings } = useSettings();
  const t = useTranslation();
  const zh = (settings.language ?? "zh") === "zh";

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Group consecutive assets into month marks (the wheel's rows + timeline).
  const months = useMemo<MonthMark[]>(() => {
    const out: MonthMark[] = [];
    let key = "";
    media.forEach((a, i) => {
      if (!a.published_at) return;
      const d = new Date(a.published_at);
      if (isNaN(d.getTime())) return;
      const y = d.getFullYear(), m = d.getMonth();
      const k = `${y}-${m}`;
      if (k !== key) { out.push({ y, m, startIdx: i }); key = k; }
    });
    return out;
  }, [media]);

  const monthLabel = (m: number) => zh ? `${m + 1}月` : new Date(2000, m, 1).toLocaleString("en", { month: "short" });
  const rowLabel = (mk: MonthMark) => zh ? `${mk.y} ${mk.m + 1}月` : `${monthLabel(mk.m)} ${mk.y}`;

  const maxScroll = () => {
    const el = scrollRef.current;
    return el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
  };
  const frac = () => { const mx = maxScroll(); return mx > 0 ? Math.min(1, Math.max(0, scrollTop / mx)) : 0; };

  // The asset at the top of the viewport → the pill's date.
  const topIdx = Math.min(media.length - 1, Math.max(0, Math.floor(scrollTop / rowH) * cols));
  const topDate = media[topIdx]?.published_at ? new Date(media[topIdx].published_at!) : null;

  // --- Pill visibility: hovering the strip, dragging, or recently scrolled. ---
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scrolledRecently, setScrolledRecently] = useState(false);
  const idleTimer = useRef<number | null>(null);
  useEffect(() => {
    setScrolledRecently(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setScrolledRecently(false), 700);
    return () => { if (idleTimer.current) window.clearTimeout(idleTimer.current); };
  }, [scrollTop]);

  const pillVisible = canScrub && (hovering || dragging || scrolledRecently);

  const H = containerRef.current?.clientHeight ?? 0;
  const pillTop = PAD + frac() * Math.max(0, H - PAD * 2);

  // Drag the pill (or the rail) up/down → scroll the grid.
  const scrubToClientY = (clientY: number) => {
    const box = containerRef.current?.getBoundingClientRect();
    const el = scrollRef.current;
    if (!box || !el) return;
    const f = Math.min(1, Math.max(0, (clientY - box.top - PAD) / Math.max(1, box.height - PAD * 2)));
    el.scrollTop = f * maxScroll();
  };
  const onPillPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    scrubToClientY(e.clientY);
  };
  const onPillPointerMove = (e: React.PointerEvent) => { if (dragging) scrubToClientY(e.clientY); };
  const onPillPointerUp = (e: React.PointerEvent) => {
    setDragging(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const jumpTop = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const jumpBottom = () => { if (scrollRef.current) scrollRef.current.scrollTop = maxScroll(); };

  // --- Month wheel (drum) ---
  const [current, setCurrent] = useState(0); // fractional index into `months`
  const wheelDrag = useRef<{ startY: number; startCur: number } | null>(null);

  // On open, spin to whatever month is currently on top of the grid.
  useEffect(() => {
    if (!wheelOpen || months.length === 0) return;
    let mi = 0;
    for (let i = 0; i < months.length; i++) { if (months[i].startIdx <= topIdx) mi = i; else break; }
    setCurrent(mi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheelOpen]);

  const jumpToMonth = (mi: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const mk = months[Math.max(0, Math.min(months.length - 1, mi))];
    if (!mk) return;
    el.scrollTop = Math.floor(mk.startIdx / cols) * rowH;
  };

  const onWheelDone = () => { jumpToMonth(Math.round(current)); onCloseWheel(); };
  const onDrumPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    wheelDrag.current = { startY: e.clientY, startCur: current };
  };
  const onDrumPointerMove = (e: React.PointerEvent) => {
    const d = wheelDrag.current;
    if (!d) return;
    const next = d.startCur - (e.clientY - d.startY) / (ITEM_H * 0.9);
    setCurrent(Math.max(0, Math.min(months.length - 1, next)));
  };
  const onDrumPointerUp = (e: React.PointerEvent) => {
    if (wheelDrag.current) setCurrent(c => Math.round(Math.max(0, Math.min(months.length - 1, c))));
    wheelDrag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onDrumWheel = (e: React.WheelEvent) => {
    setCurrent(c => Math.max(0, Math.min(months.length - 1, Math.round(c) + Math.sign(e.deltaY))));
  };

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none z-20">
      {/* Frosted date pill — the draggable fast-scroll handle */}
      {canScrub && topDate && (
        <div
          onPointerDown={onPillPointerDown}
          onPointerMove={onPillPointerMove}
          onPointerUp={onPillPointerUp}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          style={{ top: pillTop, transform: "translateY(-50%)" }}
          className={`absolute right-3 select-none flex flex-col items-end leading-tight
            rounded-2xl px-4 py-2 border border-white/15 bg-black/50 backdrop-blur-xl
            shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)] text-white
            ${dragging ? "cursor-grabbing" : "cursor-grab"}
            ${pillVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
            transition-opacity duration-200`}
        >
          <span className="text-lg font-bold tracking-tight tabular-nums">{monthLabel(topDate.getMonth())}</span>
          <span className="text-[11px] font-semibold text-white/60 tabular-nums">{topDate.getFullYear()}</span>
        </div>
      )}

      {/* Quick jump: to newest (top) / oldest (bottom) */}
      {canScrub && (
        <>
          <button
            onClick={jumpTop}
            onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}
            title={t.mediaView.scrollToTop}
            className={`absolute right-2.5 top-1.5 grid place-items-center h-7 w-7 rounded-full border border-white/15
              bg-black/50 backdrop-blur-xl text-white/80 hover:text-white shadow-[0_6px_18px_-8px_rgba(0,0,0,0.7)]
              transition-opacity duration-200 ${pillVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          >
            <ChevronsUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={jumpBottom}
            onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}
            title={t.mediaView.scrollToBottom}
            className={`absolute right-2.5 bottom-1.5 grid place-items-center h-7 w-7 rounded-full border border-white/15
              bg-black/50 backdrop-blur-xl text-white/80 hover:text-white shadow-[0_6px_18px_-8px_rgba(0,0,0,0.7)]
              transition-opacity duration-200 ${pillVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          >
            <ChevronsDown className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {/* Hover strip: a faint spine so the right edge reads as draggable */}
      {canScrub && (
        <div
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          className="absolute top-2 bottom-2 right-1.5 w-4 pointer-events-auto"
        >
          <div className={`absolute inset-y-0 right-0 w-[3px] rounded-full bg-white/10 transition-opacity duration-200 ${hovering || dragging ? "opacity-100" : "opacity-0"}`} />
        </div>
      )}

      {/* Month wheel (drum) */}
      {wheelOpen && months.length > 0 && (
        <div
          className="absolute inset-0 pointer-events-auto z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) onWheelDone(); }}
        >
          <div className="w-[260px] rounded-3xl border border-white/15 bg-neutral-900/75 backdrop-blur-2xl shadow-[0_30px_70px_-20px_rgba(0,0,0,0.8)] p-3 pt-2.5">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-xs font-semibold text-white/50">{t.mediaView.jumpToMonth}</span>
              <button onClick={onWheelDone} className="text-sm font-bold" style={{ color: "var(--navy, #5b93cc)" }}>
                {t.mediaView.wheelDone}
              </button>
            </div>
            <div className="relative">
              <div
                onPointerDown={onDrumPointerDown}
                onPointerMove={onDrumPointerMove}
                onPointerUp={onDrumPointerUp}
                onWheel={onDrumWheel}
                className="relative h-[200px] overflow-hidden touch-none cursor-grab"
                style={{
                  WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 26%, #000 74%, transparent)",
                  maskImage: "linear-gradient(to bottom, transparent, #000 26%, #000 74%, transparent)",
                }}
              >
                <div className="absolute left-0 right-0 top-1/2" style={{ perspective: "900px", transformStyle: "preserve-3d" }}>
                  {months.map((mk, i) => {
                    const theta = (i - current) * ANGLE;
                    if (Math.abs(theta) > 90) return null;
                    const opacity = Math.max(0.18, 1 - Math.abs(theta) / 90);
                    return (
                      <div
                        key={`${mk.y}-${mk.m}`}
                        className="absolute left-0 right-0 flex items-center justify-center text-white font-semibold text-[19px] tracking-tight tabular-nums"
                        style={{
                          height: ITEM_H, marginTop: -ITEM_H / 2, opacity,
                          transform: `rotateX(${theta}deg) translateZ(${RADIUS}px)`,
                          backfaceVisibility: "hidden",
                        }}
                      >
                        {rowLabel(mk)}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* center selection band */}
              <div className="pointer-events-none absolute left-1.5 right-1.5 top-1/2 -translate-y-1/2 rounded-lg border-y border-white/20 bg-white/[0.05]" style={{ height: ITEM_H }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
