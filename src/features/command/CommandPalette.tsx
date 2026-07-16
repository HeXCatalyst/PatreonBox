import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Creator } from "../../types/db";
import type { SearchResult } from "../search/SearchView";
import { useTranslation } from "../../lib/i18n";

export interface PaletteCommand {
  id: string;
  label: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  creators: (Creator & { post_count: number })[];
  commands: PaletteCommand[];
  onSelectCreator: (id: string) => void;
  onOpenPost: (result: SearchResult) => void;
}

type Item =
  | { kind: "creator"; key: string; creator: Creator & { post_count: number } }
  | { kind: "post"; key: string; result: SearchResult }
  | { kind: "command"; key: string; command: PaletteCommand };

const MAX_CREATORS = 6;
const MAX_POSTS = 6;

/**
 * ⌘K everywhere: fuzzy-jump to a creator, full-text search posts (via the FTS
 * index), or run a command. Keyboard-first — ↑ ↓ to move, ↵ to run, Esc to close.
 */
export function CommandPalette({ open, onClose, creators, commands, onSelectCreator, onOpenPost }: CommandPaletteProps) {
  const t = useTranslation();
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  // Reset each time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setPosts([]);
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced post search (only with a query).
  useEffect(() => {
    const q = query.trim();
    if (!open || !q) { setPosts([]); return; }
    const seq = ++seqRef.current;
    const handle = setTimeout(async () => {
      try {
        const r = await invoke<SearchResult[]>("search_posts", { query: q, limit: MAX_POSTS });
        if (seq === seqRef.current) setPosts(r);
      } catch (e) {
        console.error("search_posts failed", e);
      }
    }, 160);
    return () => clearTimeout(handle);
  }, [query, open]);

  const q = query.trim().toLowerCase();

  const matchedCreators = useMemo(() => {
    const subscribed = creators.filter(c => Boolean(c.is_subscribed));
    const list = q ? subscribed.filter(c => c.name.toLowerCase().includes(q)) : subscribed;
    return list.slice(0, MAX_CREATORS);
  }, [creators, q]);

  const matchedCommands = useMemo(
    () => (q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands),
    [commands, q],
  );

  // Flat list (for ↑ ↓ / ↵) + the grouped structure (for rendering).
  const items: Item[] = useMemo(() => [
    ...matchedCreators.map(c => ({ kind: "creator" as const, key: `c:${c.id}`, creator: c })),
    ...posts.map(r => ({ kind: "post" as const, key: `p:${r.post_id}`, result: r })),
    ...matchedCommands.map(c => ({ kind: "command" as const, key: `x:${c.id}`, command: c })),
  ], [matchedCreators, posts, matchedCommands]);

  useEffect(() => { setActive(a => Math.min(a, Math.max(0, items.length - 1))); }, [items.length]);

  const run = (item: Item) => {
    if (item.kind === "creator") onSelectCreator(item.creator.id);
    else if (item.kind === "post") onOpenPost(item.result);
    else item.command.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[active]) run(items[active]); }
  };

  if (!open) return null;

  let idx = -1;
  const renderItem = (item: Item, node: React.ReactNode) => {
    idx++;
    const i = idx;
    const isActive = i === active;
    return (
      <button
        key={item.key}
        onMouseEnter={() => setActive(i)}
        onClick={() => run(item)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm ${isActive ? "bg-accent text-accent-foreground" : "text-foreground"}`}
      >
        {node}
        {isActive && <CornerDownLeft className="ml-auto h-3.5 w-3.5 opacity-50 flex-shrink-0" />}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px]" />
      <div
        className="relative w-full max-w-[520px] rounded-xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 px-4 border-b h-12">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t.commandPalette.placeholder}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t.commandPalette.empty}</div>
          )}

          {matchedCreators.length > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-4 pt-2 pb-1">{t.commandPalette.groupCreators}</div>
          )}
          {matchedCreators.map(c => renderItem(
            { kind: "creator", key: `c:${c.id}`, creator: c },
            <>
              <Avatar className="h-5 w-5 flex-shrink-0"><AvatarImage src={c.avatar_path || undefined} /><AvatarFallback>{c.name.charAt(0)}</AvatarFallback></Avatar>
              <span className="truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{c.post_count}</span>
            </>,
          ))}

          {posts.length > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-4 pt-2 pb-1">{t.commandPalette.groupPosts}</div>
          )}
          {posts.map(r => renderItem(
            { kind: "post", key: `p:${r.post_id}`, result: r },
            <div className="min-w-0">
              <div className="truncate">{r.title || "Untitled"}</div>
              <div className="text-xs text-muted-foreground truncate">{r.creator_name ?? r.creator_id}</div>
            </div>,
          ))}

          {matchedCommands.length > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-4 pt-2 pb-1">{t.commandPalette.groupCommands}</div>
          )}
          {matchedCommands.map(c => renderItem(
            { kind: "command", key: `x:${c.id}`, command: c },
            <span className="truncate">{c.label}</span>,
          ))}
        </div>
      </div>
    </div>
  );
}
