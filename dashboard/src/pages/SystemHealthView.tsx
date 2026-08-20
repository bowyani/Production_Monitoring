import { useEffect, useState } from "react";
import { api, type SystemStats } from "../lib/api";

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

export default function SystemHealthView() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSystemStats().then(setStats).catch((e) => setError(e.message));
    const id = setInterval(() => api.getSystemStats().then(setStats).catch(() => {}), 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, display: "grid", gap: 24, maxWidth: 900 }}>
      <h1>System Health — for IT / Ops</h1>
      <p style={{ fontSize: 13, color: "#57606a" }}>
        This page is for whoever operates the database/infrastructure, not the factory floor — live numbers
        from this database, refreshed every 15s, plus the honest list of what's known to be missing before
        this could run against a real 200-machine line.
      </p>
      {error && <div style={{ color: "#cf222e" }}>{error}</div>}

      {stats && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {[
              ["Machines (active / manual / total)", `${stats.machines.active} / ${stats.machines.manual} / ${stats.machines.total}`],
              ["Telemetry rows", stats.rowCounts.machine_telemetry.toLocaleString()],
              ["Ingestion rate (5m avg)", `${stats.telemetry.estimatedRowsPerSecond} rows/s`],
              ["Rows last 60s", stats.telemetry.rowsLast60s],
              ["DB size", stats.database.totalSizePretty ?? "—"],
              ["Audit log entries", stats.rowCounts.audit_log.toLocaleString()],
            ].map(([label, value]) => (
              <div key={label} style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#57606a" }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </section>

          <section>
            <h2>Table sizes</h2>
            <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
                  <th>Table</th>
                  <th>Row count</th>
                  <th>Disk size</th>
                </tr>
              </thead>
              <tbody>
                {stats.database.tables.map((t) => (
                  <tr key={t.name} style={{ borderBottom: "1px solid #eaeef2" }}>
                    <td>{t.name}</td>
                    <td>{stats.rowCounts[t.name]?.toLocaleString() ?? "—"}</td>
                    <td>{t.sizePretty ?? bytesToLabel(t.sizeBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Should this worry you?</h2>
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
          </section>

          <section>
            <h2>Known gaps (for scoping debugging)</h2>
            <p style={{ fontSize: 13, color: "#57606a" }}>
              If something looks wrong in a demo, check this list first — these are documented, deliberate
              scope cuts (see GAP_ANALYSIS in the README), not unknown bugs.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {GAP_ITEMS.map((g) => (
                <div key={g.id} style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: 10 }}>
                  <strong>
                    Gap {g.id} — {g.title}
                  </strong>
                  <div style={{ fontSize: 13, color: "#57606a", marginTop: 4 }}>{g.detail}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
