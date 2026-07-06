import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Subscribe to multiple Tauri events on mount, unsubscribe on cleanup.
 * Each entry maps an event name to its handler function.
 *
 * Subscriptions are created once (no re-subscribing on re-render), but each
 * invocation dispatches through a ref so handlers always capture the latest
 * state/closures from the caller.
 */
export function useTauriEvents(events: Record<string, (payload: any) => void>) {
  const handlersRef = useRef(events);

  // Keep the ref current after every render — cheap assignment, no deps needed
  useEffect(() => {
    handlersRef.current = events;
  });

  useEffect(() => {
    const eventNames = Object.keys(events);
    const unlisteners = eventNames.map((name) =>
      listen(name, (event) => handlersRef.current[name]?.(event.payload))
    );

    return () => {
      unlisteners.forEach((p) => p.then((f) => f()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Subscribe once; freshness is maintained via handlersRef
}
