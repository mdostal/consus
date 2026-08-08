import { ConsusLayout } from "./components/ConsusLayout";
import { TicketList } from "./components/TicketList";
import { IssuePanel } from "./components/IssuePanel";
import { DecisionList } from "./features/decisions/DecisionList";

export function App() {
  const dummyTickets = Array.from({ length: 50 }, (_, i) => `Ticket #${i + 1}`);

  return (
    <ConsusLayout
      leftPanel={
        <div style={{ padding: '1rem' }}>
          <h1>Consus</h1>
          <h2>Filters</h2>
          <p>Filter options would go here...</p>
        </div>
      }
      centerPanel={
        <>
          <div style={{ padding: '1rem', borderBottom: '1px solid #eee' }}>
            <p>The Pantheon's rendered doc/decision surface.</p>
          </div>
          <DecisionList />
          <TicketList items={dummyTickets} />
        </>
      }
      rightPanel={<IssuePanel content="Selected issue content will appear here. Scroll me to see independent scroll in action!" />}
    />
  );
}
