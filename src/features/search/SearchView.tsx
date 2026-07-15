import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Search as SearchIcon, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslation } from "../../lib/i18n";

export interface SearchResult {
  post_id: string;
  creator_id: string;
  creator_name: string | null;
  title: string;
  excerpt: string;
  published_at: string;
}

interface SearchViewProps {
  onClose: () => void;
  onOpenResult: (result: SearchResult) => void;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export function SearchView({ onClose, onOpenResult }: SearchViewProps) {
  const t = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ignore stale responses if the query changed while a search was in flight.
  const seqRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search as the user types.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const seq = ++seqRef.current;
    const handle = setTimeout(async () => {
      try {
        const r = await invoke<SearchResult[]>("search_posts", { query: q, limit: 100 });
        if (seq === seqRef.current) setResults(r);
      } catch (e) {
        console.error("search_posts failed", e);
        if (seq === seqRef.current) setResults([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const trimmed = query.trim();

  return (
    <div className="flex flex-1 h-full flex-col overflow-hidden">
      <div className="border-b p-4 flex items-center gap-3">
        <button
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          onClick={onClose}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="relative flex-1 max-w-2xl">
          <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          {searching && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t.search.placeholder}
            className="pl-8 pr-8"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4">
          {!trimmed ? (
            <p className="text-sm text-muted-foreground py-16 text-center">{t.search.empty}</p>
          ) : results.length === 0 && !searching ? (
            <p className="text-sm text-muted-foreground py-16 text-center">{t.search.noResults(trimmed)}</p>
          ) : (
            <>
              {results.length > 0 && (
                <div className="text-xs text-muted-foreground mb-2">{t.search.resultsCount(results.length)}</div>
              )}
              <div className="divide-y">
                {results.map(r => (
                  <button
                    key={r.post_id}
                    onClick={() => onOpenResult(r)}
                    className="w-full text-left py-3 hover:bg-muted/40 transition-colors px-2 -mx-2 rounded"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium truncate">{r.title || "Untitled"}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(r.published_at)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{r.creator_name ?? r.creator_id}</div>
                    {r.excerpt && (
                      <div className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">{r.excerpt}</div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
