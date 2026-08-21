import { useEffect, useMemo, useState } from "react";
import { api, type Machine, type Alarm, type ProductionJob } from "../lib/api";
import { useLiveSocket } from "../lib/useLiveSocket";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";
import { displayStatus } from "../lib/format";
import HistoricalDataSection from "../components/HistoricalDataSection";

const STATUS_COLOR: Record<string, string> = {
  RUN: "#1a7f37",
  STOP: "#9a6700",
  ALARM: "#cf222e",
  OFFLINE: "#57606a",
  MANUAL: "#57606a",
  INACTIVE: "#8c959f",
};

// Machines needing attention should sort to the top of the list so an
// operator scanning the floor view sees problems first, not last.
const STATUS_PRIORITY: Record<string, number> = {
  ALARM: 0,
  STOP: 1,
  OFFLINE: 2,
  RUN: 3,
  INACTIVE: 4,
};

const UNASSIGNED_ZONE = "Unassigned";

type LiveMachine = Machine & { cycleTimeSec?: number; shotCount?: number };

export default function OperatorView() {
  const [machines, setMachines] = useState<LiveMachine[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);

  // Only the running jobs, just enough to show current Job/Product/Good/
  // Reject per machine in the grid below (Direction.md §4.3). Full search
  // with filters/sort lives on the Production page now.
  const [runningJobs, setRunningJobs] = useState<ProductionJob[]>([]);

  function refreshRunningJobs() {
    api.searchJobs({ status: "RUNNING" }).then(setRunningJobs).catch(console.error);
  }

  useEffect(() => {
    refreshRunningJobs();
    api.getMachines().then(setMachines).catch(console.error);
    api.getActiveAlarms().then(setAlarms).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const machineById = useMemo(() => {
    const map = new Map<string, LiveMachine>();
    for (const m of machines) map.set(m.machineId, m);
    return map;
  }, [machines]);

  const [zoneFilter, setZoneFilter] = useState<string>("ALL");

  function zoneOf(m: LiveMachine) {
    return m.location?.trim() || UNASSIGNED_ZONE;
  }

  // Zone tabs so a floor with many machines (100s, spread across a plant)
  // can be filtered down to "just my area" instead of one long list.
  const zones = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of machines) counts.set(zoneOf(m), (counts.get(zoneOf(m)) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [machines]);

  const visibleMachines = useMemo(() => {
    const filtered = zoneFilter === "ALL" ? machines : machines.filter((m) => zoneOf(m) === zoneFilter);
    return [...filtered].sort((a, b) => {
      const pDiff = (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
      if (pDiff !== 0) return pDiff;
      return a.machineId.localeCompare(b.machineId);
    });
  }, [machines, zoneFilter]);

  // The machine grid must show current Job Number/Product/Cycle Time/Good-Reject
  // per Direction.md §4.3, so the current job per machine is looked up here.
  const currentJobByMachine = useMemo(() => {
    const map = new Map<string, ProductionJob>();
    for (const j of runningJobs) {
      if (!map.has(j.machineId)) map.set(j.machineId, j);
    }
    return map;
  }, [runningJobs]);

  useLiveSocket((msg) => {
    if (msg.event === "telemetry") {
      setMachines((prev) =>
        prev.map((m) =>
          m.machineId === msg.data.machineId
            ? {
                ...m,
                status: msg.data.status,
                lastSeenAt: new Date().toISOString(),
                cycleTimeSec: msg.data.cycleTimeSec ?? m.cycleTimeSec,
                shotCount: msg.data.shotCount ?? m.shotCount,
              }
            : m
        )
      );
    }
    if (msg.event === "status") {
      setMachines((prev) =>
        prev.map((m) =>
          m.machineId === msg.data.machineId
            ? { ...m, status: msg.data.status, lastSeenAt: new Date().toISOString() }
            : m
        )
      );
    }
    if (msg.event === "alarm") {
      api.getActiveAlarms().then(setAlarms).catch(console.error);
    }
    if (msg.event === "job") {
      refreshRunningJobs();
    }
  });

  const mqttMachines = useMemo(() => visibleMachines.filter((m) => m.dataSource === "MQTT"), [visibleMachines]);
  const manualMachines = useMemo(() => visibleMachines.filter((m) => m.dataSource === "MANUAL"), [visibleMachines]);

  const mqttPage = usePagination(mqttMachines, 10);
  const manualPage = usePagination(manualMachines, 10);
  const alarmsPage = usePagination(alarms, 10);

  return (
    <div className="app-shell">
      <h1>Operation</h1>

      <div className="zone zone-live">
        <div className="zone-eyebrow zone-eyebrow-live">🔴 LIVE</div>
        <h2>Operator Dashboard</h2>

      <section>
        <h2>Machines</h2>

        <div className="pill-group">
          <button className={"pill" + (zoneFilter === "ALL" ? " active" : "")} onClick={() => setZoneFilter("ALL")}>
            All ({machines.length})
          </button>
          {zones.map(([zone, count]) => (
            <button
              key={zone}
              className={"pill" + (zoneFilter === zone ? " active" : "")}
              onClick={() => setZoneFilter(zone)}
            >
              📍 {zone} ({count})
            </button>
          ))}
        </div>

        <h3>MQTT — New Machines</h3>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Machine</th>
                  <th>Zone</th>
                  <th>Job</th>
                  <th>Product</th>
                  <th>Cycle (s)</th>
                  <th>Shot #</th>
                  <th>Good</th>
                  <th>Reject</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {mqttPage.pageItems.map((m) => {
                  const currentJob = currentJobByMachine.get(m.machineId);
                  const color = STATUS_COLOR[m.status] ?? "#57606a";
                  const isAlarm = m.status === "ALARM";
                  return (
                    <tr key={m.machineId} className={isAlarm ? "row-flag" : undefined}>
                      <td>
                        <span className="badge" style={{ background: color }}>
                          {displayStatus(m)}
                        </span>
                      </td>
                      <td>
                        <strong>{m.machineId}</strong>
                        <div style={{ fontSize: 12, color: "#57606a" }}>{m.machineName}</div>
                      </td>
                      <td>{m.location ?? "—"}</td>
                      <td>{currentJob?.jobNumber ?? "—"}</td>
                      <td>{currentJob?.productCode ?? "—"}</td>
                      <td>{m.cycleTimeSec ?? "—"}</td>
                      <td>{m.shotCount ?? "—"}</td>
                      <td style={{ fontWeight: 600 }}>{currentJob?.goodQty ?? "—"}</td>
                      <td style={{ fontWeight: 600, color: currentJob && currentJob.rejectQty > 0 ? "#cf222e" : undefined }}>
                        {currentJob?.rejectQty ?? "—"}
                      </td>
                      <td style={{ fontSize: 12, color: "#57606a" }}>
                        {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleTimeString() : "-"}
                      </td>
                    </tr>
                  );
                })}
                {mqttMachines.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={10}>No MQTT machines in this zone.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={mqttPage.page}
            pageCount={mqttPage.pageCount}
            total={mqttPage.total}
            pageSize={mqttPage.pageSize}
            onPageChange={mqttPage.setPage}
          />
        </div>

        <h3>MANUAL — Old Machines</h3>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Machine</th>
                  <th>Zone</th>
                  <th>Job</th>
                  <th>Product</th>
                  <th>Cycle (s)</th>
                  <th>Shot #</th>
                  <th>Good</th>
                  <th>Reject</th>
                  <th>Last imported</th>
                </tr>
              </thead>
              <tbody>
                {manualPage.pageItems.map((m) => {
                  const currentJob = currentJobByMachine.get(m.machineId);
                  const color = STATUS_COLOR[displayStatus(m)] ?? "#57606a";
                  return (
                    <tr key={m.machineId}>
                      <td>
                        <span className="badge" style={{ background: color }}>
                          {displayStatus(m)}
                        </span>
                      </td>
                      <td>
                        <strong>{m.machineId}</strong>
                        <div style={{ fontSize: 12, color: "#57606a" }}>{m.machineName}</div>
                      </td>
                      <td>{m.location ?? "—"}</td>
                      <td>{currentJob?.jobNumber ?? "—"}</td>
                      <td>{currentJob?.productCode ?? "—"}</td>
                      <td>{m.cycleTimeSec ?? "—"}</td>
                      <td>{m.shotCount ?? "—"}</td>
                      <td style={{ fontWeight: 600 }}>{currentJob?.goodQty ?? "—"}</td>
                      <td style={{ fontWeight: 600, color: currentJob && currentJob.rejectQty > 0 ? "#cf222e" : undefined }}>
                        {currentJob?.rejectQty ?? "—"}
                      </td>
                      <td style={{ fontSize: 12, color: "#57606a" }}>
                        {m.lastImportedAt ? new Date(m.lastImportedAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  );
                })}
                {manualMachines.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={10}>No MANUAL machines in this zone.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={manualPage.page}
            pageCount={manualPage.pageCount}
            total={manualPage.total}
            pageSize={manualPage.pageSize}
            onPageChange={manualPage.setPage}
          />
        </div>
      </section>

      <section>
        <h2>Active Alarms</h2>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Location</th>
                  <th>Code</th>
                  <th>Message</th>
                  <th>Raised</th>
                  <th>Manufacturer</th>
                </tr>
              </thead>
              <tbody>
                {alarmsPage.pageItems.map((a) => {
                  const m = machineById.get(a.machineId);
                  return (
                    <tr key={a.id}>
                      <td>{a.machineId}</td>
                      <td>{m?.location ? `📍 ${m.location}` : "—"}</td>
                      <td>{a.alarmCode}</td>
                      <td>{a.alarmMessage}</td>
                      <td>{new Date(a.alarmTimestamp).toLocaleString()}</td>
                      <td>{m?.manufacturerPhone ? `☎ ${m.manufacturerPhone}` : "—"}</td>
                    </tr>
                  );
                })}
                {alarms.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={6}>No active alarms.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={alarmsPage.page}
            pageCount={alarmsPage.pageCount}
            total={alarmsPage.total}
            pageSize={alarmsPage.pageSize}
            onPageChange={alarmsPage.setPage}
          />
        </div>
      </section>
      </div>

      <HistoricalDataSection />
    </div>
  );
}
