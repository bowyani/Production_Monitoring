import { useEffect, useState } from "react";
import { api, type KpiSummary, type ErpSummary } from "../lib/api";
import BlindSpotNote from "../components/BlindSpotNote";
import { HBarChart, DivergingBarChart } from "../components/Bars";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

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
function thb(v: number | null, digits = 0) {
  return v == null ? "—" : `฿${v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

const card: React.CSSProperties = { border: "1px solid #d0d7de", borderRadius: 8, padding: 12 };
const sectionTitle: React.CSSProperties = { fontSize: 12, color: "#57606a" };
const bigValue: React.CSSProperties = { fontSize: 22, fontWeight: 700 };

export default function KpiView() {
  const [from, setFrom] = useState(() => toLocalInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toLocalInputValue(new Date()));
  const [summary, setSummary] = useState<KpiSummary | null>(null);
  const [financials, setFinancials] = useState<ErpSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualMachineCount, setManualMachineCount] = useState(0);
  const [inactiveMachineCount, setInactiveMachineCount] = useState(0);

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    try {
      const [kpi, erp] = await Promise.all([
        api.getKpiSummary(new Date(from).toISOString(), new Date(to).toISOString()),
        api.getErpSummary(new Date(from).toISOString(), new Date(to).toISOString()),
      ]);
      setSummary(kpi);
      setFinancials(erp);
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

  const totalRuntimeHours = summary ? summary.machines.reduce((a, m) => a + m.runtimeHours, 0) : 0;
  const unitsPerHour = summary && totalRuntimeHours > 0 ? summary.fleet.goodQty / totalRuntimeHours : null;
  const machinesPage = usePagination(summary?.machines ?? [], 10);

  return (
    <div className="app-shell">
      <h1>Executive KPI</h1>

      <form onSubmit={load} className="toolbar">
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

      {summary && (
        <>
          <section>
            <h2 style={{ marginBottom: 8 }}>Financial</h2>
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
              <div style={card}>
                <div style={sectionTitle}>Revenue</div>
                <div style={bigValue}>{thb(financials?.totals.revenueThb ?? null)}</div>
              </div>
              <div style={card}>
                <div style={sectionTitle}>Material + Labor Cost</div>
                <div style={bigValue}>
                  {thb(
                    financials
                      ? (financials.totals.materialCostThb ?? 0) + (financials.totals.laborCostThb ?? 0)
                      : null
                  )}
                </div>
              </div>
              <div
                style={{
                  ...card,
                  borderColor: (financials?.totals.marginThb ?? 0) < 0 ? "#cf222e" : "#d0d7de",
                }}
              >
                <div style={sectionTitle}>Gross Margin</div>
                <div style={{ ...bigValue, color: (financials?.totals.marginThb ?? 0) < 0 ? "#cf222e" : undefined }}>
                  {thb(financials?.totals.marginThb ?? null)}
                </div>
              </div>
              <div style={card}>
                <div style={sectionTitle}>Est. Energy (kWh)</div>
                <div style={bigValue}>{num(summary.fleet.estimatedEnergyKwh)}</div>
              </div>
            </section>
            {financials && financials.unpricedJobCount > 0 && (
              <p style={{ fontSize: 12, color: "#9a6700" }}>
                ⚠ {financials.unpricedJobCount} job order(s) have no SKU price configured — excluded from Revenue
                and Margin above. Set prices in <strong>ERP</strong>.
              </p>
            )}
          </section>

          <section>
            <h2 style={{ marginBottom: 8 }}>Productivity</h2>
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
              {[
                ["OEE (fleet avg)", summary.machines.length > 0 ? pct(avgOf(summary.machines.map((m) => m.oee))) : "—"],
                ["Availability", pct(summary.fleet.availability)],
                ["Performance", pct(summary.fleet.performance)],
                ["Quality", pct(summary.fleet.quality)],
                ["Reject Rate", pct(summary.fleet.rejectRate)],
                ["Units / Hour", num(unitsPerHour, 1)],
              ].map(([label, value]) => (
                <div key={label} style={card}>
                  <div style={sectionTitle}>{label}</div>
                  <div style={bigValue}>{value}</div>
                </div>
              ))}
            </section>
          </section>

          {financials && (
            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <h2>Margin by SKU (฿/hr, worst first)</h2>
                <p style={{ fontSize: 12, color: "#57606a" }}>
                  Which product is worth investing in vs. which one is a drag on machine time.
                </p>
                <DivergingBarChart
                  data={financials.bySku.map((r) => ({
                    label: r.key,
                    value: r.marginPerHourThb ?? 0,
                    display: r.marginPerHourThb == null ? "—" : undefined,
                  }))}
                  formatValue={(v) => thb(v, 1)}
                />
              </div>
              <div>
                <h2>OEE by Machine</h2>
                <HBarChart
                  data={summary.machines.map((m) => ({
                    label: m.machineId,
                    value: (m.oee ?? 0) * 100,
                    display: m.oee == null ? "—" : undefined,
                  }))}
                  color="#0969da"
                  formatValue={(v) => `${v.toFixed(0)}%`}
                />
              </div>
            </section>
          )}

          <section>
            <h2>Per-Machine</h2>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Machine</th>
                      <th>OEE</th>
                      <th>Availability</th>
                      <th>Performance</th>
                      <th>Quality</th>
                      <th>Labor Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machinesPage.pageItems.map((m) => (
                      <tr key={m.machineId}>
                        <td>
                          {m.machineId} — {m.machineName}
                        </td>
                        <td>{pct(m.oee)}</td>
                        <td>{pct(m.availability)}</td>
                        <td>{pct(m.performance)}</td>
                        <td>{pct(m.quality)}</td>
                        <td>{m.estimatedLaborCost != null ? `$${num(m.estimatedLaborCost, 2)}` : "—"}</td>
                      </tr>
                    ))}
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
            <p style={{ fontSize: 13, color: "#57606a", maxWidth: 700 }}>
              Performance/OEE show "—" for machines without a configured Target Cycle Time (set it in Admin). QC
              hold rate isn't shown — there's no "QC hold" concept in the current data model. Reject rate, runtime,
              cycle time, and energy detail moved to <strong>Chief Operator</strong> — this page stays focused on
              money and overall equipment effectiveness.
            </p>
          </section>

          <section>
            <h2>Where these numbers come from</h2>
            <p style={{ fontSize: 13, color: "#57606a", maxWidth: 700 }}>
              Standard OEE decomposition (ISO 22400-2), computed per machine over the selected From/To window, then
              rolled up. Financial figures come from the mock ERP price book (Admin &gt; ERP): revenue = good qty ×
              SKU price, cost = material (all produced units) + labor (runtime × $/hr from Admin).
            </p>
            <ul style={{ fontSize: 13, color: "#57606a", maxWidth: 700, lineHeight: 1.8 }}>
              <li>
                <strong>Availability</strong> = time spent in <code>RUN</code> status ÷ window length, reconstructed
                from <code>machine_status_events</code> (every status change is logged, so this is exact, not
                sampled).
              </li>
              <li>
                <strong>Performance</strong> = Target Cycle Time ÷ actual average Cycle Time while running, capped
                at 100%. Requires Target Cycle Time to be set in Admin — otherwise "—", never a guessed default.
              </li>
              <li>
                <strong>Quality</strong> = Good Qty ÷ (Good + Reject + Startup Scrap) from{" "}
                <code>production_jobs</code> that started in the window. Startup scrap (first few shots after a
                mold/job change) is excluded from Reject per GAP_ANALYSIS §1.2, so short jobs don't show
                artificially low yield.
              </li>
              <li>
                <strong>OEE</strong> = Availability × Performance × Quality — only computed when all three have a
                value.
              </li>
              <li>
                <strong>Est. Energy / Labor Cost</strong> are <em>estimates</em>: rated power (kW) and labor cost
                ($/hr) from Admin config × measured runtime hours. Not a metered reading — treat as directional,
                not billing-grade.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function avgOf(values: (number | null)[]) {
  const present = values.filter((v): v is number => v != null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
}
