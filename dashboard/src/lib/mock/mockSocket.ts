// Stands in for the /live WebSocket in the VITE_MOCK build. Forwards engine
// events to the same callback useLiveSocket() would get from real frames.
import { engine, type LiveEvent } from "./engine";

export function subscribeMockLive(onEvent: (msg: LiveEvent) => void) {
  return engine.subscribe(onEvent);
}
