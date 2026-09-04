import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Gateway, type GatewayMachine } from "../lib/api";
import { connectionMeta } from "../lib/connection";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

type GatewayForm = { ipAddress: string; location: string; status: "ONLINE" | "OFFLINE" };
const emptyForm: GatewayForm = { ipAddress: "", location: "", status: "OFFLINE" };

// Gateway Management — the registry of Protocol Gateways (see README "ตัวกลาง
// ที่ต้องเพิ่มเข้ามา: Protocol Gateway"). A prototype has none of these; they
// exist so a physical machine can be pointed at one when registered in
// Machine Management instead of getting a simulator container.
export default function GatewayView() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<GatewayForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Which gateway's bound-machine list is expanded, and its contents.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedMachines, setExpandedMachines] = useState<GatewayMachine[]>([]);

  function load() {
    setError(null);
    api.getGateways().then(setGateways).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(load, []);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function editGateway(g: Gateway) {
    setForm({ ipAddress: g.ipAddress, location: g.location, status: g.status });
    setEditingId(g.gatewayId);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.ipAddress.trim() || !form.location.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await api.updateGateway(editingId, {
          ipAddress: form.ipAddress.trim(),
          location: form.location.trim(),
          status: form.status,
          // Setting a gateway ONLINE by hand stamps a heartbeat so the
          // derived `online` dot actually lights up; OFFLINE clears it.
          lastHeartbeatAt: form.status === "ONLINE" ? new Date().toISOString() : null,
        });
      } else {
        await api.createGateway({
          ipAddress: form.ipAddress.trim(),
          location: form.location.trim(),
          status: form.status,
        });
      }
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save gateway");
    } finally {
      setSaving(false);
    }
  }

  async function remove(gatewayId: string) {
    if (!confirm(`Remove gateway ${gatewayId}? Only works if no machine is bound to it.`)) return;
    const res = await api.deleteGateway(gatewayId);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `failed to remove gateway ${gatewayId}`);
      return;
    }
    if (expandedId === gatewayId) setExpandedId(null);
    load();
  }

  async function toggleExpand(gatewayId: string) {
    if (expandedId === gatewayId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(gatewayId);
    setExpandedMachines([]);
    try {
      setExpandedMachines(await api.getGatewayMachines(gatewayId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load gateway machines");
    }
  }

  const page = usePagination(gateways, 10);

  return (
    <div className="app-shell">
      <div className="page-title">
        <h1>Gateway Management</h1>
        <div className="page-subtitle">
          Protocol Gateways that poll real PLCs over Modbus and republish them as MQTT. Physical machines
          registered in <Link to="/chief-operator">Machine Management</Link> point at one of these.
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <section>
        <h2>{editingId ? `Edit gateway ${editingId}` : "Add Gateway"}</h2>
        <form onSubmit={save} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            value={form.ipAddress}
            onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
            placeholder="IP address (e.g. 192.168.10.2)"
            style={{ padding: 6, width: 200 }}
            required
          />
          <input
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="Location (e.g. Building A - Line 1)"
            style={{ padding: 6, width: 220 }}
            required
          />
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as "ONLINE" | "OFFLINE" })}
            style={{ padding: 6 }}
          >
            <option value="OFFLINE">OFFLINE</option>
            <option value="ONLINE">ONLINE</option>
          </select>
          <button type="submit" disabled={saving}>
            {editingId ? "Update" : "Add"} gateway
          </button>
          {editingId && (
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </form>

        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Gateway ID</th>
                  <th>IP</th>
                  <th>Location</th>
                  <th>Machines</th>
                  <th>Last heartbeat</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {page.pageItems.map((g) => (
                  <Fragment key={g.gatewayId}>
                    <tr>
                      <td>
                        <span
                          className="badge"
                          style={{ background: g.online ? "#1a7f37" : "#8c959f" }}
                          title={g.online ? "Heartbeat fresh" : "No recent heartbeat"}
                        >
                          {g.online ? "ONLINE" : "OFFLINE"}
                        </span>
                      </td>
                      <td>{g.gatewayId}</td>
                      <td>{g.ipAddress}</td>
                      <td>{g.location}</td>
                      <td>
                        <button type="button" onClick={() => toggleExpand(g.gatewayId)}>
                          {g.machineCount ?? 0} {expandedId === g.gatewayId ? "▲" : "▼"}
                        </button>
                      </td>
                      <td style={{ fontSize: 12, color: "#57606a" }}>
                        {g.lastHeartbeatAt ? new Date(g.lastHeartbeatAt).toLocaleString() : "—"}
                      </td>
                      <td style={{ display: "flex", gap: 4 }}>
                        <button type="button" onClick={() => editGateway(g)}>
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(g.gatewayId)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                    {expandedId === g.gatewayId && (
                      <tr>
                        <td colSpan={7} style={{ background: "#f6f8fa" }}>
                          {expandedMachines.length === 0 ? (
                            <span style={{ fontSize: 13, color: "#57606a" }}>No machines bound to this gateway.</span>
                          ) : (
                            <table>
                              <thead>
                                <tr>
                                  <th>Machine</th>
                                  <th>Connection</th>
                                  <th>Slave</th>
                                  <th>IP:Port</th>
                                  <th>Registers</th>
                                  <th>Active</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expandedMachines.map((m) => {
                                  const cm = connectionMeta(m.connectionType);
                                  return (
                                    <tr key={m.machineId}>
                                      <td>
                                        {m.machineId} — {m.machineName}
                                      </td>
                                      <td>
                                        <span className="badge" style={{ background: cm.color }}>
                                          {cm.label}
                                        </span>
                                      </td>
                                      <td>{m.modbusSlaveId ?? "—"}</td>
                                      <td>{m.modbusIp ? `${m.modbusIp}:${m.modbusPort ?? "?"}` : "—"}</td>
                                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                                        {m.registerMap ? JSON.stringify(m.registerMap) : "—"}
                                      </td>
                                      <td>{m.isActive ? "yes" : "no"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {gateways.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={7}>No gateways registered yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page.page}
            pageCount={page.pageCount}
            total={page.total}
            pageSize={page.pageSize}
            onPageChange={page.setPage}
          />
        </div>
      </section>
    </div>
  );
}
