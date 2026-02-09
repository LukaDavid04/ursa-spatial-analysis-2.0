import { useEffect, useMemo, useRef, useState, type FC } from "react";
import type { MapState } from "./OpenLayersMap";
import type { ChatAction } from "../types/chatActions";

type ChatPanelProps = {
  isOpen: boolean;
  onToggle: () => void;
  mapState: MapState | null;
  onActions?: (actions: ChatAction[]) => void;
  onHistoryRequest?: (message: string) => void;
  onHistoryActions?: (actions: ChatAction[]) => void;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const ChatPanel: FC<ChatPanelProps> = ({
  isOpen,
  onToggle,
  mapState,
  onActions,
  onHistoryRequest,
  onHistoryActions,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Welcome! I'm Ursa, I'll be your guide for today. You can ask to see locations, pin your favorites on the map, or get insights about the data displayed.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isOffline = Boolean(errorMessage);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading) {
      // Keep focus in the input after responses so typing stays fluid
      inputRef.current?.focus();
    }
  }, [isLoading]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Keep the newest message visible when the panel opens or updates
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [isOpen, messages]);

  const statusLabel = useMemo(() => {
    // Map UI status to something friendly for the header pill
    if (isLoading) {
      return "Thinking...";
    }

    if (errorMessage) {
      return "Offline";
    }

    return "Online";
  }, [errorMessage, isLoading]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();

    if (!trimmed || isLoading) {
      return;
    }

    // If map state is missing, send a sane default so the API is happy
    const fallbackMapState: MapState = mapState ?? {
      center: [0, 0],
      zoom: 2,
      bbox: null,
    };

    // Build the user message first so it shows instantly
    const userMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role: "user",
      text: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    onHistoryRequest?.(trimmed);
    setDraft("");
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          map_state: fallbackMapState,
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) {
        throw new Error("Chat request failed.");
      }

      const data = (await response.json()) as {
        assistant_text: string;
        actions: ChatAction[];
        conversation_id: string;
      };

      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role: "assistant",
        text: data.assistant_text,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setConversationId(data.conversation_id);

      // Only forward actions when actions are present
      if (data.actions.length > 0) {
        onActions?.(data.actions);
        onHistoryActions?.(data.actions);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while chatting.";
      setErrorMessage(message);
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          role: "assistant",
          text: `Sorry, I couldn't reach the assistant. ${message}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <aside className={`chat-pane ${isOpen ? "is-open" : "is-closed"}`}>
      <button
        className={`chat-toggle ${isOpen ? "is-open" : "is-closed"}`}
        type="button"
        onClick={onToggle}
        aria-label={isOpen ? "Close chat panel" : "Open chat panel"}
      >
        <span className="chat-toggle-icon" aria-hidden="true">
          {isOpen ? "‹" : "›"}
        </span>
        <span className="chat-toggle-text">
          {isOpen ? "Close chat" : "Show chat"}
        </span>
      </button>

      <div className="chat-content" aria-hidden={!isOpen}>
        <header className="chat-header">
          <div>
            <p className="chat-title">URSA Assistant 2.0</p>
            <p className="chat-subtitle">
              Ask a question and let's explore together.
            </p>
          </div>
          <span className={`chat-status${isOffline ? " is-offline" : ""}`}>
            {statusLabel}
          </span>
        </header>

        <div className="chat-body">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`chat-message ${
                message.role === "user" ? "user" : "bot"
              }`}
            >
              <p className="chat-message-text">{message.text}</p>
            </div>
          ))}
          <div ref={messagesEndRef} aria-hidden="true" />
        </div>

        <form className="chat-input" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a message..."
            aria-label="Type a message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={isLoading}
          />

          <button type="submit" disabled={isLoading}>
            {isLoading ? "Sending..." : "Send"}
          </button>
        </form>
      </div>
    </aside>
  );
};

export default ChatPanel;
