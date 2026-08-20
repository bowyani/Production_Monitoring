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

type LiveMachine = Machine & { cycleTimeSec?: number; shotCount?: number };

export default function OperatorView() {
  const [machines, setMachines] = useState<LiveMachine[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [jobQuery, setJobQuery] = useState("");
  const [jobResults, setJobResults] = useState<ProductionJob[]>([]);
  const [job, setJob] = useState<ProductionJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  function refreshJobs() {
    api.searchJobs({}).then(setJobResults).catch(console.error);
  }

  useEffect(() => {
    refreshJobs();
    api.getMachines().then(setMachines).catch(console.error);
    api.getActiveAlarms().then(setAlarms).catch(console.error);
  }, []);

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

  async function searchJob(e: React.FormEvent) {
    e.preventDefault();
    setJobError(null);
    setJob(null);
    try {
      setJobResults(await api.searchJobs({ q: jobQuery.trim() }));
    } catch (err) {
      setJobError(err instanceof Error ? err.message : "search failed");
    }
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
        <form onSubmit={searchJob} style={{ display: "flex", gap: 8 }}>
          <input
            value={jobQuery}
            onChange={(e) => setJobQuery(e.target.value)}
            placeholder="Job Number contains… (blank = most recent)"
            style={{ padding: 6, width: 320 }}
          />
          <button type="submit">Search</button>
        </form>
        {jobError && <div style={{ color: "#cf222e" }}>{jobError}</div>}
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
              <th>Job Number</th>
              <th>Machine</th>
              <th>Product</th>
              <th>Started</th>
              <th>Status</th>
              <th>Good / Reject</th>
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
                <td>
                  {j.goodQty} / {j.rejectQty}
                </td>
              </tr>
            ))}
            {jobResults.length === 0 && (
              <tr>
                <td colSpan={6}>No jobs found.</td>
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
