import "./App.css";
import { LibraryView } from "./features/library/LibraryView";
import { NotificationProvider } from "./features/notifications/NotificationContext";

function App() {
  return (
    // Above LibraryView rather than inside it: LibraryView raises notifications
    // from its own sync handlers, so it has to be a consumer, not the provider.
    <NotificationProvider>
      <div className="bg-background text-foreground h-screen w-screen overflow-hidden">
        <LibraryView />
      </div>
    </NotificationProvider>
  );
}

export default App;
