import { useEffect, useMemo, useState } from "react";
import { api, type Machine, type ProductionJob } from "../lib/api";
import { useLiveSocket } from "../lib/useLiveSocket";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";
import { VerticalGroupedStackedBarChart } from "../components/Bars";

const JOB_STATUSES = ["RUNNING", "DONE"];
const SORT_FIELDS: { value: string; label: string }[] = [
  { value: "startTime", label: "Started" },
  { value: "jobNumber", label: "Job Number" },
  { value: "goodQty", label: "Good Qty" },
  { value: "rejectQty", label: "Reject Qty" },
  { value: "status", label: "Status" },
];

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function formatDuration(startIso: string, endIso: string | null) {
  if (!endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms <= 0) return "—";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ProductionView() {
  const [machines, setMachines] = useState<Machine[]>([]);

  const modelByMachineId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of machines) map.set(m.machineId, m.machineModel ?? "Unspecified model");
    return map;
  }, [machines]);

  // Production Volume by Model chart — its own time window, independent of
  // the Job Lookup filters below.
  const [chartFrom, setChartFrom] = useState(() => toLocalInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [chartTo, setChartTo] = useState(() => toLocalInputValue(new Date()));
  const [chartJobs, setChartJobs] = useState<ProductionJob[]>([]);
  const [chartError, setChartError] = useState<string | null>(null);

  function loadChart(e?: React.FormEvent) {
    e?.preventDefault();
    setChartError(null);
    api
      .searchJobs({
        from: new Date(chartFrom).toISOString(),
        to: new Date(chartTo).toISOString(),
        limit: "1000",
      })
      .then(setChartJobs)
      .catch((err) => setChartError(err instanceof Error ? err.message : "failed to load production volume"));
  }

  const volumeByModelProduct = useMemo(() => {
    const groups = new Map<string, { model: string; product: string; good: number; reject: number; scrap: number }>();
    for (const j of chartJobs) {
      const model = modelByMachineId.get(j.machineId) ?? "Unspecified model";
      const key = `${model}::${j.productCode}`;
      const entry = groups.get(key) ?? { model, product: j.productCode, good: 0, reject: 0, scrap: 0 };
      entry.good += j.goodQty;
      entry.reject += j.rejectQty;
      entry.scrap += j.startupScrapQty;
      groups.set(key, entry);
    }
    return [...groups.values()].sort((a, b) => a.model.localeCompare(b.model) || a.product.localeCompare(b.product));
  }, [chartJobs, modelByMachineId]);

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
    loadChart();
    api.getMachines().then(setMachines).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run search whenever a filter/sort control changes.
  useEffect(() => {
    refreshJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMachineId, filterStatus, filterProduct, sortField, sortDir]);

  useLiveSocket((msg) => {
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

  const jobsPage = usePagination(jobResults, 10);

  return (
    <div className="app-shell">
      <h1>Production</h1>

      <section>
        <h2>Production Volume by Model</h2>
        <form onSubmit={loadChart} className="toolbar">
          <label>
            From <input type="datetime-local" value={chartFrom} onChange={(e) => setChartFrom(e.target.value)} />
          </label>
          <label>
            To <input type="datetime-local" value={chartTo} onChange={(e) => setChartTo(e.target.value)} />
          </label>
          <button type="submit">Load</button>
        </form>
        {chartError && <div className="notice notice-error">{chartError}</div>}
        <VerticalGroupedStackedBarChart
          data={volumeByModelProduct.map((r) => {
            const total = r.good + r.reject + r.scrap;
            return {
              group: r.model,
              label: `${r.model} — ${r.product}`,
              segments: [
                { key: "good", value: r.good, color: "#1a7f37", label: "Good" },
                { key: "reject", value: r.reject, color: "#cf222e", label: "Reject" },
                { key: "scrap", value: r.scrap, color: "#9a6700", label: "Startup Scrap" },
              ],
              tooltip: `${r.model} — ${r.product}\nGood: ${r.good.toLocaleString()}\nReject: ${r.reject.toLocaleString()}\nStartup Scrap: ${r.scrap.toLocaleString()}\nTotal: ${total.toLocaleString()} units`,
            };
          })}
        />
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
                  <th>Model</th>
                  <th>Product</th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleSort("startTime")}>
                    Started{sortArrow("startTime")}
                  </th>
                  <th>Finished</th>
                  <th>Duration</th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleSort("status")}>
                    Status{sortArrow("status")}
                  </th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleSort("goodQty")}>
                    Good{sortArrow("goodQty")}
                  </th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleSort("rejectQty")}>
                    Reject{sortArrow("rejectQty")}
                  </th>
                  <th>Startup Scrap</th>
                </tr>
              </thead>
              <tbody>
                {jobsPage.pageItems.map((j) => (
                  <tr key={j.jobNumber} onClick={() => openJob(j.jobNumber)} style={{ cursor: "pointer" }}>
                    <td>{j.jobNumber}</td>
                    <td>{j.machineId}</td>
                    <td>{modelByMachineId.get(j.machineId) ?? "—"}</td>
                    <td>{j.productCode}</td>
                    <td>{new Date(j.startTime).toLocaleString()}</td>
                    <td>{j.endTime ? new Date(j.endTime).toLocaleString() : "—"}</td>
                    <td>{formatDuration(j.startTime, j.endTime)}</td>
                    <td>{j.status}</td>
                    <td>{j.goodQty}</td>
                    <td>{j.rejectQty}</td>
                    <td>{j.startupScrapQty}</td>
                  </tr>
                ))}
                {jobResults.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={11}>No jobs found.</td>
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
