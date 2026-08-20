import { useEffect, useState } from "react";
import { api, type Machine, type Alarm, type ProductionJob } from "../lib/api";
import { useLiveSocket } from "../lib/useLiveSocket";

const STATUS_COLOR: Record<string, string> = {
  RUN: "#1a7f37",
  IDLE: "#9a6700",
  ALARM: "#cf222e",
  STOP: "#57606a",
  OFFLINE: "#57606a",
};

export default function OperatorView() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [jobQuery, setJobQuery] = useState("");
  const [job, setJob] = useState<ProductionJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  useEffect(() => {
    api.getMachines().then(setMachines).catch(console.error);
    api.getActiveAlarms().then(setAlarms).catch(console.error);
  }, []);

  useLiveSocket((msg) => {
    if (msg.event === "telemetry" || msg.event === "status") {
      setMachines((prev) =>
        prev.map((m) =>
          m.machineId === msg.data.machineId
            ? { ...m, status: msg.data.status, lastSeenAt: new Date().toISOString() }
            : m
        )
      );
    }
    if (msg.event === "alarm" && msg.data.event === "RAISE") {
      api.getActiveAlarms().then(setAlarms).catch(console.error);
    }
    if (msg.event === "alarm" && msg.data.event === "CLEAR") {
      api.getActiveAlarms().then(setAlarms).catch(console.error);
    }
  });

  async function searchJob(e: React.FormEvent) {
    e.preventDefault();
    setJobError(null);
    setJob(null);
    try {
      setJob(await api.getJob(jobQuery.trim()));
    } catch (err) {
      setJobError(err instanceof Error ? err.message : "not found");
    }
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, display: "grid", gap: 24 }}>
      <h1>Operator Dashboard</h1>

      <section>
        <h2>Machines</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {machines.map((m) => (
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
              <div style={{ fontSize: 12, color: "#57606a" }}>
                last seen: {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleTimeString() : "-"}
              </div>
            </div>
          ))}
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
            placeholder="Job Number"
            style={{ padding: 6 }}
          />
          <button type="submit">Search</button>
        </form>
        {jobError && <div style={{ color: "#cf222e" }}>{jobError}</div>}
        {job && (
          <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8 }}>
            {JSON.stringify(job, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
