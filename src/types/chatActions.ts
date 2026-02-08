export type GeocodeResult = {
  status: "resolved";
  lat: number;
  lon: number;
  display_name?: string;
};

export type PinResult = {
  id: string;
  title: string;
  notes?: string | null;
  lat: number;
  lon: number;
};

export type RemovePinsResult = {
  removed_all: boolean;
  ids?: string[];
  count: number;
};

export type ChatAction =
  | { type: "geocode"; result: GeocodeResult }
  | { type: "list_pins"; result: unknown[] }
  | { type: "create_pin"; result: PinResult }
  | { type: "remove_pin"; result: { id?: string; removed?: boolean } }
  | { type: "remove_pins"; result: RemovePinsResult };
