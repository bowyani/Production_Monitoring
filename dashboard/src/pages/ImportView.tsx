import { useEffect, useState } from "react";
import { api, type Machine, type ImportResult } from "../lib/api";

const TEMPLATE = `jobNumber,productCode,moldId,recipeId,startTime,endTime,goodQty,rejectQty,startupScrapQty,status
JOB-LEGACY-001,PVC-90-ELBOW,MOLD-3,RECIPE-2,2026-08-19T08:00:00Z,2026-08-19T16:00:00Z,410,12,3,DONE`;

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
        const manual = list.find((m) => m.dataSource === "MANUAL");
        setMachineId((cur) => cur || manual?.machineId || list[0]?.machineId || "");
      })
      .catch(console.error);
  }, []);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
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

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, display: "grid", gap: 24, maxWidth: 800 }}>
      <h1>Import — Legacy / Manual Data</h1>
      <p style={{ fontSize: 13, color: "#57606a" }}>
        For machines that can't connect at all — the paper/Excel fallback GAP_ANALYSIS §1.4 calls out as
        required for a real 200-machine factory ("โรงงานจริงมีเครื่องเก่าที่เชื่อมไม่ได้ปนอยู่ — ต้องมี
        manual data entry fallback"). This writes directly into <code>production_jobs</code>, bypassing MQTT
        entirely.
      </p>

      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Machine{" "}
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)} style={{ padding: 6 }}>
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

        <label>
          Or paste CSV directly
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={8}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 8 }}
            placeholder={TEMPLATE}
          />
        </label>

        <div>
          <button type="button" onClick={() => setCsvText(TEMPLATE)} style={{ fontSize: 12 }}>
            Fill example template
          </button>
        </div>

        <button type="submit" disabled={busy || !machineId || !csvText.trim()}>
          {busy ? "Importing…" : "Import"}
        </button>
      </form>

      {error && <div style={{ color: "#cf222e" }}>{error}</div>}

      {result && (
        <section>
          <h2>Result</h2>
          <p>
            {result.created} created, {result.updated} updated, {result.failed.length} failed out of{" "}
            {result.totalRows} rows.
          </p>
          {result.failed.length > 0 && (
            <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
                  <th>Row</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {result.failed.map((f) => (
                  <tr key={f.row} style={{ borderBottom: "1px solid #eaeef2" }}>
                    <td>{f.row}</td>
                    <td style={{ color: "#cf222e" }}>{f.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section>
        <h2>Expected columns</h2>
        <p style={{ fontSize: 13, color: "#57606a" }}>
          Required: <code>jobNumber, productCode, startTime, goodQty, rejectQty</code>. Optional:{" "}
          <code>moldId, recipeId, endTime, startupScrapQty, status</code>. Plain comma-separated, no quoted
          fields — a value with a comma in it will misalign columns.
        </p>
      </section>
    </div>
  );
}
