import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ProductSku, type ErpMachineAsset, type ErpJobOrder } from "../lib/api";
import { usePagination } from "../lib/usePagination";
import Pagination from "../components/Pagination";

function thb(v: number | null, digits = 0) {
  return v == null ? "—" : `฿${v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

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

type OrderForm = { jobNumber: string; productCode: string; quantityOrdered: string };
const emptyOrderForm: OrderForm = { jobNumber: "", productCode: "", quantityOrdered: "" };

export default function ErpView() {
  const [skus, setSkus] = useState<ProductSku[]>([]);
  const [assets, setAssets] = useState<ErpMachineAsset[]>([]);
  const [orders, setOrders] = useState<ErpJobOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const [orderForm, setOrderForm] = useState<OrderForm>(emptyOrderForm);
  const [savingOrder, setSavingOrder] = useState(false);
  const [editingOrderNumber, setEditingOrderNumber] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [sk, ma, jo] = await Promise.all([api.getSkus(), api.getMachineAssets(), api.getErpJobOrders()]);
      setSkus(sk);
      setAssets(ma);
      setOrders(jo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load ERP data");
    }
  }

  useEffect(() => {
    load();
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
    if (!confirm(`Remove ERP asset ${assetId}? This only works if it isn't registered as a machine in Machine Management.`)) return;
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

  function editOrder(o: ErpJobOrder) {
    setOrderForm({ jobNumber: o.jobNumber, productCode: o.productCode, quantityOrdered: String(o.quantityOrdered) });
    setEditingOrderNumber(o.jobNumber);
  }

  function resetOrderForm() {
    setOrderForm(emptyOrderForm);
    setEditingOrderNumber(null);
  }

  async function saveOrder(e: React.FormEvent) {
    e.preventDefault();
    const jobNumber = orderForm.jobNumber.trim();
    if (!jobNumber || !orderForm.productCode.trim() || orderForm.quantityOrdered === "") return;

    // Adding new (not editing) with a Job Number that already exists — most
    // often one a running job already auto-created — would silently
    // overwrite it via the upsert endpoint. Same guard as Machine Assets.
    if (editingOrderNumber === null && orders.some((o) => o.jobNumber === jobNumber)) {
      alert(`Job Number "${jobNumber}" already exists — use a different one, or click Edit on the existing row to change it.`);
      return;
    }

    setError(null);
    setSavingOrder(true);
    try {
      await api.setErpJobOrder(jobNumber, {
        productCode: orderForm.productCode.trim(),
        quantityOrdered: Number(orderForm.quantityOrdered),
      });
      resetOrderForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save job order");
    } finally {
      setSavingOrder(false);
    }
  }

  async function removeOrder(jobNumber: string) {
    if (!confirm(`Remove job order ${jobNumber}?`)) return;
    await api.deleteErpJobOrder(jobNumber);
    await load();
  }

  const assetsPage = usePagination(assets, 8);
  const skusPage = usePagination(skus, 10);
  const ordersPage = usePagination(orders, 10);

  return (
    <div className="app-shell">
      <div className="page-title">
        <h1>ERP (Mock) — Master Data</h1>
        <div className="page-subtitle">
          Level 4 view (see README Automation Pyramid): machine specs, SKU prices, and job orders — a small
          admin-editable master-data set, not a real ERP integration. Revenue/margin analysis using this data
          moved to <Link to="/kpi">Executive KPI</Link>.
        </div>
      </div>
      {error && <div className="notice notice-error">{error}</div>}

      <section>
        <h2>Machine Assets (mock ERP master data)</h2>
        <p style={{ fontSize: 12, color: "#57606a" }}>
          Single source of truth for machine specs. Machine Management registers a machine by picking a row
          here — it no longer accepts these fields as free text, which used to let the same physical machine
          get registered twice with mismatched specs.
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
            placeholder="Location (e.g. Building A)"
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
          <Link to="/chief-operator">Machine Management</Link> — it always reads the current values, so
          there's nothing to keep in sync. An asset can't be removed while a machine still references it
          (this prototype has no "unregister" action, only activate/deactivate). Startup Scrap is a live
          simulator behavior, not a spec — adjust it on <Link to="/simulator-tuning">Simulator Tuning</Link>.
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
        <p style={{ fontSize: 12, color: "#57606a" }}>
          Mock "order obtained from ERP" — Job Number, SKU, and quantity ordered only. A row is created
          automatically whenever a production job starts (matching its Job Number/SKU), so this stays
          populated without hand-keying it; you can also add/edit one directly below. Actual good/reject
          quantities produced live on the job itself — see <Link to="/production">Production</Link> for the
          ordered-vs-good comparison (an order is fulfilled by good units delivered, not total shots run —
          reject/scrap don't count toward it).
        </p>
        <form onSubmit={saveOrder} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            value={orderForm.jobNumber}
            onChange={(e) => setOrderForm({ ...orderForm, jobNumber: e.target.value })}
            placeholder="Job Number"
            style={{ padding: 6, width: 220 }}
            required
            disabled={editingOrderNumber !== null}
          />
          <input
            value={orderForm.productCode}
            onChange={(e) => setOrderForm({ ...orderForm, productCode: e.target.value })}
            placeholder="SKU / Product Code"
            style={{ padding: 6, width: 160 }}
            required
          />
          <input
            value={orderForm.quantityOrdered}
            onChange={(e) => setOrderForm({ ...orderForm, quantityOrdered: e.target.value })}
            placeholder="Quantity"
            type="number"
            min="0"
            step="1"
            style={{ padding: 6, width: 110 }}
            required
          />
          <button type="submit" disabled={savingOrder}>
            {editingOrderNumber !== null ? "Update" : "Add"} order
          </button>
          {orderForm.jobNumber && (
            <button type="button" onClick={resetOrderForm}>
              Cancel
            </button>
          )}
        </form>
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Job Number</th>
                  <th>SKU</th>
                  <th>Quantity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ordersPage.pageItems.map((o) => (
                  <tr key={o.jobNumber}>
                    <td>{o.jobNumber}</td>
                    <td>{o.productCode}</td>
                    <td>{o.quantityOrdered}</td>
                    <td style={{ display: "flex", gap: 4 }}>
                      <button type="button" onClick={() => editOrder(o)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => removeOrder(o.jobNumber)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={4}>No job orders yet.</td>
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
