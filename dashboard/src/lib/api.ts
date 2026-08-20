const API_BASE = import.meta.env.VITE_API_BASE_URL;

export type Machine = {
  machineId: string;
  machineName: string;
  status: string;
  lastSeenAt: string | null;
  isActive: boolean;
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
  alarms: Alarm[];
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

export const api = {
  getMachines: () => request<Machine[]>("/machines"),
  getActiveAlarms: () => request<Alarm[]>("/alarms/active"),
  getJob: (jobNumber: string) => request<ProductionJob>(`/jobs/${encodeURIComponent(jobNumber)}`),
  getMachineHistory: (machineId: string) =>
    request<unknown[]>(`/machines/${encodeURIComponent(machineId)}/history`),
  adminListMachines: () => request<Machine[]>("/admin/machines"),
  adminCreateMachine: (data: { machineId: string; machineName: string }) =>
    request<Machine>("/admin/machines", { method: "POST", body: JSON.stringify(data) }),
  adminPatchMachine: (machineId: string, data: { machineName?: string; isActive?: boolean }) =>
    request<Machine>(`/admin/machines/${encodeURIComponent(machineId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};
