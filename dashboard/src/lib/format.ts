import type { Machine } from "./api";

// MANUAL machines have no live connection at all, so their status is
// permanently stuck at the DB default "OFFLINE" (see watchdog.ts) — showing
// literal "OFFLINE" reads as an alarm/problem when it's actually just how
// every MANUAL machine always looks. This only changes what's displayed;
// the underlying `status` value (and STATUS_COLOR lookups keyed by it)
// stays "OFFLINE".
export function displayStatus(m: Pick<Machine, "status" | "dataSource">) {
  return m.dataSource === "MANUAL" && m.status === "OFFLINE" ? "MANUAL" : m.status;
}
