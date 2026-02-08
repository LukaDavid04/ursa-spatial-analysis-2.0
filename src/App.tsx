import { useEffect, useState } from "react";
import "./App.css";
import ChatPanel from "./components/ChatPanel.tsx";
import OpenLayersMap, { type MapState } from "./components/OpenLayersMap.tsx";
import InfoPanel from "./components/InfoPanel.tsx";
import HistoryPanel from "./components/HistoryPanel.tsx";
import chatIcon from "./assets/icons/chatIcon.png";
import type { ChatAction } from "./types/chatActions";
import type { HistoryEntry } from "./types/history";

function App() {
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [mapState, setMapState] = useState<MapState | null>(null);
  const [actions, setActions] = useState<ChatAction[]>([]);
  const [showWelcome, setShowWelcome] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    const storageKey = "ursa-welcome-dismissed";
    const hasDismissed = localStorage.getItem(storageKey);
    if (!hasDismissed) {
      setShowWelcome(true);
    }
  }, []);

  useEffect(() => {
    const storageKey = "ursa-history";
    const storedHistory = localStorage.getItem(storageKey);
    if (storedHistory) {
      try {
        const parsedHistory = JSON.parse(storedHistory) as HistoryEntry[];
        setHistoryEntries(parsedHistory);
      } catch {
        setHistoryEntries([]);
      }
    }
  }, []);

  useEffect(() => {
    const storageKey = "ursa-history";
    localStorage.setItem(storageKey, JSON.stringify(historyEntries));
  }, [historyEntries]);

  const handleDismissWelcome = () => {
    localStorage.setItem("ursa-welcome-dismissed", "true");
    setShowWelcome(false);
  };

  const appendHistoryEntries = (entries: HistoryEntry[]) => {
    if (entries.length === 0) {
      return;
    }
    setHistoryEntries((prev) => {
      const combined = [...entries, ...prev];
      return combined.slice(0, 100);
    });
  };

  const handleHistoryRequest = (message: string) => {
    appendHistoryEntries([
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind: "request",
        title: "User request",
        detail: message,
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  const formatActionDetail = (action: ChatAction) => {
    switch (action.type) {
      case "geocode": {
        const label = action.result.display_name ?? "Coordinates resolved";
        return `${label} (${action.result.lat.toFixed(4)}, ${action.result.lon.toFixed(4)})`;
      }
      case "list_pins": {
        const count = Array.isArray(action.result) ? action.result.length : 0;
        return `Listed ${count} pin${count === 1 ? "" : "s"}.`;
      }
      case "create_pin": {
        return `Pinned "${action.result.title}" at ${action.result.lat.toFixed(
          4,
        )}, ${action.result.lon.toFixed(4)}.`;
      }
      case "remove_pin": {
        const status = action.result.removed ? "Removed" : "Attempted removal";
        return `${status} pin ${action.result.id ?? "unknown"}.`;
      }
      case "remove_pins": {
        if (action.result.removed_all) {
          return `Removed all pins (${action.result.count}).`;
        }
        const ids = action.result.ids?.join(", ") ?? "unspecified";
        return `Removed ${action.result.count} pin${action.result.count === 1 ? "" : "s"} (${ids}).`;
      }
      default:
        return "Completed an action.";
    }
  };

  const handleHistoryActions = (nextActions: ChatAction[]) => {
    const entries = nextActions.map((action) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: "action" as const,
      title: "Assistant action",
      detail: formatActionDetail(action),
      timestamp: new Date().toISOString(),
    }));
    appendHistoryEntries(entries);
  };

  return (
    <div className={`app-shell ${isChatOpen ? "chat-open" : "chat-closed"}`}>
      <div className="map-pane">
        <OpenLayersMap onMapStateChange={setMapState} actions={actions} />
        <div className="map-controls">
          <InfoPanel />
          <HistoryPanel
            entries={historyEntries}
            onClear={() => setHistoryEntries([])}
          />
          {!isChatOpen && (
            <button
              className="chat-reopen"
              type="button"
              onClick={() => setIsChatOpen(true)}
              aria-label="Open chat"
            >
              <img
                className="chat-reopen-icon"
                src={chatIcon}
                alt=""
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </div>
      <ChatPanel
        isOpen={isChatOpen}
        onToggle={() => setIsChatOpen(!isChatOpen)}
        mapState={mapState}
        onActions={setActions}
        onHistoryRequest={handleHistoryRequest}
        onHistoryActions={handleHistoryActions}
      />
      {showWelcome && (
        <div
          className="welcome-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-title"
        >
          <div className="welcome-modal">
            <h2 id="welcome-title">Welcome to Ursa Spatial Analysis</h2>
            <p>
              Get oriented fast with the live map and the URSA assistant. Search
              for places, drop pins, and capture quick spatial notes as you go.
            </p>
            <ul>
              <li>Use the magnifying glass to search and zoom to a location.</li>
              <li>Ask the assistant to summarize the area or create pins.</li>
              <li>Review recent requests and actions in the history panel.</li>
            </ul>
            <button
              className="welcome-button"
              type="button"
              onClick={handleDismissWelcome}
            >
              Start exploring
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
