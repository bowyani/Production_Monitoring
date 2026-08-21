import { useEffect, useState } from "react";
import { api, type AuditLogEntry } from "../lib/api";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

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

  const entriesPage = usePagination(entries, 15);

  return (
    <div className="app-shell">
      <h1>Audit Log</h1>
      <p className="page-subtitle">
        Every Admin action (register/edit machine, activate/deactivate, maintenance logged, CSV import) is
        recorded here — answers Direction.md §4.2 "มี Log สำหรับตรวจสอบการทำงานเบื้องต้น". There's no auth
        yet, so <code>actor</code> is a fixed label; once login exists this becomes the real user.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="toolbar"
      >
        <input
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          placeholder="Filter by target (e.g. machine ID)"
          style={{ width: 240 }}
        />
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Filter by action (e.g. MACHINE_UPDATED)"
          style={{ width: 240 }}
        />
        <button type="submit">Filter</button>
      </form>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entriesPage.pageItems.map((e) => (
                <tr key={e.id}>
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
                <tr className="row-empty">
                  <td colSpan={5}>No audit entries yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={entriesPage.page}
          pageCount={entriesPage.pageCount}
          total={entriesPage.total}
          pageSize={entriesPage.pageSize}
          onPageChange={entriesPage.setPage}
        />
      </div>
    </div>
  );
}
