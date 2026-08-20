import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Machine } from "../lib/api";

type EditState = {
  machineName: string;
  machineModel: string;
  ratedPowerKw: string;
  laborCostPerHour: string;
  targetCycleTimeSec: string;
  maintenanceIntervalHours: string;
};

function toEditState(m: Machine): EditState {
  return {
    machineName: m.machineName,
    machineModel: m.machineModel ?? "",
    ratedPowerKw: m.ratedPowerKw?.toString() ?? "",
    laborCostPerHour: m.laborCostPerHour?.toString() ?? "",
    targetCycleTimeSec: m.targetCycleTimeSec?.toString() ?? "",
    maintenanceIntervalHours: m.maintenanceIntervalHours?.toString() ?? "",
  };
}

export default function AdminView() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState("");
  const [machineName, setMachineName] = useState("");
  const [machineModel, setMachineModel] = useState("");
  const [dataSource, setDataSource] = useState<"MQTT" | "MANUAL">("MQTT");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);

  function refresh() {
    api.adminListMachines().then(setMachines).catch(console.error);
  }

  useEffect(refresh, []);

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const result = await api.adminCreateMachine({ machineId, machineName, machineModel: machineModel || undefined, dataSource });
      setMachineId("");
      setMachineName("");
      setMachineModel("");
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

  async function logMaintenance(m: Machine) {
    await api.adminLogMaintenance(m.machineId);
    refresh();
  }

  function startEdit(m: Machine) {
    setEditingId(m.machineId);
    setEdit(toEditState(m));
  }

  async function saveEdit(m: Machine) {
    if (!edit) return;
    await api.adminPatchMachine(m.machineId, {
      machineName: edit.machineName,
      machineModel: edit.machineModel === "" ? null : edit.machineModel,
      ratedPowerKw: edit.ratedPowerKw === "" ? null : Number(edit.ratedPowerKw),
      laborCostPerHour: edit.laborCostPerHour === "" ? null : Number(edit.laborCostPerHour),
      targetCycleTimeSec: edit.targetCycleTimeSec === "" ? null : Number(edit.targetCycleTimeSec),
      maintenanceIntervalHours: edit.maintenanceIntervalHours === "" ? null : Number(edit.maintenanceIntervalHours),
    });
    setEditingId(null);
    setEdit(null);
    refresh();
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, display: "grid", gap: 24 }}>
      <h1>Admin — Machine Registry</h1>

      <section>
        <h2>Register New Machine</h2>
        <form onSubmit={addMachine} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            placeholder="Machine ID (e.g. IMM-04)"
            style={{ padding: 6 }}
            required
          />
          <input
            value={machineName}
            onChange={(e) => setMachineName(e.target.value)}
            placeholder="Machine Name"
            style={{ padding: 6 }}
            required
          />
          <input
            value={machineModel}
            onChange={(e) => setMachineModel(e.target.value)}
            placeholder="Model (e.g. Haitian MA1200)"
            style={{ padding: 6 }}
          />
          <select value={dataSource} onChange={(e) => setDataSource(e.target.value as "MQTT" | "MANUAL")} style={{ padding: 6 }}>
            <option value="MQTT">MQTT (connected / simulator)</option>
            <option value="MANUAL">MANUAL (legacy — no connection)</option>
          </select>
          <button type="submit">Add</button>
        </form>
        {error && <div style={{ color: "#cf222e" }}>{error}</div>}
        {notice && <div style={{ color: "#1a7f37" }}>{notice}</div>}
        <p style={{ fontSize: 13, color: "#57606a", maxWidth: 680 }}>
          <strong>MQTT</strong> machines get a simulator container launched automatically (via the Docker
          socket mounted into the backend) — telemetry starts flowing within seconds, no manual{" "}
          <code>docker compose run</code> needed. <strong>MANUAL</strong> machines represent legacy
          equipment that can't connect at all (GAP_ANALYSIS §1.4) — register it here, then backfill its
          production history on the <Link to="/import">Import</Link> page.
        </p>
      </section>

      <section>
        <h2>All Machines</h2>
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
              <th>ID</th>
              <th>Name / Model</th>
              <th>Source</th>
              <th>Status</th>
              <th>Active</th>
              <th>Rated kW</th>
              <th>Labor $/hr</th>
              <th>Target Cycle (s)</th>
              <th>Maintenance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m) =>
              editingId === m.machineId && edit ? (
                <tr key={m.machineId} style={{ borderBottom: "1px solid #eaeef2" }}>
                  <td>{m.machineId}</td>
                  <td>
                    <input
                      value={edit.machineName}
                      onChange={(e) => setEdit({ ...edit, machineName: e.target.value })}
                      style={{ width: 130, display: "block", marginBottom: 4 }}
                    />
                    <input
                      value={edit.machineModel}
                      onChange={(e) => setEdit({ ...edit, machineModel: e.target.value })}
                      placeholder="model"
                      style={{ width: 130 }}
                    />
                  </td>
                  <td>{m.dataSource}</td>
                  <td>{m.status}</td>
                  <td>{m.isActive ? "yes" : "no"}</td>
                  <td>
                    <input
                      value={edit.ratedPowerKw}
                      onChange={(e) => setEdit({ ...edit, ratedPowerKw: e.target.value })}
                      style={{ width: 60 }}
                      inputMode="decimal"
                    />
                  </td>
                  <td>
                    <input
                      value={edit.laborCostPerHour}
                      onChange={(e) => setEdit({ ...edit, laborCostPerHour: e.target.value })}
                      style={{ width: 60 }}
                      inputMode="decimal"
                    />
                  </td>
                  <td>
                    <input
                      value={edit.targetCycleTimeSec}
                      onChange={(e) => setEdit({ ...edit, targetCycleTimeSec: e.target.value })}
                      style={{ width: 60 }}
                      inputMode="decimal"
                    />
                  </td>
                  <td>
                    <input
                      value={edit.maintenanceIntervalHours}
                      onChange={(e) => setEdit({ ...edit, maintenanceIntervalHours: e.target.value })}
                      style={{ width: 60 }}
                      inputMode="decimal"
                      placeholder="interval h"
                    />
                  </td>
                  <td style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => saveEdit(m)}>Save</button>
                    <button onClick={() => setEditingId(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={m.machineId} style={{ borderBottom: "1px solid #eaeef2" }}>
                  <td>{m.machineId}</td>
                  <td>
                    {m.machineName}
                    {m.machineModel && <div style={{ fontSize: 12, color: "#57606a" }}>{m.machineModel}</div>}
                  </td>
                  <td>{m.dataSource}</td>
                  <td>{m.status}</td>
                  <td>{m.isActive ? "yes" : "no"}</td>
                  <td>{m.ratedPowerKw ?? "—"}</td>
                  <td>{m.laborCostPerHour ?? "—"}</td>
                  <td>{m.targetCycleTimeSec ?? "—"}</td>
                  <td>
                    {m.maintenanceIntervalHours == null ? (
                      "—"
                    ) : (
                      <span style={{ color: m.maintenanceDue ? "#cf222e" : "#57606a" }}>
                        {m.runHoursSinceMaintenance?.toFixed(1)} / {m.maintenanceIntervalHours} h
                        {m.maintenanceDue ? " ⚠ due" : ""}
                      </span>
                    )}
                  </td>
                  <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button onClick={() => startEdit(m)}>Edit</button>
                    <button onClick={() => toggleActive(m)}>{m.isActive ? "Deactivate" : "Activate"}</button>
                    {m.maintenanceIntervalHours != null && (
                      <button onClick={() => logMaintenance(m)}>Mark Maintained</button>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: "#57606a" }}>
          Deactivating a machine stops the backend from accepting its MQTT telemetry (status becomes{" "}
          <strong>INACTIVE</strong>) and — for MQTT-sourced machines — stops its simulator container too,
          so it actually goes quiet instead of just being ignored. Full history of every change here is on
          the <Link to="/audit-log">Audit Log</Link> page.
        </p>
      </section>
    </div>
  );
}
