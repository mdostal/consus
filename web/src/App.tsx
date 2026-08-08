import { DecisionList } from "./features/decisions/DecisionList";
import { ThemeSwitcher } from "./components/ThemeProvider";

export function App() {
  return (
    <main>
      <h1>Consus</h1>
      <p>The Pantheon's rendered doc/decision surface.</p>
      <ThemeSwitcher />
      <DecisionList />
    </main>
  );
}
