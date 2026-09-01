import { useEffect, useMemo, useState } from "react";
import { debounce } from "./debounce";

/**
 * Returns a copy of `value` that only updates once it has stopped changing for
 * `ms` milliseconds. The input bound to `value` stays responsive (it tracks
 * every change); only the *returned* value is delayed, so effects that depend on
 * it fire at most once per burst of typing rather than once per keystroke.
 *
 * Powers the post-list search (LibraryView): without it every keystroke fired a
 * full `getPosts()` query — the ~20MB/keystroke payload flagged as P0-2.
 *
 * The trailing-edge timing itself lives in the tested `debounce` util; this is
 * only the React binding (a single stable debounced setter held across renders,
 * so rapid value changes exercise debounce's reset-on-each-call semantics).
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  // setDebounced is stable across renders, so the debounced setter depends only
  // on `ms`. Holding one instance lets debounce's trailing-edge reset work across
  // rapid value changes: each new value cancels the prior pending set.
  const set = useMemo(() => debounce(setDebounced, ms), [ms]);
  useEffect(() => {
    set(value);
  }, [value, set]);
  // Cancel a pending trailing set on unmount or when the wait changes, so a
  // stale timer can't fire after the component is gone.
  useEffect(() => () => set.cancel(), [set]);
  return debounced;
}
