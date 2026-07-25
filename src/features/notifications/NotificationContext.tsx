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

interface NotificationContextValue {
  notifications: AppNotification[];
  toasts: AppNotification[];
  unreadCount: number;
  notify: (input: NotifyInput) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clear: () => void;
  closeToast: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  toasts: [],
  unreadCount: 0,
  notify: () => {},
  markRead: () => {},
  markAllRead: () => {},
  dismiss: () => {},
  clear: () => {},
  closeToast: () => {},
});

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

  const value = useMemo(
    () => ({
      notifications,
      toasts,
      unreadCount,
      notify,
      markRead,
      markAllRead,
      dismiss,
      clear,
      closeToast,
    }),
    [notifications, toasts, unreadCount, notify, markRead, markAllRead, dismiss, clear, closeToast],
  );

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}

/** Convenience for the common case: raising one without reading the log. */
export function useNotify() {
  return useContext(NotificationContext).notify;
}
