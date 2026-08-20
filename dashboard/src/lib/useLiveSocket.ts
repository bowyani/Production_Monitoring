import { useEffect, useRef } from "react";

const WS_URL = import.meta.env.VITE_WS_URL;

export type LiveEvent =
  | { event: "telemetry"; data: { machineId: string; status: string; timestamp: string } }
  | { event: "job"; data: { machineId: string; jobNumber: string; event: string } }
  | { event: "alarm"; data: { machineId: string; alarmCode: string; event: string } }
  | { event: "status"; data: { machineId: string; status: string } };

export function useLiveSocket(onEvent: (msg: LiveEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      socket = new WebSocket(WS_URL);
      socket.onmessage = (ev) => {
        try {
          handlerRef.current(JSON.parse(ev.data));
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        reconnectTimer = setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);
}
