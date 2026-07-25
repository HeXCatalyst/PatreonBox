import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { NotifySeverity } from "./store";

const ICONS = {
  error: XCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
} as const;

/** Severity colours live on tokens so the named themes can override them. */
const TONES: Record<NotifySeverity, string> = {
  error: "text-destructive",
  warning: "text-star",
  success: "text-primary",
  info: "text-muted-foreground",
};

export function NotificationIcon({
  severity,
  className = "h-4 w-4",
}: {
  severity: NotifySeverity;
  className?: string;
}) {
  const Icon = ICONS[severity];
  return <Icon className={`${className} ${TONES[severity]} shrink-0`} aria-hidden />;
}
