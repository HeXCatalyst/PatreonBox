import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  AppNotification,
  NotifyInput,
  activeToasts as selectToasts,
  addNotification,
  clearAll,
  closeToast as closeOneToast,
  hasExpiringToast,
  markAllRead as markAllReadIn,
  markRead as markReadIn,
  removeNotification,
  unreadCount as countUnread,
} from "./store";
import { loadNotifications, saveNotifications } from "./persist";

/**
 * The write side of the notification store. Every member is a stable
 * `useCallback`, so this context's value never changes identity — a component
 * that only *raises* notifications can subscribe to it and stay put while the
 * log grows or a toast counts down.
 *
 * This split matters for performance: the toast clock ticks every 250ms while a
 * toast is live, and `toasts` is recomputed from it. When all three groups lived
 * in one context value, that tick changed the value and re-rendered *every*
 * consumer — including the library root, which pulls the whole app tree down
 * with it (the tree has no memo boundaries at the top).
 */
interface NotificationActions {
  notify: (input: NotifyInput) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clear: () => void;
  closeToast: (id: string) => void;
}

/**
 * The read side: the full log plus the toasts that are live *right now*.
 * `toasts` changes on every expiry tick, so only the components that actually
 * draw toasts or the log (ToastStack, NotificationCenter) should subscribe.
 */
interface NotificationData {
  notifications: AppNotification[];
  toasts: AppNotification[];
}

const noop = () => {};

const ACTIONS_FALLBACK: NotificationActions = {
  notify: noop,
  markRead: noop,
  markAllRead: noop,
  dismiss: noop,
  clear: noop,
  closeToast: noop,
};

const DATA_FALLBACK: NotificationData = { notifications: [], toasts: [] };

const NotificationActionsContext = createContext<NotificationActions>(ACTIONS_FALLBACK);
const NotificationDataContext = createContext<NotificationData>(DATA_FALLBACK);
/** Just the badge count — a primitive that only changes when the log does,
 *  never on a toast tick, so the sidebar/rail badges don't re-render 4x/sec. */
const NotificationUnreadContext = createContext<number>(0);

/** How often the toast layer re-checks expiry while something is counting down. */
const TICK_MS = 250;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    typeof localStorage === "undefined" ? [] : loadNotifications(localStorage),
  );
  // Drives toast expiry. Only advances while a transient toast is live, so an
  // idle window doesn't re-render four times a second forever.
  const [now, setNow] = useState(() => Date.now());
  const firstRender = useRef(true);

  useEffect(() => {
    // Nothing to write on mount — that state came straight out of storage.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (typeof localStorage !== "undefined") {
      saveNotifications(localStorage, notifications);
    }
  }, [notifications]);

  const pending = hasExpiringToast(notifications, now);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [pending]);

  const notify = useCallback((input: NotifyInput) => {
    const at = Date.now();
    setNow(at);
    setNotifications(list => addNotification(list, input, at));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications(list => markReadIn(list, id));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(list => markAllReadIn(list));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(list => removeNotification(list, id));
  }, []);

  const clear = useCallback(() => {
    setNotifications(clearAll());
  }, []);

  const closeToast = useCallback((id: string) => {
    setNotifications(list => closeOneToast(list, id, Date.now()));
  }, []);

  const toasts = useMemo(() => selectToasts(notifications, now), [notifications, now]);
  const unreadCount = useMemo(() => countUnread(notifications), [notifications]);

  // Stable for the lifetime of the provider — see NotificationActions.
  const actions = useMemo<NotificationActions>(
    () => ({ notify, markRead, markAllRead, dismiss, clear, closeToast }),
    [notify, markRead, markAllRead, dismiss, clear, closeToast],
  );
  // Changes on every toast tick; only the toast layer and the log read it.
  const data = useMemo<NotificationData>(
    () => ({ notifications, toasts }),
    [notifications, toasts],
  );

  return (
    <NotificationActionsContext.Provider value={actions}>
      <NotificationUnreadContext.Provider value={unreadCount}>
        <NotificationDataContext.Provider value={data}>
          {children}
        </NotificationDataContext.Provider>
      </NotificationUnreadContext.Provider>
    </NotificationActionsContext.Provider>
  );
}

/**
 * Everything at once — the log, the live toasts and the actions. Convenient for
 * the notification UI itself, but it re-renders on every toast tick, so don't
 * reach for it from a screen that merely wants to raise one.
 */
export function useNotifications() {
  const actions = useContext(NotificationActionsContext);
  const data = useContext(NotificationDataContext);
  const unreadCount = useContext(NotificationUnreadContext);
  return useMemo(
    () => ({ ...actions, ...data, unreadCount }),
    [actions, data, unreadCount],
  );
}

/** Actions only, with a value that never changes identity. */
export function useNotificationActions() {
  return useContext(NotificationActionsContext);
}

/** The badge count — re-renders only when the log actually changes. */
export function useUnreadCount() {
  return useContext(NotificationUnreadContext);
}

/** Convenience for the common case: raising one without reading the log. */
export function useNotify() {
  return useContext(NotificationActionsContext).notify;
}