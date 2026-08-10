import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { DecisionList } from "./features/decisions/DecisionList";
import { EpicDetailView } from "./features/epics/EpicDetailView";
import { EpicListView } from "./features/epics/EpicListView";
<<<<<<< HEAD
import { DocEditor } from "./features/docs/DocEditor";
import { QuestionInbox } from "./features/questions/QuestionInbox";
import { FiredHistoryView } from "./features/fired/FiredHistoryView";
=======
import { QuestionInbox } from "./features/questions/QuestionInbox";
>>>>>>> origin/feat/PAN-8234
import { ThemeSwitcher } from "./components/ThemeProvider";
import { QuestionsView } from "./views/QuestionsView";

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
<<<<<<< HEAD
<<<<<<< HEAD
          <Link to="/questions" style={{ marginRight: '1rem' }}>Questions</Link>
          <Link to="/fired">Fire History</Link>
=======
          <Link to="/questions">Questions</Link>
>>>>>>> origin/feat/PAN-8234
=======
          <Link to="/questions">Questions</Link>
>>>>>>> origin/feat/PAN-8226
        </nav>
        <Routes>
          <Route path="/" element={<DecisionList />} />
          <Route path="/epics" element={<EpicListView />} />
<<<<<<< HEAD
<<<<<<< HEAD
          <Route path="/epics/:epic_id" element={<EpicDetailView />} />
          <Route path="/docs/:id" element={<DocEditor />} />
          <Route path="/questions" element={<QuestionInbox />} />
          <Route path="/fired" element={<FiredHistoryView />} />
=======
=======
          <Route path="/questions" element={<QuestionsView />} />
>>>>>>> origin/feat/PAN-8226
          {/* A detail view stub for s2-05 */}
          <Route path="/epics/:id" element={<div>Epic Detail View Stub</div>} />
          <Route path="/questions" element={<QuestionInbox />} />
>>>>>>> origin/feat/PAN-8234
        </Routes>
      </main>
    </BrowserRouter>
  );
}
