import { useEffect, useState } from "react";
import { api, type Machine } from "../lib/api";

export default function AdminView() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState("");
  const [machineName, setMachineName] = useState("");
  const [error, setError] = useState<string | null>(null);

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
        <p style={{ fontSize: 13, color: "#57606a" }}>
          Takes effect immediately — no service restart needed, since the backend subscribes to MQTT
          via wildcard topic.
        </p>
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => (
              <tr key={m.machineId} style={{ borderBottom: "1px solid #eaeef2" }}>
                <td>{m.machineId}</td>
                <td>{m.machineName}</td>
                <td>{m.status}</td>
                <td>{m.isActive ? "yes" : "no"}</td>
                <td>
                  <button onClick={() => toggleActive(m)}>{m.isActive ? "Deactivate" : "Activate"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
