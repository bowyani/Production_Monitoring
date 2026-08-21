import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Machine, type ErpMachineAsset, type SystemStats } from "../lib/api";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

function bytesToLabel(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const GAP_ITEMS = [
  {
    id: "2.5–2.7",
    title: "ไม่มี Modbus ในโค้ดเลย",
    detail:
      "Machine Simulator สวมบทบาทแทน PLC ทั้งก้อน สร้างค่า Cycle Time/Pressure/Temperature เองแล้ว publish MQTT ตรง — torn-read, register chunking (125 limit), และ port contention ล้วนเป็น Future Scope ตอนต่อ PLC จริง ไม่ใช่บั๊กของ prototype นี้",
  },
  {
    id: "3.1",
    title: "Emergency Stop ไม่ได้ implement",
    detail:
      "Path การ monitoring (MQTT → Backend → Dashboard) ไม่ fail-safe พอสำหรับ safety — ถ้า broker/backend ล่ม ระบบนี้จะไม่รู้เลย. Deactivate ใน Admin หยุดแค่การรับข้อมูล (และคุม container ของ simulator) ไม่ใช่ hardwired safety circuit จริง",
  },
  {
    id: "1.5",
    title: "ไม่มี Disaster Recovery จริง",
    detail:
      "Postgres ตัวเดียว ไม่มี replica — ถ้า container/disk พังคือข้อมูลหาย ระบบจริงต้องมี on-site + cloud replica",
  },
  {
    id: "1.4",
    title: "MANUAL data source คือ workaround ไม่ใช่ของจริง",
    detail:
      'เครื่อง dataSource="MANUAL" ไม่มี watchdog/OFFLINE detection เพราะไม่มี telemetry ให้ตรวจเลย ข้อมูลมาจาก CSV import เท่านั้น เป็น blind spot ถาวรตามที่ Gap 1.4 ระบุไว้',
  },
  {
    id: "2.3",
    title: "Backup เป็นแค่แนวคิด ยังไม่ implement",
    detail: "ไม่มี pg_dump schedule จริงใน prototype นี้ — ถ้า volume หาย ข้อมูลหายหมด ไม่มี recovery path ทดสอบแล้ว",
  },
];

export default function AdminView() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [assets, setAssets] = useState<ErpMachineAsset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [dataSource, setDataSource] = useState<"MQTT" | "MANUAL">("MQTT");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);

  function refresh() {
    api.adminListMachines().then(setMachines).catch(console.error);
    api.getMachineAssets().then(setAssets).catch(console.error);
  }

  useEffect(refresh, []);

  useEffect(() => {
    api.getSystemStats().then(setStats).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const id = setInterval(() => api.getSystemStats().then(setStats).catch(() => {}), 15000);
    return () => clearInterval(id);
  }, []);

  const unregisteredAssets = assets.filter((a) => !a.registered);
  const machinesPage = usePagination(machines, 10);

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const result = await api.adminCreateMachine({ assetId, dataSource });
      setAssetId("");
      if (dataSource === "MQTT") {
        setNotice(
          result.simulator?.ok
            ? `Simulator container ${result.simulator.reused ? "reused" : "started"} for ${result.machineId} — it will show RUN/telemetry within a few seconds, no manual steps needed.`
            : `Machine registered, but the simulator container couldn't be started automatically (${result.simulator?.reason ?? "Docker management unavailable"}). Start it manually if needed.`
        );
      } else {
        setNotice(`Machine registered as MANUAL — no simulator, use the Import page to backfill its data.`);
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create machine");
    }
  }

  async function toggleActive(m: Machine) {
    setNotice(null);
    const result = await api.adminPatchMachine(m.machineId, { isActive: !m.isActive });
    if (m.dataSource === "MQTT" && result.simulator && !result.simulator.ok) {
      setNotice(`Status updated, but simulator container control failed: ${result.simulator.reason}`);
    }
    refresh();
  }

  return (
    <div className="app-shell">
      <div className="page-title">
        <h1>Admin — IT System Management</h1>
        <div className="page-subtitle">
          This page is for IT: connect/disconnect machines and watch database/ingestion health. Machine specs
          (name, model, cost, maintenance interval, vendor...) live in <Link to="/erp">ERP</Link> now — Admin
          only picks which registered asset to bring online.
        </div>
      </div>

      <section>
        <h2>Register New Machine</h2>
        <form onSubmit={addMachine} className="toolbar">
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)} style={{ minWidth: 260 }} required>
            <option value="" disabled>
              Select ERP asset…
            </option>
            {unregisteredAssets.map((a) => (
              <option key={a.assetId} value={a.assetId}>
                {a.assetId} — {a.machineName}
                {a.machineModel ? ` (${a.machineModel})` : ""}
              </option>
            ))}
          </select>
          <select value={dataSource} onChange={(e) => setDataSource(e.target.value as "MQTT" | "MANUAL")}>
            <option value="MQTT">MQTT (connected / simulator)</option>
            <option value="MANUAL">MANUAL (legacy — no connection)</option>
          </select>
          <button type="submit" disabled={!assetId}>
            Add
          </button>
        </form>
        {error && <div className="notice notice-error">{error}</div>}
        {notice && <div className="notice notice-success">{notice}</div>}
        {unregisteredAssets.length === 0 && (
          <p style={{ fontSize: 13, color: "#9a6700" }}>
            No unregistered assets in ERP. Add the machine's specs on the <Link to="/erp">ERP</Link> page first,
            then come back here to connect it.
          </p>
        )}
        <p style={{ fontSize: 13, color: "#57606a", maxWidth: 680 }}>
          Machines are picked from ERP's asset master data, not typed in here — that's what keeps one physical
          machine from ending up registered twice with mismatched specs. <strong>MQTT</strong> machines get a
          simulator container launched automatically — telemetry starts flowing within seconds.{" "}
          <strong>MANUAL</strong> machines represent legacy equipment that can't connect at all (GAP_ANALYSIS
          §1.4) — register it here, then backfill its production history on the{" "}
          <Link to="/import">Import</Link> page.
        </p>
      </section>

      <section>
        <h2>All Machines</h2>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {machinesPage.pageItems.map((m) => (
                  <tr key={m.machineId}>
                    <td>{m.machineId}</td>
                    <td>{m.machineName}</td>
                    <td>{m.dataSource}</td>
                    <td>{m.status}</td>
                    <td>{m.isActive ? "yes" : "no"}</td>
                    <td>
                      <button onClick={() => toggleActive(m)}>{m.isActive ? "Deactivate" : "Activate"}</button>
                    </td>
                  </tr>
                ))}
                {machines.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={6}>No machines registered yet.</td>
                  </tr>
                )}
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
        <p style={{ fontSize: 13, color: "#57606a" }}>
          Deactivating a machine stops the backend from accepting its MQTT telemetry (status becomes{" "}
          <strong>INACTIVE</strong>) and — for MQTT-sourced machines — stops its simulator container too,
          so it actually goes quiet instead of just being ignored. Specs, maintenance interval, and cost data
          are managed on the <Link to="/erp">ERP</Link> page; full history of every change here is on the{" "}
          <Link to="/audit-log">Audit Log</Link> page.
        </p>
      </section>

      <section>
        <h2>System Health</h2>
        <p style={{ fontSize: 13, color: "#57606a" }}>
          Live numbers from this database, refreshed every 15s, plus the honest list of what's known to be
          missing before this could run against a real 200-machine line.
        </p>

        {stats && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {[
                ["Machines (active / manual / total)", `${stats.machines.active} / ${stats.machines.manual} / ${stats.machines.total}`],
                ["Telemetry rows", stats.rowCounts.machine_telemetry.toLocaleString()],
                ["Ingestion rate (5m avg)", `${stats.telemetry.estimatedRowsPerSecond} rows/s`],
                ["Rows last 60s", stats.telemetry.rowsLast60s],
                ["DB size", stats.database.totalSizePretty ?? "—"],
                ["Audit log entries", stats.rowCounts.audit_log.toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="card">
                  <div style={{ fontSize: 12, color: "#57606a" }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>

            <h3>Table sizes</h3>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Row count</th>
                      <th>Disk size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.database.tables.map((t) => (
                      <tr key={t.name}>
                        <td>{t.name}</td>
                        <td>{stats.rowCounts[t.name]?.toLocaleString() ?? "—"}</td>
                        <td>{t.sizePretty ?? bytesToLabel(t.sizeBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <h3>Should this worry you?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.6 }}>
              At {stats.machines.active} active machines and{" "}
              {stats.telemetry.estimatedRowsPerSecond.toFixed(2)} rows/s, this single PostgreSQL instance is
              nowhere near stressed — <code>machine_telemetry</code> has one index on{" "}
              <code>(machine_id, timestamp)</code> and every query the dashboard makes hits that index. The
              number that actually matters is what happens at 200 machines publishing every ~2s: that's
              roughly <strong>8.6 million rows/day</strong> into one table. At that point you'd need{" "}
              <strong>time-based partitioning</strong> (or moving to TimescaleDB, which is a Postgres
              extension — no backend code changes needed to switch) plus a <strong>retention policy</strong>{" "}
              that rolls old raw ticks up into hourly aggregates. None of that is implemented here — it's
              future work, sized for a scale this prototype was never asked to run at. See "แนวทางขยายจาก 3
              เครื่องไปยัง 200 เครื่อง" in the README for the full plan.
            </p>

            <h3>Known gaps (for scoping debugging)</h3>
            <p style={{ fontSize: 13, color: "#57606a" }}>
              If something looks wrong in a demo, check this list first — these are documented, deliberate
              scope cuts (see GAP_ANALYSIS in the README), not unknown bugs.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {GAP_ITEMS.map((g) => (
                <div key={g.id} className="card">
                  <strong>
                    Gap {g.id} — {g.title}
                  </strong>
                  <div style={{ fontSize: 13, color: "#57606a", marginTop: 4 }}>{g.detail}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
