import { useEffect, useState } from "react";
import { api, type SystemStats, type AuditLogEntry } from "../lib/api";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

function bytesToLabel(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Actors written by a human clicking through the UI. Anything else (e.g.
// "watchdog", "docker") is a system-triggered action — see logAudit call
// sites in the backend — and gets a visibly different color below so the
// two are never confused at a glance (item 9).
const HUMAN_UI_ACTORS = new Set(["admin-ui", "erp-ui"]);
function isSystemActor(actor: string) {
  return !HUMAN_UI_ACTORS.has(actor);
}

function formatDetail(detail: string | null) {
  if (!detail) return "—";
  try {
    return JSON.stringify(JSON.parse(detail));
  } catch {
    return detail;
  }
}

export default function AdminView() {
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [auditTargetId, setAuditTargetId] = useState("");
  const [auditAction, setAuditAction] = useState("");

  function loadAuditLog() {
    api
      .getAuditLog({ targetId: auditTargetId || undefined, action: auditAction || undefined, limit: "200" })
      .then(setEntries)
      .catch(console.error);
  }

  useEffect(loadAuditLog, []);

  useEffect(() => {
    api.getSystemStats().then(setStats).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const id = setInterval(() => api.getSystemStats().then(setStats).catch(() => {}), 15000);
    return () => clearInterval(id);
  }, []);

  const entriesPage = usePagination(entries, 15);

  return (
    <div className="app-shell">
      <div className="page-title">
        <h1>Admin — IT System Management</h1>
        <div className="page-subtitle">
          This page is for IT: watch database/ingestion health and review the audit trail. Registering/activating
          machines moved to Machine Management; specs live in ERP.
        </div>
      </div>

      <section>
        <h2>System Health</h2>
        <p style={{ fontSize: 13, color: "#57606a" }}>
          Live numbers from this database, refreshed every 15s, plus the honest list of what's known to be
          missing before this could run against a real 200-machine line.
        </p>

        {stats && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {[
                ["Machines (active / manual / total)", `${stats.machines.active} / ${stats.machines.manual} / ${stats.machines.total}`],
                ["Telemetry rows", stats.rowCounts.machine_telemetry.toLocaleString()],
                ["Ingestion rate (5m avg)", `${stats.telemetry.estimatedRowsPerSecond} rows/s`],
                ["Rows last 60s", stats.telemetry.rowsLast60s],
                ["DB size", stats.database.totalSizePretty ?? "—"],
                ["Audit log entries", stats.rowCounts.audit_log.toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="card">
                  <div style={{ fontSize: 12, color: "#57606a" }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>

            <h3>Table sizes</h3>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Row count</th>
                      <th>Disk size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.database.tables.map((t) => (
                      <tr key={t.name}>
                        <td>{t.name}</td>
                        <td>{stats.rowCounts[t.name]?.toLocaleString() ?? "—"}</td>
                        <td>{t.sizePretty ?? bytesToLabel(t.sizeBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <h3>Should this worry you?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.6 }}>
              At {stats.machines.active} active machines and{" "}
              {stats.telemetry.estimatedRowsPerSecond.toFixed(2)} rows/s, this single PostgreSQL instance is
              nowhere near stressed — <code>machine_telemetry</code> has one index on{" "}
              <code>(machine_id, timestamp)</code> and every query the dashboard makes hits that index. The
              number that actually matters is what happens at 200 machines publishing every ~2s: that's
              roughly <strong>8.6 million rows/day</strong> into one table. At that point you'd need{" "}
              <strong>time-based partitioning</strong> (or moving to TimescaleDB, which is a Postgres
              extension — no backend code changes needed to switch) plus a <strong>retention policy</strong>{" "}
              that rolls old raw ticks up into hourly aggregates. None of that is implemented here — it's
              future work, sized for a scale this prototype was never asked to run at. See "แนวทางขยายจาก 3
              เครื่องไปยัง 200 เครื่อง" in the README for the full plan.
            </p>
          </>
        )}
        {error && <div className="notice notice-error">{error}</div>}
      </section>

      <section>
        <h2>Audit Log</h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadAuditLog();
          }}
          className="toolbar"
        >
          <input
            value={auditTargetId}
            onChange={(e) => setAuditTargetId(e.target.value)}
            placeholder="Filter by target (e.g. machine ID)"
            style={{ width: 240 }}
          />
          <input
            value={auditAction}
            onChange={(e) => setAuditAction(e.target.value)}
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
                {entriesPage.pageItems.map((e) => {
                  const system = isSystemActor(e.actor);
                  return (
                    <tr key={e.id} style={system ? { background: "#faf5ff" } : undefined}>
                      <td>{new Date(e.createdAt).toLocaleString()}</td>
                      <td>
                        <span
                          className="badge"
                          style={{ background: system ? "#8250df" : "#57606a" }}
                          title={system ? "Performed automatically by the system" : "Performed by a person via the UI"}
                        >
                          {e.actor}
                        </span>
                      </td>
                      <td>{e.action}</td>
                      <td>
                        {e.targetType}:{e.targetId}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{formatDetail(e.detail)}</td>
                    </tr>
                  );
                })}
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
      </section>
    </div>
  );
}
