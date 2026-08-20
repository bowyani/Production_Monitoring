import { useEffect, useState } from "react";
import { api, type KpiSummary } from "../lib/api";

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function pct(v: number | null) {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function num(v: number | null, digits = 1) {
  return v == null ? "—" : v.toFixed(digits);
}

export default function KpiView() {
  const [from, setFrom] = useState(() => toLocalInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toLocalInputValue(new Date()));
  const [summary, setSummary] = useState<KpiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualMachineCount, setManualMachineCount] = useState(0);
  const [inactiveMachineCount, setInactiveMachineCount] = useState(0);

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    try {
      setSummary(await api.getKpiSummary(new Date(from).toISOString(), new Date(to).toISOString()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load KPI summary");
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

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, display: "grid", gap: 24 }}>
      <h1>Executive KPI</h1>

      <form onSubmit={load} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label>
          From <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit">Load</button>
      </form>
      {error && <div style={{ color: "#cf222e" }}>{error}</div>}

      {(manualMachineCount > 0 || inactiveMachineCount > 0) && (
        <div
          style={{
            border: "1px solid #f0c36d",
            background: "#fff8e6",
            borderRadius: 8,
            padding: 12,
            fontSize: 13,
            maxWidth: 700,
          }}
        >
          <strong>⚠ Blind spot in these numbers:</strong>{" "}
          {manualMachineCount > 0 &&
            `${manualMachineCount} machine(s) are dataSource=MANUAL (legacy, no live connection) and are excluded from every KPI below entirely — their real output isn't reflected in fleet Availability/OEE at all. `}
          {inactiveMachineCount > 0 &&
            `${inactiveMachineCount} machine(s) are currently deactivated and also excluded. `}
          This mirrors GAP_ANALYSIS §1.4: a factory with unconnected old equipment has a{" "}
          <em>permanent</em> blind spot here, not a temporary glitch — the fleet numbers below are only
          representative of the machines this system can actually see, never assume they're the whole
          plant.
        </div>
      )}

      {summary && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
            {[
              ["Availability", pct(summary.fleet.availability)],
              ["Performance", pct(summary.fleet.performance)],
              ["Quality", pct(summary.fleet.quality)],
              ["Reject Rate", pct(summary.fleet.rejectRate)],
              ["Est. Energy (kWh)", num(summary.fleet.estimatedEnergyKwh)],
              ["Est. Labor Cost", summary.fleet.estimatedLaborCost != null ? `$${num(summary.fleet.estimatedLaborCost, 2)}` : "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#57606a" }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </section>

          <section>
            <h2>Per-Machine</h2>
            <div style={{ overflowX: "auto" }}>
              <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
                    <th>Machine</th>
                    <th>OEE</th>
                    <th>Availability</th>
                    <th>Performance</th>
                    <th>Quality</th>
                    <th>Reject Rate</th>
                    <th>Runtime (h)</th>
                    <th>Avg Cycle (s)</th>
                    <th>Target Cycle (s)</th>
                    <th>Energy (kWh)</th>
                    <th>Labor Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.machines.map((m) => (
                    <tr key={m.machineId} style={{ borderBottom: "1px solid #eaeef2" }}>
                      <td>
                        {m.machineId} — {m.machineName}
                      </td>
                      <td>{pct(m.oee)}</td>
                      <td>{pct(m.availability)}</td>
                      <td>{pct(m.performance)}</td>
                      <td>{pct(m.quality)}</td>
                      <td>{pct(m.rejectRate)}</td>
                      <td>{num(m.runtimeHours, 2)}</td>
                      <td>{num(m.avgCycleTimeSec)}</td>
                      <td>{m.targetCycleTimeSec ?? "—"}</td>
                      <td>{num(m.estimatedEnergyKwh)}</td>
                      <td>{m.estimatedLaborCost != null ? `$${num(m.estimatedLaborCost, 2)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 13, color: "#57606a", maxWidth: 700 }}>
              Performance/OEE show "—" for machines without a configured Target Cycle Time (set it in
              Admin). QC hold rate isn't shown — there's no "QC hold" concept in the current data model.
            </p>
          </section>

          <section>
            <h2>Where these numbers come from</h2>
            <p style={{ fontSize: 13, color: "#57606a", maxWidth: 700 }}>
              Standard OEE decomposition (ISO 22400-2), computed per machine over the selected From/To
              window, then rolled up:
            </p>
            <ul style={{ fontSize: 13, color: "#57606a", maxWidth: 700, lineHeight: 1.8 }}>
              <li>
                <strong>Availability</strong> = time spent in <code>RUN</code> status ÷ window length,
                reconstructed from <code>machine_status_events</code> (every status change is logged, so
                this is exact, not sampled).
              </li>
              <li>
                <strong>Performance</strong> = Target Cycle Time ÷ actual average Cycle Time while running,
                capped at 100%. Requires Target Cycle Time to be set in Admin — otherwise "—", never a
                guessed default.
              </li>
              <li>
                <strong>Quality</strong> = Good Qty ÷ (Good + Reject + Startup Scrap) from{" "}
                <code>production_jobs</code> that started in the window. Startup scrap (first few shots
                after a mold/job change) is excluded from Reject per GAP_ANALYSIS §1.2, so short jobs don't
                show artificially low yield.
              </li>
              <li>
                <strong>OEE</strong> = Availability × Performance × Quality — only computed when all three
                have a value.
              </li>
              <li>
                <strong>Est. Energy / Labor Cost</strong> are <em>estimates</em>: rated power (kW) and labor
                cost ($/hr) from Admin config × measured runtime hours. Not a metered reading — treat as
                directional, not billing-grade.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
