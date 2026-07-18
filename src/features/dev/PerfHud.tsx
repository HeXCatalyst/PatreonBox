import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { X, Minus, Plus, Activity } from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import { useSettings } from "../settings/SettingsContext";

/** Renders the HUD only when developer mode + the perf-HUD toggle are both on. */
export function PerfHudGate() {
  const { settings, updateSettings } = useSettings();
  if (!settings.developer_mode_enabled || !settings.perf_hud_enabled) return null;
  return <PerfHud onClose={() => updateSettings({ perf_hud_enabled: false })} />;
}

interface ProcStats { rss_mb: number; cpu_percent: number; cores: number; process_count: number; }

const POS_KEY = "patreonbox-perf-hud-pos";
const COLLAPSE_KEY = "patreonbox-perf-hud-collapsed";

function loadPos(): { x: number; y: number } {
  try {
    const s = JSON.parse(localStorage.getItem(POS_KEY) || "");
    if (typeof s?.x === "number" && typeof s?.y === "number") return s;
  } catch { /* default below */ }
  return { x: Math.max(12, window.innerWidth - 244), y: 64 };
}

interface PerfHudProps {
  onClose: () => void;   // hide (flips the setting off)
}

/**
 * A draggable developer overlay showing this app's live performance: frame rate
 * and frame time + render pressure (from the webview's rAF), JS heap (where the
 * engine exposes it), and the app process tree's RSS / CPU (from the Rust
 * `process_stats` command — this process, not the whole system).
 */
export function PerfHud({ onClose }: PerfHudProps) {
  const t = useTranslation();
  const hudRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(loadPos);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  // Live values (numbers refreshed at 5Hz so the HUD itself stays cheap).
  const [fps, setFps] = useState(60);
  const [frameMs, setFrameMs] = useState(16);
  const [pressure, setPressure] = useState(0);
  const [heap, setHeap] = useState<{ used: number; limit: number } | null>(null);
  const [proc, setProc] = useState<ProcStats | null>(null);

  // Smoothed accumulators live in refs (mutated every animation frame).
  const acc = useRef({ last: performance.now(), fps: 60, frame: 16, press: 0 });
  const fpsBuf = useRef<number[]>(new Array(48).fill(60));
  const frameBuf = useRef<number[]>(new Array(48).fill(16));
  const spFps = useRef<HTMLCanvasElement | null>(null);
  const spFrame = useRef<HTMLCanvasElement | null>(null);

  // rAF loop: measure fps / frame time / render pressure.
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const a = acc.current;
      const dt = now - a.last; a.last = now;
      const fpsNow = 1000 / Math.max(1, dt);
      a.fps += (fpsNow - a.fps) * 0.15;
      a.frame += (dt - a.frame) * 0.15;
      const p = Math.max(0, Math.min(1, (dt - 16.7) / (33 - 16.7)));
      a.press += (p - a.press) * 0.1;
      fpsBuf.current.push(a.fps); fpsBuf.current.shift();
      frameBuf.current.push(a.frame); frameBuf.current.shift();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Push refs → state at 5Hz, redraw sparklines, and (each second) poll the process.
  useEffect(() => {
    let tick = 0;
    const draw = (canvas: HTMLCanvasElement | null, buf: number[], max: number, stroke: string) => {
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== canvas.clientWidth * dpr) { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr; }
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      for (let i = 0; i < buf.length; i++) {
        const x = (i / (buf.length - 1)) * w;
        const y = h - Math.min(1, buf[i] / max) * (h - 2 * dpr) - dpr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = stroke; ctx.lineWidth = 1.5 * dpr; ctx.lineJoin = "round"; ctx.stroke();
    };
    const id = window.setInterval(() => {
      const a = acc.current;
      setFps(a.fps); setFrameMs(a.frame); setPressure(a.press);
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      setHeap(mem ? { used: mem.usedJSHeapSize / 1048576, limit: mem.jsHeapSizeLimit / 1048576 } : null);
      draw(spFps.current, fpsBuf.current, 75, "#5bd08a");
      draw(spFrame.current, frameBuf.current, 50, "#5b93cc");
      if (tick % 5 === 0) invoke<ProcStats>("process_stats").then(setProc).catch(() => {});
      tick++;
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  // Drag the whole HUD (from anywhere except the header buttons). Uses
  // document-level listeners + delta-based movement so it works regardless of
  // any ancestor transform/stacking context, and never loses the pointer.
  const lastPos = useRef(pos);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const el = hudRef.current;
    if (!el) return;
    const startX = e.clientX, startY = e.clientY;
    const baseX = lastPos.current.x, baseY = lastPos.current.y;
    const move = (ev: PointerEvent) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      const x = Math.max(0, Math.min(window.innerWidth - w, baseX + (ev.clientX - startX)));
      const y = Math.max(0, Math.min(window.innerHeight - h, baseY + (ev.clientY - startY)));
      lastPos.current = { x, y };
      setPos(lastPos.current);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      localStorage.setItem(POS_KEY, JSON.stringify(lastPos.current));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  const toggleCollapse = () => {
    setCollapsed(c => { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); return !c; });
  };

  const pressColor = pressure >= 0.66 ? "#e5646b" : pressure >= 0.33 ? "#e8b33a" : "#5bd08a";
  const fpsColor = fps < 30 ? "#e5646b" : fps < 50 ? "#e8b33a" : "#5bd08a";
  const cpuNorm = proc ? Math.min(100, proc.cpu_percent / Math.max(1, proc.cores)) : 0;
  const cpuColor = cpuNorm >= 70 ? "#e5646b" : cpuNorm >= 40 ? "#e8b33a" : "#5bd08a";
  // Overall health = worst of the key signals; drives the collapsed pill's dot.
  const healthColor =
    (fps < 30 || cpuNorm >= 70 || pressure >= 0.66) ? "#e5646b" :
    (fps < 50 || cpuNorm >= 40 || pressure >= 0.33) ? "#e8b33a" : "#5bd08a";

  return (
    <div
      ref={hudRef}
      onPointerDown={onPointerDown}
      className={`fixed z-[200] rounded-xl border border-white/10 bg-black/70 backdrop-blur-xl text-white shadow-[0_16px_40px_-14px_rgba(0,0,0,0.7)] font-mono select-none cursor-grab active:cursor-grabbing ${collapsed ? "w-auto" : "w-[220px]"}`}
      style={{ left: pos.x, top: pos.y }}
    >
      {collapsed ? (
        // Compact pill: a health dot + live glanceable stats, still draggable.
        <div className="flex items-center gap-2.5 pl-2.5 pr-1.5 py-1.5 text-xs whitespace-nowrap">
          <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: healthColor, boxShadow: `0 0 6px ${healthColor}` }} />
          <span className="font-semibold tabular-nums" style={{ color: fpsColor }}>{Math.round(fps)}<small className="text-white/45 font-normal ml-0.5">fps</small></span>
          <span className="font-semibold tabular-nums" style={{ color: cpuColor }}>{proc ? Math.round(cpuNorm) : "—"}<small className="text-white/45 font-normal ml-0.5">%</small></span>
          <span className="font-semibold tabular-nums text-white/70">{proc ? Math.round(proc.rss_mb) : "—"}<small className="text-white/45 font-normal ml-0.5">mb</small></span>
          <button type="button" onClick={toggleCollapse} className="text-white/55 hover:text-white ml-0.5" title={t.perfHud.expand}>
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onClose} className="text-white/55 hover:text-white" title={t.perfHud.close}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
      <>
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-white/10">
        <Activity className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-sans font-bold tracking-[0.14em]">{t.perfHud.title}</span>
        <span className="flex-1" />
        <button type="button" onClick={toggleCollapse} className="text-white/60 hover:text-white" title={t.perfHud.collapse}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onClose} className="text-white/60 hover:text-white" title={t.perfHud.close}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-2.5 py-2.5 flex flex-col gap-2.5">
          <Row label={t.perfHud.fps} value={Math.round(fps)} color={fpsColor}>
            <canvas ref={spFps} className="w-full h-5 block" />
          </Row>
          <Row label={t.perfHud.frame} value={`${frameMs.toFixed(1)}`} unit="ms">
            <canvas ref={spFrame} className="w-full h-5 block" />
          </Row>
          <Row label={t.perfHud.heap} value={heap ? `${Math.round(heap.used)}` : "—"} unit={heap ? `/ ${Math.round(heap.limit)} MB` : "n/a"}>
            {heap && <Meter pct={Math.min(100, (heap.used / heap.limit) * 100)} color="#5b93cc" />}
          </Row>
          <Row label={t.perfHud.pressure} value={Math.round(pressure * 100)} unit="%">
            <Meter pct={pressure * 100} color={pressColor} />
          </Row>

          <div className="text-[9.5px] font-sans tracking-[0.12em] uppercase text-white/45 pt-1.5 mt-0.5 border-t border-white/10">
            {t.perfHud.processSection}
          </div>
          <Row label={t.perfHud.rss} value={proc ? Math.round(proc.rss_mb) : "—"} unit="MB">
            {proc && <Meter pct={Math.min(100, (proc.rss_mb / 1200) * 100)} color="#5b93cc" />}
          </Row>
          <Row label={t.perfHud.cpu} value={proc ? Math.round(cpuNorm) : "—"} unit="%" color={cpuColor}>
            {proc && <Meter pct={cpuNorm} color={cpuColor} />}
          </Row>
        </div>
      </>
      )}
    </div>
  );
}

function Row({ label, value, unit, color, children }: { label: string; value: React.ReactNode; unit?: string; color?: string; children?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 items-center">
      <span className="text-[10px] font-sans tracking-[0.06em] uppercase text-white/50">{label}</span>
      <span className="text-[15px] font-semibold text-right tabular-nums" style={color ? { color } : undefined}>
        {value}{unit && <small className="text-[10px] text-white/50 font-normal ml-0.5">{unit}</small>}
      </span>
      {children && <div className="col-span-2">{children}</div>}
    </div>
  );
}

function Meter({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-0.5">
      <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}
