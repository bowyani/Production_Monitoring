import { MOCK, DEMO_MODE, DemoLockedError, notifyDemoLocked, isDemoLocked } from "./demo";
import { mockApi } from "./mock/mockApi";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", undefined]);

// Re-exported for existing importers (DemoLockModal, pages) — canonical home is
// ./demo now.
export { DEMO_MODE, DemoLockedError, notifyDemoLocked };
export { REPO_URL, MAIN_BRANCH_URL } from "./demo";

// Coarse column every view reads. "MQTT"/"MANUAL" were renamed to these when
// the connection model was added (see backend migration
// add_gateway_and_connection_config).
export type DataSource = "SIMULATOR" | "MODBUS_GATEWAY" | "MANUAL_CSV";

// Precise connection kind, from MachineConnectionConfig. MODBUS_TCP/RTU both
// roll up to data_source MODBUS_GATEWAY.
export type ConnectionType = "SIMULATOR" | "MODBUS_TCP" | "MODBUS_RTU" | "MANUAL_CSV";

export type Machine = {
  machineId: string;
  machineName: string;
  machineModel: string | null;
  status: string;
  lastSeenAt: string | null;
  lastImportedAt: string | null;
  isActive: boolean;
  dataSource: DataSource;
  connectionType: ConnectionType | null;
  ratedPowerKw: number | null;
  laborCostPerHour: number | null;
  targetCycleTimeSec: number | null;
  maintenanceIntervalHours: number | null;
  lastMaintenanceAt: string;
  runHoursSinceMaintenance?: number;
  maintenanceDue?: boolean;
  vendorName: string | null;
  purchaseDate: string | null;
  location: string | null;
  manufacturerPhone: string | null;
};

// ERP master data for machine assets (schema.prisma ErpMachineAsset) — the
// pick-list Admin registers machines from, and the only place these fields
// are editable. `registered` reflects whether an operational Machine already
// exists for this assetId (see GET /erp/machine-assets).
export type ErpMachineAsset = {
  assetId: string;
  machineName: string;
  machineModel: string | null;
  ratedPowerKw: number | null;
  laborCostPerHour: number | null;
  targetCycleTimeSec: number | null;
  maintenanceIntervalHours: number | null;
  vendorName: string | null;
  purchaseDate: string | null;
  location: string | null;
  manufacturerPhone: string | null;
  createdAt: string;
  updatedAt: string;
  registered: boolean;
};

// Mock "order obtained from ERP" (schema.prisma ErpJobOrder) — Job
// Number/SKU/Quantity only, deliberately decoupled from the real production
// numbers on ProductionJob. Auto-populated by the backend as jobs start
// (see mqtt/subscriber.ts), but also directly editable here like SKU Pricing.
export type ErpJobOrder = {
  jobNumber: string;
  productCode: string;
  quantityOrdered: number;
  createdAt: string;
  updatedAt: string;
};

// Protocol Gateway (schema.prisma Gateway) — the box that polls real PLCs
// over Modbus and republishes them as MQTT. `online` is derived server-side
// from heartbeat freshness; `status` is the last written value.
export type Gateway = {
  gatewayId: string;
  ipAddress: string;
  location: string;
  lastHeartbeatAt: string | null;
  status: "ONLINE" | "OFFLINE";
  online: boolean;
  machineCount?: number;
  createdAt: string;
  updatedAt: string;
};

// One row of GET /admin/gateways/:id/machines — the machines bound to a gateway.
export type GatewayMachine = {
  machineId: string;
  machineName: string;
  connectionType: ConnectionType;
  modbusSlaveId: number | null;
  modbusIp: string | null;
  modbusPort: number | null;
  registerMap: Record<string, number> | null;
  isActive: boolean;
  status: string;
};

export type Alarm = {
  id: string;
  machineId: string;
  jobNumber: string | null;
  alarmCode: string;
  alarmMessage: string;
  alarmTimestamp: string;
  clearedTimestamp: string | null;
};

export type ProductionJob = {
  jobNumber: string;
  machineId: string;
  productCode: string;
  moldId: string | null;
  recipeId: string | null;
  startTime: string;
  endTime: string | null;
  goodQty: number;
  rejectQty: number;
  startupScrapQty: number;
  status: string;
  alarms?: Alarm[];
};

export type TelemetryPoint = {
  id: string;
  machineId: string;
  timestamp: string;
  status: string;
  cycleTimeSec: string | null;
  shotCount: number | null;
  injectionPressureBar: string | null;
  barrelTemperatureC: string | null;
};

export type StatusEvent = {
  id: string;
  machineId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
};

export type MachineKpi = {
  machineId: string;
  machineName: string;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  rejectRate: number | null;
  runtimeHours: number;
  avgCycleTimeSec: number | null;
  targetCycleTimeSec: number | null;
  ratedPowerKw: number | null;
  estimatedEnergyKwh: number | null;
  laborCostPerHour: number | null;
  estimatedLaborCost: number | null;
  goodQty: number;
  rejectQty: number;
  startupScrapQty: number;
};

export type KpiSummary = {
  from: string;
  to: string;
  machines: MachineKpi[];
  fleet: {
    availability: number | null;
    performance: number | null;
    quality: number | null;
    rejectRate: number | null;
    goodQty: number;
    rejectQty: number;
    startupScrapQty: number;
    estimatedEnergyKwh: number | null;
    estimatedLaborCost: number | null;
  };
};

export type ProductSku = {
  productCode: string;
  description: string | null;
  unitPriceThb: number;
  materialCostPerUnitThb: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ErpRollup = {
  key: string;
  jobCount: number;
  goodQty: number;
  rejectQty: number;
  revenueThb: number | null;
  materialCostThb: number | null;
  laborCostThb: number | null;
  marginThb: number | null;
  marginPerHourThb: number | null;
  rejectMaterialLossThb: number | null;
};

export type ErpSummary = {
  from: string;
  to: string;
  unpricedJobCount: number;
  totals: Omit<ErpRollup, "key" | "jobCount" | "rejectMaterialLossThb">;
  bySku: ErpRollup[];
  byMachine: ErpRollup[];
};

export type MaintenanceReason = { alarmCode: string; alarmMessage: string; count: number; hours: number };

export type MachineMaintenance = {
  machineId: string;
  machineName: string;
  machineModel: string | null;
  dataSource: DataSource;
  runHoursSinceMaintenance: number;
  maintenanceIntervalHours: number | null;
  pctOfInterval: number | null;
  maintenanceDue: boolean;
  statusHours: Record<string, number> | null;
  intentionalDowntimeHours: number | null;
  errorDowntimeHours: number | null;
  offlineHours: number | null;
  otherDowntimeHours: number | null;
  alarmCount: number;
  topReasons: MaintenanceReason[];
};

export type ModelRollup = {
  machineModel: string;
  machineCount: number;
  totalErrorDowntimeHours: number;
  totalIntentionalDowntimeHours: number;
  totalOfflineHours: number;
  totalOtherDowntimeHours: number;
  totalAlarmCount: number;
  machinesOverdue: number;
  topReasons: MaintenanceReason[];
};

export type MaintenanceOverview = {
  from: string;
  to: string;
  machines: MachineMaintenance[];
  byModel: ModelRollup[];
};

export type AuditLogEntry = {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  createdAt: string;
};

export type SystemStats = {
  machines: { total: number; active: number; manual: number };
  rowCounts: Record<string, number>;
  telemetry: {
    oldest: string | null;
    newest: string | null;
    rowsLast60s: number;
    rowsLast5m: number;
    estimatedRowsPerSecond: number;
  };
  database: {
    totalSizePretty: string | null;
    totalSizeBytes: number | null;
    tables: { name: string; sizePretty: string; sizeBytes: number }[];
  };
};

// Mirrors simulator/src/index.ts's Tuning type. Every simulator publishes its
// current values retained over MQTT on connect/change (see
// backend/src/mqtt/subscriber.ts), so `tuning` is null only for a machine
// whose simulator hasn't come up yet.
export type SimulatorTuning = {
  tickMs: number;
  silentProbability: number;
  alarmProbability: number;
  rejectProbability: number;
  cycleTimeMinSec: number;
  cycleTimeMaxSec: number;
  pressureMinBar: number;
  pressureMaxBar: number;
  temperatureMinC: number;
  temperatureMaxC: number;
  // Shots after a mold/job change treated as purge scrap, not reject — lives
  // here (not on ErpMachineAsset) since the simulator is the only consumer.
  startupScrapQty: number;
};

export const SIMULATOR_DEFAULT_TUNING: SimulatorTuning = {
  tickMs: 2000,
  silentProbability: 0.2,
  alarmProbability: 0.015,
  rejectProbability: 0.03,
  cycleTimeMinSec: 9,
  cycleTimeMaxSec: 16,
  pressureMinBar: 700,
  pressureMaxBar: 950,
  temperatureMinC: 195,
  temperatureMaxC: 245,
  startupScrapQty: 3,
};

export type ImportResult = {
  created: number;
  updated: number;
  failed: { row: number; error: string }[];
  totalRows: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (DEMO_MODE && !SAFE_METHODS.has(init?.method)) {
    notifyDemoLocked();
    throw new DemoLockedError();
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (isDemoLocked(res.status, body)) {
      notifyDemoLocked();
      throw new DemoLockedError();
    }
    throw new Error(body.error ? JSON.stringify(body.error) : `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Raw DELETE helper for the few callers that inspect the Response themselves.
// In demo mode it never touches the network: it fires the dialog and hands back
// a synthetic 403 so `res.ok` checks still fail cleanly.
async function rawMutate(path: string, init: RequestInit): Promise<Response> {
  if (DEMO_MODE && !SAFE_METHODS.has(init.method)) {
    notifyDemoLocked();
    return new Response(JSON.stringify({ error: "READ_ONLY_DEMO" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const res = await fetch(`${API_BASE}${path}`, init);
  if (res.status === 403) {
    const body = await res
      .clone()
      .json()
      .catch(() => ({}));
    if (isDemoLocked(res.status, body)) notifyDemoLocked();
  }
  return res;
}

function qs(params: Record<string, string | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v);
  return entries.length ? `?${new URLSearchParams(entries as [string, string][]).toString()}` : "";
}

const realApi = {
  getMachines: () => request<Machine[]>("/machines"),
  getActiveAlarms: () => request<Alarm[]>("/alarms/active"),
  getJob: (jobNumber: string) => request<ProductionJob>(`/jobs/${encodeURIComponent(jobNumber)}`),
  searchJobs: (params: {
    machineId?: string;
    q?: string;
    productCode?: string;
    status?: string;
    from?: string;
    to?: string;
    sort?: string;
    dir?: string;
    limit?: string;
  }) => request<ProductionJob[]>(`/jobs${qs(params)}`),
  getMachineHistory: (machineId: string, from?: string, to?: string) =>
    request<TelemetryPoint[]>(`/machines/${encodeURIComponent(machineId)}/history${qs({ from, to })}`),
  getMachineEvents: (machineId: string, from?: string, to?: string) =>
    request<StatusEvent[]>(`/machines/${encodeURIComponent(machineId)}/events${qs({ from, to })}`),
  getMachineAlarms: (machineId: string, from?: string, to?: string) =>
    request<Alarm[]>(`/machines/${encodeURIComponent(machineId)}/alarms${qs({ from, to })}`),
  getKpiSummary: (from?: string, to?: string) => request<KpiSummary>(`/kpi/summary${qs({ from, to })}`),
  adminListMachines: () => request<Machine[]>("/admin/machines"),
  adminCreateMachine: (data: { assetId: string; dataSource?: "SIMULATOR" | "MANUAL_CSV" }) =>
    request<Machine & { simulator?: { ok: boolean; reason?: string; reused?: boolean } }>("/admin/machines", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  // Physical machine (Modbus via a Gateway) — no container is started.
  adminManualRegisterMachine: (data: {
    assetId: string;
    connectionType: "MODBUS_TCP" | "MODBUS_RTU";
    gatewayId: string;
    modbusSlaveId: number;
    modbusIp?: string;
    modbusPort?: number;
    registerMap?: Record<string, number>;
  }) =>
    request<Machine>("/admin/machines/manual-register", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getGateways: () => request<Gateway[]>("/admin/gateways"),
  createGateway: (data: { ipAddress: string; location: string; status?: "ONLINE" | "OFFLINE" }) =>
    request<Gateway>("/admin/gateways", { method: "POST", body: JSON.stringify(data) }),
  updateGateway: (
    gatewayId: string,
    data: { ipAddress?: string; location?: string; status?: "ONLINE" | "OFFLINE"; lastHeartbeatAt?: string | null }
  ) =>
    request<Gateway>(`/admin/gateways/${encodeURIComponent(gatewayId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteGateway: (gatewayId: string) =>
    rawMutate(`/admin/gateways/${encodeURIComponent(gatewayId)}`, { method: "DELETE" }),
  getGatewayMachines: (gatewayId: string) =>
    request<GatewayMachine[]>(`/admin/gateways/${encodeURIComponent(gatewayId)}/machines`),
  adminPatchMachine: (machineId: string, data: { isActive?: boolean }) =>
    request<Machine & { simulator?: { ok: boolean; reason?: string } }>(
      `/admin/machines/${encodeURIComponent(machineId)}`,
      { method: "PATCH", body: JSON.stringify(data) }
    ),
  adminLogMaintenance: (machineId: string) =>
    request<Machine>(`/admin/machines/${encodeURIComponent(machineId)}/maintenance`, { method: "POST" }),
  getMachineAssets: () => request<ErpMachineAsset[]>("/erp/machine-assets"),
  setMachineAsset: (
    assetId: string,
    data: {
      machineName: string;
      machineModel?: string;
      ratedPowerKw?: number;
      laborCostPerHour?: number;
      targetCycleTimeSec?: number;
      maintenanceIntervalHours?: number;
      vendorName?: string;
      purchaseDate?: string;
      location?: string;
      manufacturerPhone?: string;
    }
  ) =>
    request<ErpMachineAsset>(`/erp/machine-assets/${encodeURIComponent(assetId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteMachineAsset: (assetId: string) =>
    rawMutate(`/erp/machine-assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }),
  getAuditLog: (params: { targetId?: string; action?: string; limit?: string }) =>
    request<AuditLogEntry[]>(`/admin/audit-log${qs(params)}`),
  getSystemStats: () => request<SystemStats>("/admin/system-stats"),
  importJobs: (machineId: string, csvText: string) =>
    request<ImportResult>("/admin/import/jobs", { method: "POST", body: JSON.stringify({ machineId, csvText }) }),
  getSkus: () => request<ProductSku[]>("/erp/skus"),
  setSkuPrice: (
    productCode: string,
    data: { description?: string; unitPriceThb: number; materialCostPerUnitThb?: number }
  ) =>
    request<ProductSku>(`/erp/skus/${encodeURIComponent(productCode)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteSku: (productCode: string) =>
    rawMutate(`/erp/skus/${encodeURIComponent(productCode)}`, { method: "DELETE" }),
  getErpJobOrders: () => request<ErpJobOrder[]>("/erp/job-orders"),
  setErpJobOrder: (jobNumber: string, data: { productCode: string; quantityOrdered: number }) =>
    request<ErpJobOrder>(`/erp/job-orders/${encodeURIComponent(jobNumber)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteErpJobOrder: (jobNumber: string) =>
    rawMutate(`/erp/job-orders/${encodeURIComponent(jobNumber)}`, { method: "DELETE" }),
  getErpSummary: (from?: string, to?: string) => request<ErpSummary>(`/erp/summary${qs({ from, to })}`),
  getMaintenanceOverview: (from?: string, to?: string) =>
    request<MaintenanceOverview>(`/maintenance/overview${qs({ from, to })}`),
  getSimulatorParams: (machineId: string) =>
    request<{ machineId: string; tuning: SimulatorTuning | null }>(
      `/admin/machines/${encodeURIComponent(machineId)}/simulator/params`
    ),
  patchSimulatorParams: (machineId: string, patch: Partial<SimulatorTuning>) =>
    request<{ ok: boolean; applied: Partial<SimulatorTuning> }>(
      `/admin/machines/${encodeURIComponent(machineId)}/simulator/params`,
      { method: "PATCH", body: JSON.stringify(patch) }
    ),
};

export type Api = typeof realApi;

// VITE_MOCK build: no backend, lib/mock serves everything.
export const api: Api = MOCK ? mockApi : realApi;
