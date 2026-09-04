import type { ConnectionType } from "./api";

// Shared look for the connection-type badge so Machine Management and Gateway
// Management render it identically. Colours reuse the palette already used
// across the dashboard (green = healthy/live, purple = system, grey = none).
const CONNECTION_META: Record<ConnectionType, { label: string; color: string }> = {
  SIMULATOR: { label: "Simulator", color: "#8250df" },
  MODBUS_TCP: { label: "Modbus TCP", color: "#1a7f37" },
  MODBUS_RTU: { label: "Modbus RTU", color: "#1f6feb" },
  MANUAL_CSV: { label: "Manual CSV", color: "#57606a" },
};

export function connectionMeta(type: ConnectionType | null) {
  return type ? CONNECTION_META[type] : { label: "—", color: "#8c959f" };
}
