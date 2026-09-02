/**
 * Trailing-edge debounce: `fn` runs once, `ms` after the last call.
 *
 * Powers the post-list search input (LibraryView): without it each keystroke
 * fires a full `getPosts()` query — the ~20MB/keystroke payload flagged as P0-2
 * in the perf audit. SearchView already inlines the same pattern; this is the
 * shared, tested version.
 *
 * `cancel()` clears a pending call and is safe to call when nothing is pending.
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: A) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}
