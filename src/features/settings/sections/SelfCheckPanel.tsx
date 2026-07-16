import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useTranslation } from "../../../lib/i18n";

interface CheckResult {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

// Plain-text markers for the copy-to-clipboard bug-report format only;
// the UI renders the lucide icons below.
const STATUS_ICON: Record<CheckResult["status"], string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
};

const STATUS_LUCIDE: Record<CheckResult["status"], React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  fail: <XCircle className="h-4 w-4 text-destructive" />,
};

/** Serialize results to a plain-text block for pasting into a bug report. */
export function formatResultsForCopy(
  results: CheckResult[],
  title: (id: string) => string,
): string {
  const lines = results.map(
    r => `${STATUS_ICON[r.status]} ${title(r.id)}: ${r.detail}`,
  );
  return ["PatreonBOX self-check", ...lines].join("\n");
}

export function SelfCheckPanel() {
  const t = useTranslation();
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const checkTitle = (id: string): string =>
    (t.selfCheck.checks as Record<string, string>)[id] ?? id;

  const run = async () => {
    setRunning(true);
    setCopied(false);
    try {
      const res = await invoke<CheckResult[]>("run_self_check");
      setResults(res);
    } catch (e) {
      console.error("self-check failed", e);
      setResults([{ id: "run_self_check", status: "fail", detail: String(e) }]);
    } finally {
      setRunning(false);
    }
  };

  const copy = async () => {
    if (!results) return;
    try {
      await navigator.clipboard.writeText(formatResultsForCopy(results, checkTitle));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // Clipboard unavailable — fail silently, no acknowledgement.
      console.error("copy failed", e);
    }
  };

  return (
    <div className="py-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <div className="font-medium">{t.selfCheck.heading}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{t.selfCheck.description}</div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="px-3 py-1.5 text-xs rounded border border-border bg-background text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
        >
          {running ? t.selfCheck.running : t.selfCheck.run}
        </button>
      </div>

      {results && (
        <div className="mt-4 space-y-1.5">
          {results.map(r => (
            <div key={r.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 flex-shrink-0">{STATUS_LUCIDE[r.status]}</span>
              <div className="min-w-0">
                <span className="font-medium">{checkTitle(r.id)}</span>
                <span className="text-xs text-muted-foreground font-mono break-all"> — {r.detail}</span>
              </div>
            </div>
          ))}

          <div className="pt-2">
            <button
              onClick={copy}
              className="px-3 py-1.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? t.selfCheck.copied : t.selfCheck.copy}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
