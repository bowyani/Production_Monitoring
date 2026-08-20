const API_BASE = import.meta.env.VITE_API_BASE_URL;

export type Machine = {
  machineId: string;
  machineName: string;
  machineModel: string | null;
  status: string;
  lastSeenAt: string | null;
  isActive: boolean;
  dataSource: "MQTT" | "MANUAL";
  ratedPowerKw: number | null;
  laborCostPerHour: number | null;
  targetCycleTimeSec: number | null;
  maintenanceIntervalHours: number | null;
  lastMaintenanceAt: string;
  runHoursSinceMaintenance?: number;
  maintenanceDue?: boolean;
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

export type ImportResult = {
  created: number;
  updated: number;
  failed: { row: number; error: string }[];
  totalRows: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `${res.status} ${res.statusText}`);
  }
  return res.json();
}

function qs(params: Record<string, string | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v);
  return entries.length ? `?${new URLSearchParams(entries as [string, string][]).toString()}` : "";
}

export const api = {
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
  adminCreateMachine: (data: {
    machineId: string;
    machineName: string;
    machineModel?: string;
    dataSource?: "MQTT" | "MANUAL";
    ratedPowerKw?: number;
    laborCostPerHour?: number;
    targetCycleTimeSec?: number;
    maintenanceIntervalHours?: number;
  }) => request<Machine & { simulator?: { ok: boolean; reason?: string; reused?: boolean } }>("/admin/machines", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  adminPatchMachine: (
    machineId: string,
    data: {
      machineName?: string;
      machineModel?: string | null;
      isActive?: boolean;
      ratedPowerKw?: number | null;
      laborCostPerHour?: number | null;
      targetCycleTimeSec?: number | null;
      maintenanceIntervalHours?: number | null;
    }
  ) =>
    request<Machine & { simulator?: { ok: boolean; reason?: string } }>(
      `/admin/machines/${encodeURIComponent(machineId)}`,
      { method: "PATCH", body: JSON.stringify(data) }
    ),
  adminLogMaintenance: (machineId: string) =>
    request<Machine>(`/admin/machines/${encodeURIComponent(machineId)}/maintenance`, { method: "POST" }),
  getAuditLog: (params: { targetId?: string; action?: string; limit?: string }) =>
    request<AuditLogEntry[]>(`/admin/audit-log${qs(params)}`),
  getSystemStats: () => request<SystemStats>("/admin/system-stats"),
  importJobs: (machineId: string, csvText: string) =>
    request<ImportResult>("/admin/import/jobs", { method: "POST", body: JSON.stringify({ machineId, csvText }) }),
};
