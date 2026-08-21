import { useEffect, useState } from "react";
import { api, type Machine, type TelemetryPoint, type StatusEvent, type Alarm, type ProductionJob } from "../lib/api";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

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
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
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
      const [t, ev, al, jb] = await Promise.all([
        api.getMachineHistory(machineId, fromIso, toIso),
        api.getMachineEvents(machineId, fromIso, toIso),
        api.getMachineAlarms(machineId, fromIso, toIso),
        api.searchJobs({ machineId, from: fromIso, to: toIso, limit: "200" }),
      ]);
      setTelemetry(t);
      setEvents(ev);
      setMachineAlarms(al);
      setJobs(jb);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load history");
    }
  }

  useEffect(() => {
    if (machineId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  const jobsPage = usePagination(jobs, 10);
  const telemetryPage = usePagination(telemetry, 15);
  const eventsPage = usePagination(events, 15);
  const alarmsPage = usePagination(machineAlarms, 10);

  return (
    <div className="app-shell">
      <h1>Historical Data</h1>

      <form onSubmit={load} className="toolbar">
        <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
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
      {error && <div className="notice notice-error">{error}</div>}

      <section>
        <h2>Jobs ({jobs.length})</h2>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Job Number</th>
                  <th>Product</th>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Status</th>
                  <th>Good</th>
                  <th>Reject</th>
                  <th>Startup Scrap</th>
                </tr>
              </thead>
              <tbody>
                {jobsPage.pageItems.map((j) => (
                  <tr key={j.jobNumber}>
                    <td>{j.jobNumber}</td>
                    <td>{j.productCode}</td>
                    <td>{new Date(j.startTime).toLocaleString()}</td>
                    <td>{j.endTime ? new Date(j.endTime).toLocaleString() : "—"}</td>
                    <td>{j.status}</td>
                    <td>{j.goodQty}</td>
                    <td>{j.rejectQty}</td>
                    <td>{j.startupScrapQty}</td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={8}>No jobs in this range.</td>
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
      </section>

      <section>
        <h2>Telemetry ({telemetry.length} points)</h2>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th>Cycle (s)</th>
                  <th>Shot #</th>
                  <th>Pressure (bar)</th>
                  <th>Temp (°C)</th>
                </tr>
              </thead>
              <tbody>
                {telemetryPage.pageItems.map((t) => (
                  <tr key={t.id}>
                    <td>{new Date(t.timestamp).toLocaleString()}</td>
                    <td>{t.status}</td>
                    <td>{t.cycleTimeSec ?? "—"}</td>
                    <td>{t.shotCount ?? "—"}</td>
                    <td>{t.injectionPressureBar ?? "—"}</td>
                    <td>{t.barrelTemperatureC ?? "—"}</td>
                  </tr>
                ))}
                {telemetry.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={6}>No telemetry in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={telemetryPage.page}
            pageCount={telemetryPage.pageCount}
            total={telemetryPage.total}
            pageSize={telemetryPage.pageSize}
            onPageChange={telemetryPage.setPage}
          />
        </div>
      </section>

      <section>
        <h2>Status Changes ({events.length})</h2>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>From</th>
                  <th>To</th>
                </tr>
              </thead>
              <tbody>
                {eventsPage.pageItems.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.changedAt).toLocaleString()}</td>
                    <td>{e.fromStatus ?? "—"}</td>
                    <td>{e.toStatus}</td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={3}>No status changes in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={eventsPage.page}
            pageCount={eventsPage.pageCount}
            total={eventsPage.total}
            pageSize={eventsPage.pageSize}
            onPageChange={eventsPage.setPage}
          />
        </div>
      </section>

      <section>
        <h2>Alarm History ({machineAlarms.length})</h2>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Message</th>
                  <th>Raised</th>
                  <th>Cleared</th>
                </tr>
              </thead>
              <tbody>
                {alarmsPage.pageItems.map((a) => (
                  <tr key={a.id}>
                    <td>{a.alarmCode}</td>
                    <td>{a.alarmMessage}</td>
                    <td>{new Date(a.alarmTimestamp).toLocaleString()}</td>
                    <td>{a.clearedTimestamp ? new Date(a.clearedTimestamp).toLocaleString() : "active"}</td>
                  </tr>
                ))}
                {machineAlarms.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={4}>No alarms in this range.</td>
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
  );
}
