import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { DecisionList } from "./features/decisions/DecisionList";
import { EpicListView } from "./features/epics/EpicListView";
import { ThemeSwitcher } from "./components/ThemeProvider";
import { DocEditorView } from "./views/DocEditorView";

export function App() {
  return (
    <BrowserRouter>
      <main>
        <h1>Consus</h1>
        <p>The Pantheon's rendered doc/decision surface.</p>
        <ThemeSwitcher />
        <nav style={{ marginBottom: '1rem' }}>
          <Link to="/" style={{ marginRight: '1rem' }}>Decisions</Link>
          <Link to="/epics">Epics</Link>
        </nav>
        <Routes>
          <Route path="/" element={<DecisionList />} />
          <Route path="/epics" element={<EpicListView />} />
          <Route path="/docs/:repo/*" element={<DocEditorView />} />
          {/* A detail view stub for s2-05 */}
          <Route path="/epics/:id" element={<div>Epic Detail View Stub</div>} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
