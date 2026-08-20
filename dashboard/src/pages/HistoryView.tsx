import { useEffect, useState } from "react";
import { api, type Machine, type TelemetryPoint, type StatusEvent, type Alarm } from "../lib/api";

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

export default function HistoryView() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState("");
  const [from, setFrom] = useState(() => toLocalInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toLocalInputValue(new Date()));
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [events, setEvents] = useState<StatusEvent[]>([]);
  const [machineAlarms, setMachineAlarms] = useState<Alarm[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminListMachines()
      .then((list) => {
        setMachines(list);
        if (list.length > 0) setMachineId((cur) => cur || list[0].machineId);
      })
      .catch(console.error);
  }, []);

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    if (!machineId) return;
    setError(null);
    try {
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(to).toISOString();
      const [t, ev, al] = await Promise.all([
        api.getMachineHistory(machineId, fromIso, toIso),
        api.getMachineEvents(machineId, fromIso, toIso),
        api.getMachineAlarms(machineId, fromIso, toIso),
      ]);
      setTelemetry(t);
      setEvents(ev);
      setMachineAlarms(al);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load history");
    }
  }

  useEffect(() => {
    if (machineId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, display: "grid", gap: 24 }}>
      <h1>Historical Data</h1>

      <form onSubmit={load} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={machineId} onChange={(e) => setMachineId(e.target.value)} style={{ padding: 6 }}>
          {machines.map((m) => (
            <option key={m.machineId} value={m.machineId}>
              {m.machineId} — {m.machineName}
            </option>
          ))}
        </select>
        <label>
          From <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit">Load</button>
      </form>
      {error && <div style={{ color: "#cf222e" }}>{error}</div>}

      <section>
        <h2>Telemetry ({telemetry.length} points)</h2>
        <div style={{ maxHeight: 400, overflow: "auto", border: "1px solid #d0d7de", borderRadius: 8 }}>
          <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead style={{ position: "sticky", top: 0, background: "#f6f8fa" }}>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
                <th>Timestamp</th>
                <th>Status</th>
                <th>Cycle (s)</th>
                <th>Shot #</th>
                <th>Pressure (bar)</th>
                <th>Temp (°C)</th>
              </tr>
            </thead>
            <tbody>
              {telemetry.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid #eaeef2" }}>
                  <td>{new Date(t.timestamp).toLocaleString()}</td>
                  <td>{t.status}</td>
                  <td>{t.cycleTimeSec ?? "—"}</td>
                  <td>{t.shotCount ?? "—"}</td>
                  <td>{t.injectionPressureBar ?? "—"}</td>
                  <td>{t.barrelTemperatureC ?? "—"}</td>
                </tr>
              ))}
              {telemetry.length === 0 && (
                <tr>
                  <td colSpan={6}>No telemetry in this range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Status Changes ({events.length})</h2>
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
              <th>When</th>
              <th>From</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #eaeef2" }}>
                <td>{new Date(e.changedAt).toLocaleString()}</td>
                <td>{e.fromStatus ?? "—"}</td>
                <td>{e.toStatus}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={3}>No status changes in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Alarm History ({machineAlarms.length})</h2>
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
              <th>Code</th>
              <th>Message</th>
              <th>Raised</th>
              <th>Cleared</th>
            </tr>
          </thead>
          <tbody>
            {machineAlarms.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #eaeef2" }}>
                <td>{a.alarmCode}</td>
                <td>{a.alarmMessage}</td>
                <td>{new Date(a.alarmTimestamp).toLocaleString()}</td>
                <td>{a.clearedTimestamp ? new Date(a.clearedTimestamp).toLocaleString() : "active"}</td>
              </tr>
            ))}
            {machineAlarms.length === 0 && (
              <tr>
                <td colSpan={4}>No alarms in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
