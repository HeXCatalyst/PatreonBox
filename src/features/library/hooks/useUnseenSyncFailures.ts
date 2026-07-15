import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTauriEvents } from "./useTauriEvents";

/**
 * Count of failed sync runs the user hasn't seen yet — drives the sidebar's
 * passive error dot on the Settings entry. Refreshes on mount and whenever a run
 * finishes or is marked seen (`sync-runs-changed`).
 */
export function useUnseenSyncFailures() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setCount(await invoke<number>("get_unseen_failed_count"));
    } catch (e) {
      console.error("get_unseen_failed_count failed", e);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useTauriEvents({ "sync-runs-changed": () => { refresh(); } });

  return { unseenFailures: count, refreshUnseenFailures: refresh };
}
