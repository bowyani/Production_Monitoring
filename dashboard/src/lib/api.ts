const API_BASE = import.meta.env.VITE_API_BASE_URL;

export type Machine = {
  machineId: string;
  machineName: string;
  status: string;
  lastSeenAt: string | null;
  isActive: boolean;
  ratedPowerKw: number | null;
  laborCostPerHour: number | null;
  targetCycleTimeSec: number | null;
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
  searchJobs: (params: { machineId?: string; q?: string }) =>
    request<ProductionJob[]>(`/jobs${qs(params)}`),
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
    ratedPowerKw?: number;
    laborCostPerHour?: number;
    targetCycleTimeSec?: number;
  }) => request<Machine>("/admin/machines", { method: "POST", body: JSON.stringify(data) }),
  adminPatchMachine: (
    machineId: string,
    data: {
      machineName?: string;
      isActive?: boolean;
      ratedPowerKw?: number | null;
      laborCostPerHour?: number | null;
      targetCycleTimeSec?: number | null;
    }
  ) =>
    request<Machine>(`/admin/machines/${encodeURIComponent(machineId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};
