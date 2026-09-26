import { useEffect, useRef } from "react";

interface ResizeDividerProps {
  currentWidth: number;
  min: number;
  max: number;
  onDrag: (newWidth: number) => void;
  onCommit: (newWidth: number) => void;
  /**
   * The element whose width this divider controls. When provided, the drag
   * writes `style.width` on it directly and never touches React state (P2-11):
   * a mousemove stream arrives at up to 125Hz, and one setState per event
   * re-rendered the whole library tree per event. Calls are coalesced into one
   * rAF, and the pane is resized by direct DOM write — zero renders while
   * dragging. Without a ref we fall back to the coalesced `onDrag` path, which
   * is still frame-aligned but does re-render.
   *
   * Known edge (accepted): if unrelated state re-renders the tree mid-drag,
   * React rewrites the pane's inline width from the stale `currentWidth` for
   * one frame; the next rAF restores it. A re-render during a drag is rare, and
   * the transient is a single frame.
   */
  paneRef?: React.RefObject<HTMLElement | null>;
}

export function ResizeDivider({ currentWidth, min, max, onDrag, onCommit, paneRef }: ResizeDividerProps) {
  const startX = useRef(0);
  const startWidth = useRef(0);
  // Latest width computed from mousemove, not yet applied to the DOM.
  const pendingWidth = useRef(0);
  const rafId = useRef<number | null>(null);
  // Lets the unmount cleanup detach the document listeners of an in-flight drag.
  const detachRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    detachRef.current?.();
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = currentWidth;

    const widthAt = (clientX: number) =>
      Math.min(max, Math.max(min, startWidth.current + clientX - startX.current));

    const apply = (width: number) => {
      const el = paneRef?.current;
      if (el) el.style.width = `${width}px`;
      else onDrag(width);
    };

    const flush = () => {
      rafId.current = null;
      apply(pendingWidth.current);
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingWidth.current = widthAt(e.clientX);
      if (rafId.current === null) rafId.current = requestAnimationFrame(flush);
    };

    const detach = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      detachRef.current = null;
    };

    const handleMouseUp = (e: MouseEvent) => {
      const finalWidth = widthAt(e.clientX);
      // Drop the queued frame and land the last width synchronously, so the
      // commit below can't race a still-pending paint.
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      apply(finalWidth);
      detach();
      onCommit(finalWidth);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    detachRef.current = detach;
  };

  return (
    <div
      className="w-2 flex-shrink-0 cursor-col-resize relative group select-none"
      onMouseDown={handleMouseDown}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-primary/60 transition-colors" />
    </div>
  );
}