import { useEffect, useMemo, useRef, useState } from "react";
import { Post, Asset } from "../../types/db";
import { getAllPostsChrono, getPostAssets } from "../../lib/db";
import { ReadingView } from "../library/ReadingView";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "../../lib/i18n";

interface TimelineViewProps {
  onOpenInWorkbench: (post: Post) => void;
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function fmtMonth(key: string): string {
  const d = new Date(`${key}-01T00:00:00`);
  return isNaN(d.getTime()) ? key : d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

/**
 * The "all activity" river: recent posts across every subscribed creator,
 * newest first, with a month spine to jump around. Selecting an entry reads it
 * inline; "open in workbench" jumps into that creator's Workbench.
 */
export function TimelineView({ onOpenInWorkbench }: TimelineViewProps) {
  const t = useTranslation();
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<Post | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const monthRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => { getAllPostsChrono(300).then(setPosts).catch(console.error); }, []);
  useEffect(() => {
    if (!selected) { setAssets([]); return; }
    let cancelled = false;
    getPostAssets(selected.id).then(a => { if (!cancelled) setAssets(a); }).catch(console.error);
    return () => { cancelled = true; };
  }, [selected]);

  const { days, months } = useMemo(() => {
    const days: { day: string; monthKey: string; posts: Post[] }[] = [];
    const monthCounts: Record<string, number> = {};
    let cur: { day: string; monthKey: string; posts: Post[] } | null = null;
    for (const p of posts) {
      const iso = p.published_at || p.created_at || "";
      const day = iso.slice(0, 10);
      const monthKey = iso.slice(0, 7);
      monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
      if (!cur || cur.day !== day) { cur = { day, monthKey, posts: [] }; days.push(cur); }
      cur.posts.push(p);
    }
    const months = Object.keys(monthCounts).map(k => ({ key: k, count: monthCounts[k] }));
    return { days, months };
  }, [posts]);

  const scrollToMonth = (key: string) => {
    monthRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  let seenMonth = "";

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* month spine */}
      <div className="w-[150px] flex-shrink-0 bg-muted/20 border-r overflow-y-auto p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1 pb-2">{t.timeline.heading}</div>
        {months.map(m => (
          <button
            key={m.key}
            onClick={() => scrollToMonth(m.key)}
            className="w-full flex items-center gap-2 px-1 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />
            <span className="truncate">{fmtMonth(m.key)}</span>
            <span className="ml-auto tabular-nums text-[11px] text-muted-foreground/70">{m.count}</span>
          </button>
        ))}
      </div>

      {/* river */}
      <div className="flex-1 min-w-0 overflow-y-auto border-r">
        {days.map(group => {
          const firstOfMonth = group.monthKey !== seenMonth;
          seenMonth = group.monthKey;
          return (
            <div key={group.day} ref={firstOfMonth ? (el => { monthRefs.current[group.monthKey] = el; }) : undefined}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-primary px-4 pt-4 pb-1 sticky top-0 bg-background/95 backdrop-blur-sm">
                {fmtDay(group.day)}
              </div>
              {group.posts.map(p => {
                const active = selected?.id === p.id;
                const iso = p.published_at || p.created_at || "";
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${active ? "bg-accent" : "hover:bg-muted/40"}`}
                  >
                    <Avatar className="h-6 w-6 flex-shrink-0">
                      <AvatarImage src={p.creator_avatar_path || undefined} />
                      <AvatarFallback>{(p.creator_name ?? "?").charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{p.title || "Untitled"}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.creator_name ?? p.creator_id} · {fmtTime(iso)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
        {days.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">{t.timeline.empty}</div>
        )}
      </div>

      {/* reading */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <>
            <div className="flex items-center justify-end px-3 py-1.5 border-b flex-shrink-0">
              <button
                onClick={() => onOpenInWorkbench(selected)}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1"
              >
                {t.timeline.openInWorkbench}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ReadingView post={selected} assets={assets} />
            </div>
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-sm text-muted-foreground">{t.timeline.pick}</div>
        )}
      </div>
    </div>
  );
}
