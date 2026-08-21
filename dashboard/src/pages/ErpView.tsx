import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ErpSummary, type JobOrder, type ProductSku, type ErpMachineAsset } from "../lib/api";
import BlindSpotNote from "../components/BlindSpotNote";
import { DivergingBarChart, HBarChart } from "../components/Bars";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function thb(v: number | null, digits = 0) {
  return v == null ? "—" : `฿${v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

const card: React.CSSProperties = { border: "1px solid #d0d7de", borderRadius: 8, padding: 12 };
const sectionTitle: React.CSSProperties = { fontSize: 12, color: "#57606a" };
const bigValue: React.CSSProperties = { fontSize: 22, fontWeight: 700 };

type AssetForm = {
  assetId: string;
  machineName: string;
  machineModel: string;
  ratedPowerKw: string;
  laborCostPerHour: string;
  targetCycleTimeSec: string;
  maintenanceIntervalHours: string;
  vendorName: string;
  purchaseDate: string;
  location: string;
  manufacturerPhone: string;
};

const emptyAssetForm: AssetForm = {
  assetId: "",
  machineName: "",
  machineModel: "",
  ratedPowerKw: "",
  laborCostPerHour: "",
  targetCycleTimeSec: "",
  maintenanceIntervalHours: "",
  vendorName: "",
  purchaseDate: "",
  location: "",
  manufacturerPhone: "",
};

function toAssetForm(a: ErpMachineAsset): AssetForm {
  return {
    assetId: a.assetId,
    machineName: a.machineName,
    machineModel: a.machineModel ?? "",
    ratedPowerKw: a.ratedPowerKw?.toString() ?? "",
    laborCostPerHour: a.laborCostPerHour?.toString() ?? "",
    targetCycleTimeSec: a.targetCycleTimeSec?.toString() ?? "",
    maintenanceIntervalHours: a.maintenanceIntervalHours?.toString() ?? "",
    vendorName: a.vendorName ?? "",
    purchaseDate: a.purchaseDate ? a.purchaseDate.slice(0, 10) : "",
    location: a.location ?? "",
    manufacturerPhone: a.manufacturerPhone ?? "",
  };
}

export default function ErpView() {
  const [from, setFrom] = useState(() => toLocalInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toLocalInputValue(new Date()));
  const [summary, setSummary] = useState<ErpSummary | null>(null);
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [skus, setSkus] = useState<ProductSku[]>([]);
  const [assets, setAssets] = useState<ErpMachineAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualMachineCount, setManualMachineCount] = useState(0);
  const [inactiveMachineCount, setInactiveMachineCount] = useState(0);

  const [editCode, setEditCode] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCost, setEditCost] = useState("");
  const [saving, setSaving] = useState(false);

  const [assetForm, setAssetForm] = useState<AssetForm>(emptyAssetForm);
  const [savingAsset, setSavingAsset] = useState(false);
  // Tracks whether the form was opened via "Edit" on an existing row — the
  // PUT endpoint upserts by assetId, so without this the Add form would
  // silently overwrite an existing asset if the user typed a duplicate ID.
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [s, o, sk, ma] = await Promise.all([
        api.getErpSummary(new Date(from).toISOString(), new Date(to).toISOString()),
        api.getJobOrders({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), limit: "200" }),
        api.getSkus(),
        api.getMachineAssets(),
      ]);
      setSummary(s);
      setOrders(o);
      setSkus(sk);
      setAssets(ma);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load ERP data");
    }
  }

  useEffect(() => {
    load();
    api
      .adminListMachines()
      .then((list) => {
        setManualMachineCount(list.filter((m) => m.dataSource === "MANUAL").length);
        setInactiveMachineCount(list.filter((m) => !m.isActive).length);
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function editAsset(a: ErpMachineAsset) {
    setAssetForm(toAssetForm(a));
    setEditingAssetId(a.assetId);
  }

  function resetAssetForm() {
    setAssetForm(emptyAssetForm);
    setEditingAssetId(null);
  }

  async function saveAsset(e: React.FormEvent) {
    e.preventDefault();
    const assetId = assetForm.assetId.trim();
    if (!assetId || !assetForm.machineName.trim()) return;

    // Adding new (not editing) with an ID that already exists would silently
    // overwrite that asset via the upsert endpoint — block it with an alert
    // (same attention level as the confirm() below) and point the user at
    // Edit instead.
    if (editingAssetId === null && assets.some((a) => a.assetId === assetId)) {
      alert(`Machine ID "${assetId}" already exists — use a different ID, or click Edit on the existing row to change it.`);
      return;
    }

    setError(null);
    setSavingAsset(true);
    try {
      await api.setMachineAsset(assetForm.assetId.trim(), {
        machineName: assetForm.machineName.trim(),
        machineModel: assetForm.machineModel.trim() || undefined,
        ratedPowerKw: assetForm.ratedPowerKw === "" ? undefined : Number(assetForm.ratedPowerKw),
        laborCostPerHour: assetForm.laborCostPerHour === "" ? undefined : Number(assetForm.laborCostPerHour),
        targetCycleTimeSec: assetForm.targetCycleTimeSec === "" ? undefined : Number(assetForm.targetCycleTimeSec),
        maintenanceIntervalHours:
          assetForm.maintenanceIntervalHours === "" ? undefined : Number(assetForm.maintenanceIntervalHours),
        vendorName: assetForm.vendorName.trim() || undefined,
        purchaseDate: assetForm.purchaseDate || undefined,
        location: assetForm.location.trim() || undefined,
        manufacturerPhone: assetForm.manufacturerPhone.trim() || undefined,
      });
      resetAssetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save machine asset");
    } finally {
      setSavingAsset(false);
    }
  }

  async function removeAsset(assetId: string) {
    if (!confirm(`Remove ERP asset ${assetId}? This only works if it isn't registered as a machine in Admin.`)) return;
    const res = await api.deleteMachineAsset(assetId);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `failed to remove asset ${assetId}`);
      return;
    }
    await load();
  }

  function editSku(sku: ProductSku) {
    setEditCode(sku.productCode);
    setEditDesc(sku.description ?? "");
    setEditPrice(String(sku.unitPriceThb));
    setEditCost(sku.materialCostPerUnitThb != null ? String(sku.materialCostPerUnitThb) : "");
  }

  function resetEdit() {
    setEditCode("");
    setEditDesc("");
    setEditPrice("");
    setEditCost("");
  }

  async function saveSku(e: React.FormEvent) {
    e.preventDefault();
    if (!editCode.trim() || !editPrice) return;
    setSaving(true);
    try {
      await api.setSkuPrice(editCode.trim(), {
        description: editDesc.trim() || undefined,
        unitPriceThb: Number(editPrice),
        materialCostPerUnitThb: editCost ? Number(editCost) : undefined,
      });
      resetEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save SKU price");
    } finally {
      setSaving(false);
    }
  }

  async function removeSku(productCode: string) {
    if (!confirm(`Remove mock price for ${productCode}?`)) return;
    await api.deleteSku(productCode);
    await load();
  }

  const assetsPage = usePagination(assets, 8);
  const skusPage = usePagination(skus, 10);
  const ordersPage = usePagination(orders, 10);

  return (
    <div className="app-shell">
      <div className="page-title">
        <h1>ERP (Mock) — Job Orders &amp; SKU Pricing</h1>
        <div className="page-subtitle">
          Level 4 view (see README Automation Pyramid): prices below are a small admin-editable price book, not a
          real ERP integration — good enough to show where revenue, cost, and margin actually sit.
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="toolbar"
      >
        <label>
          From <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit">Load</button>
      </form>
      {error && <div className="notice notice-error">{error}</div>}

      <BlindSpotNote manualCount={manualMachineCount} inactiveCount={inactiveMachineCount} />

      {summary && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
            <div style={card}>
              <div style={sectionTitle}>Revenue</div>
              <div style={bigValue}>{thb(summary.totals.revenueThb)}</div>
            </div>
            <div style={card}>
              <div style={sectionTitle}>Material Cost</div>
              <div style={bigValue}>{thb(summary.totals.materialCostThb)}</div>
            </div>
            <div style={card}>
              <div style={sectionTitle}>Labor Cost</div>
              <div style={bigValue}>{thb(summary.totals.laborCostThb)}</div>
            </div>
            <div style={{ ...card, borderColor: (summary.totals.marginThb ?? 0) < 0 ? "#cf222e" : "#d0d7de" }}>
              <div style={sectionTitle}>Gross Margin</div>
              <div style={{ ...bigValue, color: (summary.totals.marginThb ?? 0) < 0 ? "#cf222e" : undefined }}>
                {thb(summary.totals.marginThb)}
              </div>
            </div>
            <div style={card}>
              <div style={sectionTitle}>Margin / Runtime Hour</div>
              <div style={bigValue}>{thb(summary.totals.marginPerHourThb, 1)}</div>
            </div>
          </section>

          {summary.unpricedJobCount > 0 && (
            <div className="notice notice-warn" style={{ display: "inline-block" }}>
              ⚠ {summary.unpricedJobCount} job order(s) use a product code with no mock price set — excluded from
              the revenue/margin totals above. Add a price below to include them.
            </div>
          )}

          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <h2>Margin by SKU (฿/hr, worst first)</h2>
              <p style={{ fontSize: 12, color: "#57606a" }}>
                Lowest margin-per-runtime-hour first — the SKU at the top is the current bottleneck: it ties up
                machine time for the least (or negative) return.
              </p>
              <DivergingBarChart
                data={summary.bySku.map((r) => ({
                  label: r.key,
                  value: r.marginPerHourThb ?? 0,
                  sublabel: `${r.jobCount} job(s)`,
                  display: r.marginPerHourThb == null ? "—" : undefined,
                }))}
                formatValue={(v) => thb(v, 1)}
              />
            </div>
            <div>
              <h2>Margin by Machine (฿/hr, worst first)</h2>
              <DivergingBarChart
                data={summary.byMachine.map((r) => ({
                  label: r.key,
                  value: r.marginPerHourThb ?? 0,
                  sublabel: `${r.jobCount} job(s)`,
                  display: r.marginPerHourThb == null ? "—" : undefined,
                }))}
                formatValue={(v) => thb(v, 1)}
              />
            </div>
          </section>

          <section>
            <h2>Revenue by SKU</h2>
            <HBarChart
              data={[...summary.bySku].reverse().map((r) => ({
                label: r.key,
                value: r.revenueThb ?? 0,
                display: r.revenueThb == null ? "—" : undefined,
              }))}
              color="#0969da"
              formatValue={(v) => thb(v)}
            />
          </section>

          <section>
            <h2>Reject material loss by SKU</h2>
            <p style={{ fontSize: 12, color: "#57606a" }}>
              Material consumed by rejected/scrap units that earned no revenue — cost hiding inside the reject
              rate.
            </p>
            <HBarChart
              data={[...summary.bySku].reverse().map((r) => ({
                label: r.key,
                value: r.rejectMaterialLossThb ?? 0,
                display: r.rejectMaterialLossThb == null ? "—" : undefined,
              }))}
              color="#cf222e"
              formatValue={(v) => thb(v)}
            />
          </section>
        </>
      )}

      <section>
        <h2>Machine Assets (mock ERP master data)</h2>
        <p style={{ fontSize: 12, color: "#57606a" }}>
          Single source of truth for machine specs. Admin registers a machine by picking a row here — it no
          longer accepts these fields as free text, which used to let the same physical machine get
          registered twice with mismatched specs.
        </p>
        <form onSubmit={saveAsset} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            value={assetForm.assetId}
            onChange={(e) => setAssetForm({ ...assetForm, assetId: e.target.value })}
            placeholder="Asset/Machine ID (e.g. IMM-06)"
            style={{ padding: 6, width: 160 }}
            required
          />
          <input
            value={assetForm.machineName}
            onChange={(e) => setAssetForm({ ...assetForm, machineName: e.target.value })}
            placeholder="Name"
            style={{ padding: 6, width: 180 }}
            required
          />
          <input
            value={assetForm.machineModel}
            onChange={(e) => setAssetForm({ ...assetForm, machineModel: e.target.value })}
            placeholder="Model (e.g. Haitian MA1200)"
            style={{ padding: 6, width: 160 }}
          />
          <input
            value={assetForm.ratedPowerKw}
            onChange={(e) => setAssetForm({ ...assetForm, ratedPowerKw: e.target.value })}
            placeholder="Rated kW"
            inputMode="decimal"
            style={{ padding: 6, width: 90 }}
          />
          <input
            value={assetForm.laborCostPerHour}
            onChange={(e) => setAssetForm({ ...assetForm, laborCostPerHour: e.target.value })}
            placeholder="Labor $/hr"
            inputMode="decimal"
            style={{ padding: 6, width: 90 }}
          />
          <input
            value={assetForm.targetCycleTimeSec}
            onChange={(e) => setAssetForm({ ...assetForm, targetCycleTimeSec: e.target.value })}
            placeholder="Target Cycle (s)"
            inputMode="decimal"
            style={{ padding: 6, width: 110 }}
          />
          <input
            value={assetForm.maintenanceIntervalHours}
            onChange={(e) => setAssetForm({ ...assetForm, maintenanceIntervalHours: e.target.value })}
            placeholder="Maintenance interval (h)"
            inputMode="decimal"
            style={{ padding: 6, width: 150 }}
          />
          <input
            value={assetForm.location}
            onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })}
            placeholder="Location (e.g. Line 3, Bay 12)"
            style={{ padding: 6, width: 160 }}
          />
          <input
            value={assetForm.vendorName}
            onChange={(e) => setAssetForm({ ...assetForm, vendorName: e.target.value })}
            placeholder="Vendor"
            style={{ padding: 6, width: 150 }}
          />
          <input
            type="date"
            value={assetForm.purchaseDate}
            onChange={(e) => setAssetForm({ ...assetForm, purchaseDate: e.target.value })}
            style={{ padding: 6, width: 150 }}
          />
          <input
            value={assetForm.manufacturerPhone}
            onChange={(e) => setAssetForm({ ...assetForm, manufacturerPhone: e.target.value })}
            placeholder="Phone"
            style={{ padding: 6, width: 130 }}
          />
          <button type="submit" disabled={savingAsset}>
            {editingAssetId !== null ? "Update" : "Add"} asset
          </button>
          {assetForm.assetId && (
            <button type="button" onClick={resetAssetForm}>
              Cancel
            </button>
          )}
        </form>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name / Model</th>
                  <th>Rated kW</th>
                  <th>Labor $/hr</th>
                  <th>Target Cycle (s)</th>
                  <th>Maintenance</th>
                  <th>Location</th>
                  <th>Vendor / Purchased / Phone</th>
                  <th>Registered</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assetsPage.pageItems.map((a) => (
                  <tr key={a.assetId}>
                    <td>{a.assetId}</td>
                    <td>
                      {a.machineName}
                      {a.machineModel && <div style={{ fontSize: 12, color: "#57606a" }}>{a.machineModel}</div>}
                    </td>
                    <td>{a.ratedPowerKw ?? "—"}</td>
                    <td>{a.laborCostPerHour ?? "—"}</td>
                    <td>{a.targetCycleTimeSec ?? "—"}</td>
                    <td>{a.maintenanceIntervalHours != null ? `${a.maintenanceIntervalHours} h` : "—"}</td>
                    <td>{a.location ?? "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      {a.vendorName ?? "—"}
                      {a.purchaseDate && <div>bought {new Date(a.purchaseDate).toLocaleDateString()}</div>}
                      {a.manufacturerPhone && <div>☎ {a.manufacturerPhone}</div>}
                    </td>
                    <td>{a.registered ? "yes" : "—"}</td>
                    <td style={{ display: "flex", gap: 4 }}>
                      <button type="button" onClick={() => editAsset(a)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => removeAsset(a.assetId)} disabled={a.registered}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {assets.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={10}>No machine assets in ERP yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={assetsPage.page}
            pageCount={assetsPage.pageCount}
            total={assetsPage.total}
            pageSize={assetsPage.pageSize}
            onPageChange={assetsPage.setPage}
          />
        </div>
        <p style={{ fontSize: 13, color: "#57606a" }}>
          Specs can be edited here at any time, even after the asset is registered as a machine in{" "}
          <Link to="/admin">Admin</Link> — Admin always reads the current values, so there's nothing to keep
          in sync. An asset can't be removed while a machine still references it (this prototype has no
          "unregister" action in Admin, only activate/deactivate).
        </p>
      </section>

      <section>
        <h2>SKU Pricing (mock ERP master data)</h2>
        <form onSubmit={saveSku} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            value={editCode}
            onChange={(e) => setEditCode(e.target.value)}
            placeholder="Product Code (SKU)"
            style={{ padding: 6, width: 160 }}
            required
          />
          <input
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder="Description"
            style={{ padding: 6, width: 200 }}
          />
          <input
            value={editPrice}
            onChange={(e) => setEditPrice(e.target.value)}
            placeholder="Unit price (฿)"
            type="number"
            step="0.01"
            min="0"
            style={{ padding: 6, width: 130 }}
            required
          />
          <input
            value={editCost}
            onChange={(e) => setEditCost(e.target.value)}
            placeholder="Material cost/unit (฿)"
            type="number"
            step="0.01"
            min="0"
            style={{ padding: 6, width: 160 }}
          />
          <button type="submit" disabled={saving}>
            {editCode && skus.some((s) => s.productCode === editCode) ? "Update" : "Add"} price
          </button>
          {editCode && (
            <button type="button" onClick={resetEdit}>
              Cancel
            </button>
          )}
        </form>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Description</th>
                  <th>Unit Price</th>
                  <th>Material Cost/Unit</th>
                  <th>Margin/Unit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {skusPage.pageItems.map((s) => (
                  <tr key={s.productCode}>
                    <td>{s.productCode}</td>
                    <td>{s.description ?? "—"}</td>
                    <td>{thb(s.unitPriceThb, 2)}</td>
                    <td>{thb(s.materialCostPerUnitThb, 2)}</td>
                    <td>{s.materialCostPerUnitThb != null ? thb(s.unitPriceThb - s.materialCostPerUnitThb, 2) : "—"}</td>
                    <td>
                      <button type="button" onClick={() => editSku(s)}>
                        Edit
                      </button>{" "}
                      <button type="button" onClick={() => removeSku(s.productCode)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {skus.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={6}>No SKU prices configured yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={skusPage.page}
            pageCount={skusPage.pageCount}
            total={skusPage.total}
            pageSize={skusPage.pageSize}
            onPageChange={skusPage.setPage}
          />
        </div>
      </section>

      <section>
        <h2>Job Orders</h2>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Job Number</th>
                  <th>Machine</th>
                  <th>SKU</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Good</th>
                  <th>Reject</th>
                  <th>Revenue</th>
                  <th>Material Cost</th>
                  <th>Labor Cost</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {ordersPage.pageItems.map((o) => (
                  <tr key={o.jobNumber}>
                    <td>{o.jobNumber}</td>
                    <td>{o.machineId}</td>
                    <td>{o.productCode}</td>
                    <td>{new Date(o.startTime).toLocaleString()}</td>
                    <td>{o.status}</td>
                    <td>{o.goodQty}</td>
                    <td>{o.rejectQty}</td>
                    <td>{thb(o.revenueThb, 2)}</td>
                    <td>{thb(o.materialCostThb, 2)}</td>
                    <td>{thb(o.laborCostThb, 2)}</td>
                    <td style={{ color: o.marginThb != null && o.marginThb < 0 ? "#cf222e" : undefined }}>
                      {thb(o.marginThb, 2)}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={11}>No job orders in this window.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={ordersPage.page}
            pageCount={ordersPage.pageCount}
            total={ordersPage.total}
            pageSize={ordersPage.pageSize}
            onPageChange={ordersPage.setPage}
          />
        </div>
      </section>
    </div>
  );
}
