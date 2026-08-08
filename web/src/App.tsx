import { DecisionList } from "./features/decisions/DecisionList";
import { ThemeProvider } from "./components/ThemeProvider";

export function App() {
  return (
    <ThemeProvider>
      <main>
        <h1>Consus</h1>
        <p>The Pantheon's rendered doc/decision surface.</p>
        <DecisionList />
      </main>
    </ThemeProvider>
  );
}
