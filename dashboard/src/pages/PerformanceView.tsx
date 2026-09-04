import { Fragment, useEffect, useMemo, useState } from "react";
import {
  api,
  type MaintenanceOverview,
  type MaintenanceReason,
  type KpiSummary,
} from "../lib/api";
import BlindSpotNote from "../components/BlindSpotNote";
import { DonutChart } from "../components/Bars";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

const UNSPECIFIED_MODEL = "Unspecified model";

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function hrs(v: number | null) {
  return v == null ? "—" : `${v.toFixed(1)}h`;
}
function num(v: number | null, digits = 1) {
  return v == null ? "—" : v.toFixed(digits);
}

function ReasonsList({ reasons }: { reasons: MaintenanceReason[] }) {
  if (reasons.length === 0) return <>—</>;
  return (
    <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 2 }}>
      {reasons.map((r) => (
        <li key={`${r.alarmCode}::${r.alarmMessage}`} style={{ fontSize: 13 }}>
          {r.alarmMessage || r.alarmCode} ({r.count}×, {r.hours.toFixed(1)}h)
        </li>
      ))}
    </ul>
  );
}

const STATUS_LEGEND = [
  {
    status: "RUN",
    meaning: "เครื่องกำลังทำงานผลิตอยู่",
    counts: "Uptime",
  },
  {
    status: "STOP",
    meaning:
      "เครื่องหยุดโดยตั้งใจ เช่น รอรอบงานถัดไป เปลี่ยนโหมด/แม่พิมพ์ระหว่างงาน (Intentional downtime)",
    counts: "Downtime",
  },
  {
    status: "ALARM",
    meaning: "เครื่องแจ้งเตือนปัญหา (ดูรายละเอียดเพิ่มที่ตาราง alarms)",
    counts: "Downtime",
  },
  {
    status: "OFFLINE",
    meaning:
      "ไม่มีข้อมูล telemetry เข้ามาเกิน threshold ที่ตั้งไว้ (BACKEND_WATCHDOG_OFFLINE_THRESHOLD_SEC, ค่าเริ่มต้น 15 วินาที) — Watchdog job ฝั่ง backend เป็นคนตั้งสถานะนี้เอง ไม่ใช่เครื่องจักรส่งมา",
    counts: 'Downtime (นับแยกเป็น "Offline" ไม่รวมกับ Error)',
  },
];

export default function PerformanceView() {
  // Default window is 8 hours — this assumes a factory running 3 shifts
  // across 24 hours (24 / 3 = 8h/shift), so "From/To" defaults to covering
  // roughly one shift's worth of production by default.
  const [from, setFrom] = useState(() =>
    toLocalInputValue(new Date(Date.now() - 8 * 60 * 60 * 1000)),
  );
  const [to, setTo] = useState(() => toLocalInputValue(new Date()));
  const [overview, setOverview] = useState<MaintenanceOverview | null>(null);
  const [kpi, setKpi] = useState<KpiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualMachineCount, setManualMachineCount] = useState(0);
  const [inactiveMachineCount, setInactiveMachineCount] = useState(0);

  // Downtime donut has its own model picker, independent of Summary by
  // Model's row expansion below.
  const [downtimeModel, setDowntimeModel] = useState<string | null>(null);
  // Summary by Model — which row (if any) has its per-machine detail
  // expanded inline, accordion-style.
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [overviewResult, kpiResult] = await Promise.all([
        api.getMaintenanceOverview(
          new Date(from).toISOString(),
          new Date(to).toISOString(),
        ),
        api.getKpiSummary(
          new Date(from).toISOString(),
          new Date(to).toISOString(),
        ),
      ]);
      setOverview(overviewResult);
      setKpi(kpiResult);
      setDowntimeModel(
        (cur) => cur ?? overviewResult.byModel[0]?.machineModel ?? null,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "failed to load maintenance overview",
      );
    }
  }

  useEffect(() => {
    load();
    api
      .adminListMachines()
      .then((list) => {
        setManualMachineCount(
          list.filter((m) => m.dataSource === "MANUAL_CSV").length,
        );
        setInactiveMachineCount(list.filter((m) => !m.isActive).length);
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // kpi.machines (MachineKpi) has no machineModel of its own — join against
  // overview.machines (MachineMaintenance), which does, by machineId.
  const modelByMachineId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of overview?.machines ?? [])
      map.set(m.machineId, m.machineModel ?? UNSPECIFIED_MODEL);
    return map;
  }, [overview]);

  const productionByModel = useMemo(() => {
    const groups = new Map<
      string,
      {
        runtimeHours: number;
        cycleWeighted: number;
        energyKwh: number | null;
        machineIds: Set<string>;
      }
    >();
    for (const m of kpi?.machines ?? []) {
      const model = modelByMachineId.get(m.machineId) ?? UNSPECIFIED_MODEL;
      const g = groups.get(model) ?? {
        runtimeHours: 0,
        cycleWeighted: 0,
        energyKwh: null,
        machineIds: new Set(),
      };
      g.runtimeHours += m.runtimeHours;
      if (m.avgCycleTimeSec != null)
        g.cycleWeighted += m.avgCycleTimeSec * m.runtimeHours;
      if (m.estimatedEnergyKwh != null)
        g.energyKwh = (g.energyKwh ?? 0) + m.estimatedEnergyKwh;
      g.machineIds.add(m.machineId);
      groups.set(model, g);
    }
    return [...groups.entries()]
      .map(([model, g]) => ({
        model,
        machineCount: g.machineIds.size,
        runtimeHours: g.runtimeHours,
        avgCycleTimeSec:
          g.runtimeHours > 0 ? g.cycleWeighted / g.runtimeHours : null,
        estimatedEnergyKwh: g.energyKwh,
      }))
      .sort((a, b) => a.model.localeCompare(b.model));
  }, [kpi, modelByMachineId]);

  // Per-machine detail shown inline under the expanded Summary-by-Model row
  // — combines what used to be separate "per-machine Production Detail" and
  // "Error Reasons by Machine" sections into one place.
  const expandedMachines = useMemo(() => {
    if (expandedModel == null) return [];
    const kpiById = new Map((kpi?.machines ?? []).map((m) => [m.machineId, m]));
    return (overview?.machines ?? [])
      .filter((m) => (m.machineModel ?? UNSPECIFIED_MODEL) === expandedModel)
      .map((m) => {
        const k = kpiById.get(m.machineId);
        return {
          machineId: m.machineId,
          machineName: m.machineName,
          runtimeHours: k?.runtimeHours ?? null,
          avgCycleTimeSec: k?.avgCycleTimeSec ?? null,
          estimatedEnergyKwh: k?.estimatedEnergyKwh ?? null,
          alarmCount: m.alarmCount,
          topReasons: m.topReasons,
        };
      });
  }, [overview, kpi, expandedModel]);

  const productionPage = usePagination(productionByModel, 10);
  const byModelPage = usePagination(overview?.byModel ?? [], 10);
  const downtimeSelected =
    overview?.byModel.find((r) => r.machineModel === downtimeModel) ?? null;

  return (
    <div className="app-shell">
      <h1>Performance</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="toolbar"
      >
        <label>
          From{" "}
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To{" "}
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button type="submit">Load</button>
      </form>
      {error && <div className="notice notice-error">{error}</div>}

      <BlindSpotNote
        manualCount={manualMachineCount}
        inactiveCount={inactiveMachineCount}
      />

      {overview && (
        <>
          <section>
            <h2>Downtime — Intentional vs Error vs Offline</h2>

            <label>
              Model{" "}
              <select
                value={downtimeModel ?? ""}
                onChange={(e) => setDowntimeModel(e.target.value)}
              >
                {(overview.byModel ?? []).map((r) => (
                  <option key={r.machineModel} value={r.machineModel}>
                    {r.machineModel}
                  </option>
                ))}
              </select>
            </label>

            {downtimeSelected ? (
              <DonutChart
                data={[
                  {
                    key: "stop",
                    label: "Intentional",
                    value: downtimeSelected.totalIntentionalDowntimeHours,
                    color: "#9a6700",
                  },
                  {
                    key: "alarm",
                    label: "Error",
                    value: downtimeSelected.totalErrorDowntimeHours,
                    color: "#cf222e",
                  },
                  {
                    key: "offline",
                    label: "Offline",
                    value: downtimeSelected.totalOfflineHours,
                    color: "#57606a",
                  },
                  {
                    key: "other",
                    label: "Other",
                    value: downtimeSelected.totalOtherDowntimeHours,
                    color: "#8250df",
                  },
                ]}
                formatValue={(v) => `${v.toFixed(1)}h`}
              />
            ) : (
              <p style={{ fontSize: 13, color: "#57606a" }}>
                No models to show yet.
              </p>
            )}
            <div className="table-card" style={{ padding: 0 }}>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Meaning</th>
                      <th>Counted as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STATUS_LEGEND.map((row) => (
                      <tr key={row.status}>
                        <td>
                          <code>{row.status}</code>
                        </td>
                        <td style={{ fontSize: 13 }}>{row.meaning}</td>
                        <td style={{ fontSize: 13 }}>{row.counts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section>
            <h2>Summary by Model — which model tends to have problems</h2>
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
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {byModelPage.pageItems.map((r) => {
                      const isExpanded = expandedModel === r.machineModel;
                      return (
                        <Fragment key={r.machineModel}>
                          <tr
                            style={
                              isExpanded
                                ? { background: "var(--color-accent-subtle)" }
                                : undefined
                            }
                          >
                            <td>
                              <strong>{r.machineModel}</strong>
                            </td>
                            <td>{r.machineCount}</td>
                            <td
                              style={{
                                color:
                                  r.machinesOverdue > 0 ? "#cf222e" : undefined,
                              }}
                            >
                              {r.machinesOverdue}
                            </td>
                            <td
                              style={{
                                color:
                                  r.totalErrorDowntimeHours > 0
                                    ? "#cf222e"
                                    : undefined,
                              }}
                            >
                              {hrs(r.totalErrorDowntimeHours)}
                            </td>
                            <td>{hrs(r.totalIntentionalDowntimeHours)}</td>
                            <td>{hrs(r.totalOfflineHours)}</td>
                            <td>{hrs(r.totalOtherDowntimeHours)}</td>
                            <td>{r.totalAlarmCount}</td>
                            <td style={{ fontSize: 13 }}>
                              <ReasonsList reasons={r.topReasons} />
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedModel(
                                    isExpanded ? null : r.machineModel,
                                  )
                                }
                              >
                                {isExpanded ? "Hide machines" : "View machines"}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td
                                colSpan={10}
                                style={{
                                  background: "var(--color-canvas)",
                                  padding: 12,
                                }}
                              >
                                <table style={{ width: "100%" }}>
                                  <thead>
                                    <tr>
                                      <th>Machine</th>
                                      <th>Runtime (h)</th>
                                      <th>Avg Cycle (s)</th>
                                      <th>Energy (kWh)</th>
                                      <th>Alarm Count</th>
                                      <th>Top Reasons</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {expandedMachines.map((m) => (
                                      <tr key={m.machineId}>
                                        <td>
                                          {m.machineId} — {m.machineName}
                                        </td>
                                        <td>{num(m.runtimeHours, 2)}</td>
                                        <td>{num(m.avgCycleTimeSec)}</td>
                                        <td>{num(m.estimatedEnergyKwh)}</td>
                                        <td>{m.alarmCount}</td>
                                        <td style={{ fontSize: 13 }}>
                                          <ReasonsList reasons={m.topReasons} />
                                        </td>
                                      </tr>
                                    ))}
                                    {expandedMachines.length === 0 && (
                                      <tr className="row-empty">
                                        <td colSpan={6}>
                                          No machines for this model.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {overview.byModel.length === 0 && (
                      <tr className="row-empty">
                        <td colSpan={10}>No machines to summarize.</td>
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

          <section>
            <h2>Production Detail — Cycle Time, Runtime &amp; Energy</h2>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Machines</th>
                      <th>Runtime (h)</th>
                      <th>Avg Cycle (s)</th>
                      <th>Energy (kWh)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionPage.pageItems.map((r) => (
                      <tr key={r.model}>
                        <td>
                          <strong>{r.model}</strong>
                        </td>
                        <td>{r.machineCount}</td>
                        <td>{num(r.runtimeHours, 2)}</td>
                        <td>{num(r.avgCycleTimeSec)}</td>
                        <td>{num(r.estimatedEnergyKwh)}</td>
                      </tr>
                    ))}
                    {(!kpi || kpi.machines.length === 0) && (
                      <tr className="row-empty">
                        <td colSpan={5}>No data in this window.</td>
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
        </>
      )}
    </div>
  );
}
