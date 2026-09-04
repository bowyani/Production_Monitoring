import { useEffect, useState } from "react";
import { api, type Machine, type ImportResult } from "../lib/api";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

const TEMPLATE_CSV =
  "jobNumber,productCode,moldId,recipeId,startTime,endTime,goodQty,rejectQty,startupScrapQty,quantityOrdered,status\n" +
  "JOB-LEGACY-001,PVC-90-ELBOW,MOLD-3,RECIPE-2,2026-08-19T08:00:00Z,2026-08-19T16:00:00Z,410,12,3,425,DONE\n";

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "production_jobs_import_template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ImportView() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .adminListMachines()
      .then((list) => {
        setMachines(list);
        const manual = list.find((m) => m.dataSource === "MANUAL_CSV");
        setMachineId((cur) => cur || manual?.machineId || list[0]?.machineId || "");
      })
      .catch(console.error);
  }, []);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      setResult(await api.importJobs(machineId, csvText));
    } catch (err) {
      setError(err instanceof Error ? err.message : "import failed");
    } finally {
      setBusy(false);
    }
  }

  const failedPage = usePagination(result?.failed ?? [], 10);

  return (
    <div className="app-shell" style={{ maxWidth: 800 }}>
      <h1>Import — Legacy / Manual Data</h1>

      <div>
        <button type="button" onClick={downloadTemplate}>
          ⬇ Download CSV Template
        </button>
        <span style={{ fontSize: 12, color: "#57606a", marginLeft: 8 }}>
          Give this to the operator to fill in — column headers and one example row.
        </span>
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Machine{" "}
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            {machines.map((m) => (
              <option key={m.machineId} value={m.machineId}>
                {m.machineId} — {m.machineName} ({m.dataSource})
              </option>
            ))}
          </select>
        </label>

        <label>
          CSV file <input type="file" accept=".csv,text/csv" onChange={onFile} />
          {fileName && <span style={{ fontSize: 12, color: "#57606a", marginLeft: 8 }}>{fileName}</span>}
        </label>

        <button type="submit" disabled={busy || !machineId || !csvText.trim()}>
          {busy ? "Importing…" : "Import"}
        </button>
      </form>

      {error && <div className="notice notice-error">{error}</div>}

      {result && (
        <section>
          <h2>Result</h2>
          {result.failed.length > 0 ? (
            <p className="notice notice-error" style={{ display: "inline-block" }}>
              Import rejected — {result.failed.length} of {result.totalRows} row(s) failed validation.{" "}
              <strong>Nothing was imported.</strong> Fix the rows below and re-upload.
            </p>
          ) : (
            <p className="notice notice-success" style={{ display: "inline-block" }}>
              {result.created} created, {result.updated} updated — all {result.totalRows} row(s) imported
              successfully.
            </p>
          )}
          {result.failed.length > 0 && (
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedPage.pageItems.map((f) => (
                      <tr key={f.row}>
                        <td>{f.row}</td>
                        <td style={{ color: "#cf222e" }}>{f.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={failedPage.page}
                pageCount={failedPage.pageCount}
                total={failedPage.total}
                pageSize={failedPage.pageSize}
                onPageChange={failedPage.setPage}
              />
            </div>
          )}
        </section>
      )}

    </div>
  );
}
