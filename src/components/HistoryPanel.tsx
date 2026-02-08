import { useState, type FC } from "react";
import historyIcon from "../assets/icons/historyIcon.png";
import type { HistoryEntry } from "../types/history";

type HistoryPanelProps = {
  entries: HistoryEntry[];
  onClear: () => void;
};

const HistoryPanel: FC<HistoryPanelProps> = ({ entries, onClear }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="history-shell">
      <button
        className="history-trigger"
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open history"
      >
        <img
          className="history-trigger-icon"
          src={historyIcon}
          alt=""
          aria-hidden="true"
        />
      </button>

      <div className={`history-overlay ${isOpen ? "is-open" : ""}`}>
        <div className="history-backdrop" onClick={() => setIsOpen(false)} />
        <div
          className="history-panel"
          role="dialog"
          aria-modal="true"
          aria-label="History"
        >
          <header className="history-header">
            <div>
              <p className="history-eyebrow">Session log</p>
              <h2>Action History</h2>
            </div>
            <div className="history-actions">
              <button
                type="button"
                className="history-clear"
                onClick={onClear}
                disabled={entries.length === 0}
              >
                Clear
              </button>
              <button type="button" onClick={() => setIsOpen(false)}>
                Close
              </button>
            </div>
          </header>

          <section className="history-content">
            {entries.length === 0 ? (
              <div className="history-empty">
                <p>No history yet.</p>
                <p>Send a request to the assistant to start the log.</p>
              </div>
            ) : (
              <ul className="history-list">
                {entries.map((entry) => (
                  <li key={entry.id} className={`history-item ${entry.kind}`}>
                    <div>
                      <p className="history-item-title">{entry.title}</p>
                      <p className="history-item-detail">{entry.detail}</p>
                    </div>
                    <span className="history-item-time">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;
