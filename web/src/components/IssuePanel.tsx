import React from 'react';

interface IssuePanelProps {
  content: string;
}

export function IssuePanel({ content }: IssuePanelProps) {
  return (
    <div className="issue-panel">
      <div className="issue-panel-content">
        {content}
      </div>
    </div>
  );
}
