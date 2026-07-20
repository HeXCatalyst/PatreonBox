import { cn } from "@/lib/utils";

/**
 * The compact chip used in view toolbars (media wall, favourites).
 *
 * Deliberately not a `Button` variant: `buttonVariants` emits size classes after
 * variant classes, so the `size` prop would win on `text-*`, `gap-*` and
 * `rounded-*` and shift these by a pixel or two everywhere. These chips are a
 * distinct control — 28px tall, xs text, transparent until hovered — so they get
 * their own component rather than a variant that has to fight the size scale.
 */
export interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** "danger" is the destructive-action styling (delete selected, etc.). */
  tone?: "neutral" | "danger";
}

const TONES = {
  neutral: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
  danger: "text-destructive border-destructive/50 hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed",
} as const;

export function ToolbarButton({ tone = "neutral", className, ...props }: ToolbarButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "h-7 px-2.5 flex items-center gap-1.5 border rounded text-xs transition-colors",
        TONES[tone],
        className,
      )}
    />
  );
}
