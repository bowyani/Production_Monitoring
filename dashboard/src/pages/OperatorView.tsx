import { useEffect, useMemo, useState } from "react";
import { api, type Machine, type Alarm, type ProductionJob } from "../lib/api";
import { useLiveSocket } from "../lib/useLiveSocket";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

const STATUS_COLOR: Record<string, string> = {
  RUN: "#1a7f37",
  STOP: "#9a6700",
  ALARM: "#cf222e",
  OFFLINE: "#57606a",
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

const JOB_STATUSES = ["RUNNING", "DONE"];
const SORT_FIELDS: { value: string; label: string }[] = [
  { value: "startTime", label: "Started" },
  { value: "jobNumber", label: "Job Number" },
  { value: "goodQty", label: "Good Qty" },
  { value: "rejectQty", label: "Reject Qty" },
  { value: "status", label: "Status" },
];

type LiveMachine = Machine & { cycleTimeSec?: number; shotCount?: number };

export default function OperatorView() {
  const [machines, setMachines] = useState<LiveMachine[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);

  const [jobQuery, setJobQuery] = useState("");
  const [filterMachineId, setFilterMachineId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [sortField, setSortField] = useState("startTime");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [jobResults, setJobResults] = useState<ProductionJob[]>([]);
  const [job, setJob] = useState<ProductionJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  function refreshJobs() {
    api
      .searchJobs({
        machineId: filterMachineId || undefined,
        q: jobQuery.trim() || undefined,
        productCode: filterProduct.trim() || undefined,
        status: filterStatus || undefined,
        sort: sortField,
        dir: sortDir,
      })
      .then(setJobResults)
      .catch((err) => setJobError(err instanceof Error ? err.message : "search failed"));
  }

  useEffect(() => {
    refreshJobs();
    api.getMachines().then(setMachines).catch(console.error);
    api.getActiveAlarms().then(setAlarms).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run search whenever a filter/sort control changes.
  useEffect(() => {
    refreshJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMachineId, filterStatus, filterProduct, sortField, sortDir]);

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
    for (const j of jobResults) {
      if (j.status === "RUNNING" && !map.has(j.machineId)) map.set(j.machineId, j);
    }
    return map;
  }, [jobResults]);

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
      refreshJobs();
    }
  });

  function searchJob(e: React.FormEvent) {
    e.preventDefault();
    setJobError(null);
    setJob(null);
    refreshJobs();
  }

  function toggleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function sortArrow(field: string) {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  async function openJob(jobNumber: string) {
    setJobError(null);
    try {
      setJob(await api.getJob(jobNumber));
    } catch (err) {
      setJobError(err instanceof Error ? err.message : "not found");
    }
  }

  const machinesPage = usePagination(visibleMachines, 10);
  const alarmsPage = usePagination(alarms, 10);
  const jobsPage = usePagination(jobResults, 10);

  return (
    <div className="app-shell">
      <h1>Operator Dashboard</h1>

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
                {machinesPage.pageItems.map((m) => {
                  const currentJob = currentJobByMachine.get(m.machineId);
                  const color = STATUS_COLOR[m.status] ?? "#57606a";
                  const isAlarm = m.status === "ALARM";
                  return (
                    <tr key={m.machineId} className={isAlarm ? "row-flag" : undefined}>
                      <td>
                        <span className="badge" style={{ background: color }}>
                          {m.status}
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
                {visibleMachines.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={10}>No machines in this zone.</td>
                  </tr>
                )}
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

      <section>
        <h2>Job Lookup</h2>
        <form onSubmit={searchJob} className="toolbar">
          <input
            value={jobQuery}
            onChange={(e) => setJobQuery(e.target.value)}
            placeholder="Job Number contains…"
            style={{ width: 220 }}
          />
          <input
            value={filterProduct}
            onChange={(e) => setFilterProduct(e.target.value)}
            placeholder="Product Code contains…"
            style={{ width: 180 }}
          />
          <select value={filterMachineId} onChange={(e) => setFilterMachineId(e.target.value)}>
            <option value="">All machines</option>
            {machines.map((m) => (
              <option key={m.machineId} value={m.machineId}>
                {m.machineId}
              </option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Any status</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={sortField} onChange={(e) => setSortField(e.target.value)}>
            {SORT_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                Sort: {f.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
            {sortDir === "asc" ? "↑ asc" : "↓ desc"}
          </button>
          <button type="submit">Search</button>
        </form>
        {jobError && <div className="notice notice-error">{jobError}</div>}
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleSort("jobNumber")}>
                    Job Number{sortArrow("jobNumber")}
                  </th>
                  <th>Machine</th>
                  <th>Product</th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleSort("startTime")}>
                    Started{sortArrow("startTime")}
                  </th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleSort("status")}>
                    Status{sortArrow("status")}
                  </th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleSort("goodQty")}>
                    Good{sortArrow("goodQty")}
                  </th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleSort("rejectQty")}>
                    Reject{sortArrow("rejectQty")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobsPage.pageItems.map((j) => (
                  <tr key={j.jobNumber} onClick={() => openJob(j.jobNumber)} style={{ cursor: "pointer" }}>
                    <td>{j.jobNumber}</td>
                    <td>{j.machineId}</td>
                    <td>{j.productCode}</td>
                    <td>{new Date(j.startTime).toLocaleString()}</td>
                    <td>{j.status}</td>
                    <td>{j.goodQty}</td>
                    <td>{j.rejectQty}</td>
                  </tr>
                ))}
                {jobResults.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={7}>No jobs found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={jobsPage.page}
            pageCount={jobsPage.pageCount}
            total={jobsPage.total}
            pageSize={jobsPage.pageSize}
            onPageChange={jobsPage.setPage}
          />
        </div>
        {job && (
          <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, marginTop: 4 }}>
            {JSON.stringify(job, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
