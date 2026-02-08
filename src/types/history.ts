export type HistoryEntry = {
  id: string;
  kind: "request" | "action";
  title: string;
  detail: string;
  timestamp: string;
};
