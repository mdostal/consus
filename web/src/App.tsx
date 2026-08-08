import { DecisionList } from "./features/decisions/DecisionList";

export function App() {
  return (
    <main>
      <h1>Consus</h1>
      <p>The Pantheon's rendered doc/decision surface.</p>
      <DecisionList />
    </main>
  );
}
