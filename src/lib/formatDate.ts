import { format } from "date-fns";

export function formatPostDate(dateStr: string | null | undefined, unknownLabel = "Unknown Date"): string {
  if (!dateStr) return unknownLabel;
  try {
    const dt = new Date(dateStr);
    if (!isNaN(dt.getTime())) {
      return format(dt, "MMM d, yyyy h:mm a");
    }
    return dateStr; // Return raw string if unparseable
  } catch {
    return dateStr || unknownLabel;
  }
}
