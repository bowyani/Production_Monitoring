import { useEffect, useState } from "react";
import {
  api,
  type MaintenanceOverview,
  type MachineMaintenance,
  type Machine,
  type ErpMachineAsset,
} from "../lib/api";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

function hrs(v: number | null) {
  return v == null ? "—" : `${v.toFixed(1)}h`;
}

function maintenanceStatus(m: MachineMaintenance): {
  label: string;
  color: string;
} {
  if (m.dataSource === "MANUAL")
    return { label: "No live data", color: "#57606a" };
  if (m.maintenanceIntervalHours == null)
    return { label: "No interval set", color: "#57606a" };
  if (m.maintenanceDue)
    return { label: "Overdue — schedule PM", color: "#cf222e" };
  if ((m.pctOfInterval ?? 0) >= 0.8)
    return { label: "Due soon", color: "#9a6700" };
  return { label: "OK", color: "#1a7f37" };
}

export default function ChiefOperatorView() {
  const [overview, setOverview] = useState<MaintenanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingId, setLoggingId] = useState<string | null>(null);

  // Register New Machine / All Machines — moved here from Admin (IT no
  // longer owns bringing a machine online; that's an operations decision).
  const [machines, setMachines] = useState<Machine[]>([]);
  const [assets, setAssets] = useState<ErpMachineAsset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [dataSource, setDataSource] = useState<"MQTT" | "MANUAL">("MQTT");
  const [machineFormError, setMachineFormError] = useState<string | null>(null);
  const [machineNotice, setMachineNotice] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      // Preventive Maintenance Planning's numbers (run hours since last PM)
      // always accumulate up to right now regardless of window — see
      // computeRunHoursSince in admin.ts — so there's no From/To to pick.
      const overviewResult = await api.getMaintenanceOverview();
      setOverview(overviewResult);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "failed to load maintenance overview",
      );
    }
  }

  function refreshMachines() {
    api.adminListMachines().then(setMachines).catch(console.error);
    api.getMachineAssets().then(setAssets).catch(console.error);
  }

  useEffect(() => {
    load();
    refreshMachines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logMaintenance(machineId: string) {
    setLoggingId(machineId);
    try {
      await api.adminLogMaintenance(machineId);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "failed to log maintenance",
      );
    } finally {
      setLoggingId(null);
    }
  }

  const unregisteredAssets = assets.filter((a) => !a.registered);

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    setMachineFormError(null);
    setMachineNotice(null);
    try {
      const result = await api.adminCreateMachine({ assetId, dataSource });
      setAssetId("");
      if (dataSource === "MQTT") {
        setMachineNotice(
          result.simulator?.ok
            ? `Simulator container ${result.simulator.reused ? "reused" : "started"} for ${result.machineId} — it will show RUN/telemetry within a few seconds, no manual steps needed.`
            : `Machine registered, but the simulator container couldn't be started automatically (${result.simulator?.reason ?? "Docker management unavailable"}). Start it manually if needed.`
        );
      } else {
        setMachineNotice(`Machine registered as MANUAL — no simulator, use the Import page to backfill its data.`);
      }
      refreshMachines();
      await load();
    } catch (err) {
      setMachineFormError(err instanceof Error ? err.message : "failed to create machine");
    }
  }

  async function toggleActive(m: Machine) {
    setMachineNotice(null);
    const result = await api.adminPatchMachine(m.machineId, { isActive: !m.isActive });
    if (m.dataSource === "MQTT" && result.simulator && !result.simulator.ok) {
      setMachineNotice(`Status updated, but simulator container control failed: ${result.simulator.reason}`);
    }
    refreshMachines();
    await load();
  }

  const machinesAdminPage = usePagination(machines, 10);
  const machinesPage = usePagination(overview?.machines ?? [], 10);

  return (
    <div className="app-shell">
      <h1>Machine Management</h1>

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
        {machineFormError && <div className="notice notice-error">{machineFormError}</div>}
        {machineNotice && <div className="notice notice-success">{machineNotice}</div>}
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
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {machinesAdminPage.pageItems.map((m) => (
                  <tr key={m.machineId}>
                    <td>{m.machineId}</td>
                    <td>{m.machineName}</td>
                    <td>{m.dataSource}</td>
                    <td>{m.isActive ? "yes" : "no"}</td>
                    <td>
                      <button onClick={() => toggleActive(m)}>{m.isActive ? "Deactivate" : "Activate"}</button>
                    </td>
                  </tr>
                ))}
                {machines.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={5}>No machines registered yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={machinesAdminPage.page}
            pageCount={machinesAdminPage.pageCount}
            total={machinesAdminPage.total}
            pageSize={machinesAdminPage.pageSize}
            onPageChange={machinesAdminPage.setPage}
          />
        </div>
      </section>

      {error && <div className="notice notice-error">{error}</div>}

      {overview && (
        <section>
          <h2>Preventive Maintenance Planning</h2>
          <p style={{ fontSize: 12, color: "#57606a" }}>
            Running hours since last maintenance, reconstructed from
            status-event history (not a counter on the machine). MANUAL
            machines have no telemetry, so this can't be computed for them.
          </p>
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Model</th>
                    <th>Run Hrs Since PM</th>
                    <th>Interval</th>
                    <th>Usage</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {machinesPage.pageItems.map((m) => {
                    const st = maintenanceStatus(m);
                    const pct =
                      m.pctOfInterval != null
                        ? Math.min(1, m.pctOfInterval)
                        : null;
                    return (
                      <tr key={m.machineId}>
                        <td>
                          {m.machineId} — {m.machineName}
                        </td>
                        <td>{m.machineModel ?? "—"}</td>
                        <td>{hrs(m.runHoursSinceMaintenance)}</td>
                        <td>
                          {m.maintenanceIntervalHours != null
                            ? `${m.maintenanceIntervalHours}h`
                            : "—"}
                        </td>
                        <td style={{ minWidth: 120 }}>
                          {pct != null ? (
                            <div
                              style={{
                                background: "#f6f8fa",
                                borderRadius: 4,
                                height: 10,
                                width: 100,
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct * 100}%`,
                                  height: "100%",
                                  borderRadius: 4,
                                  background: m.maintenanceDue
                                    ? "#cf222e"
                                    : pct >= 0.8
                                      ? "#9a6700"
                                      : "#1a7f37",
                                }}
                              />
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ color: st.color, fontWeight: 600 }}>
                          {st.label}
                        </td>
                        <td>
                          <button
                            type="button"
                            disabled={loggingId === m.machineId}
                            onClick={() => logMaintenance(m.machineId)}
                          >
                            Log PM done
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
        </section>
      )}
    </div>
  );
}
