import { useEffect, useState } from "react";
import { api, type AuditLogEntry } from "../lib/api";

function formatDetail(detail: string | null) {
  if (!detail) return "—";
  try {
    return JSON.stringify(JSON.parse(detail));
  } catch {
    return detail;
  }
}

export default function AuditLogView() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [targetId, setTargetId] = useState("");
  const [action, setAction] = useState("");

  function load() {
    api
      .getAuditLog({ targetId: targetId || undefined, action: action || undefined, limit: "200" })
      .then(setEntries)
      .catch(console.error);
  }

  useEffect(load, []);

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, display: "grid", gap: 24 }}>
      <h1>Audit Log</h1>
      <p style={{ fontSize: 13, color: "#57606a", maxWidth: 680 }}>
        Every Admin action (register/edit machine, activate/deactivate, maintenance logged, CSV import) is
        recorded here — answers Direction.md §4.2 "มี Log สำหรับตรวจสอบการทำงานเบื้องต้น". There's no auth
        yet, so <code>actor</code> is a fixed label; once login exists this becomes the real user.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          placeholder="Filter by target (e.g. machine ID)"
          style={{ padding: 6, width: 240 }}
        />
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Filter by action (e.g. MACHINE_UPDATED)"
          style={{ padding: 6, width: 240 }}
        />
        <button type="submit">Filter</button>
      </form>

      <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} style={{ borderBottom: "1px solid #eaeef2" }}>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
              <td>{e.actor}</td>
              <td>{e.action}</td>
              <td>
                {e.targetType}:{e.targetId}
              </td>
              <td style={{ fontFamily: "monospace", fontSize: 12 }}>{formatDetail(e.detail)}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5}>No audit entries yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
