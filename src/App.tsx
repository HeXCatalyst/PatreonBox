import "./App.css";
import { LibraryView } from "./features/library/LibraryView";

function App() {
  return (
    <div className="bg-background text-foreground h-screen w-screen overflow-hidden">
      <LibraryView />
    </div>
  );
}

export default App;
