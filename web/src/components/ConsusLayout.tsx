import React from 'react';
import '../styles/layout.css';

interface ConsusLayoutProps {
  leftPanel?: React.ReactNode;
  centerPanel?: React.ReactNode;
  rightPanel?: React.ReactNode;
}

export function ConsusLayout({ leftPanel, centerPanel, rightPanel }: ConsusLayoutProps) {
  return (
    <div className="consus-layout">
      <div className="consus-layout-left">
        {leftPanel}
      </div>
      <div className="consus-layout-center">
        {centerPanel}
      </div>
      <div className="consus-layout-right">
        {rightPanel}
      </div>
    </div>
  );
}
