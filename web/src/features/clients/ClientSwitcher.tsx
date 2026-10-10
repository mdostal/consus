import { useClientScope } from "./ClientScope";

const ALL_CLIENTS_VALUE = "";

/** PANT-960: the header client switcher. Picking a client scopes the
 *  projects, docs, decisions and events views to that client's repos;
 *  "All clients" shows everything. Hidden until at least one client exists,
 *  so an ungrouped install looks exactly as before. */
export function ClientSwitcher() {
  const { client, setClient, clients } = useClientScope();
  if (clients.length === 0) return null;

  return (
    <label className="client-switcher">
      <span className="client-switcher__label">Client</span>
      <select
        aria-label="Select client"
        data-testid="client-switcher"
        value={client ?? ALL_CLIENTS_VALUE}
        onChange={(e) => setClient(e.target.value === ALL_CLIENTS_VALUE ? null : e.target.value)}
      >
        <option value={ALL_CLIENTS_VALUE}>All clients</option>
        {clients.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}
