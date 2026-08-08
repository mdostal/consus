import React from 'react';

interface TicketListProps {
  items: string[];
}

export function TicketList({ items }: TicketListProps) {
  return (
    <div className="ticket-list">
      {items.map((item, index) => (
        <div key={index} className="ticket-list-item">
          {item}
        </div>
      ))}
    </div>
  );
}
