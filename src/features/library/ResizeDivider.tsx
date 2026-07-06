import { useRef } from "react";

interface ResizeDividerProps {
  currentWidth: number;
  min: number;
  max: number;
  onDrag: (newWidth: number) => void;
  onCommit: (newWidth: number) => void;
}

export function ResizeDivider({ currentWidth, min, max, onDrag, onCommit }: ResizeDividerProps) {
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = currentWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(max, Math.max(min, startWidth.current + e.clientX - startX.current));
      onDrag(newWidth);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const newWidth = Math.min(max, Math.max(min, startWidth.current + e.clientX - startX.current));
      onCommit(newWidth);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
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
