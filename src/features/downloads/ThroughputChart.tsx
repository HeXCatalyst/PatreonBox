import { useEffect, useRef } from "react";
import { WINDOW_SAMPLES, type ThroughputSample } from "./useThroughput";

interface ThroughputChartProps {
  samples: ThroughputSample[];
  height?: number;
}

/** Read a CSS custom property off an element, with a fallback. */
function token(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Network throughput as a filled area with disk write as a hairline over it.
 *
 * Deliberately not two filled areas. Downloads stream straight to disk, so the
 * two series normally agree almost exactly — stacking two fills would produce
 * one muddy shape and imply two independent signals. With one fill and one line,
 * agreement reads as the line hugging the fill edge, and it's the *divergence*
 * that carries information: line above fill is a flush or rename landing, fill
 * with no line underneath it means bytes are arriving but not reaching disk.
 *
 * Canvas rather than SVG: this repaints every second for as long as the page is
 * open, and swapping ~120 path points through the DOM each time is wasteful.
 */
export function ThroughputChart({ samples, height = 92 }: ThroughputChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The y-axis ceiling eases toward the target instead of snapping, so a single
  // spike doesn't visibly rescale the whole history under the viewer.
  const ceiling = useRef(512 * 1024);
  // The observer is wired once, but it has to call the *current* draw, which
  // closes over the latest samples. Without this indirection the effect would
  // need `samples` in its deps and would tear down and rebuild the observer on
  // every one-second tick.
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w <= 0 || h <= 0) return;

      // Cap DPR at 2: past that the extra pixels cost real paint time and buy
      // nothing visible on a 92px-tall sparkline.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const styles = canvas;
      const netColor = token(styles, "--primary", "#a3e12b");
      const diskColor = token(styles, "--link", "#5b93cc");
      const gridColor = token(styles, "--border", "#2a2f34");

      const peak = samples.reduce((m, s) => Math.max(m, s.net, s.disk), 0);
      const target = Math.max(peak * 1.25, 512 * 1024);
      ceiling.current += (target - ceiling.current) * 0.25;
      const max = ceiling.current;

      // Always plot a full window so the chart scrolls in from the right as
      // history accumulates, rather than stretching a few points across the width.
      const xAt = (i: number) => (i / (WINDOW_SAMPLES - 1)) * w;
      const yAt = (v: number) => h - 2 - (v / max) * (h - 8);
      const offset = WINDOW_SAMPLES - samples.length;

      ctx.strokeStyle = gridColor;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      for (let g = 1; g <= 2; g++) {
        const y = Math.round((h / 3) * g) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (samples.length < 2) return;

      // Network: filled area + stroke.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xAt(offset), h);
      samples.forEach((s, i) => ctx.lineTo(xAt(offset + i), yAt(s.net)));
      ctx.lineTo(xAt(WINDOW_SAMPLES - 1), h);
      ctx.closePath();
      ctx.globalAlpha = 0.24;
      // The colour comes from a theme token, which is hex under the named colour
      // themes but oklch() under the default one. strokeStyle ignores a value it
      // can't parse, but addColorStop throws — and an exception here would kill
      // the whole frame, not just the fade. Solid tint is the fallback.
      try {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, netColor);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
      } catch {
        ctx.fillStyle = netColor;
      }
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      samples.forEach((s, i) => {
        const x = xAt(offset + i);
        const y = yAt(s.net);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = netColor;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.stroke();

      // Disk: hairline only, so it disappears into the fill edge when the two agree.
      ctx.beginPath();
      samples.forEach((s, i) => {
        const x = xAt(offset + i);
        const y = yAt(s.disk);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = diskColor;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Emphasise the newest reading — the one point that's actually current.
      const last = samples[samples.length - 1];
      ctx.beginPath();
      ctx.arc(xAt(WINDOW_SAMPLES - 1) - 1.5, yAt(last.net), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = netColor;
      ctx.fill();
    };

    drawRef.current = draw;
    draw();
  }, [samples, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height, display: "block" }}
      role="img"
      aria-label="Network and disk throughput over the last 60 seconds"
    />
  );
}
