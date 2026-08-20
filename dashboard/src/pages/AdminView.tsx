import { useEffect, useState } from "react";
import { api, type Machine } from "../lib/api";

type EditState = {
  machineName: string;
  ratedPowerKw: string;
  laborCostPerHour: string;
  targetCycleTimeSec: string;
};

function toEditState(m: Machine): EditState {
  return {
    machineName: m.machineName,
    ratedPowerKw: m.ratedPowerKw?.toString() ?? "",
    laborCostPerHour: m.laborCostPerHour?.toString() ?? "",
    targetCycleTimeSec: m.targetCycleTimeSec?.toString() ?? "",
  };
}

export default function AdminView() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState("");
  const [machineName, setMachineName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);

  function refresh() {
    api.adminListMachines().then(setMachines).catch(console.error);
  }

  useEffect(refresh, []);

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.adminCreateMachine({ machineId, machineName });
      setMachineId("");
      setMachineName("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create machine");
    }
  }

  async function toggleActive(m: Machine) {
    await api.adminPatchMachine(m.machineId, { isActive: !m.isActive });
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
      ratedPowerKw: edit.ratedPowerKw === "" ? null : Number(edit.ratedPowerKw),
      laborCostPerHour: edit.laborCostPerHour === "" ? null : Number(edit.laborCostPerHour),
      targetCycleTimeSec: edit.targetCycleTimeSec === "" ? null : Number(edit.targetCycleTimeSec),
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
        <form onSubmit={addMachine} style={{ display: "flex", gap: 8 }}>
          <input
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            placeholder="Machine ID (e.g. IMM-02)"
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
          <button type="submit">Add</button>
        </form>
        {error && <div style={{ color: "#cf222e" }}>{error}</div>}
        <p style={{ fontSize: 13, color: "#57606a", maxWidth: 640 }}>
          Registering a machine here only creates its record — it will show <strong>OFFLINE</strong>{" "}
          until something actually publishes telemetry for its Machine ID over MQTT. In this prototype
          that means starting a Simulator instance for it, e.g.:
        </p>
        <pre style={{ background: "#f6f8fa", padding: 8, borderRadius: 6, fontSize: 12, maxWidth: 640 }}>
          {`docker compose run -d --rm --name simulator-${machineId || "IMM-04"} \\\n  -e MACHINE_ID=${
            machineId || "IMM-04"
          } -e MACHINE_NAME="${machineName || "..."}" \\\n  -e MQTT_BROKER_URL=mqtt://mosquitto:1883 \\\n  -e BACKEND_API_URL=http://backend:3000/api/v1 \\\n  simulator-01`}
        </pre>
      </section>

      <section>
        <h2>All Machines</h2>
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Active</th>
              <th>Rated kW</th>
              <th>Labor $/hr</th>
              <th>Target Cycle (s)</th>
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
                      style={{ width: 140 }}
                    />
                  </td>
                  <td>{m.status}</td>
                  <td>{m.isActive ? "yes" : "no"}</td>
                  <td>
                    <input
                      value={edit.ratedPowerKw}
                      onChange={(e) => setEdit({ ...edit, ratedPowerKw: e.target.value })}
                      style={{ width: 70 }}
                      inputMode="decimal"
                    />
                  </td>
                  <td>
                    <input
                      value={edit.laborCostPerHour}
                      onChange={(e) => setEdit({ ...edit, laborCostPerHour: e.target.value })}
                      style={{ width: 70 }}
                      inputMode="decimal"
                    />
                  </td>
                  <td>
                    <input
                      value={edit.targetCycleTimeSec}
                      onChange={(e) => setEdit({ ...edit, targetCycleTimeSec: e.target.value })}
                      style={{ width: 70 }}
                      inputMode="decimal"
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
                  <td>{m.machineName}</td>
                  <td>{m.status}</td>
                  <td>{m.isActive ? "yes" : "no"}</td>
                  <td>{m.ratedPowerKw ?? "—"}</td>
                  <td>{m.laborCostPerHour ?? "—"}</td>
                  <td>{m.targetCycleTimeSec ?? "—"}</td>
                  <td style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => startEdit(m)}>Edit</button>
                    <button onClick={() => toggleActive(m)}>{m.isActive ? "Deactivate" : "Activate"}</button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: "#57606a" }}>
          Deactivating a machine stops the backend from accepting its MQTT telemetry (status becomes{" "}
          <strong>INACTIVE</strong>) — it does not stop the machine's own simulator/PLC from publishing.
        </p>
      </section>
    </div>
  );
}
