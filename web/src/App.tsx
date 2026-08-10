import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { DecisionList } from "./features/decisions/DecisionList";
import { EpicDetailView } from "./features/epics/EpicDetailView";
import { EpicListView } from "./features/epics/EpicListView";
import { DocEditor } from "./features/docs/DocEditor";
import { QuestionInbox } from "./features/questions/QuestionInbox";
import { FiredHistoryView } from "./features/fired/FiredHistoryView";
import { ThemeSwitcher } from "./components/ThemeProvider";

export function App() {
  return (
    <BrowserRouter>
      <main>
        <h1>Consus</h1>
        <p>The Pantheon's rendered doc/decision surface.</p>
        <ThemeSwitcher />
        <nav style={{ marginBottom: '1rem' }}>
          <Link to="/" style={{ marginRight: '1rem' }}>Decisions</Link>
          <Link to="/epics" style={{ marginRight: '1rem' }}>Epics</Link>
          <Link to="/questions" style={{ marginRight: '1rem' }}>Questions</Link>
          <Link to="/fired">Fire History</Link>
        </nav>
        <Routes>
          <Route path="/" element={<DecisionList />} />
          <Route path="/epics" element={<EpicListView />} />
          <Route path="/epics/:epic_id" element={<EpicDetailView />} />
          <Route path="/docs/:id" element={<DocEditor />} />
          <Route path="/questions" element={<QuestionInbox />} />
          <Route path="/fired" element={<FiredHistoryView />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
