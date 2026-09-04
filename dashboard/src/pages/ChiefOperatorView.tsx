import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type MaintenanceOverview,
  type MachineMaintenance,
  type Machine,
  type ErpMachineAsset,
  type Gateway,
} from "../lib/api";
import { connectionMeta } from "../lib/connection";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

function hrs(v: number | null) {
  return v == null ? "—" : `${v.toFixed(1)}h`;
}

// A key/value row of the register_map editor. Kept as an array (not an
// object) while editing so a half-typed duplicate/blank key doesn't drop
// rows out from under the user.
type RegisterRow = { key: string; value: string };

type RegisterMap = Record<string, number>;

function registerRowsToMap(rows: RegisterRow[]): RegisterMap | undefined {
  const entries = rows
    .map((r) => [r.key.trim(), Number(r.value)] as const)
    .filter(([k, v]) => k !== "" && Number.isFinite(v));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function maintenanceStatus(m: MachineMaintenance): {
  label: string;
  color: string;
} {
  if (m.dataSource === "MANUAL_CSV")
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
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [assetId, setAssetId] = useState("");
  // "simulator" = demo/test path (POST /admin/machines, may spin up a
  // container); "physical" = real PLC reached over Modbus through a Gateway
  // (POST /admin/machines/manual-register, no container).
  const [mode, setMode] = useState<"simulator" | "physical">("simulator");
  const [dataSource, setDataSource] = useState<"SIMULATOR" | "MANUAL_CSV">("SIMULATOR");
  const [connectionType, setConnectionType] = useState<"MODBUS_TCP" | "MODBUS_RTU">("MODBUS_TCP");
  const [gatewayId, setGatewayId] = useState("");
  const [modbusSlaveId, setModbusSlaveId] = useState("");
  const [modbusIp, setModbusIp] = useState("");
  const [modbusPort, setModbusPort] = useState("502");
  const [registerRows, setRegisterRows] = useState<RegisterRow[]>([{ key: "", value: "" }]);
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
    api.getGateways().then(setGateways).catch(console.error);
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

  function resetMachineForm() {
    setAssetId("");
    setModbusSlaveId("");
    setModbusIp("");
    setModbusPort("502");
    setRegisterRows([{ key: "", value: "" }]);
  }

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    setMachineFormError(null);
    setMachineNotice(null);
    try {
      if (mode === "simulator") {
        const result = await api.adminCreateMachine({ assetId, dataSource });
        if (dataSource === "SIMULATOR") {
          setMachineNotice(
            result.simulator?.ok
              ? `Simulator container ${result.simulator.reused ? "reused" : "started"} for ${result.machineId} — it will show RUN/telemetry within a few seconds, no manual steps needed.`
              : `Machine registered, but the simulator container couldn't be started automatically (${result.simulator?.reason ?? "Docker management unavailable"}). Start it manually if needed.`
          );
        } else {
          setMachineNotice(`Machine registered as Manual CSV — no simulator, use the Import page to backfill its data.`);
        }
      } else {
        const slave = Number(modbusSlaveId);
        if (!gatewayId) throw new Error("pick a gateway");
        if (!Number.isInteger(slave) || slave < 0 || slave > 247) throw new Error("Modbus Slave ID must be 0–247");
        if (connectionType === "MODBUS_TCP" && (!modbusIp.trim() || !modbusPort.trim()))
          throw new Error("Modbus TCP needs an IP and port");
        const result = await api.adminManualRegisterMachine({
          assetId,
          connectionType,
          gatewayId,
          modbusSlaveId: slave,
          modbusIp: connectionType === "MODBUS_TCP" ? modbusIp.trim() : undefined,
          modbusPort: connectionType === "MODBUS_TCP" ? Number(modbusPort) : undefined,
          registerMap: registerRowsToMap(registerRows),
        });
        setMachineNotice(
          `Physical machine ${result.machineId} registered on gateway ${gatewayId} (slave ${slave}). No container — a Gateway must poll it and publish MQTT under this ID.`
        );
      }
      resetMachineForm();
      refreshMachines();
      await load();
    } catch (err) {
      setMachineFormError(err instanceof Error ? err.message : "failed to create machine");
    }
  }

  async function toggleActive(m: Machine) {
    setMachineNotice(null);
    const result = await api.adminPatchMachine(m.machineId, { isActive: !m.isActive });
    if (m.dataSource === "SIMULATOR" && result.simulator && !result.simulator.ok) {
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
        <p style={{ fontSize: 12, color: "#57606a", maxWidth: 720 }}>
          A prototype simulator publishes MQTT itself; a real machine speaks Modbus and is reached through a{" "}
          <Link to="/gateways">Gateway</Link> that republishes it. Pick the mode that matches what's actually
          on the other end.
        </p>

        <div className="pill-group" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={"pill" + (mode === "simulator" ? " active" : "")}
            onClick={() => {
              setMode("simulator");
              setMachineFormError(null);
            }}
          >
            Simulator (Demo/Test)
          </button>
          <button
            type="button"
            className={"pill" + (mode === "physical" ? " active" : "")}
            onClick={() => {
              setMode("physical");
              setMachineFormError(null);
            }}
          >
            Physical Machine
          </button>
        </div>

        <form onSubmit={addMachine} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)} style={{ minWidth: 260, padding: 6 }} required>
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

          {mode === "simulator" && (
            <select
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value as "SIMULATOR" | "MANUAL_CSV")}
              style={{ padding: 6 }}
            >
              <option value="SIMULATOR">Simulator container (live MQTT)</option>
              <option value="MANUAL_CSV">Manual CSV (legacy — no connection)</option>
            </select>
          )}

          {mode === "physical" && (
            <>
              <select
                value={connectionType}
                onChange={(e) => setConnectionType(e.target.value as "MODBUS_TCP" | "MODBUS_RTU")}
                style={{ padding: 6 }}
              >
                <option value="MODBUS_TCP">Modbus TCP</option>
                <option value="MODBUS_RTU">Modbus RTU</option>
              </select>
              <select value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} style={{ padding: 6, minWidth: 200 }} required>
                <option value="" disabled>
                  Select gateway…
                </option>
                {gateways.map((g) => (
                  <option key={g.gatewayId} value={g.gatewayId}>
                    {g.gatewayId} — {g.location} ({g.ipAddress})
                  </option>
                ))}
              </select>
              <input
                value={modbusSlaveId}
                onChange={(e) => setModbusSlaveId(e.target.value)}
                placeholder="Slave ID (0–247)"
                inputMode="numeric"
                style={{ padding: 6, width: 130 }}
                required
              />
              {connectionType === "MODBUS_TCP" && (
                <>
                  <input
                    value={modbusIp}
                    onChange={(e) => setModbusIp(e.target.value)}
                    placeholder="Modbus IP (e.g. 192.168.10.15)"
                    style={{ padding: 6, width: 190 }}
                    required
                  />
                  <input
                    value={modbusPort}
                    onChange={(e) => setModbusPort(e.target.value)}
                    placeholder="Port"
                    inputMode="numeric"
                    style={{ padding: 6, width: 80 }}
                    required
                  />
                </>
              )}
            </>
          )}

          <button type="submit" disabled={!assetId || (mode === "physical" && !gatewayId)}>
            {mode === "physical" ? "Register physical machine" : "Add"}
          </button>
        </form>

        {mode === "physical" && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: "#57606a", marginBottom: 4 }}>
              Register map — which raw Modbus register the gateway reads for each metric (e.g.{" "}
              <code>pressure → 40001</code>).
            </div>
            {registerRows.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                <input
                  value={row.key}
                  onChange={(e) =>
                    setRegisterRows((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                  }
                  placeholder="metric (e.g. pressure)"
                  style={{ padding: 6, width: 180 }}
                />
                <input
                  value={row.value}
                  onChange={(e) =>
                    setRegisterRows((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                  }
                  placeholder="register (e.g. 40001)"
                  inputMode="numeric"
                  style={{ padding: 6, width: 150 }}
                />
                <button
                  type="button"
                  onClick={() => setRegisterRows((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows))}
                  disabled={registerRows.length === 1}
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setRegisterRows((rows) => [...rows, { key: "", value: "" }])}>
              + register
            </button>
          </div>
        )}

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
                  <th>Connection</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {machinesAdminPage.pageItems.map((m) => {
                  const cm = connectionMeta(m.connectionType);
                  return (
                    <tr key={m.machineId}>
                      <td>{m.machineId}</td>
                      <td>{m.machineName}</td>
                      <td>
                        <span className="badge" style={{ background: cm.color }}>
                          {cm.label}
                        </span>
                      </td>
                      <td>{m.isActive ? "yes" : "no"}</td>
                      <td>
                        <button onClick={() => toggleActive(m)}>{m.isActive ? "Deactivate" : "Activate"}</button>
                      </td>
                    </tr>
                  );
                })}
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
