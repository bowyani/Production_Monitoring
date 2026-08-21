import { useEffect, useState } from "react";
import {
  api,
  type MaintenanceOverview,
  type MachineMaintenance,
  type MaintenanceReason,
  type KpiSummary,
} from "../lib/api";
import BlindSpotNote from "../components/BlindSpotNote";
import { StackedBarChart } from "../components/Bars";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function hrs(v: number | null) {
  return v == null ? "—" : `${v.toFixed(1)}h`;
}
function pct(v: number | null) {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function num(v: number | null, digits = 1) {
  return v == null ? "—" : v.toFixed(digits);
}

function reasonsList(reasons: MaintenanceReason[]) {
  if (reasons.length === 0) return "—";
  return reasons.map((r) => `${r.alarmMessage || r.alarmCode} (${r.count}×, ${r.hours.toFixed(1)}h)`).join("; ");
}

function maintenanceStatus(m: MachineMaintenance): { label: string; color: string } {
  if (m.dataSource === "MANUAL") return { label: "No live data", color: "#57606a" };
  if (m.maintenanceIntervalHours == null) return { label: "No interval set", color: "#57606a" };
  if (m.maintenanceDue) return { label: "Overdue — schedule PM", color: "#cf222e" };
  if ((m.pctOfInterval ?? 0) >= 0.8) return { label: "Due soon", color: "#9a6700" };
  return { label: "OK", color: "#1a7f37" };
}

export default function ChiefOperatorView() {
  const [from, setFrom] = useState(() => toLocalInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toLocalInputValue(new Date()));
  const [overview, setOverview] = useState<MaintenanceOverview | null>(null);
  const [kpi, setKpi] = useState<KpiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [manualMachineCount, setManualMachineCount] = useState(0);
  const [inactiveMachineCount, setInactiveMachineCount] = useState(0);

  async function load() {
    setError(null);
    try {
      const [overviewResult, kpiResult] = await Promise.all([
        api.getMaintenanceOverview(new Date(from).toISOString(), new Date(to).toISOString()),
        api.getKpiSummary(new Date(from).toISOString(), new Date(to).toISOString()),
      ]);
      setOverview(overviewResult);
      setKpi(kpiResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load maintenance overview");
    }
  }

  useEffect(() => {
    load();
    api
      .adminListMachines()
      .then((list) => {
        setManualMachineCount(list.filter((m) => m.dataSource === "MANUAL").length);
        setInactiveMachineCount(list.filter((m) => !m.isActive).length);
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logMaintenance(machineId: string) {
    setLoggingId(machineId);
    try {
      await api.adminLogMaintenance(machineId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to log maintenance");
    } finally {
      setLoggingId(null);
    }
  }

  const machinesPage = usePagination(overview?.machines ?? [], 10);
  const productionPage = usePagination(kpi?.machines ?? [], 10);
  const errorReasonsPage = usePagination(
    (overview?.machines ?? []).filter((m) => m.dataSource === "MQTT"),
    10
  );
  const byModelPage = usePagination(overview?.byModel ?? [], 10);

  return (
    <div className="app-shell">
      <div className="page-title">
        <h1>Chief Operator — Maintenance &amp; Downtime</h1>
        <div className="page-subtitle">
          Plan preventive maintenance from actual running hours, and see which machines/models eat the most
          downtime and why.
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="toolbar"
      >
        <label>
          From <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit">Load</button>
      </form>
      {error && <div className="notice notice-error">{error}</div>}

      <BlindSpotNote manualCount={manualMachineCount} inactiveCount={inactiveMachineCount} />

      {overview && (
        <>
          <section>
            <h2>Preventive Maintenance Planning</h2>
            <p style={{ fontSize: 12, color: "#57606a" }}>
              Running hours since last maintenance, reconstructed from status-event history (not a counter on the
              machine). MANUAL machines have no telemetry, so this can't be computed for them.
            </p>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Machine</th>
                      <th>Model</th>
                      <th>Run Hrs Since PM</th>
                      <th>Interval</th>
                      <th>Usage</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {machinesPage.pageItems.map((m) => {
                      const st = maintenanceStatus(m);
                      const pct = m.pctOfInterval != null ? Math.min(1, m.pctOfInterval) : null;
                      return (
                        <tr key={m.machineId}>
                          <td>
                            {m.machineId} — {m.machineName}
                          </td>
                          <td>{m.machineModel ?? "—"}</td>
                          <td>{hrs(m.runHoursSinceMaintenance)}</td>
                          <td>{m.maintenanceIntervalHours != null ? `${m.maintenanceIntervalHours}h` : "—"}</td>
                          <td style={{ minWidth: 120 }}>
                            {pct != null ? (
                              <div style={{ background: "#f6f8fa", borderRadius: 4, height: 10, width: 100 }}>
                                <div
                                  style={{
                                    width: `${pct * 100}%`,
                                    height: "100%",
                                    borderRadius: 4,
                                    background: m.maintenanceDue ? "#cf222e" : pct >= 0.8 ? "#9a6700" : "#1a7f37",
                                  }}
                                />
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td style={{ color: st.color, fontWeight: 600 }}>{st.label}</td>
                          <td>
                            <button
                              type="button"
                              disabled={loggingId === m.machineId}
                              onClick={() => logMaintenance(m.machineId)}
                            >
                              Log PM done
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={machinesPage.page}
                pageCount={machinesPage.pageCount}
                total={machinesPage.total}
                pageSize={machinesPage.pageSize}
                onPageChange={machinesPage.setPage}
              />
            </div>
          </section>

          <section>
            <h2>Production Detail — Cycle Time, Runtime &amp; Energy</h2>
            <p style={{ fontSize: 12, color: "#57606a" }}>
              Cycle time drifting up while runtime since maintenance climbs is the early signal that a machine
              needs a rest, not just the interval clock.
            </p>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Machine</th>
                      <th>Reject Rate</th>
                      <th>Runtime (h)</th>
                      <th>Avg Cycle (s)</th>
                      <th>Target Cycle (s)</th>
                      <th>Energy (kWh)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionPage.pageItems.map((m) => (
                      <tr key={m.machineId}>
                        <td>
                          {m.machineId} — {m.machineName}
                        </td>
                        <td>{pct(m.rejectRate)}</td>
                        <td>{num(m.runtimeHours, 2)}</td>
                        <td>{num(m.avgCycleTimeSec)}</td>
                        <td>{m.targetCycleTimeSec ?? "—"}</td>
                        <td>{num(m.estimatedEnergyKwh)}</td>
                      </tr>
                    ))}
                    {(!kpi || kpi.machines.length === 0) && (
                      <tr className="row-empty">
                        <td colSpan={6}>No data in this window.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={productionPage.page}
                pageCount={productionPage.pageCount}
                total={productionPage.total}
                pageSize={productionPage.pageSize}
                onPageChange={productionPage.setPage}
              />
            </div>
          </section>

          <section>
            <h2>Downtime — Intentional vs Error vs Offline</h2>
            <p style={{ fontSize: 12, color: "#57606a" }}>
              Intentional = between-job stop (STOP status). Error = machine alarm (ALARM status). Offline =
              connection/telemetry loss.
            </p>
            <StackedBarChart
              data={overview.machines
                .filter((m) => m.dataSource === "MQTT")
                .map((m) => ({
                  label: `${m.machineId}`,
                  segments: [
                    { key: "stop", value: m.intentionalDowntimeHours ?? 0, color: "#9a6700", label: "Intentional" },
                    { key: "alarm", value: m.errorDowntimeHours ?? 0, color: "#cf222e", label: "Error" },
                    { key: "offline", value: m.offlineHours ?? 0, color: "#57606a", label: "Offline" },
                    { key: "other", value: m.otherDowntimeHours ?? 0, color: "#8250df", label: "Other" },
                  ],
                }))}
            />
          </section>

          <section>
            <h2>Error Reasons by Machine</h2>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Machine</th>
                      <th>Alarm Count</th>
                      <th>Top Reasons (count × hours)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorReasonsPage.pageItems.map((m) => (
                      <tr key={m.machineId}>
                        <td>{m.machineId}</td>
                        <td>{m.alarmCount}</td>
                        <td style={{ fontSize: 13 }}>{reasonsList(m.topReasons)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={errorReasonsPage.page}
                pageCount={errorReasonsPage.pageCount}
                total={errorReasonsPage.total}
                pageSize={errorReasonsPage.pageSize}
                onPageChange={errorReasonsPage.setPage}
              />
            </div>
          </section>

          <section>
            <h2>Summary by Model — which model tends to have problems</h2>
            <p style={{ fontSize: 12, color: "#57606a" }}>Sorted by total error downtime, worst first.</p>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Machines</th>
                      <th>Overdue PM</th>
                      <th>Error Downtime</th>
                      <th>Intentional Downtime</th>
                      <th>Offline</th>
                      <th>Other</th>
                      <th>Alarms</th>
                      <th>Top Reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byModelPage.pageItems.map((r) => (
                      <tr key={r.machineModel}>
                        <td>
                          <strong>{r.machineModel}</strong>
                        </td>
                        <td>{r.machineCount}</td>
                        <td style={{ color: r.machinesOverdue > 0 ? "#cf222e" : undefined }}>{r.machinesOverdue}</td>
                        <td style={{ color: r.totalErrorDowntimeHours > 0 ? "#cf222e" : undefined }}>
                          {hrs(r.totalErrorDowntimeHours)}
                        </td>
                        <td>{hrs(r.totalIntentionalDowntimeHours)}</td>
                        <td>{hrs(r.totalOfflineHours)}</td>
                        <td>{hrs(r.totalOtherDowntimeHours)}</td>
                        <td>{r.totalAlarmCount}</td>
                        <td style={{ fontSize: 13 }}>{reasonsList(r.topReasons)}</td>
                      </tr>
                    ))}
                    {overview.byModel.length === 0 && (
                      <tr className="row-empty">
                        <td colSpan={9}>No machines to summarize.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={byModelPage.page}
                pageCount={byModelPage.pageCount}
                total={byModelPage.total}
                pageSize={byModelPage.pageSize}
                onPageChange={byModelPage.setPage}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
