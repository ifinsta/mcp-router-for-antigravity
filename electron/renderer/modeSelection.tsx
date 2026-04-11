import React from 'react';

interface ModeSelectionProps {
  onSelect: (mode: 'agent' | 'router') => void;
}

export function ModeSelection({ onSelect }: ModeSelectionProps) {
  return (
    <div className="mode-selection-overlay">
      <div className="mode-selection-container">
        <h1 className="mode-selection-title">Welcome to ifin Platform</h1>
        <p className="mode-selection-subtitle">Choose how you'd like to use ifin Platform</p>
        
        <div className="mode-cards">
          <div className="mode-card" onClick={() => onSelect('agent')}>
            <div className="mode-card-icon">🤖</div>
            <h2>Use my IDE's AI</h2>
            <p>Your IDE's built-in AI handles conversations. ifin provides browser automation, MCP tools, and multi-provider access as background capabilities.</p>
            <button className="mode-card-button">Select Agent Mode</button>
          </div>
          
          <div className="mode-card" onClick={() => onSelect('router')}>
            <div className="mode-card-icon">🔀</div>
            <h2>Use ifin-managed models</h2>
            <p>ifin manages your AI model connections directly. Get access to multiple providers with intelligent routing, fallback, and resilience.</p>
            <button className="mode-card-button mode-card-button-primary">Select Router Mode</button>
          </div>
        </div>
      </div>
    </div>
  );
}
