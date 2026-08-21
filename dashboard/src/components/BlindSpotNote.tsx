// Short-form version of the blind-spot warning (GAP_ANALYSIS §1.4): MANUAL
// (no live connection) and deactivated machines are excluded from every
// number derived from telemetry/status events on this page. Kept to one
// line by design — full reasoning is in the hover title, not inline.
export default function BlindSpotNote({
  manualCount,
  inactiveCount,
}: {
  manualCount: number;
  inactiveCount: number;
}) {
  if (manualCount === 0 && inactiveCount === 0) return null;

  const parts: string[] = [];
  if (manualCount > 0) parts.push(`${manualCount} MANUAL (no live data)`);
  if (inactiveCount > 0) parts.push(`${inactiveCount} deactivated`);

  return (
    <div
      title="GAP_ANALYSIS §1.4: machines with no live data connection (dataSource=MANUAL) or that are deactivated have no telemetry/status-event history, so they're excluded entirely — a permanent blind spot, not a temporary glitch. These numbers only represent the machines this system can see."
      style={{
        fontSize: 12,
        color: "#9a6700",
        background: "#fff8e6",
        border: "1px solid #f0c36d",
        borderRadius: 6,
        padding: "4px 10px",
        display: "inline-block",
        cursor: "help",
      }}
    >
      ⚠ Excludes {parts.join(" + ")} machine(s) — not full-plant numbers.
    </div>
  );
}
