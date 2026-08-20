import { useEffect, useMemo, useState } from "react";
import { api, type Machine, type Alarm, type ProductionJob } from "../lib/api";
import { useLiveSocket } from "../lib/useLiveSocket";

const STATUS_COLOR: Record<string, string> = {
  RUN: "#1a7f37",
  STOP: "#9a6700",
  ALARM: "#cf222e",
  OFFLINE: "#57606a",
  INACTIVE: "#8c959f",
};

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

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, display: "grid", gap: 24 }}>
      <h1>Operator Dashboard</h1>

      <section>
        <h2>Machines</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {machines.map((m) => {
            const currentJob = currentJobByMachine.get(m.machineId);
            return (
              <div
                key={m.machineId}
                style={{
                  border: "1px solid #d0d7de",
                  borderRadius: 8,
                  padding: 12,
                  borderLeft: `6px solid ${STATUS_COLOR[m.status] ?? "#57606a"}`,
                }}
              >
                <strong>{m.machineId}</strong>
                <div>{m.machineName}</div>
                <div style={{ color: STATUS_COLOR[m.status] ?? "#57606a", fontWeight: 600 }}>{m.status}</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>
                  Job: {currentJob?.jobNumber ?? "—"}
                  <br />
                  Product: {currentJob?.productCode ?? "—"}
                  <br />
                  Cycle: {m.cycleTimeSec ?? "—"} s · Shot #{m.shotCount ?? "—"}
                  <br />
                  Good/Reject: {currentJob ? `${currentJob.goodQty} / ${currentJob.rejectQty}` : "— / —"}
                </div>
                <div style={{ fontSize: 12, color: "#57606a", marginTop: 6 }}>
                  last seen: {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleTimeString() : "-"}
                </div>
              </div>
            );
          })}
          {machines.length === 0 && <div>No machines registered yet.</div>}
        </div>
      </section>

      <section>
        <h2>Active Alarms</h2>
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
              <th>Machine</th>
              <th>Code</th>
              <th>Message</th>
              <th>Raised</th>
            </tr>
          </thead>
          <tbody>
            {alarms.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #eaeef2" }}>
                <td>{a.machineId}</td>
                <td>{a.alarmCode}</td>
                <td>{a.alarmMessage}</td>
                <td>{new Date(a.alarmTimestamp).toLocaleString()}</td>
              </tr>
            ))}
            {alarms.length === 0 && (
              <tr>
                <td colSpan={4}>No active alarms.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Job Lookup</h2>
        <form onSubmit={searchJob} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={jobQuery}
            onChange={(e) => setJobQuery(e.target.value)}
            placeholder="Job Number contains…"
            style={{ padding: 6, width: 220 }}
          />
          <input
            value={filterProduct}
            onChange={(e) => setFilterProduct(e.target.value)}
            placeholder="Product Code contains…"
            style={{ padding: 6, width: 180 }}
          />
          <select value={filterMachineId} onChange={(e) => setFilterMachineId(e.target.value)} style={{ padding: 6 }}>
            <option value="">All machines</option>
            {machines.map((m) => (
              <option key={m.machineId} value={m.machineId}>
                {m.machineId}
              </option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ padding: 6 }}>
            <option value="">Any status</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={sortField} onChange={(e) => setSortField(e.target.value)} style={{ padding: 6 }}>
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
        {jobError && <div style={{ color: "#cf222e" }}>{jobError}</div>}
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
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
            {jobResults.map((j) => (
              <tr
                key={j.jobNumber}
                onClick={() => openJob(j.jobNumber)}
                style={{ borderBottom: "1px solid #eaeef2", cursor: "pointer" }}
              >
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
              <tr>
                <td colSpan={7}>No jobs found.</td>
              </tr>
            )}
          </tbody>
        </table>
        {job && (
          <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, marginTop: 12 }}>
            {JSON.stringify(job, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
